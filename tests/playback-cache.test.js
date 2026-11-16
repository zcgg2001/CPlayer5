import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackCache } from '../js/playback-cache.js';

const data = { provider:'netease', url:'https://media.test/a.flac' };
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve}; };

test('resolved URLs expire, respect upstream expiry, evict on failure, and stay bounded', async () => {
  let now = 1800000000000, calls=0;
  const cache=createPlaybackCache({now:()=>now,limit:2});
  const fetch=async()=>{calls++;return data;};
  assert.equal((await cache.get('a',fetch)).hit,false);
  assert.equal((await cache.get('a',fetch)).hit,true);
  now+=120001;await cache.get('a',fetch);assert.equal(calls,2);
  cache.invalidate(data);await cache.get('a',fetch);assert.equal(calls,3);
  await cache.get('b',fetch);await cache.get('c',fetch);await cache.get('a',fetch);assert.equal(calls,6);
  await cache.get('expiring',async()=>({...data,expiresAt:(now+10000)/1000}));
  now+=5001;assert.equal((await cache.get('expiring',fetch)).hit,false);
  const empty=async()=>{calls++;return null;};
  await cache.get('empty',empty);await cache.get('empty',empty);assert.equal(calls,9);
});

test('concurrent resolutions share one request and cancelling preload leaves active playback alive', async () => {
  const cache=createPlaybackCache(), response=deferred(), a=new AbortController(), b=new AbortController();
  let calls=0, requestSignal;
  const fetch=async signal=>{calls++;requestSignal=signal;return response.promise;};
  const first=cache.get('a',fetch,a.signal), second=cache.get('a',fetch,b.signal);
  await Promise.resolve();a.abort();
  await assert.rejects(first,{name:'AbortError'});assert.equal(requestSignal.aborted,false);
  response.resolve(data);assert.deepEqual((await second).data,data);assert.equal(calls,1);
  assert.equal((await cache.get('a',fetch)).hit,true);
});

test('last cancelled consumer aborts upstream and late results cannot fill the cache', async () => {
  const cache=createPlaybackCache(), response=deferred(), controller=new AbortController();
  let requestSignal;
  const request=cache.get('a',async signal=>{requestSignal=signal;return response.promise;},controller.signal);
  await Promise.resolve();controller.abort();await assert.rejects(request,{name:'AbortError'});
  assert.equal(requestSignal.aborted,true);response.resolve(data);
  await new Promise(r=>setImmediate(r));
  assert.equal((await cache.get('a',async()=>data)).hit,false);
});
