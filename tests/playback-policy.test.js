import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicService } from '../js/music-service.js';
import { createPlaybackRouter } from '../js/playback-router.js';
import { createLxSources } from '../js/lx-music-sources.js';
import { HttpStatusError } from '../js/http.js';

const track = { id:'123', sourceId:'123', provider:'gd', name:'晴天', artist:'周杰伦', album:'叶惠美', duration:269 };
const memory = () => {
  const values = new Map();
  return { getItem:key => values.get(key), setItem:(key,value) => values.set(key,value) };
};
async function fixture(t, { now = Date.now, storage = memory() } = {}) {
  const previous = globalThis.document;
  globalThis.document = {};
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const service = new MusicService({ storage }), calls = [], modes = new Map();
  service.getRuntimePolicy = async () => null;
  service.playbackRouter = createPlaybackRouter(service, { storage, now });
  service.lxSources = createLxSources(storage, {
    download:async url => url,
    open:async code => ({ sources:{ wy:{ qualitys:['128k'] } }, close() {}, resolve:async () => {
      const slot = code.includes('backup') ? 'lx-backup' : 'lx-primary'; calls.push(slot);
      return modes.get(slot) === 'fail' ? null : `https://audio.example.org/${slot}.mp3`;
    } }),
  });
  await service.lxSources.save({ enabled:true, primary:'https://example.org/main.js', backup:'https://example.org/backup.js' });
  const fetchImpl = async input => {
    const url = new URL(input, 'https://player.test'), provider = url.searchParams.get('source');
    calls.push(provider);
    const mode = modes.get(provider);
    if (mode === 'fail' || mode === 'quota') return Response.json({error:{code:'chksz_error'}}, {status:mode === 'quota' ? 402 : 503});
    return Response.json({code:200,data:{id:url.searchParams.get('id'),level:'standard',url:`https://audio.example.org/${provider}.mp3`}},
      mode === 'last' ? {headers:{'x-quota-free-remaining':'0','x-quota-paid-remaining':'0'}} : undefined);
  };
  const next = (id = '123', extra = {}) => service.playbackCandidates(id, { song:{...track,id,sourceId:id}, fetchImpl, ...extra });
  return { service, calls, modes, next, storage };
}

test('default playback uses custom primary, backup, then ChKSz before the other platform channels', async t => {
  const h = await fixture(t), it = h.next();
  assert.equal((await it.next()).value.playbackSource, 'lx-primary');
  assert.equal((await it.next({skipProvider:true})).value.playbackSource, 'lx-backup');
  assert.equal((await it.next({skipProvider:true})).value.provider, 'chksz');
  assert.deepEqual(h.calls, ['lx-primary','lx-backup','chksz']);
  await it.return();
});

test('a selected built-in failure falls back through both custom slots without replacing the saved preference', async t => {
  const h = await fixture(t); h.service.setPlaybackPreference('netease'); h.modes.set('netease','fail');
  const it = h.next();
  assert.equal((await it.next()).value.playbackSource, 'lx-primary');
  assert.equal((await it.next({skipProvider:true})).value.playbackSource, 'lx-backup');
  const fallback = (await it.next({skipProvider:true})).value;
  assert.equal(fallback.provider, 'chksz'); h.service.recordPlaybackSuccess(fallback, 10);
  assert.deepEqual(h.calls, ['netease','lx-primary','lx-backup','chksz']);
  assert.equal(h.service.config.playbackSource, 'netease');
  assert.equal(new MusicService({storage:h.storage}).config.playbackSource, 'netease');
  await it.return();
  h.calls.length = 0;
  assert.equal((await h.next('456').next()).value.playbackSource, 'lx-primary');
  assert.deepEqual(h.calls, ['lx-primary']); // The known failed platform stays in cooldown.
});

test('disabled preferred platform falls back to custom sources before the original catalog channel', async t => {
  const h = await fixture(t); h.service.setPlaybackPreference('netease');
  h.service.getRuntimePolicy = async () => ({sources:{netease:{enabled:false}}});
  const result = await h.next('123', {song:{...track,preferredProvider:'gd'}}).next();
  assert.equal(result.value.playbackSource, 'lx-primary'); assert.deepEqual(h.calls, ['lx-primary']);
});

test('saved custom backup preference wins next time, then failed scripts automatically reach platform channels', async t => {
  const h = await fixture(t); h.service.setPlaybackPreference('lx-backup');
  assert.equal((await h.next().next()).value.playbackSource, 'lx-backup');
  h.calls.length = 0; h.modes.set('lx-backup','fail'); h.modes.set('lx-primary','fail');
  assert.equal((await h.next('456').next()).value.provider, 'chksz');
  assert.deepEqual(h.calls, ['lx-backup','lx-primary','chksz']);
  assert.equal(h.storage.getItem('cp_playback_source'), 'lx-backup');
});

test('daily quota exhaustion skips further requests, persists across restarts, and resumes exactly at Beijing midnight', async t => {
  let time = Date.parse('2026-11-26T01:00:00+08:00');
  const h = await fixture(t, {now:() => time}); h.service.setPlaybackPreference('chksz'); h.modes.set('chksz','quota');
  assert.equal((await h.next().next()).value.playbackSource, 'lx-primary');
  const reset = Date.parse('2026-11-27T00:00:00+08:00');
  assert.equal(h.service.playbackRouter.health().chksz.until, reset);
  assert.equal(h.service.playbackRouter.health().chksz.reason, 'daily_quota');
  // Delayed success and transport failure cannot cancel or shorten the daily hold.
  h.service.recordPlaybackSuccess({provider:'chksz'}, 20);
  h.service.recordPlaybackFailure({provider:'chksz'}, new HttpStatusError(503));
  h.service.playbackRouter = createPlaybackRouter(h.service, {storage:h.storage,now:() => time});
  assert.equal(h.service.playbackRouter.health().chksz.until, reset); // Not capped at one hour on restart.
  time = reset - 1;
  assert.equal((await h.next('456').next()).value.playbackSource, 'lx-primary');
  assert.equal(h.calls.filter(p => p === 'chksz').length, 1);
  await assert.rejects(h.next('456',{onlyProvider:'chksz'}).next(), e => e.code === 'source_unavailable');
  h.modes.delete('chksz'); time = reset;
  assert.equal((await h.next('789').next()).value.provider, 'chksz');
  assert.equal(h.calls.filter(p => p === 'chksz').length, 2);
  assert.equal(h.service.playbackRouter.health().chksz.reason, undefined);
  assert.equal(h.service.config.playbackSource, 'chksz');
});

test('the final successful quota response still plays but no further quality or next-song requests spend quota', async t => {
  const h = await fixture(t); h.service.setPlaybackPreference('chksz'); h.modes.set('chksz','last');
  const it = h.next(), last = (await it.next()).value;
  assert.equal(last.provider, 'chksz'); assert.ok(last.url);
  h.service.recordPlaybackSuccess(last, 20);
  assert.equal(h.service.playbackRouter.health().chksz.reason, 'daily_quota');
  assert.equal((await it.next({error:Error('decode')})).value.playbackSource, 'lx-primary');
  await it.return();
  assert.equal((await h.next('456').next()).value.playbackSource, 'lx-primary');
  assert.equal(h.calls.filter(p => p === 'chksz').length, 1);
});

test('absent quota headers, paid balance, other providers, auth errors and ordinary 429 are not daily exhaustion', () => {
  const time = Date.parse('2026-11-26T01:00:00+08:00');
  for (const [provider, headers] of [['chksz',{}],['chksz',{'x-quota-free-remaining':'0'}],
    ['chksz',{'x-quota-free-remaining':'0','x-quota-paid-remaining':'2'}],
    ['chksz',{'x-quota-free-remaining':'','x-quota-paid-remaining':'0'}],
    ['gd',{'x-quota-free-remaining':'0','x-quota-paid-remaining':'0'}]]) {
    const router = createPlaybackRouter({}, {now:() => time});
    router.observeQuota(provider, new Response('{}',{headers})); assert.deepEqual(router.health(), {});
  }
  for (const status of [401,403,429]) {
    const router = createPlaybackRouter({}, {now:() => time});
    router.failure({provider:'chksz'}, new HttpStatusError(status,null,'600'));
    assert.equal(router.health().chksz.reason, undefined);
    assert.ok(router.health().chksz.until <= time + 900000);
  }
});

test('cooldown storage is optional and prefetch uses neither custom scripts nor the chosen quota channel', async t => {
  const storage = {getItem:() => null,setItem() {throw Error('storage unavailable');}};
  const service = new MusicService({storage});
  assert.equal(service.setPlaybackPreference('chksz'), true);
  service.playbackRouter.failure({provider:'chksz'},new HttpStatusError(402));
  assert.equal(service.playbackRouter.health().chksz.reason, 'daily_quota');
  const h = await fixture(t); h.service.setPlaybackPreference('chksz');
  assert.equal((await h.next('456',{prefetch:true}).next()).done, true); assert.deepEqual(h.calls, []);
});
