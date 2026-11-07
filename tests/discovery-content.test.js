import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
const req = path => new Request(`https://player.test/api/v1/discovery/${path}`);
const raw = {id:1,name:'歌曲',duration:240000,artists:[{id:2,name:'歌手'}],album:{name:'专辑',picUrl:'http://p1.music.126.net/a.jpg',publishTime:1609459200000},mp3Url:'https://secret.test/signed?token=secret',fee:1};
const upstream = tracks => Response.json({code:200,result:{id:123,name:'公开歌单',tracks,trackCount:1000}});
test('discovery validates IDs and actions before outbound requests',async()=>{
  for(const path of ['playlist?id=../123','artist?id=https://bad.test','other','playlists?offset=-1','playlists?category='+ 'a'.repeat(41)]){
    assert.equal((await worker.fetch(req(path),{DISCOVERY_FETCH:()=>{throw Error('should not fetch');}})).status,400);
  }
});
test('public playlists preserve metadata, show partial counts, and do not infer GD restrictions from NetEase fee',async()=>{
  let calls=0;const fetchImpl=async (url,options)=>{calls++;assert.equal(new URL(url).origin,'https://music.163.com');assert.equal(options.redirect,'manual');return upstream([raw]);};
  const response=await worker.fetch(req('playlist?id=123'),{DISCOVERY_FETCH:fetchImpl});assert.equal(response.status,200);
  const body=await response.json(),song=body.tracks[0];assert.equal(song.duration,240);assert.equal(song.provider,'gd');assert.equal(song.sourceId,'1');assert.equal(song.metadata.releaseDate,'2021-01-01');assert.equal(song.availability.status,'unknown');assert.equal(body.partial,true);assert.equal(body.collection.trackCount,1000);
  assert.doesNotMatch(JSON.stringify(body),/secret|token|mp3Url/);assert.match(song.cover,/^https:/);
  await worker.fetch(req('playlist?id=123'),{DISCOVERY_FETCH:fetchImpl});assert.equal(calls,1);
});
test('oversized, redirected, mismatched and malformed upstream data fail explicitly',async()=>{
  for(const fetchImpl of [async()=>new Response('x'.repeat(2*1024*1024+1)),async()=>new Response(null,{status:302,headers:{location:'https://bad.test'}}),async()=>Response.json({code:200,result:{id:456,tracks:[raw]}}),async()=>Response.json({code:200})]){
    assert.equal((await worker.fetch(req('playlist?id=123'),{DISCOVERY_FETCH:fetchImpl})).status,502);
  }
});
test('charts and scene categories retain upstream ordering without requesting ChKSz',async()=>{
  const response=await worker.fetch(req('charts'),{DISCOVERY_FETCH:async url=>{assert.ok(url.endsWith('/api/toplist'));return Response.json({code:200,list:[{id:2,name:'风格榜'},{id:1,name:'地区榜'}]});}});
  assert.deepEqual((await response.json()).items.map(x=>x.id),['2','1']);
  const scene=await worker.fetch(req('playlists?category='+encodeURIComponent('学习')),{DISCOVERY_FETCH:async url=>{assert.equal(new URL(url).searchParams.get('cat'),'学习');return Response.json({code:200,playlists:[]});}});assert.equal(scene.status,200);
});
