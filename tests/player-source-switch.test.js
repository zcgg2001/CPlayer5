import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackController } from '../js/playback-controller.js';
import { createPlaybackRouter } from '../js/playback-router.js';
import { createQueueStore } from '../js/queue-store.js';
import { createPlayerAudio } from '../js/native-audio.js';
import { MusicService } from '../js/music-service.js';
import { createLxSources } from '../js/lx-music-sources.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const track = { id:'123', sourceId:'123', provider:'gd', name:'晴天', artist:'周杰伦', album:'叶惠美', duration:269 };
const media = (provider, id = '123') => ({ ...track, id, sourceId:id, provider, level:'standard', url:`https://audio.test/${provider}/${id}.mp3` });
class Audio extends EventTarget {
    constructor() { super(); this.paused = true; this.currentTime = 0; this.duration = 269; this.readyState = 4; this.error = null; this.loads = []; this.behavior = async () => {}; }
    get src() { return this.url; }
    set src(url) { this.url = url; this.currentTime = 0; this.error = null; this.loads.push(url); }
    async play() { await this.behavior(); this.paused = false; this.dispatchEvent(new Event('playing')); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    load() { this.dispatchEvent(new Event('loadedmetadata')); }
    removeAttribute() { this.url = ''; }
}
function setup({ audio = new Audio(), resolve = async () => {}, getLyric = async () => null } = {}) {
    const queue = createQueueStore(); queue.insert(track);
    const attempts = [], events = [], failures = [];
    const service = {
        config:{quality:'lossless',playbackSource:''},
        setPlaybackPreference(provider) { this.config.playbackSource = provider; },
        async *playbackCandidates(id, options) {
            attempts.push(options); await resolve(id, options);
            yield media(options.onlyProvider || options.song?.preferredProvider || 'gd', id);
            yield media('qq', id);
        }, getLyric, recordPlaybackFailure:(song,error) => failures.push({song,error}), recordPlaybackSuccess() {},
    };
    const controller = createPlaybackController({ audio, musicService:service, queueStore:queue, mediaTimeoutMs:40 });
    const view = { onResolved:(_,song)=>events.push(['resolved',song.provider]), onStarted:(_,song,ctx)=>events.push(['started',song.provider,ctx.recovering]), onError:()=>events.push(['error']), onLyrics:lrc=>events.push(['lyrics',lrc]), onSourceRestored:()=>events.push(['restored']) };
    return { audio, queue, service, controller, attempts, events, failures, view };
}

test('source resolution leaves audio running; commit uses the latest clock, real provider, and original queue identity', async () => {
    const ready = gate();
    const h = setup({resolve:(_,options) => options.onlyProvider ? ready.promise : null});
    await h.controller.load(track.id, track, h.view);
    h.audio.currentTime = 42;
    const switchSource = h.controller.changeSource('netease');
    await tick();
    assert.equal(h.audio.paused, false); assert.equal(h.audio.loads.length, 1);
    assert.equal(h.service.config.playbackSource, '');
    assert.equal(h.controller.state.currentSong.provider, 'gd');
    h.audio.currentTime = 47;
    ready.resolve(); assert.equal(await switchSource, true);
    assert.equal(h.audio.currentTime, 47); assert.equal(h.audio.paused, false);
    assert.equal(h.controller.state.currentSong.provider, 'netease');
    assert.equal(h.controller.state.currentSong.id, track.id);
    assert.equal(h.queue.state.playlist[0].provider, 'gd');
    assert.equal(h.service.config.playbackSource, 'netease');
    assert.ok(h.events.some(event => event[0] === 'started' && event[1] === 'netease' && event[2] === true));
    h.controller.stop();
});

test('a pause or seek made while matching is retained by the new source', async () => {
    const ready = gate(), h = setup({resolve:(_,o) => o.onlyProvider ? ready.promise : null});
    await h.controller.load(track.id, track, h.view);
    const switching = h.controller.changeSource('netease'); await tick();
    await h.controller.toggle(); h.audio.currentTime = 88; ready.resolve();
    assert.equal(await switching, true); assert.equal(h.audio.paused, true); assert.equal(h.audio.currentTime, 88);
    h.controller.stop();
});

test('failed resolution preserves audio, song, lyrics and does not enter the main playback error state', async () => {
    const h = setup({resolve:(_,o) => { if (o.onlyProvider) throw Error('no match'); }});
    await h.controller.load(track.id, track, h.view); await tick();
    const before = h.events.length; let restored;
    assert.equal(await h.controller.changeSource('netease', {onError:(_,state) => {restored = state.restored;}}), false);
    assert.equal(restored, true); assert.equal(h.audio.loads.length, 1);
    assert.equal(h.service.config.playbackSource, '');
    assert.equal(h.controller.state.currentSong.provider, 'gd'); assert.equal(h.events.length, before);
    assert.equal(h.controller.state.sourceSwitch, null); h.controller.stop();
});

test('decode failure restores the original source at the captured position and keeps old UI metadata', async () => {
    const h = setup(); await h.controller.load(track.id, track, h.view); await tick();
    h.audio.currentTime = 63;
    h.audio.behavior = async () => { if (h.audio.src.includes('netease')) throw new DOMException('decode failure','NotSupportedError'); };
    let restored;
    await h.controller.changeSource('netease', {onError:(_,state) => {restored = state.restored;}});
    assert.equal(restored, true); assert.equal(h.audio.src, media('gd').url);
    assert.equal(h.service.config.playbackSource, '');
    assert.equal(h.audio.currentTime, 63); assert.equal(h.audio.paused, false);
    assert.equal(h.controller.state.currentSong.provider, 'gd');
    assert.ok(!h.events.some(e=>e[0]==='resolved' && e[1]==='netease'));
    assert.ok(h.events.some(e=>e[0]==='restored')); h.controller.stop();
});

test('rapid successive choices ignore an older resolution and only commit the last chosen provider', async () => {
    const ready = gate(), h = setup({resolve:(_,o) => o.onlyProvider === 'netease' ? ready.promise : null});
    await h.controller.load(track.id, track, h.view);
    const old = h.controller.changeSource('netease'); await tick();
    assert.equal(await h.controller.changeSource('qq'), true); ready.resolve();
    assert.equal(await old, false); assert.equal(h.controller.state.currentSong.provider, 'qq');
    assert.equal(h.service.config.playbackSource, 'qq');
    assert.equal(h.audio.loads.filter(url=>url.includes('netease')).length, 0); h.controller.stop();
});

for (const action of ['load','stop']) test(`${action} cancels a pending source resolution without later restoring the old track`, async () => {
    const ready = gate(), h = setup({resolve:(_,o) => o.onlyProvider ? ready.promise : null});
    await h.controller.load(track.id, track, h.view);
    const switching = h.controller.changeSource('netease'); await tick();
    if (action === 'load') await h.controller.load('456', {...track,id:'456'}, h.view); else h.controller.stop();
    ready.resolve(); assert.equal(await switching, false);
    assert.equal(h.service.config.playbackSource, '');
    assert.equal(h.controller.state.currentSong?.id || null, action === 'load' ? '456' : null);
    assert.equal(h.audio.loads.filter(url=>url.includes('netease')).length, 0); h.controller.stop();
});

test('a new track interrupts media installation; its source is never overwritten by rollback', async () => {
    const ready = gate(), h = setup();
    await h.controller.load(track.id, track, h.view);
    h.audio.behavior = () => h.audio.src.includes('netease') ? ready.promise : Promise.resolve();
    const switching = h.controller.changeSource('netease'); await tick();
    assert.equal(h.controller.state.sourceSwitch.stage, 'installing');
    await h.controller.load('456', {...track,id:'456'}, h.view);
    ready.resolve(); assert.equal(await switching, false);
    assert.equal(h.audio.src, media('gd','456').url); assert.equal(h.controller.state.currentSong.id, '456'); h.controller.stop();
});

test('late old lyrics cannot overwrite the selected source, while later media failure still recovers', async () => {
    const oldLyric = gate(), h = setup({getLyric:(_,o)=>o.song.provider==='gd'?oldLyric.promise:Promise.resolve(o.song.provider)});
    await h.controller.load(track.id, track, h.view); await tick();
    await h.controller.changeSource('netease'); await tick();
    oldLyric.resolve('old lyrics'); await tick();
    assert.ok(h.events.some(e=>e[0]==='lyrics' && e[1]==='netease'));
    assert.ok(!h.events.some(e=>e[1]==='old lyrics'));
    h.audio.currentTime = 75; h.audio.error = {code:2}; h.audio.dispatchEvent(new Event('error')); await tick();
    assert.equal(h.audio.currentTime, 75); assert.ok(h.attempts.length >= 3); h.controller.stop();
});

test('local, offline, and video playback cannot silently become an online source', async () => {
    for (const changes of [{provider:'local'}, {offline:true}, {provider:'bilibili'}]) {
        const h = setup(); await h.controller.load(track.id, track, h.view);
        Object.assign(h.controller.state.currentSong, changes);
        assert.equal(await h.controller.changeSource('netease'), false); assert.equal(h.audio.loads.length,1); h.controller.stop();
    }
});

function routing() {
    const calls=[];
    const service={sourceForSong:()=>({provider:'gd'}),search:async()=>[],getSongAtLevel:async(id,level,options)=>{calls.push({id,...options});return {...media(options.source,id),level};}};
    return {service,calls,router:createPlaybackRouter(service)};
}
test('manual routing attempts only the explicitly selected source and honors policy/cooldown', async () => {
    const h = routing();
    h.service.getSongAtLevel = async () => null;
    await assert.rejects(h.router.candidates(track.id,{song:track,onlyProvider:'netease'}).next(), /同一版本/);
    h.service.getRuntimePolicy = async () => ({sources:{netease:{enabled:false}}});
    await assert.rejects(h.router.candidates(track.id,{song:track,onlyProvider:'netease'}).next(), /暂不可用/);
    h.service.getRuntimePolicy = async () => null; h.router.failure({provider:'netease'}, Error('offline'));
    await assert.rejects(h.router.candidates(track.id,{song:track,onlyProvider:'netease'}).next(), /冷却/);
});

test('manual cross-platform switching requires strict recording evidence and uses the destination ID', async () => {
    const h=routing();
    h.service.search=async()=>[{...track,provider:'qq',id:'qq:live',sourceId:'live',name:'晴天 (Live)'}];
    await assert.rejects(h.router.candidates(track.id,{song:track,onlyProvider:'qq'}).next(), /同一版本/); assert.equal(h.calls.length,0);
    h.service.search=async()=>[{...track,provider:'qq',id:'qq:mid123',sourceId:'mid123'}];
    const next=await h.router.candidates(track.id,{song:track,onlyProvider:'qq'}).next();
    assert.equal(next.value.provider,'qq'); assert.equal(h.calls[0].id,'qq:mid123'); assert.equal(h.calls[0].song.sourceId,'mid123');
});

test('ChKSz supports both explicit switching and subsequent playback preference', async () => {
    const h=routing();
    assert.equal((await h.router.candidates(track.id,{song:track,onlyProvider:'chksz'}).next()).value.provider,'chksz');
    assert.equal((await h.router.candidates(track.id,{song:track,preferredSource:'chksz'}).next()).value.provider,'chksz');
});

test('future playback preference searches the selected platform first and persists separately from search filters', async () => {
    const saved=new Map([['cp_source','gd']]), storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
    const service=new MusicService({storage,location:{search:''}});
    assert.equal(service.setPlaybackPreference('qq'),true); assert.equal(saved.get('cp_source'),'gd');
    assert.equal(new MusicService({storage,location:{search:''}}).config.playbackSource,'qq');
    assert.equal(service.setPlaybackPreference('chksz'),true);
    assert.equal(new MusicService({storage}).config.playbackSource,'chksz');
    const h=routing(); h.service.search=async()=>[{...track,provider:'qq',id:'qq:mid',sourceId:'mid'}];
    assert.equal((await h.router.candidates(track.id,{song:track,preferredSource:'qq'}).next()).value.provider,'qq');
    service.setPlaybackPreference(); assert.equal(saved.get('cp_playback_source'),'');
});

test('manual MusicService selection bypasses offline cache and imported resolvers', async () => {
    const service=new MusicService({storage:null,location:{search:''}});
    service.offlineAudio={resolve:()=>{throw Error('should not resolve cached audio');}};
    service.lxSources={async *candidates(){throw Error('should not use imported source');}};
    let options; service.playbackRouter={async *candidates(id,o){options=o;yield media('netease');}};
    assert.equal((await service.playbackCandidates(track.id,{song:track,onlyProvider:'netease'}).next()).value.provider,'netease');
    assert.equal(options.onlyProvider,'netease');
});

test('native Media3 loads the new source with its own identity and seeks after readiness', async () => {
    const calls=[]; let bridge;
    const state = () => bridge.onmessage({data:JSON.stringify({type:'state',token:calls.findLast(c=>c.op==='load').token,ready:true,duration:269,position:0,playWhenReady:true,playing:true})});
    bridge={postMessage:body=>{const packet=JSON.parse(body);calls.push(packet);if(packet.op==='play')queueMicrotask(state);}};
    const audio=createPlayerAudio({bridge,createAudio:()=>new Audio()});
    const h=setup({audio});
    const view={...h.view,onResolved:(data,song)=>audio.setMetadata(song)};
    await h.controller.load(track.id,track,view); audio.currentTime=51;
    assert.equal(await h.controller.changeSource('netease'),true);
    assert.equal(calls.findLast(c=>c.op==='load').mediaId,'netease:123');
    assert.ok(Math.abs(calls.findLast(c=>c.op==='seek').position-51)<1);
    h.controller.stop();
});

test('quality changes after a manual switch keep the chosen channel and matched IDs', async () => {
    const h=setup(); await h.controller.load(track.id,track,h.view);
    await h.controller.changeSource('qq');
    await h.controller.changeQuality('exhigh');
    assert.equal(h.attempts.at(-1).song.preferredProvider,'qq');
    assert.equal(h.controller.state.currentSong.provider,'qq');
    h.controller.stop();
});

test('repeated switching retains flat, bounded source records', async () => {
    const h=setup(); await h.controller.load(track.id,track,h.view);
    for (let i=0;i<12;i++) await h.controller.changeSource(i%2?'gd':'qq');
    for (const request of h.attempts.filter(o=>o.onlyProvider)) {
        assert.ok(request.song.sources.length<=2);
        assert.ok(request.song.sources.every(s=>!s.sources && !s.artworkSource && !s.routing));
    }
    h.controller.stop();
});

test('an old source failing during resolution cancels the manual request and recovers once', async () => {
    const ready=gate(),h=setup({resolve:(_,o)=>o.onlyProvider?ready.promise:null});
    await h.controller.load(track.id,track,h.view);
    const switching=h.controller.changeSource('netease'); await tick();
    h.audio.currentTime=31; h.audio.error={code:2}; h.audio.dispatchEvent(new Event('error')); await tick();
    assert.equal(h.audio.src,media('qq').url);
    ready.resolve();assert.equal(await switching,false);
    assert.equal(h.audio.src,media('qq').url);assert.equal(h.audio.currentTime,31);
    h.controller.stop();
});

test('failed rollback is reported as playback failure instead of claiming the old audio is playing', async () => {
    const h=setup();await h.controller.load(track.id,track,h.view);
    h.audio.behavior=async()=>{throw Error('media unavailable');};let restored;
    await h.controller.changeSource('netease',{onError:(_,status)=>restored=status.restored});
    assert.equal(restored,false);assert.ok(h.events.some(e=>e[0]==='error'));
    assert.equal(h.controller.state.quality.songLoading,false);h.controller.stop();
});

test('a failed decode invalidates the cached URL for the selected provider', async () => {
    const h=routing(); const data=(await h.router.candidates(track.id,{song:track,onlyProvider:'netease'}).next()).value;
    h.router.failure(data,Error('decode'));
    h.router.success(data,10); // Simulate cooldown expiry without waiting.
    await h.router.candidates(track.id,{song:track,onlyProvider:'netease'}).next();
    assert.equal(h.calls.length,2);
});

for (const paused of [false,true]) test(`native source ${paused?'switch retains pause':'failure rolls back'} with the original clock and metadata`, async () => {
    const calls=[];let bridge;
    const emit=(token,extra={})=>bridge.onmessage({data:JSON.stringify({type:'state',token,ready:true,duration:269,position:0,playWhenReady:false,playing:false,...extra})});
    bridge={postMessage:body=>{
        const call=JSON.parse(body);calls.push(call);
        if(call.op==='load'&&paused)queueMicrotask(()=>emit(call.token));
        if(call.op==='play'){
            const load=calls.findLast(c=>c.op==='load');
            queueMicrotask(()=>emit(call.token,load.url.includes('/netease/')?{error:{code:2,message:'native failure'}}:{playWhenReady:true,playing:true}));
        }
    }};
    const audio=createPlayerAudio({bridge,createAudio:()=>new Audio()});const h=setup({audio});
    await h.controller.load(track.id,track,{...h.view,onResolved:(_,song)=>audio.setMetadata(song)});
    if(paused)audio.pause();audio.currentTime=66;
    let restored;
    assert.equal(await h.controller.changeSource('netease',{onError:(_,s)=>restored=s.restored}),paused);
    assert.equal(audio.paused,paused);
    assert.equal(calls.findLast(c=>c.op==='load').mediaId,paused?'netease:123':'gd:123');
    assert.ok(Math.abs(calls.findLast(c=>c.op==='seek').position-66)<1);
    if(!paused)assert.equal(restored,true);
    h.controller.stop();
});

test('manual channel survives quality changes without imported scripts, offline copies, or future preferences replacing it', async () => {
    const previousDocument=globalThis.document;
    try {
        globalThis.document={};
        const service=new MusicService({storage:null,location:{search:''}});
        service.setPlaybackPreference('qq');
        service.offlineAudio={resolve:async()=>({...media('gd'),offline:true})};
        service.lxSources={async *candidates(){yield {...media('gd'),playbackSource:'lx-primary'};}};
        let preferred;
        service.playbackRouter={async *candidates(id,options){preferred=options.preferredSource;yield media(preferred||'netease');}};
        const selected={...track,provider:'netease',preferredProvider:'netease',routing:{manual:true}};
        const result=(await service.playbackCandidates(track.id,{song:selected,level:'exhigh'}).next()).value;
        assert.equal(result.provider,'netease'); assert.equal(result.offline,undefined); assert.equal(result.playbackSource,undefined);
        assert.equal(preferred,'netease');
        service.offlineAudio=null;
        service.setPlaybackPreference();
        const nextTrack=(await service.playbackCandidates('456',{song:{...track,id:'456'}}).next()).value;
        assert.equal(nextTrack.playbackSource,'lx-primary');
    } finally { if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument; }
});

async function customSetup() {
    const h = setup(), service = new MusicService({ storage: null });
    service.getRuntimePolicy = async () => null;
    service.getSongAtLevel = async (id, level, options) => ({ ...media(options.source, id), level });
    service.getLyric = async () => null;
    service.search = async () => [];
    service.lxSources = createLxSources(null, {
        download: async url => `/**\n * @name 我的音源\n */\n${url}`,
        open: async code => ({ sources: { wy: { qualitys: ['flac', '320k', '128k'] } }, close() {},
            resolve: async () => `https://audio.example.org/custom/${code.includes('backup') ? 'backup' : 'primary'}.mp3` }),
    });
    await service.lxSources.save({ enabled: true, primary: 'https://example.org/main.js', backup: 'https://example.org/backup.js' });
    service.setPlaybackPreference('gd');
    h.controller = createPlaybackController({ audio: h.audio, musicService: service, queueStore: h.queue, mediaTimeoutMs: 40 });
    h.service = service;
    await h.controller.load(track.id, track, h.view);
    return h;
}

test('switching to an imported slot preserves progress, pause, queue identity and manual preference through quality changes', async () => {
    const previousDocument = globalThis.document; globalThis.document = {};
    const h = await customSetup();
    try {
        h.audio.pause(); h.audio.currentTime = 53;
        assert.equal(await h.controller.changeSource('lx-backup'), true);
        assert.equal(h.controller.state.currentSong.provider, 'gd');
        assert.equal(h.controller.state.currentSong.playbackSource, 'lx-backup');
        assert.equal(h.service.config.playbackSource, 'lx-backup');
        assert.equal(h.controller.state.currentSong.source, '我的音源');
        assert.equal(h.controller.state.currentSong.id, track.id);
        assert.equal(h.audio.currentTime, 53); assert.equal(h.audio.paused, true);
        assert.equal(h.queue.state.playlist[0].playbackSource, undefined);
        h.service.offlineAudio = { resolve() { assert.fail('manual quality change used offline copy'); } };
        await h.controller.changeQuality('exhigh');
        assert.equal(h.controller.state.currentSong.playbackSource, 'lx-backup');
        assert.equal(h.audio.currentTime, 53); assert.equal(h.audio.paused, true);
        assert.equal(await h.controller.changeSource('netease'), true);
        assert.equal(h.controller.state.currentSong.playbackSource, undefined);
        assert.equal(h.controller.state.currentSong.playbackSourceUrl, undefined);
        assert.equal(h.controller.state.currentSong.provider, 'netease');
        await h.controller.changeQuality('standard');
        assert.equal(h.controller.state.currentSong.playbackSource, undefined);
        assert.equal(h.controller.state.currentSong.provider, 'netease');
        assert.equal(h.audio.currentTime, 53);
    } finally { h.controller.stop(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});

test('an imported URL decode failure restores original audio and does not commit a new source', async () => {
    const h = await customSetup();
    try {
        h.audio.currentTime = 39;
        h.audio.behavior = async () => { if (h.audio.src.includes('/custom/')) throw Error('decode failed'); };
        let restored;
        assert.equal(await h.controller.changeSource('lx-primary', { onError: (_, state) => restored = state.restored }), false);
        assert.equal(restored, true); assert.equal(h.audio.currentTime, 39); assert.equal(h.audio.paused, false);
        assert.equal(h.controller.state.currentSong.playbackSource, undefined);
        assert.equal(h.audio.src, media('gd').url);
        assert.equal(h.service.config.playbackSource, 'gd');
    } finally { h.controller.stop(); }
});

test('a newer source choice cancels pending custom resolution before it can commit', async () => {
    const h = await customSetup(), ready = gate();
    const candidates = h.service.lxSources.candidates;
    h.service.lxSources.candidates = async function* (...args) { await ready.promise; yield* candidates(...args); };
    try {
        const old = h.controller.changeSource('lx-backup'); await tick();
        assert.equal(await h.controller.changeSource('netease'), true);
        ready.resolve(); assert.equal(await old, false);
        assert.equal(h.controller.state.currentSong.provider, 'netease');
        assert.equal(h.service.config.playbackSource, 'netease');
        assert.equal(h.audio.loads.some(url => url.includes('/custom/')), false);
    } finally { ready.resolve(); h.controller.stop(); }
});

test('replacing an imported configuration during media installation rolls back rather than relabeling old audio', async () => {
    const h = await customSetup(), ready = gate();
    h.audio.behavior = () => h.audio.src.includes('/custom/') ? ready.promise : Promise.resolve();
    try {
        h.audio.currentTime = 28;
        const switching = h.controller.changeSource('lx-backup'); await tick();
        assert.equal(h.controller.state.sourceSwitch.stage, 'installing');
        await h.service.lxSources.save({ enabled: true, primary: 'https://example.org/main.js', backup: 'https://example.org/replaced.js' });
        ready.resolve(); assert.equal(await switching, false);
        assert.equal(h.controller.state.currentSong.playbackSource, undefined);
        assert.equal(h.audio.src, media('gd').url); assert.equal(h.audio.currentTime, 28);
    } finally { ready.resolve(); h.controller.stop(); }
});
