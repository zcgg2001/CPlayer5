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

test('ChKSz collections play through the selected API and retain listing metadata', async () => {
  const service = new MusicService({ storage: storage(), location: { search: '?source=gd' } });
  const requests = [];
  const track = { id: 65766, name: '富士山下', artist: '陈奕迅', album: '专辑', cover: 'https://example.com/cover.jpg' };
  const fetchImpl = async url => {
    const parsed = new URL(url, 'https://player.example');
    requests.push({ path: parsed.pathname, source: parsed.searchParams.get('source') });
    if (parsed.pathname.endsWith('/playlist')) {
      return Response.json({ code: 200, data: { id: 3779629, name: '新歌榜', tracks: [track] } });
    }
    return Response.json({ code: 200, data: { id: track.id, url: 'https://example.com/song.mp3', level: 'exhigh' } });
  };
  const discovery = await service.getNewSongs({ fetchImpl });
  const collection = await service.getPlaylistCollection('3779629', { fetchImpl });
  assert.equal(discovery[0].provider, 'chksz');
  assert.deepEqual(collection.tracks, discovery);
  for (const source of ['gd', 'chksz']) {
    service.saveSettings('source', source);
    const played = await service.getSong(track.id, { song: collection.tracks[0], fetchImpl });
    assert.equal(played.provider, source);
    assert.equal(played.name, track.name);
    assert.equal(played.artist, track.artist);
    assert.equal(played.cover, track.cover);
  }
  assert.deepEqual(requests, [
    { path: '/api/v1/music/playlist', source: 'chksz' },
    { path: '/api/v1/music/playlist', source: 'chksz' },
    { path: '/api/v1/music/song', source: 'gd' },
    { path: '/api/v1/music/song', source: 'chksz' },
  ]);
});
