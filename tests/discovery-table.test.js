import test from 'node:test';
import assert from 'node:assert/strict';
import {trackDuration, durationLabel, filterDiscoveryTracks} from '../js/discovery-table.js';
import {MusicService} from '../js/music-service.js';
import {normalizeSearchPayload} from '../js/music-data.js';
test('unknown duration is never shown as a zero-length song', () => {
  assert.equal(durationLabel(trackDuration({})), '—');
  assert.equal(durationLabel(trackDuration({duration:NaN})), '—');
  assert.equal(durationLabel(trackDuration({dt:239000})), '3:59');
  assert.equal(durationLabel(trackDuration({duration:240})), '4:00');
  assert.equal(normalizeSearchPayload({code:200,data:[{id:1,name:'Song',dt:239000}]}).at(0).duration,239);
});
test('result sorting preserves original discovery order and keeps unknown lengths last', () => {
  const songs=[{id:1,name:'Beta',artist:'One',duration:240},{id:2,name:'Alpha',album:'Moon'},{id:3,name:'Gamma',duration:120}];
  assert.deepEqual(filterDiscoveryTracks(songs,'moon').map(s=>s.id),[2]);
  assert.deepEqual(filterDiscoveryTracks(songs,'','duration').map(s=>s.id),[3,1,2]);
  assert.deepEqual(songs.map(s=>s.id),[1,2,3]);
});
test('load-more search carries provider, page size, and offset without contacting ChKSz', async () => {
  const service=new MusicService({storage:{getItem:()=>null,setItem(){}}});
  let requested;
  await service.search('华语',{source:'netease',offset:10,limit:10,fetchImpl:async url=>{requested=new URL(url,'https://example.test');return Response.json({code:200,data:[]});}});
  assert.equal(requested.searchParams.get('source'),'netease');
  assert.equal(requested.searchParams.get('offset'),'10');
  assert.equal(requested.searchParams.get('limit'),'10');
});
