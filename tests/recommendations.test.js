import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryProfile, rankRecommendations, recordingKey, parseLibraryJson, parsePlaylistInput, storedSong, matchesFilters, analyzeLibrary, dayKey } from '../js/recommendation-model.js';
import { createRecommendationService, createRadio } from '../js/recommendation-service.js';
const storage = () => { const values = new Map(); return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}; };
const song = (id, props = {}) => ({id:String(id),name:`歌曲${id}`,artist:'歌手',album:'专辑',provider:'gd',duration:240,...props});
const profile = () => createDiscoveryProfile({storage:storage(),random:()=>0.5});
const candidates = Array.from({length:60},(_,i)=>song(i+1));

test('daily recommendations have 30 unique recordings, stable order and exclude feedback',()=>{
  const store=profile();
  const run=()=>rankRecommendations([...candidates,{...candidates[0],provider:'netease'}],{profile:store.profile,day:'2026-11-08'});
  const first=run();assert.equal(first.length,30);assert.equal(new Set(first.map(x=>recordingKey(x.song))).size,30);
  assert.deepEqual(first,run());
  store.dismiss(first[0].song);assert.equal(run().length,30);assert.ok(!run().some(x=>recordingKey(x.song)===recordingKey(first[0].song)));
  store.undoDismiss(first[0].song);assert.deepEqual(first,run());
  assert.notDeepEqual(first.map(x=>x.song.id),rankRecommendations(candidates,{profile:store.profile,day:'2026-11-09'}).map(x=>x.song.id));
  assert.equal(dayKey(Date.parse('2026-11-08T16:00:00Z')),'2026-11-09');
});
test('recommendations distinguish qualified listening, favorites and imported artists',()=>{
  const store=profile();store.record(song(80),220,2);
  let rows=rankRecommendations([song(1)],{profile:store.profile});assert.doesNotMatch(rows[0].reason,/因为你听了/);
  store.record(song(80),230,13);rows=rankRecommendations([song(1)],{profile:store.profile});assert.match(rows[0].reason,/因为你听了《歌曲80》/);
  const imported=profile();imported.import([song(90)]);assert.match(rankRecommendations([song(1)],{profile:imported.profile})[0].reason,/导入了/);
  assert.match(rankRecommendations([song(1)],{profile:profile().profile,favorites:[song(90)]})[0].reason,/收藏了/);
});
test('unknown metadata does not satisfy filters and known duration, BPM, language, era, genre combine',()=>{
  assert.equal(matchesFilters(song(1),{bpmMin:80}),false);
  assert.equal(matchesFilters(song(1),{language:'华语'}),false);
  const row=song(1,{metadata:{bpm:100,duration:180,language:'国语',genres:['City Pop'],releaseDate:'1995-05-08'}});
  assert.equal(matchesFilters(row,{bpmMin:90,bpmMax:120,durationMax:200,language:'华语',era:'90s',genre:'City Pop'}),true);
  assert.equal(matchesFilters(row,{durationMin:181}),false);assert.equal(matchesFilters(row,{era:'00s'}),false);
  assert.equal(matchesFilters(row,{language:'韩语'}),false);
});
test('profile bounds data, survives denied/corrupt storage and never persists signed audio',()=>{
  const disk=storage(),store=createDiscoveryProfile({storage:disk});
  const raw=song(1,{url:'https://secret.test/song?token=secret',sources:[{...song(1),url:'https://secret.test/audio'}],catalogId:'recording:1'});
  store.import([raw]);store.record(raw,42,10);store.setTags(['华语','华语','invalid']);
  assert.doesNotMatch(disk.getItem('cp_discovery_profile_v1:guest'),/secret|token/);
  const reloaded=createDiscoveryProfile({storage:disk});assert.equal(reloaded.profile.history[0].position,42);assert.deepEqual(reloaded.profile.tags,['华语']);
  for(let i=0;i<105;i++)store.record(song(i),1,1);assert.equal(store.profile.history.length,100);
  for(let i=0;i<505;i++)store.dismiss(song(i));assert.equal(store.profile.dismissed.length,500);
  const denied=createDiscoveryProfile({storage:{getItem(){throw Error();},setItem(){throw Error();}}});denied.import([song(1)]);assert.equal(denied.profile.library.length,1);assert.equal(denied.persistent(),false);
});
test('cold-start input parses only approved playlist IDs and bounded JSON contracts',()=>{
  for(const value of ['123','https://music.163.com/#/playlist?id=123','https://y.music.163.com/m/playlist?id=123'])assert.equal(parsePlaylistInput(value),'123');
  for(const value of ['https://evil.test/playlist?id=123','https://music.163.com.evil.test/playlist?id=123','https://music.163.com/song?id=123','javascript:123','../123'])assert.equal(parsePlaylistInput(value),null);
  const songs=parseLibraryJson(JSON.stringify({tracks:[{id:1,name:'曲目',ar:[{id:2,name:'艺人'}],al:{name:'专辑'},dt:120000,bpm:100}]}));
  assert.equal(songs[0].duration,120);assert.equal(songs[0].metadata.bpm,100);assert.equal(songs[0].artist,'艺人');
  assert.deepEqual(analyzeLibrary(songs).artists,[{name:'艺人',count:1}]);
  assert.throws(()=>parseLibraryJson('x'.repeat(2*1024*1024+1)),/2 MB/);
  assert.throws(()=>parseLibraryJson(JSON.stringify(Array(1001).fill(1))),/1,000/);
  assert.throws(()=>parseLibraryJson('{}'),/JSON/);
});
test('known restricted sources do not re-enter recommendations via Array.every index arguments',()=>{
  const blocked={...song(1),catalogId:'recording:1',sources:[{...song(1),availability:{status:'no_copyright',requestedLevel:'lossless'}},{...song(1,{provider:'netease'}),availability:{status:'login_required',requestedLevel:'lossless'}}]};
  assert.equal(rankRecommendations([blocked],{profile:profile().profile}).length,0);
});
test('home has partial success without keys; each request stays on public discovery routes',async()=>{
  const requests=[],disk=storage(),store=profile();
  const service=createRecommendationService({musicService:{search(){throw Error('No ChKSz or search for cold start');}},profileStore:store,storage:disk,fetchImpl:async url=>{
    requests.push(url);if(url.includes('3779629'))return Response.json({error:{message:'unavailable'}},{status:502});
    return Response.json({tracks:candidates,collection:{name:'热歌榜'}});
  }});
  const updates=[];await service.loadHome(new AbortController().signal,value=>updates.push(value));
  assert.equal(service.rank().length,30);assert.equal(updates.at(-1).errors.length,1);assert.ok(requests.every(url=>url.startsWith('/api/v1/discovery/')));
  assert.ok(disk.getItem('cp_recommendation_pool_v1'));
});

test('home publishes each chart before a slower chart completes', async () => {
  const requests = new Map(), updates = [];
  const service = createRecommendationService({ musicService: {}, profileStore: profile(), storage: storage(),
    fetchImpl: url => new Promise(resolve => requests.set(new URL(url, 'https://player.test').searchParams.get('id'), resolve)),
  });
  const pending = service.loadHome(new AbortController().signal, state => updates.push(state));
  assert.equal(updates[0].loading, true);
  requests.get('3779629')(Response.json({ tracks: [song(2)] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.newSongs()[0].id, '2');
  assert.equal(service.rank()[0].song.id, '2');
  assert.equal(updates.at(-1).sections.hot, 'loading');
  assert.equal(updates.at(-1).sections.news, 'ready');
  requests.get('3778678')(Response.json({ error: {} }, { status: 502 }));
  await pending;
  assert.equal(updates.at(-1).loading, false);
  assert.equal(updates.at(-1).stale, false);
  assert.equal(updates.at(-1).errors.length, 1);
});

test('imported recommendations are available before any network result', async () => {
  const store = profile(); store.import([song(77, { artist: '未知歌手' })]);
  const requests = [], updates = [];
  const service = createRecommendationService({ musicService: {}, profileStore: store, storage: storage(),
    fetchImpl: () => new Promise(resolve => requests.push(resolve)),
  });
  const pending = service.loadHome(new AbortController().signal, state => updates.push(state));
  assert.equal(service.rank()[0].song.id, '77');
  assert.equal(updates[0].loading, true);
  requests.forEach(resolve => resolve(Response.json({}, { status: 502 })));
  await pending;
  assert.equal(updates.at(-1).loading, false);
  assert.equal(updates.at(-1).stale, true);
});

test('an obsolete home load cannot mutate the pool or publish late chart results', async () => {
  const requests = [], oldUpdates = [], newUpdates = [];
  const service = createRecommendationService({ musicService: {}, profileStore: profile(), storage: storage(),
    fetchImpl: () => new Promise(resolve => requests.push(resolve)),
  });
  const first = service.loadHome(new AbortController().signal, state => oldUpdates.push(state));
  const second = service.loadHome(new AbortController().signal, state => newUpdates.push(state));
  requests[2](Response.json({ tracks: [song(20)] })); requests[3](Response.json({ tracks: [song(21)] }));
  await second;
  requests[0](Response.json({ tracks: [song(1)] })); requests[1](Response.json({ tracks: [song(2)] }));
  await first;
  assert.deepEqual(service.pool().map(track => track.id).sort(), ['20', '21']);
  assert.equal(service.newSongs()[0].id, '21');
  assert.equal(oldUpdates.length, 1);
  assert.equal(newUpdates.at(-1).loading, false);
});
test('radio advances without duplicates, applies fresh dislikes, and never overlaps next requests',async()=>{
  const store=profile();let calls=0;
  const radio=createRadio({profile:store.profile,fetchBatch:async()=>{calls++;return candidates.slice(0,10).map(song=>({song,reason:'候选'}));}});
  const a=await radio.start('personal');store.dismiss(song(2));
  const [b,c]=await Promise.all([radio.next(),radio.next()]);assert.equal(c,null);assert.notEqual(recordingKey(a),recordingKey(b));assert.notEqual(b.id,'2');assert.equal(calls,1);
  radio.stop();assert.equal(await radio.next(),null);
});
test('stopped and superseded radio requests never start stale playback',async()=>{
  const waiting=[];
  const radio=createRadio({profile:profile().profile,fetchBatch:({signal})=>new Promise(resolve=>waiting.push({signal,resolve}))});
  const first=radio.start('song',song(90));radio.stop();assert.equal(waiting[0].signal.aborted,true);
  const second=radio.start('artist',song(80));waiting[0].resolve(candidates.slice(0,10).map(song=>({song})));assert.equal(await first,null);
  waiting[1].resolve(candidates.slice(10,20).map(song=>({song})));const current=await second;assert.equal(current.id,'11');assert.equal(radio.owns(current),true);
});
test('empty radio is bounded and failed requests can be retried at the same page',async()=>{
  let calls=0,page=0,fail=true;const changes=[];
  const radio=createRadio({profile:profile().profile,onChange:state=>changes.push(state),fetchBatch:async params=>{calls++;page=params.page;if(fail)throw Error('offline');return [];}});
  assert.equal(await radio.start('personal'),null);assert.equal(changes.at(-1).error,'offline');fail=false;
  assert.equal(await radio.next(),null);assert.equal(calls,4);assert.equal(page,2);assert.match(changes.at(-1).error,/候选/);
});

test('a new browser retains its daily shuffle seed even before any listening action',()=>{
  const disk=storage();const first=createDiscoveryProfile({storage:disk,random:()=>0.2});
  const second=createDiscoveryProfile({storage:disk,random:()=>0.8});assert.equal(first.profile.seed,second.profile.seed);
});
test('recommendations diversify artists while filling 30 songs when one artist dominates',()=>{
  const tracks=[...candidates,...Array.from({length:15},(_,i)=>song(i+100,{artist:`艺人${i}`}))];
  const store=profile();store.import([song(500)]);
  const rows=rankRecommendations(tracks,{profile:store.profile,limit:30});assert.equal(rows.length,30);
  assert.ok(new Set(rows.slice(0,10).map(row=>row.song.artist)).size>=7);
});
test('song radio uses known artist/genre relationships and artist radio filters unrelated results',async()=>{
  const store=profile();const service=createRecommendationService({profileStore:store,storage:storage(),musicService:{search:async()=>[song(1),song(2,{artist:'其他艺人'})]}});
  service.add([song(1),song(2,{artist:'其他艺人',metadata:{genres:['后摇']}}),song(3,{artist:'无关艺人'})]);
  const related=await service.radioBatch({mode:'song',seed:song(90,{metadata:{genres:['后摇']}}),page:0,signal:new AbortController().signal});
  assert.deepEqual(new Set(related.map(row=>row.song.id)),new Set(['1','2']));assert.match(related.find(row=>row.song.id==='2').reason,/共同风格/);
  const artist=await service.radioBatch({mode:'artist',seed:song(90),page:1,signal:new AbortController().signal});assert.deepEqual(artist.map(row=>row.song.id),['1']);
});
