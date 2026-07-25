import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatReleaseDate,
  normalizeArtistsPayload,
  normalizeVideosPayload,
} from '../js/music-explore.js';


test('normalizes artist cards and preserves playable chart tracks', () => {
  const result = normalizeArtistsPayload({
    version: 1,
    collection: {
      key: 'trending',
      name: '趋势歌手',
      fetchedAt: '2026-07-25T00:00:00.000Z',
    },
    items: [{
      rank: 1,
      id: 'artist-a',
      name: '歌手甲',
      cover: 'https://p1.music.126.net/artist.jpg',
      appearances: 3,
      chartCount: 2,
      tracks: [{
        id: '101',
        playbackId: '101',
        name: '第一首',
        artist: '歌手甲',
        album: '专辑一',
        cover: 'https://p1.music.126.net/song.jpg',
        playable: true,
      }],
    }],
  });

  assert.equal(result.collection.key, 'trending');
  assert.equal(result.items[0].name, '歌手甲');
  assert.equal(result.items[0].featuredTrack.playbackId, '101');
  assert.equal(result.items[0].tracks[0].playable, true);
});


test('rejects artist payloads without playable track identities', () => {
  assert.throws(
    () => normalizeArtistsPayload({
      items: [{ id: 'artist-a', name: '歌手甲', tracks: [{ name: '无 ID 歌曲' }] }],
    }),
    /没有返回可播放内容/,
  );
});


test('normalizes allowlisted Apple video links and drops unsafe cards', () => {
  const result = normalizeVideosPayload({
    collection: { key: 'global', name: '全球流行' },
    items: [
      {
        id: '201',
        name: 'Music Video',
        artist: 'Artist',
        poster: 'https://is1-ssl.mzstatic.com/image/thumb/video/900x506bb.jpg',
        externalUrl: 'https://music.apple.com/cn/music-video/example/201',
        previewUrl: 'https://video-ssl.itunes.apple.com/video/example.mov',
        releasedAt: '2026-03-24T07:00:00Z',
        genre: 'Pop',
      },
      {
        id: 'unsafe',
        name: 'Unsafe',
        artist: 'Unknown',
        poster: 'javascript:alert(1)',
        externalUrl: 'https://example.com/watch',
      },
    ],
  });

  assert.equal(result.collection.key, 'global');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, '201');
  assert.match(result.items[0].previewUrl, /^https:\/\/video-ssl\.itunes\.apple\.com\//);
});


test('formats valid release dates and handles missing values', () => {
  assert.match(formatReleaseDate('2026-03-24T07:00:00Z'), /2026/);
  assert.equal(formatReleaseDate('not-a-date'), '近期发布');
});
