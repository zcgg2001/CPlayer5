import test from 'node:test';
import assert from 'node:assert/strict';
import { createLxSources, LX_DEFAULTS } from '../js/lx-music-sources.js';
import { publicLxUrl } from '../js/lx-source-runtime.js';
import { MusicService } from '../js/music-service.js';

test('online playback tries LX primary, LX backup and the built-in router in order', async () => {
  const calls = [];
  const service = new MusicService({});
  service.lxSources = createLxSources(undefined, {
    download: async url => url,
    open: async code => ({
      sources: { tx: { qualitys: ['flac', '128k'] } },
      async resolve({ source, info }) {
        calls.push([code, source, info.type, info.musicInfo.songmid]);
        return code === LX_DEFAULTS.primary ? 'https://audio.example.org/primary.flac' : 'https://audio.example.org/backup.mp3';
      },
      close() {},
    }),
  });
  service.playbackRouter.candidates = async function* () { yield { provider: 'qq' }; };
  const song = { id: 'qq:001AbCdEF23GhI', provider: 'qq', name: '测试' };
  const oldDocument = globalThis.document;
  globalThis.document = {};
  try {
    const candidates = service.playbackCandidates(song.id, { song });
    const primary = (await candidates.next()).value;
    assert.equal(primary.playbackSource, 'lx-primary');
    assert.equal(primary.provider, 'qq');
    assert.equal(primary.level, 'lossless');
    const backup = (await candidates.next({ skipProvider: true })).value;
    assert.equal(backup.playbackSource, 'lx-backup');
    assert.equal(backup.level, 'standard');
    assert.equal((await candidates.next({ skipProvider: true })).value.provider, 'qq');
    assert.deepEqual(calls, [
      [LX_DEFAULTS.primary, 'tx', 'flac', '001AbCdEF23GhI'],
      [LX_DEFAULTS.backup, 'tx', 'flac', '001AbCdEF23GhI'],
    ]);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

test('a failed import keeps the previous settings and disabled sources persist', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const sources = createLxSources(storage, { download: async () => { throw new Error('unavailable'); } });
  await assert.rejects(sources.save({ ...LX_DEFAULTS, primary: 'https://example.org/source.js' }), /unavailable/);
  assert.deepEqual(sources.settings, LX_DEFAULTS);
  assert.equal(values.size, 0);
  await sources.save({ ...LX_DEFAULTS, enabled: false });
  assert.equal(createLxSources(storage).settings.enabled, false);
  for (const url of ['https://127.0.0.1/a', 'https://inside.local/a', 'http://example.org/a', 'https://user@example.org/a']) {
    assert.throws(() => publicLxUrl(url));
  }
});

const track = { id: '123', provider: 'gd', name: '测试歌曲' };
const settings = { enabled: true, primary: 'https://example.org/main.js', backup: 'https://example.org/backup.js' };
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};
function fixture(storage = memory(), { resolve, sources = { wy: { qualitys: ['flac', '320k', '128k'] } } } = {}) {
  const calls = [], closed = [];
  const lx = createLxSources(storage, {
    download: async url => `/**\n * @name ${url.includes('backup') ? '备用自定义' : '我的自定义'}\n */\n${url}`,
    open: async code => ({ sources, close: () => closed.push(code), resolve: async query => {
      calls.push({ code, ...query });
      return resolve ? resolve(code, query) : `https://audio.example.org/${code.includes('backup') ? 'backup' : 'main'}.mp3`;
    } }),
  });
  return { lx, storage, calls, closed };
}

test('import exposes real names and platform availability, persists metadata, and notifies removal and disable', async () => {
  const h = fixture(); let changes = 0;
  const unsubscribe = h.lx.subscribe(() => changes++);
  await h.lx.save(settings);
  assert.equal(changes, 1);
  assert.deepEqual(h.lx.list({ song: track }).map(({ label, disabledReason }) => ({ label, disabledReason })), [
    { label: '我的自定义', disabledReason: '' }, { label: '备用自定义', disabledReason: '' },
  ]);
  assert.equal(createLxSources(h.storage).list()[0].label, '我的自定义');
  assert.match(h.lx.list({ song: { id: 'qq:001AbCdEF23GhI', provider: 'qq' } })[0].disabledReason, /不支持/);
  assert.match(h.lx.list({ song: { id: 'qq:123', provider: 'qq' } })[0].disabledReason, /平台标识/);
  await h.lx.save({ ...settings, primary: '' });
  assert.deepEqual(h.lx.list().map(option => option.id), ['lx-backup']);
  await h.lx.save({ ...settings, enabled: false });
  assert.ok(h.lx.list().every(option => option.disabledReason.includes('已关闭')));
  assert.equal(changes, 3); unsubscribe();
});

test('manual LX resolves exactly the selected slot, preserves catalog identity, and cannot fall back on failure', async () => {
  const h = fixture(); await h.lx.save(settings);
  const service = new MusicService({ storage: h.storage }); service.lxSources = h.lx;
  service.offlineAudio = { resolve() { assert.fail('manual selection must bypass offline cache'); } };
  service.playbackRouter.candidates = async function* () { assert.fail('manual LX must not use built-ins'); };
  const iterator = service.playbackCandidates(track.id, { song: track, onlyProvider: 'lx-backup' });
  const result = (await iterator.next()).value;
  assert.equal(result.playbackSource, 'lx-backup'); assert.equal(result.playbackSourceUrl, settings.backup);
  assert.equal(result.provider, 'gd'); assert.equal(result.id, track.id); assert.equal(result.routing.manual, true);
  assert.equal((await iterator.next()).done, true);
  assert.equal(h.calls.length, 1); assert.ok(h.calls[0].code.includes('backup'));
  const failing = fixture(memory(), { resolve: () => null }); await failing.lx.save(settings);
  service.lxSources = failing.lx;
  await assert.rejects(service.playbackCandidates(track.id, { song: track, onlyProvider: 'lx-backup' }).next(), /无法解析/);
  assert.ok(failing.calls.every(call => call.code.includes('backup')));
  await failing.lx.save({ ...settings, enabled: false });
  await assert.rejects(service.playbackCandidates(track.id, { song: track, onlyProvider: 'lx-backup' }).next(), /已关闭/);
});

test('remembered custom preference persists, and disabling or removing it restores automatic choice', async () => {
  const storage = memory(), h = fixture(storage); await h.lx.save(settings);
  const service = new MusicService({ storage });
  assert.equal(service.playbackPreferenceOptions().find(option => option.id === 'lx-backup').label, '备用自定义 · 自定义备用');
  assert.equal(service.setPlaybackPreference('lx-backup'), true);
  assert.equal(new MusicService({ storage }).config.playbackSource, 'lx-backup');
  let changes = 0; service.subscribePlaybackPreferences(() => changes++);
  await service.lxSources.save({ ...settings, enabled: false, backup: '' });
  assert.equal(service.config.playbackSource, ''); assert.equal(storage.getItem('cp_playback_source'), '');
  assert.equal(service.setPlaybackPreference('lx-backup'), false); assert.equal(changes, 1);
});

test('LX preference orders backup before primary and built-ins, but speculative prefetch never executes scripts', async () => {
  const h = fixture(); await h.lx.save(settings);
  const service = new MusicService({ storage: h.storage }); service.lxSources = h.lx;
  service.setPlaybackPreference('lx-backup');
  service.playbackRouter.candidates = async function* (id, options) {
    assert.equal(options.preferredSource, ''); yield { provider: 'netease' };
  };
  const previousDocument = globalThis.document; globalThis.document = {};
  try {
    const candidates = service.playbackCandidates(track.id, { song: track });
    assert.equal((await candidates.next()).value.playbackSource, 'lx-backup');
    assert.equal((await candidates.next()).value.playbackSource, 'lx-primary');
    assert.equal((await candidates.next()).value.provider, 'netease');
    h.calls.length = 0;
    assert.equal((await service.playbackCandidates(track.id, { song: track, prefetch: true }).next()).value.provider, 'netease');
    assert.equal(h.calls.length, 0);
    service.setPlaybackPreference('qq');
    const selected = { ...track, preferredProvider: 'lx-backup', routing: { manual: true } };
    const result = (await service.playbackCandidates(track.id, { song: selected, level: 'exhigh' }).next()).value;
    assert.equal(result.playbackSource, 'lx-backup'); assert.equal(h.calls[0].info.type, '320k');
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});

test('LX failures cool only the actual script, without poisoning the catalog provider', async () => {
  const h = fixture(); await h.lx.save(settings);
  const service = new MusicService({ storage: h.storage }); service.lxSources = h.lx;
  const result = (await service.playbackCandidates(track.id, { song: track, onlyProvider: 'lx-backup' }).next()).value;
  service.recordPlaybackFailure(result, Error('decode'));
  assert.match(h.lx.list()[1].disabledReason, /冷却/);
  assert.equal(h.lx.list()[0].disabledReason, '');
  assert.deepEqual(service.playbackRouter.health(), {});
  service.recordPlaybackSuccess(result, 10); assert.equal(h.lx.list()[1].disabledReason, '');
});

test('changing import settings during resolution discards stale results and closes the runtime', async () => {
  let release; const ready = new Promise(resolve => release = resolve);
  const h = fixture(memory(), { resolve: () => ready }); await h.lx.save(settings);
  const request = h.lx.candidates(track.id, { song: track, onlyProvider: 'lx-backup' }).next();
  while (!h.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
  await h.lx.save({ ...settings, backup: '' });
  release('https://audio.example.org/old.mp3');
  await assert.rejects(request, /设置已更新/);
  assert.equal(h.closed.length, 4);
});

test('known matching platform IDs are tried when the original ID cannot resolve; malformed IDs never reach scripts', async () => {
  const h = fixture(memory(), { sources: { wy: { qualitys: ['128k'] }, tx: { qualitys: ['128k'] } },
    resolve: (code, query) => query.source === 'wy' ? null : 'https://audio.example.org/song.mp3' });
  await h.lx.save(settings);
  const song = { ...track, sources: [{ id: 'qq:123', provider: 'qq' }, { id: 'qq:001AbCdEF23GhI', provider: 'qq' }] };
  const result = (await h.lx.candidates(track.id, { song, onlyProvider: 'lx-primary' }).next()).value;
  assert.equal(result.playbackSource, 'lx-primary');
  assert.deepEqual(h.calls.map(call => [call.source, call.info.musicInfo.id]), [['wy', '123'], ['tx', '001AbCdEF23GhI']]);
});
