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
