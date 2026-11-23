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
