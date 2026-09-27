import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QUALITY,
  MusicService,
  MUSIC_API_BASE_URL,
  supportedMusicSource,
  supportedQuality,
} from '../js/music-service.js';

function storage(values = {}) {
  const state = new Map(Object.entries(values));
  return {
    getItem: key => state.get(key) || null,
    setItem: (key, value) => state.set(key, String(value)),
  };
}

test('music service restores and validates preferences at its module boundary', () => {
  const service = new MusicService({
    storage: storage({ cp_quality: 'invalid', cp_source: 'bilibili' }),
    location: { search: '' },
  });

  assert.equal(service.config.quality, DEFAULT_QUALITY);
  assert.equal(service.config.source, 'bilibili');
  assert.equal(supportedQuality('missing'), DEFAULT_QUALITY);
  assert.equal(supportedMusicSource('missing'), 'chksz');
});

test('music service builds source-aware search requests', async () => {
  const requests = [];
  const service = new MusicService({ storage: storage(), location: { search: '' } });
  const songs = await service.search('夜曲', {
    source: 'bilibili',
    fetchImpl: async url => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 200, data: [] }),
      };
    },
  });

  assert.equal(MUSIC_API_BASE_URL, '/api/v1/music');
  assert.equal(requests[0], '/api/v1/music/search?source=bilibili&keyword=%E5%A4%9C%E6%9B%B2&limit=30');
  assert.equal(service.sourceForSong({ provider: 'bilibili' }).provider, 'bilibili');
  assert.deepEqual(songs, []);
});

test('music service persists normalized setting changes', () => {
  const saved = storage();
  const service = new MusicService({ storage: saved, location: { search: '' } });
  service.saveSettings('quality', 'hires');
  service.saveSettings('source', 'bilibili');
  assert.equal(service.config.quality, 'hires');
  assert.equal(service.config.source, 'bilibili');
  assert.equal(saved.getItem('cp_quality'), 'hires');
  assert.equal(saved.getItem('cp_source'), 'bilibili');
});
