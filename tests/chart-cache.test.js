import test from 'node:test';
import assert from 'node:assert/strict';
import { createChartCache } from '../js/chart-cache.js';

const storage = () => { const map = new Map(); return { getItem: key => map.get(key), setItem: (key,value) => map.set(key,value) }; };
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };

test('saved charts render synchronously after reopening without waiting for a network request', async () => {
  const disk = storage(); let calls = 0;
  const fetchValue = async id => { calls++; return {chart:{id},items:[{id:'song'}]}; };
  const first = createChartCache({storage:disk,fetchValue,now:()=>1000}); await first.get('hot');
  const reopened = createChartCache({storage:disk,fetchValue,now:()=>1001});
  assert.equal(reopened.peek('hot').items[0].id,'song');
  assert.equal(reopened.fresh('hot'),true);
  await reopened.get('hot'); assert.equal(calls,1);
});

test('refresh retains the previous chart on slow responses and failures, and deduplicates concurrent loads', async () => {
  const request = deferred(); let calls = 0, time = 0;
  const cache = createChartCache({now:()=>time,ttl:100,fetchValue:()=> ++calls === 1 ? {items:['old']} : request.promise});
  await cache.get('hot'); time = 101;
  const a = cache.get('hot'), b = cache.get('hot',{force:true});
  assert.equal(a,b); assert.deepEqual(cache.peek('hot'),{items:['old']});
  request.reject(new Error('offline'));
  await assert.rejects(a,/offline/); await assert.rejects(b,/offline/);
  assert.deepEqual(cache.peek('hot'),{items:['old']}); assert.equal(calls,2);
});

test('chart and catalog entries are isolated, bounded and never accept malformed persisted records', async () => {
  const disk=storage(); disk.setItem('zp_chart_cache_v1','[["bad",{"at":1,"value":{}}]]');
  const cache=createChartCache({storage:disk,limit:2,now:()=>1000,validate:(_,v)=>Array.isArray(v.items),fetchValue:async id=>({items:[id]})});
  assert.equal(cache.peek('bad'),null);
  for (const id of ['a','b','c']) await cache.get(id);
  assert.equal(cache.peek('a'),null); assert.deepEqual(cache.peek('b').items,['b']);
  const second=createChartCache({storage:disk,key:'another',fetchValue:async()=>({items:[]})});
  assert.equal(second.peek('b'),null);
});

test('disposing prevents an outstanding request from overwriting persisted charts', async () => {
  const pending=deferred(),disk=storage();
  const cache=createChartCache({storage:disk,fetchValue:()=>pending.promise});
  const result=cache.get('hot'); cache.destroy(); pending.resolve({items:['late']});
  await assert.rejects(result); assert.equal(disk.getItem('zp_chart_cache_v1'),undefined);
});

test('browsing more charts than the cache limit retains the directory for the next launch', async () => {
  const disk=storage();
  const cache=createChartCache({storage:disk,limit:3,pinnedKeys:['directory'],fetchValue:async id=>({items:[id]})});
  for (const id of ['directory','a','b','c','d']) await cache.get(id);
  const reopened=createChartCache({storage:disk,limit:3});
  assert.deepEqual(reopened.peek('directory').items,['directory']);
  assert.equal(reopened.peek('b'),null);
  assert.deepEqual(reopened.peek('d').items,['d']);
});
