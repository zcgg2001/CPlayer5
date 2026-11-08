import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackRouter, playbackLevels, samePlaybackRecording, actualPlaybackQuality } from '../js/playback-router.js';
import { createPlaybackController } from '../js/playback-controller.js';
import { createQueueStore } from '../js/queue-store.js';
import { HttpStatusError, RequestCancelledError } from '../js/http.js';

const track={id:'123',provider:'gd',name:'晴天',artist:'周杰伦',album:'叶惠美',duration:269};
const playable=(provider,level='standard')=>({id:'123',sourceId:'123',provider,level,url:`https://audio.test/${provider}/${level}.flac`});
function harness(resolve, options={}) {
 const calls=[];const service={sourceForSong:()=>({provider:'gd'}),search:async()=>[],getSongAtLevel:async(id,level,opts)=>{calls.push({id,level,...opts});return resolve(id,level,opts);}};
 const router=createPlaybackRouter(service,options);return {router,service,calls};
}
test('each provider starts at its maximum and a ceiling constrains manual quality',()=>{
 assert.deepEqual(playbackLevels('gd'),['hires','lossless','exhigh','standard']);
 assert.deepEqual(playbackLevels('netease'),['lossless','exhigh','standard']);
 assert.deepEqual(playbackLevels('op-applemusic'),['hires','lossless','exhigh','standard']);
 assert.deepEqual(playbackLevels('op-qq','lossless'),['lossless','exhigh','standard']);
 assert.deepEqual(playbackLevels('chksz','exhigh'),['exhigh','standard']);
});
test('legacy numeric IDs can use exact NetEase IDs without search and start lossless',async()=>{
 const {router,calls}=harness((id,level,{source})=>playable(source,level));
 const next=await router.candidates('123').next();assert.equal(next.value.provider,'chksz');assert.equal(calls[0].id,'123');assert.equal(calls[0].level,'jymaster');
});
test('a selected search provider wins over global priority and latency for every channel',async()=>{
 for(const provider of ['gd','netease','chksz','op-netease','op-qq','op-applemusic','at38-qq','at38-netease','jianbin-netease','jianbin-qq','jianbin-kugou','jianbin-kuwo','gequke','bilibili']){
  const {router,calls}=harness((id,level,{source})=>playable(source,level));
  router.success({provider},29000);router.success({provider:'chksz'},10);
  const song={...track,provider,id:`${provider}:123`,sourceId:'123',preferredProvider:provider};
  const result=(await router.candidates(song.id,{song}).next()).value;
  assert.equal(result.provider,provider);assert.equal(result.requestedLevel,playbackLevels(provider)[0]);assert.equal(calls.length,1);
 }
});
test('selected source downgrades before falling back and preserves exact source IDs',async()=>{
 const {router,calls}=harness((id,level,{source})=>source==='op-netease'&&level==='hires'?null:playable(source,level));
 const song={...track,id:'op-netease:123',sourceId:'123',provider:'op-netease',preferredProvider:'op-netease'};
 const iterator=router.candidates(song.id,{song});
 const result=(await iterator.next()).value;assert.equal(result.provider,'op-netease');assert.equal(result.level,'lossless');
 assert.deepEqual(calls.map(x=>[x.source,x.level]),[['op-netease','hires'],['op-netease','lossless']]);
 assert.equal((await iterator.next({skipProvider:true})).value.provider,'chksz');
 assert.equal(calls[0].id,song.id);assert.equal(calls[2].id,'123');
});
test('a queued choice survives search-filter changes and is validated against its own candidates',async()=>{
 const {router,service}=harness((id,level,{source})=>playable(source,level));
 const queue=createQueueStore();const song={...track,provider:'op-qq',id:'op-qq:mid123',sourceId:'mid123',preferredProvider:'op-qq'};
 queue.insert(song);const saved=JSON.parse(JSON.stringify(queue.snapshot()));queue.clear();queue.restore(saved);
 service.sourceForSong=()=>({provider:'gd'});
 assert.equal((await router.candidates(song.id,{song:queue.state.playlist[0]}).next()).value.provider,'op-qq');
 assert.equal((await router.candidates(track.id,{song:{...track,preferredProvider:'op-qq'}}).next()).value.provider,'chksz');
});
test('selected sources still honor Retry-After and do not bypass a known provider refusal',async()=>{
 const {router,calls}=harness((id,level,{source})=>{if(source==='op-netease')throw new HttpStatusError(429,null,'600');return playable(source,level);});
 const song={...track,provider:'op-netease',id:'op-netease:123',sourceId:'123',preferredProvider:'op-netease'};
 assert.equal((await router.candidates(song.id,{song}).next()).value.provider,'chksz');
 assert.equal((await router.candidates(song.id,{song}).next()).value.provider,'chksz');
 assert.equal(calls.filter(x=>x.source==='op-netease').length,1);
});
test('unavailable quality downgrades on the same provider',async()=>{
 const {router,calls}=harness((id,level,{source})=>level==='jymaster'?null:playable(source,level));
 const {value}=await router.candidates(track.id,{song:track}).next();assert.equal(value.level,'hires');assert.deepEqual(calls.map(x=>x.level),['jymaster','hires']);
});
test('rate limits skip all remaining qualities and cool the provider across songs',async()=>{
 const {router,calls}=harness((id,level,{source})=>{if(source==='chksz')throw new HttpStatusError(429,null,'600');return playable(source,level);});
 assert.equal((await router.candidates(track.id,{song:track}).next()).value.provider,'netease');
 assert.equal((await router.candidates(track.id,{song:track}).next()).value.provider,'netease');
 assert.equal(calls.filter(x=>x.source==='chksz').length,1);assert.ok(router.health().chksz.until>Date.now()+500000);
});
test('media failure tries lower quality, transport failure moves to another provider',async()=>{
 const {router}=harness((id,level,{source})=>playable(source,level));const iterator=router.candidates(track.id,{song:track});
 assert.equal((await iterator.next()).value.level,'jymaster');
 assert.equal((await iterator.next({error:Error('codec')})).value.level,'hires');
 assert.equal((await iterator.next({skipProvider:true})).value.provider,'netease');
});
test('actual server downgrade skips redundant tiers on subsequent media failure',async()=>{
 const {router,calls}=harness((id,level,{source})=>playable(source,level==='jymaster'?'exhigh':level));const it=router.candidates(track.id,{song:track});
 await it.next();assert.equal((await it.next()).value.level,'standard');assert.deepEqual(calls.map(x=>x.level),['jymaster','standard']);
});
test('matching rejects covers, live versions, mismatched album and duration',()=>{
 assert.equal(samePlaybackRecording(track,{...track,provider:'qq',id:'abc'}),true);
 for(const change of [{artist:'另一个歌手'},{name:'晴天 (Live)'},{album:'另一张专辑'},{duration:220}])assert.equal(samePlaybackRecording(track,{...track,provider:'qq',id:'abc',...change}),false);
});
test('cross-platform fallback searches and uses matched source IDs rather than copying IDs',async()=>{
 const {router,service,calls}=harness((id,level,{source})=>{if(source!=='qq')throw new HttpStatusError(503);return playable(source,level);});
 service.search=async(query,{source})=>source==='qq'?[{...track,provider:'qq',id:'qq:mid',sourceId:'mid'}]:[];
 const result=(await router.candidates(track.id,{song:track}).next()).value;assert.equal(result.provider,'qq');assert.equal(calls.find(x=>x.source==='qq').id,'qq:mid');
});
test('abort exits without poisoning provider health',async()=>{
 const {router}=harness(()=>{throw new RequestCancelledError();});await assert.rejects(router.candidates(track.id,{song:track}).next(),RequestCancelledError);assert.deepEqual(router.health(),{});
});
test('OP NetEase reuses verified platform IDs and skips pending tasks without trying every quality',async()=>{
 const {router,calls}=harness((id,level,{source})=>{
  if(source==='at38-netease')return playable(source,level);
  throw new HttpStatusError(503,{error:{message:'OP Music 音频仍在准备，已切换其他渠道'}});
 });
 assert.equal((await router.candidates(track.id,{song:track}).next()).value.provider,'at38-netease');
 const op=calls.filter(x=>x.source==='op-netease');assert.equal(op.length,1);assert.equal(op[0].id,'op-netease:123');assert.equal(op[0].level,'hires');
});
test('OP QQ shares mids, while Apple IDs stay isolated and later matching uses prepared album metadata',async()=>{
 const h=harness((id,level,{source})=>source==='op-qq'?playable(source,level):Promise.reject(new HttpStatusError(503)));
 const qq={...track,id:'qq:mid123',sourceId:'mid123',provider:'qq'};
 assert.equal((await h.router.candidates(qq.id,{song:qq}).next()).value.provider,'op-qq');assert.equal(h.calls.find(x=>x.source==='op-qq').id,'op-qq:mid123');
 const apple={...track,id:'op-applemusic:999',sourceId:'999',provider:'op-applemusic',album:''};
 const second=harness((id,level,{source})=>({...playable(source,level),album:track.album,duration:track.duration}));
 second.service.search=async(query,{source})=>source==='chksz'?[{...track,provider:'chksz',id:'123'}]:[];
 const iterator=second.router.candidates(apple.id,{song:apple});
 assert.equal((await iterator.next()).value.provider,'op-applemusic');
 const recovered=(await iterator.next({skipProvider:true})).value;assert.equal(recovered.provider,'chksz');
 assert.equal(second.calls[1].id,'123');
});
test('provider cooldown expires and successful real playback clears failure history',async()=>{
 let now=100000;const {router}=harness((id,l,{source})=>playable(source,l),{now:()=>now});router.failure({provider:'chksz'},new HttpStatusError(429,null,'1'));
 assert.equal((await router.candidates(track.id,{song:track}).next()).value.provider,'netease');now+=310000;router.success({provider:'chksz'},100);
 assert.equal((await router.candidates(track.id,{song:track}).next()).value.provider,'chksz');
});
class Audio extends EventTarget {
 constructor(){super();this.paused=true;this.currentTime=0;this.duration=300;this.readyState=4;this.error=null;this.src='';this.behavior=async()=>{};}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 load(){this.dispatchEvent(new Event('loadedmetadata'));}
 async play(){await this.behavior();this.paused=false;this.dispatchEvent(new Event('playing'));}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function controllerHarness(values,behavior) {
 const audio=new Audio();if(behavior)audio.behavior=()=>behavior(audio);
 const failures=[],success=[],events=[];
 const service={config:{source:'gd'},async *playbackCandidates(){for(const value of values)yield value;},getLyric:async()=>({lrc:''}),recordPlaybackFailure:(...a)=>failures.push(a),recordPlaybackSuccess:(...a)=>success.push(a)};
 const controller=createPlaybackController({audio,musicService:service,queueStore:createQueueStore(),mediaTimeoutMs:30,stallTimeoutMs:20});
 const view={onStarted:d=>events.push(d.provider),onError:e=>events.push(e.code||e.message)};
 return {audio,controller,view,events,failures,success,service};
}
test('browser decode rejection falls back and reports only the successful media',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')],audio=>{if(audio.src.includes('netease'))throw new DOMException('decode','NotSupportedError');});
 await h.controller.load(track.id,track,h.view);assert.deepEqual(h.events,['chksz']);assert.equal(h.failures.length,1);assert.equal(h.success.length,1);
});
test('autoplay policy refusal does not trigger source fallback or mark failure',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')],()=>{throw new DOMException('blocked','NotAllowedError');});let blocked=0;
 await h.controller.load(track.id,track,{...h.view,onAutoplayBlocked:()=>blocked++});assert.equal(blocked,1);assert.equal(h.failures.length,0);assert.equal(h.success.length,0);assert.deepEqual(h.events,['netease']);
});
test('mid-playback network failure switches source and preserves time',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')]);await h.controller.load(track.id,track,h.view);
 h.audio.currentTime=61;h.audio.error={code:2};h.audio.dispatchEvent(new Event('error'));await tick();
 assert.deepEqual(h.events,['netease','chksz']);assert.equal(h.audio.currentTime,61);assert.equal(h.audio.paused,false);
});
test('stalled playback recovers while user-paused playback does not',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')]);await h.controller.load(track.id,track,h.view);
 h.audio.currentTime=15;h.audio.dispatchEvent(new Event('waiting'));await new Promise(r=>setTimeout(r,35));assert.deepEqual(h.events,['netease','chksz']);
 h.audio.error=null;h.audio.pause();h.audio.dispatchEvent(new Event('waiting'));await new Promise(r=>setTimeout(r,35));assert.equal(h.events.length,2);
});
test('never-settling media start is bounded and falls back',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')],audio=>audio.src.includes('netease')?new Promise(()=>{}):undefined);
 await h.controller.load(track.id,track,h.view);assert.deepEqual(h.events,['chksz']);
});
test('late lyrics from a failed source cannot replace recovered lyrics',async()=>{
 const h=controllerHarness([playable('netease'),playable('chksz')]);let finishOld;const lyrics=[];
 h.service.getLyric=async(id,{song})=>song.provider==='netease'?new Promise(r=>finishOld=r):{lrc:'new'};
 await h.controller.load(track.id,track,{...h.view,onLyrics:x=>lyrics.push(x.lrc)});await tick();
 h.audio.error={code:2};h.audio.dispatchEvent(new Event('error'));await tick();finishOld({lrc:'old'});await tick();assert.deepEqual(lyrics,['new']);
});

test('compressed MP3 cannot retain an upstream lossless or master label',()=>{
 const data=actualPlaybackQuality({url:'https://audio.test/music.mp3',level:'jymaster',br:320000});assert.equal(data.level,'exhigh');assert.equal(data.format,'mp3');
 const gd=actualPlaybackQuality({url:'https://audio.test/music.mp3',level:'hires',br:999000});assert.equal(gd.level,'standard');assert.equal(gd.br,0);
});

test('a new selection aborts automatic recovery and owns all later media updates',async()=>{
 const h=controllerHarness([playable('netease')]);let resolveFirst;
 h.service.playbackCandidates=async function* (id,{signal}) {if(id==='old')await new Promise(r=>resolveFirst=r);signal.throwIfAborted();yield {...playable('netease'),id,url:`https://audio.test/${id}.flac`};};
 const first=h.controller.load('old',null,h.view);await tick();await h.controller.load('new',null,h.view);resolveFirst();await first;
 assert.match(h.audio.src,/new/);assert.deepEqual(h.events,['netease']);
});
test('all providers failing terminates with a useful error and bounded attempts',async()=>{
 const {router,calls}=harness(()=>{throw new HttpStatusError(404);});
 await assert.rejects(router.candidates(track.id,{song:track}).next(),e=>e.code==='playback_exhausted');assert.ok(calls.length<=16);
});

test('recovery restores position only once across metadata and play completion',async()=>{
 const h=controllerHarness([playable('chksz'),playable('netease')]);
 let time=0,writes=0;Object.defineProperty(h.audio,'currentTime',{get:()=>time,set:v=>{time=v;writes++;}});
 h.audio.behavior=async()=>{h.audio.dispatchEvent(new Event('loadedmetadata'));};
 await h.controller.load(track.id,track,h.view);h.audio.currentTime=42;writes=0;
 h.audio.error={code:2};h.audio.dispatchEvent(new Event('error'));await tick();
 assert.equal(writes,1);assert.equal(time,42);
});
