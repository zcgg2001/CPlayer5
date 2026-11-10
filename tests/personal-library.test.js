import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteSQL, applyLocalAccountMigrations } from '../local-accounts.js';
import worker from '../sites/worker.js';
import { cleanRecords, mergeRecords } from '../js/account-data.js';
import { cleanPlaylist, songKey, libraryStats } from '../js/library-data.js';
import { createPersonalLibraryStore, createListeningTracker, LIBRARY_KEY } from '../js/personal-library-store.js';
import { createAccountLibrary } from '../js/account-library.js';
import { createAccountSync } from '../js/account-sync.js';
import { parsePlaylistLink, exportCSV, exportM3U, parseTransfer, mergeImport } from '../js/library-transfer.js';
import { createOfflineAudio, boundedAudio, MAX_AUDIO_BYTES } from '../js/offline-audio.js';
import { MusicService } from '../js/music-service.js';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
const song={id:'123',provider:'gd',name:'春日, "记忆"',artist:'歌手',album:'专辑',url:'https://secret/audio?token=secret'};
const origin='http://127.0.0.1:8787';
function fixture(t,extra={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');applyLocalAccountMigrations(db);t.after(()=>db.close());
 const env={ACCOUNTS_DB:db,ACCOUNT_SQL:sqliteSQL(db),AUTH_URL:origin,AUTH_SECRET:'personal-library-test-secret-not-production',...extra};
 const call=async(path,body,cookie,method=body?'POST':'GET',headers={})=>{const response=await worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json','cf-connecting-ip':'127.0.0.1',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,data:await response.json(),response};};
 const register=async username=>{const r=await call('/api/auth/sign-up/username',{username,password:'test-personal-password'});assert.equal(r.status,200,JSON.stringify(r.data));return {cookie:r.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),id:r.data.user.id};};
 return {db,env,call,register};
}
test('four kinds of favorites, playlist order, annotations and legacy migration round-trip through account sync',()=>{
 const storage=memory(),p=createPersonalLibraryStore({storage});storage.setItem('cp_favorites_v1',JSON.stringify([['gd:123',song]]));
 assert.equal(p.favorites().length,1);
 for(const type of ['artist','album','playlist'])p.toggleEntity({type,id:'123',name:type,provider:'netease'});
 assert.equal(p.entities('album').length,1);assert.equal(p.entities('artist').length,1);assert.equal(p.entities('playlist').length,1);
 const a=p.create('第一张',[song,song]),b=p.create('第二张',[]);assert.equal(p.lists().find(l=>l.id===a).songs.length,1);p.moveList(b,-1);assert.equal(p.lists()[0].id,b);
 p.updateList(a,{description:'我的文字',cover:'https://p1.music.126.net/cover.jpg'});p.annotate(song,{tags:['通勤','通勤'],rating:5,note:'一段回忆'});
 const lib=createAccountLibrary({storage,player:{queue:()=>[],setQueue(){}},refreshFavorites(){},onSettings(){}}),records=lib.capture();assert.ok(!JSON.stringify(records).includes('secret'));assert.deepEqual(records['annotation:gd:123'].tags,['通勤']);
 lib.apply({});assert.equal(p.favorites().length,0);assert.equal(p.entities('artist').length,0);lib.apply(records);assert.equal(p.favorites().length,1);assert.equal(p.lists().find(l=>l.id===a).description,'我的文字');assert.equal(p.annotation(song).rating,5);
 assert.throws(()=>cleanRecords({'entity:album:a':{type:'album',name:'x',provider:'http://bad'}}));assert.throws(()=>cleanRecords({'annotation:gd:1':{tags:[],rating:6}}));
});
test('true listening excludes paused time, seeks and buffering; monthly counters merge by device',()=>{
 const storage=memory();let clock=0,currentSong=song;const audio=new EventTarget();Object.assign(audio,{paused:false,ended:false,seeking:false,readyState:4,currentTime:0,playbackRate:1});
 const store=createPersonalLibraryStore({storage,now:()=>Date.UTC(2026,4,1)}),tracker=createListeningTracker({audio,store,getSong:()=>currentSong,getOwner:()=> 'alice',deviceId:'device1',now:()=>clock,uuid:()=> 'session1'});
 tracker.tick();clock=10000;audio.currentTime=10;tracker.tick();audio.paused=true;clock=50000;audio.dispatchEvent(new Event('pause'));tracker.tick();
 audio.paused=false;audio.currentTime=100;clock+=1000;audio.dispatchEvent(new Event('seeking'));tracker.tick();clock+=5000;audio.currentTime+=5;tracker.tick();tracker.flush();
 assert.equal(store.stats('2026').seconds,15);assert.equal(store.stats('2026').plays,1);assert.equal(store.history()[0].position,105);
 const remote={'listen:2026-05:device2':{seconds:30,plays:1,days:{'01':30},artists:{'歌手':30}}};const merged=mergeRecords({},store.records(),remote);assert.equal(merged.conflicts.length,0);assert.equal(libraryStats(merged.records,'2026').seconds,45);
});
test('expired listening records stay bounded through sync and stale devices cannot resurrect deletions',async()=>{
 let remote={revision:0,records:{}};
 const request=async(_path,options)=>{if(!options)return structuredClone(remote);assert.equal(options.body.revision,remote.revision);remote={revision:remote.revision+1,records:structuredClone(options.body.records)};return {revision:remote.revision};};
 let time=Date.UTC(2026,10,10);
 const storage=memory(), library=createPersonalLibraryStore({storage,now:()=>time++});
 const a=createAccountSync({storage,request}),b=createAccountSync({storage:memory(),request});a.connect('a');b.connect('a');
 for(let i=0;i<260;i++) {library.record({sessionId:`s${i}`,deviceId:'d1',song,seconds:10,position:10,first:true});a.capture(library.records());await a.sync();if(i===5)await b.sync();}
 assert.equal(Object.keys(remote.records).filter(k=>k.startsWith('history:')).length,200);
 await b.sync();assert.equal(b.records()['history:s0'],undefined);assert.equal(Object.keys(remote.records).filter(k=>k.startsWith('history:')).length,200);
 library.clearHistory();a.capture(library.records());await a.sync();await b.sync();assert.ok(!Object.keys(b.records()).some(k=>k.startsWith('history:')));
});
test('portable imports validate links, preserve Unicode/CSV quotes, redact audio and retain existing playlists',()=>{
 assert.deepEqual(parsePlaylistLink('https://music.163.com/#/playlist?id=123'),{provider:'netease',id:'123'});
 assert.deepEqual(parsePlaylistLink('https://y.qq.com/n/ryqq/playlist/456'),{provider:'qq',id:'456'});
 for(const bad of ['https://music.163.com.evil/playlist?id=1','https://user:pass@y.qq.com/playlist/2','file:///playlist/3','https://127.0.0.1/playlist?id=1'])assert.throws(()=>parsePlaylistLink(bad));
 const csv=exportCSV([song]);assert.equal(parseTransfer(csv,'songs.csv').songs[0].name,song.name);assert.ok(!csv.includes('secret'));
 assert.ok(exportCSV([{...song,name:'=1+2'}]).includes("'=1+2"));
 const m3u=exportM3U([song]);assert.ok(!m3u.includes('token='));assert.equal(parseTransfer(m3u,'songs.m3u').songs[0].name,song.name);
 assert.throws(()=>parseTransfer('#EXTM3U\nhttps://evil.example/secret.mp3','a.m3u'));
 const before={'playlist:old':cleanPlaylist({name:'原歌单',songs:[song]})}, incoming={'playlist:old':{name:'迁移歌单',songs:[]},'favorite:gd:123':null};const result=mergeImport(before,incoming,()=> 'copy');assert.equal(result['playlist:old'].name,'原歌单');assert.equal(result['playlist:copy'].name,'迁移歌单（导入）');assert.equal(result['favorite:gd:123'],undefined);
});
test('collaborative playlists enforce invitation, viewer/editor/owner rules, revision CAS and revocation',async t=>{
 const f=fixture(t),a=await f.register('owner_user'),b=await f.register('editor_user'),c=await f.register('reader_user');
 const created=await f.call('/api/library/playlists',{name:'一起听',songs:[song],visibility:'public'},a.cookie);assert.equal(created.status,201);const path='/api/library/playlists/'+created.data.id, pub='/api/library/public/'+created.data.id;
 assert.equal((await f.call(pub)).status,404);assert.equal((await f.call(path,null,b.cookie)).status,404);assert.equal((await f.call(path,null,null)).status,401);
 assert.equal((await f.call(path+'/members',{username:'editor_user',role:'editor'},a.cookie)).status,200);
 assert.equal((await f.call(path,null,b.cookie)).status,404);assert.equal((await f.call('/api/library/playlists',null,b.cookie)).data.invitations.length,1);
 assert.equal((await f.call(path+'/invitation',{accept:true},b.cookie)).status,200);const current=(await f.call(path,null,b.cookie)).data;
 assert.equal(current.role,'editor');assert.ok(!JSON.stringify(current).includes(a.id));assert.ok(!JSON.stringify(current).includes('secret'));
 assert.equal((await f.call(path,{...current,visibility:'public'},b.cookie,'PUT')).status,403);
 const edit={...current,name:'编辑者修改',visibility:undefined};assert.equal((await f.call(path,edit,b.cookie,'PUT')).status,200);assert.equal((await f.call(path,edit,a.cookie,'PUT')).status,409);
 assert.equal((await f.call(path+'/members',{username:'reader_user',role:'viewer'},a.cookie)).status,200);await f.call(path+'/invitation',{accept:true},c.cookie);
 const fresh=(await f.call(path,null,a.cookie)).data;assert.equal((await f.call(path,{...fresh,visibility:undefined},c.cookie,'PUT')).status,403);assert.equal((await f.call(path,{revision:fresh.revision},b.cookie,'DELETE')).status,403);
 assert.equal((await f.call(path,{...fresh,visibility:'public'},a.cookie,'PUT')).status,200);assert.equal((await f.call(pub)).status,200);assert.ok(!(await f.call(pub)).data.ownerId);
 await f.call(path+'/members',{username:'editor_user'},a.cookie,'DELETE');assert.equal((await f.call(path,null,b.cookie)).status,404);
 const latest=(await f.call(path,null,a.cookie)).data;assert.equal((await f.call(path,{...latest,visibility:'private'},a.cookie,'PUT')).status,200);assert.equal((await f.call(pub)).status,404);
 const exported=await f.call('/api/account/export',null,a.cookie);assert.equal(exported.data.sharedPlaylists.length,1);
 assert.equal((await f.call('/api/account/delete',{confirmation:'删除我的账号'},a.cookie)).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cplayer_shared_playlists').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM cplayer_playlist_members').get().n,0);
});
test('library requests enforce CSRF and reject unsafe projection and oversized payloads',async t=>{
 const f=fixture(t),a=await f.register('check_user');
 assert.equal((await f.call('/api/library/playlists',{name:'x',songs:[]},a.cookie,'POST',{origin:'https://evil.example'})).status,403);
 assert.equal((await f.call('/api/library/playlists',{name:'x',songs:Array.from({length:1001},()=>song)},a.cookie)).status,400);
 assert.equal((await f.call('/api/library/playlists',{name:'x',songs:[],padding:'x'.repeat(2100000)},a.cookie)).status,413);
});
test('playlist import only requests numeric IDs at fixed hosts and reports partial upstream lists',async t=>{
 let calls=0;const f=fixture(t,{LIBRARY_IMPORT_FETCH:async(url,options)=>{calls++;assert.equal(url.hostname,'c.y.qq.com');assert.equal(options.redirect,'error');return Response.json({code:0,cdlist:[{disstid:'456',dissname:'QQ 歌单',total_song_num:5,songlist:[{songmid:'mid123',songname:'歌曲',singer:[{name:'歌手'}]}]}]});}});
 const result=await f.call('/api/v1/library/import?url='+encodeURIComponent('https://y.qq.com/n/ryqq/playlist/456'));assert.equal(result.status,200);assert.equal(result.data.partial,true);assert.equal(result.data.tracks[0].provider,'at38-qq');
 assert.equal((await f.call('/api/v1/library/import?url='+encodeURIComponent('https://127.0.0.1/private'))).status,400);assert.equal(calls,1);
});
test('offline audio is complete and bounded; owner switching aborts downloads and revokes object URLs',async()=>{
 const signal=new AbortController().signal;
 await assert.rejects(()=>boundedAudio(new Response('html',{headers:{'content-type':'text/html'}}),signal));
 await assert.rejects(()=>boundedAudio(new Response('audio',{status:206,headers:{'content-type':'audio/mpeg'}}),signal));
 await assert.rejects(()=>boundedAudio(new Response('large',{headers:{'content-type':'audio/mpeg','content-length':String(MAX_AUDIO_BYTES+1)}}),signal));
 const blob=await boundedAudio(new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}}),signal);assert.equal(blob.size,9);
 let owner='a',writes=0;const revoked=[],stored=new Map(),database={list:async o=>[...stored.values()].filter(e=>e.owner===o),get:async(o,id)=>stored.get(o+'|'+id)?.blob,put:async(o,id,s,b)=>{writes++;stored.set(o+'|'+id,{owner:o,id,song:s,blob:b});},clear:async()=>{},remove:async()=>{}};
 const offline=createOfflineAudio({storage:memory(),getOwner:()=>owner,database,fetchImpl:async()=>new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}}),urlAPI:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)}});
 await offline.download(song,async()=>({url:'https://audio.example/song.mp3',downloadAllowed:true}));assert.equal(writes,1);assert.equal((await offline.resolve(song)).url,'blob:test');owner='b';assert.equal(await offline.resolve(song),null);offline.reset();assert.deepEqual(revoked,['blob:test']);
 await assert.rejects(()=>offline.download(song,async()=>{owner='c';return {url:'https://audio.example/song.mp3'};}));assert.equal(writes,1);
});
test('playback uses local offline blob without invoking an online source',async()=>{
 const service=new MusicService({storage:memory(),location:{href:origin,search:''}});let network=0;
 service.offlineAudio={resolve:async()=>({...song,url:'blob:test',offline:true})};service.playbackRouter={async *candidates(){network++;throw new Error('offline network');}};
 const results=[];for await(const value of service.playbackCandidates(song.id,{song}))results.push(value);
 assert.equal(results[0].offline,true);assert.equal(network,0);
 assert.equal(service.sourceForSong({provider:'local'}).label,'本地音频');
 assert.equal((await service.getLyric('local-id',{song:{provider:'local'}})).lrc,'');
 service.offlineAudio={resolve:async()=>null};service.offlineOnly=()=>true;
 await assert.rejects(async()=>{for await(const value of service.playbackCandidates(song.id,{song}))void value;},/离线模式/);
 assert.equal(network,0);
});
