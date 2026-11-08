import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SOURCES, catalogRecord, aggregateSongs, artworkVariants, extractMetadata, relatedMusic, availability, groupAvailability, sourceBlocked } from '../js/music-catalog.js';
import { createCatalogService, probeAudio, failureAvailability } from '../js/catalog-service.js';
import { MusicService } from '../js/music-service.js';
const track=(provider,id,extra={})=>({provider,id,sourceId:id,name:'青花瓷',artist:'周杰伦',album:'我很忙',...extra});

test('five channels for one recording produce one record and retain exact source IDs',()=>{
  const groups=aggregateSongs([track('gd','186016'),track('netease','186016'),track('at38-netease','186016'),track('qq','abc',{duration:239}),track('jianbin-qq','https://jbsou.test/?get=url&type=qq&id=abc',{duration:240})]);
  assert.equal(groups.length,1); assert.equal(groups[0].sources.length,5);
  assert.equal(groups[0].sources[4].sourceId,'https://jbsou.test/?get=url&type=qq&id=abc');
  assert.ok(groups[0].songEntity.id); assert.equal(groups[0].version.songId,groups[0].songEntity.id);
  assert.ok(groups[0].artists[0].id); assert.ok(groups[0].albumEntity.id);
});
test('recording versions, different remixes and live shows never collapse by title cleanup',()=>{
  const names=['青花瓷','青花瓷 (Live)','青花瓷 (2020 Live)','青花瓷 (DJ A Remix)','青花瓷 (DJ B Remix)','青花瓷 (伴奏)','青花瓷 (Instrumental)'];
  const groups=aggregateSongs(names.map((name,i)=>track('netease',String(i+1),{name})));
  assert.equal(groups.length,7);assert.equal(groups[5].version.kind,'accompaniment');assert.equal(groups[6].version.kind,'instrumental');
  assert.equal(groups[0].songEntity.id,groups[1].songEntity.id);
});
test('cross-platform matches require album evidence and compatible duration',()=>{
  assert.equal(aggregateSongs([track('gd','1',{duration:200}),track('qq','2',{duration:240})]).length,2);
  assert.equal(aggregateSongs([track('gd','1',{album:''}),track('qq','2',{album:''})]).length,2);
  assert.equal(aggregateSongs([track('gd','1',{artist:'Unknown'}),track('qq','2',{artist:'Unknown'})]).length,2);
  assert.equal(aggregateSongs([track('gd','1',{name:'青花瓷（重制版）'}),track('qq','2')]).length,2);
  assert.equal(aggregateSongs([track('bilibili','bili:1'),track('qq','2')]).length,2);
});
test('ISRC can match reissues but conflicting ISRCs and different versions remain separate',()=>{
  const first=track('gd','1',{isrc:'CN-A01-07-00001'});
  assert.equal(aggregateSongs([first,track('qq','2',{album:'精选',isrc:'CNA010700001'})]).length,1);
  assert.equal(aggregateSongs([first,track('qq','2',{isrc:'CNA010700002'})]).length,2);
  assert.equal(aggregateSongs([first,track('qq','2',{name:'青花瓷 (Live)',isrc:'CNA010700001'})]).length,2);
});
test('metadata keeps provenance, disagreements and artist/album content without inventing fields',()=>{
  const groups=aggregateSongs([track('gd','1'),track('netease','1',{dt:239000,br:320000,publishTime:1193587200000,language:'国语',genre:['流行'],company:'杰威尔',isrc:'CNA010700001',description:'歌曲说明',artists:[{id:1,name:'周杰伦',picUrl:'https://example.test/artist.jpg'}],albumEntity:{id:2,name:'我很忙',description:'专辑说明'}}),track('qq','2',{duration:240,releaseDate:'2007-11-02'})]);
  const song=groups[0]; assert.equal(song.metadata.bitrate,320);assert.equal(song.metadata.duration,239);
  assert.equal(song.artists[0].avatar,'https://example.test/artist.jpg');assert.equal(song.albumEntity.description,'专辑说明');
  assert.equal(song.provenance.releaseDate.length,2); assert.equal(catalogRecord(track('gd','2')).metadata.isrc,'');
  assert.deepEqual(extractMetadata({genre:5,language:3,isrc:'not-isrc'}).metadata.genres,[]);
});
test('aggregation is idempotent across pages and does not mutate input',()=>{
  const first=aggregateSongs([track('gd','1'),track('qq','2')]);const before=JSON.stringify(first);
  const next=aggregateSongs([...first,track('gd','1'),track('at38-qq','2')]);
  assert.equal(next.length,1);assert.equal(next[0].sources.length,3);assert.equal(JSON.stringify(first),before);
});
test('artwork variants preserve signed and proxy URLs and reject unsafe schemes',()=>{
  assert.equal(artworkVariants('https://p1.music.126.net/x.jpg')[2].url,'https://p1.music.126.net/x.jpg?param=800y800');
  const signed='https://p1.music.126.net/x.jpg?token=abc';assert.deepEqual(artworkVariants(signed),[{label:'原图',url:signed}]);
  assert.equal(artworkVariants('/api/v1/music/cover?source=gd&id=1').length,1);
  assert.equal(artworkVariants('javascript:alert(1)').length,0);
  assert.ok(artworkVariants('https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg')[2].url.includes('R800x800'));
});
test('recommendations explain metadata matches and do not guess similar artists without genre',()=>{
  const catalog=aggregateSongs([track('gd','1'),track('gd','2',{name:'彩虹'}),track('qq','3',{name:'其他',artist:'别人',album:'其他'})]);
  const result=relatedMusic(catalog[0],catalog);assert.equal(result.songs.length,1);assert.ok(result.songs[0].reasons.includes('同一歌手'));assert.equal(result.artists.length,0);
  catalog[0].metadata.genres=['流行'];catalog[2].metadata.genres=['流行'];assert.equal(relatedMusic(catalog[0],catalog).artists[0].name,'别人');
});
test('availability expires, unknown does not mean playable and generic HTTP failures are not copyright',()=>{
  assert.equal(availability({status:'playable',expiresAt:10},11).status,'unknown');
  assert.equal(groupAvailability(catalogRecord(track('gd','1'))).status,'unknown');
  assert.equal(failureAvailability({status:403}).status,'unavailable');
  assert.equal(failureAvailability({payload:{error:{code:'no_copyright'}}}).status,'no_copyright');
  assert.equal(sourceBlocked({availability:{status:'region_restricted'}}),true);
});
test('audio probes inspect bytes, reject HTML even with audio MIME, and cancel streaming bodies',async()=>{
  let cancelled=false;
  const valid=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('fLaC123456789'));},cancel(){cancelled=true;}});
  assert.equal(await probeAudio('/audio',{fetchImpl:async(_,options)=>{assert.equal(options.headers.Range,'bytes=0-4095');return new Response(valid);}}),true);assert.equal(cancelled,true);
  assert.equal(await probeAudio('/audio',{fetchImpl:async()=>new Response('<html>failed</html>',{headers:{'content-type':'audio/mpeg'}})}),false);
  assert.equal(await probeAudio('/audio',{fetchImpl:async()=>new Response(null,{status:204})}),false);
});
test('aggregate search limits concurrency, reports partial failures and never calls ChKSz by default',async()=>{
  let active=0,max=0; const calls=[];
  const api={config:{quality:'lossless'},async search(q,{source}){calls.push(source);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,5));active--;if(source==='qq')throw new Error('failure');return[track(source,'1')];}};
  const service=createCatalogService(api);const progress=[];const result=await service.search('青花瓷',{onProgress:s=>progress.push(s.completed)});
  assert.equal(max,3);assert.equal(calls.includes('chksz'),false);assert.equal(result.completed,CATALOG_SOURCES.length);assert.deepEqual(result.failures,['qq']);assert.equal(progress.length,CATALOG_SOURCES.length);
});
test('search cancellation stops scheduling and deadlines preserve other results',async()=>{
  const calls=[];const controller=new AbortController();
  const api={config:{quality:'lossless'},search(q,{source,signal}){calls.push(source);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
  const service=createCatalogService(api,{timeoutMs:20});
  const pending=service.search('x',{signal:controller.signal});controller.abort();await assert.rejects(pending);assert.ok(calls.length<=3);
  const snapshot=await service.search('x',{sources:['gd','netease']});assert.equal(snapshot.failures.length,2);
});
test('checking caches only bounded status metadata per quality, never signed audio URLs',async()=>{
  let resolves=0,now=1000;const api={config:{quality:'lossless'},async getSongAtLevel(){resolves++;return{url:'https://audio.test/file?secret=signed',br:320000,level:'exhigh',format:'mp3'};}};
  const service=createCatalogService(api,{now:()=>now,fetchImpl:async()=>new Response('ID3abcdefghijk')});const song=track('netease','1');
  assert.equal((await service.check(song)).status,'playable');assert.equal((await service.check(song)).bitrate,320);assert.equal(resolves,1);assert.equal(JSON.stringify(song).includes('signed'),false);
  await service.check(song,{level:'standard'});assert.equal(resolves,2);now+=300001;await service.check(song);assert.equal(resolves,3);
});
test('resolving without readable audio remains unverified, and cancellation restores unknown',async()=>{
  const api={config:{quality:'lossless'},getSongAtLevel:async()=>({url:'/audio'})};
  const service=createCatalogService(api,{fetchImpl:async()=>{throw new TypeError('CORS');}});assert.equal((await service.check(track('gd','1'))).status,'resolved');
  api.getSongAtLevel=async()=>new Promise(()=>{});const controller=new AbortController();const song=track('gd','2');const pending=service.check(song,{signal:controller.signal});controller.abort();await assert.rejects(pending);assert.equal(song.availability.status,'unknown');
});
test('aggregated playback resolves exact candidate IDs, skips restrictions and lyrics follow actual source',async()=>{
  const service=new MusicService({storage:{getItem:()=>null}});const calls=[];
  service.getSongAtLevel=async(id,level,options)=>{calls.push({id,source:options.source});if(options.source==='gd')throw new Error('offline');return{id:'qq:real',sourceId:'real',provider:'qq',url:'/audio'};};
  const group=aggregateSongs([track('gd','1'),track('netease','1',{availability:{status:'no_copyright'}}),track('qq','real')])[0];
  const result=await service.getSong(group.id,{song:group});assert.deepEqual(calls,[{id:'1',source:'gd'},{id:'real',source:'qq'}]);assert.equal(result.sourceId,'real');assert.equal(result.id,group.id);
  let lyricUrl;await service.getLyric(group.id,{song:result,fetchImpl:async url=>{lyricUrl=url;return new Response(JSON.stringify({code:200,data:{lrc:''}}));}});assert.equal(new URL(lyricUrl,'https://test').searchParams.get('id'),'real');
});
test('a deliberately chosen source does not fall through to other channels',async()=>{
  const service=new MusicService({storage:{getItem:()=>null}});const calls=[];service.getSongAtLevel=async(id,level,{source})=>{calls.push(source);throw new Error('chosen unavailable');};
  const group=catalogRecord(track('qq','abc'));await assert.rejects(service.getSong(group.id,{song:group}),/chosen unavailable/);assert.deepEqual(calls,['qq']);
});

test('release date preserves the source calendar day rather than shifting at UTC midnight',()=>{
  const info=extractMetadata({publishTime:Date.parse('2003-07-31T00:00:00+08:00')});assert.equal(info.metadata.releaseDate,'2003-07-31');
});

test('quality-specific restrictions do not block a different requested quality',()=>{
  const source={availability:{status:'no_copyright',requestedLevel:'lossless'}};
  assert.equal(sourceBlocked(source,'lossless'),true);assert.equal(sourceBlocked(source,'standard'),false);
});
