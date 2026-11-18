import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { catalogRecord, mergeMetadata, neteaseMetadataId } from '../js/music-catalog.js';
const request=(query='source=netease&id=1')=>new Request(`https://player.test/api/v1/music/metadata?${query}`);
const base={id:1,name:'歌曲',duration:240000,artists:[{id:2,name:'歌手'}],album:{id:3,name:'专辑',publishTime:1609459200000,company:'厂牌',picUrl:'https://p1.music.126.net/cover.jpg'}};
const data=value=>new Response(JSON.stringify(value));
test('metadata validates identifiers and sources before contacting any upstream',async()=>{
  for(const query of ['source=qq&id=1','source=netease&id=https://bad.test','source=netease&id=../1']){
    const result=await worker.fetch(request(query),{METADATA_FETCH:()=>{throw new Error('must not fetch');}});assert.equal(result.status,400);
  }
});
test('metadata enrichment is quota-independent and bounds content to song, album and artists',async()=>{
  const urls=[];const fetchImpl=async url=>{urls.push(url);if(url.includes('/song/detail'))return data({code:200,songs:[base]});if(url.endsWith('/album/3'))return data({code:200,album:{...base.album,description:'专辑介绍',language:'国语'}});return data({code:200,artist:{id:2,name:'歌手',picId:123,picUrl:'https://p1.music.126.net/avatar.jpg',briefDesc:'艺人介绍'}});};
  const result=await worker.fetch(request(),{METADATA_FETCH:fetchImpl});assert.equal(result.status,200);const body=await result.json();
  assert.equal(body.data.duration,240);assert.equal(body.data.metadata.releaseDate,'2021-01-01');assert.equal(body.data.metadata.label,'厂牌');assert.equal(body.data.metadata.language,'国语');
  assert.equal(body.data.albumEntity.description,'专辑介绍');assert.equal(body.data.artistEntities[0].description,'艺人介绍');
  assert.equal(urls.length,3);assert.ok(urls.every(url=>new URL(url).origin==='https://music.163.com'));
  await worker.fetch(request(),{METADATA_FETCH:fetchImpl});assert.equal(urls.length,3);
});
test('optional album/artist failure retains basic metadata; generic avatars are not artist portraits',async()=>{
  const result=await worker.fetch(request(),{METADATA_FETCH:async url=>url.includes('/song/detail')?data({code:200,songs:[base]}):data({code:-462})});const body=await result.json();
  assert.equal(result.status,200);assert.deepEqual(body.data.partial,['album','artist']);assert.equal(body.data.duration,240);assert.equal(body.data.artistEntities[0].avatar,'');
});
test('oversized or mismatched upstream metadata never reaches the UI',async()=>{
  const huge=await worker.fetch(request(),{METADATA_FETCH:async()=>new Response('x'.repeat(513*1024))});assert.equal(huge.status,502);
  const mismatch=await worker.fetch(request(),{METADATA_FETCH:async()=>data({code:200,songs:[{...base,id:99}]})});assert.equal(mismatch.status,404);
});
test('metadata ID extraction respects platform boundaries and does not create playable source candidates',()=>{
  const raw={id:'1',provider:'gd',name:'歌曲',artist:'歌手',album:'专辑'};
  assert.equal(neteaseMetadataId(raw),'1');assert.equal(neteaseMetadataId({...raw,provider:'gequke'}),null);
  assert.equal(neteaseMetadataId({...raw,provider:'jianbin-netease',sourceId:'https://x.test/?id=88&type=wy'}),'88');
  const song=catalogRecord(raw),updated=mergeMetadata(song,{id:'1',provider:'netease',name:'歌曲',artist:'歌手',album:'专辑',metadata:{language:'国语'},albumEntity:{description:'专辑介绍'},artistEntities:[{name:'歌手',avatar:'https://example.test/avatar'}],cover:'https://p1.music.126.net/cover.jpg'});
  assert.equal(updated.sources.length,1);assert.equal(updated.sources[0].provider,'gd');assert.equal(updated.metadata.language,'国语');assert.equal(updated.artists[0].avatar,'https://example.test/avatar');assert.equal(updated.albumEntity.artwork.length,3);
});

test('playback artwork lookup makes only one request and does not contaminate the full detail cache',async()=>{
  const urls=[];
  const env={METADATA_FETCH:async url=>{urls.push(url);return url.includes('/song/detail')?data({code:200,songs:[base]}):data({code:200,album:base.album,artist:base.artists[0]});}};
  const result=await worker.fetch(request('source=netease&id=1&artwork=1'),env);
  assert.equal((await result.json()).data.cover,base.album.picUrl);assert.equal(urls.length,1);
  await worker.fetch(request('source=netease&id=1&artwork=1'),env);assert.equal(urls.length,1);
  await worker.fetch(request(),env);assert.equal(urls.length,4);
});

test('artwork lookup recovers from an empty song cover using only its exact album ID',async()=>{
  const urls=[];
  const result=await worker.fetch(request('source=netease&id=1&artwork=1'),{METADATA_FETCH:async url=>{
    urls.push(url);return url.includes('/song/detail')?data({code:200,songs:[{...base,album:{id:3,name:'专辑'}}]}):data({code:200,album:base.album});
  }});
  assert.equal((await result.json()).data.cover,base.album.picUrl);assert.equal(urls.length,2);assert.ok(urls[1].endsWith('/album/3'));
});

test('QQ artwork looks up the exact song MID and caches only the matching public album MID', async () => {
  const mid='0039MnYb0qxYhV', albumMid='000MkMni19ClKG';
  const query=`source=qq&id=${mid}&artwork=1`, urls=[];
  const song={mid,name:'晴天',album:{mid:albumMid,name:'叶惠美'},file:{extra:'ignored'}};
  const env={METADATA_FETCH:async(url,options)=>{
    urls.push(url);assert.equal(options.redirect,'error');
    return data({code:0,data:[{...song,mid:'004Fs2FP1EvZYc',album:{mid:'000rusYr0tlsP1'}},song]});
  }};
  for(let call=0;call<2;call++) {
    const result=await worker.fetch(request(query),env);
    assert.equal(result.status,200);assert.deepEqual(await result.json(),{code:200,data:{id:mid,albumMid}});
  }
  assert.deepEqual(urls,[`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${mid}&format=json`]);
  for (const bad of [`source=qq&id=${mid}`,'source=qq&id=123&artwork=1','source=qq&id=..%2Ffoo&artwork=1']) {
    assert.equal((await worker.fetch(request(bad),{METADATA_FETCH:assert.fail})).status,400);
  }
});

test('QQ artwork distinguishes missing songs/albums from upstream errors', async () => {
  const mid='0039MnYb0qxYhV',query=`source=qq&id=${mid}&artwork=1`;
  for (const [response,expected] of [
    [data({code:0,data:[]}),404], [data({code:0,data:[{mid:'004Fs2FP1EvZYc',name:'晴天',album:{mid:'000MkMni19ClKG'}}]}),404],
    [data({code:0,data:[{mid,album:{id:'112233'}}]}),404], [data({code:-1}),502],
    [new Response(null,{status:503}),502], [new Response('x'.repeat(128*1024+1)),502],
  ]) {
    const result=await worker.fetch(request(query),{METADATA_FETCH:async()=>response});
    assert.equal(result.status,expected);assert.equal((await result.json()).data,undefined);
  }
});
