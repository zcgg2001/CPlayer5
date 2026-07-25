import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchArtistsPayload,
  formatReleaseDate,
  normalizeArtistsPayload,
  normalizeDirectArtistsPayload,
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

test('aggregates ChKSz chart tracks into ranked artist cards', () => {
  const result = normalizeDirectArtistsPayload([
    {
      chart: { key: 'hot' },
      items: [{
        id: '101',
        playbackId: '101',
        name: '第一首',
        artist: '歌手甲/歌手乙',
        album: '专辑一',
        cover: 'https://p1.music.126.net/song.jpg',
        rank: 1,
        playable: true,
      }],
    },
    {
      chart: { key: 'soaring' },
      items: [{
        id: '102',
        playbackId: '102',
        name: '第二首',
        artist: '歌手甲',
        album: '专辑二',
        cover: 'https://p1.music.126.net/song-2.jpg',
        rank: 2,
        playable: true,
      }],
    },
  ], { scope: 'trending' });

  assert.equal(result.collection.key, 'trending');
  assert.equal(result.collection.sourceName, 'ChKSz 国内榜单 · 直连模式');
  assert.equal(result.items[0].name, '歌手甲');
  assert.equal(result.items[0].chartCount, 2);
  assert.equal(result.items[0].tracks.length, 2);
});

test('uses direct ChKSz feeds when the page is opened from a local file', async () => {
  const requestedUrls = [];
  const payload = {
    data: {
      id: '3778678',
      name: '热歌榜',
      tracks: [{
        id: 101,
        name: '第一首',
        ar: [{ name: '歌手甲' }],
        al: {
          name: '专辑一',
          picUrl: 'https://p1.music.126.net/song.jpg',
        },
      }],
    },
  };
  const fetchImpl = async url => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      json: async () => payload,
    };
  };

  const result = await fetchArtistsPayload(fetchImpl, 'trending', {
    locationProtocol: 'file:',
  });

  assert.equal(result.items[0].name, '歌手甲');
  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls.every(url => url.startsWith('https://api.chksz.top/api/163_playlist')));
  assert.ok(requestedUrls.every(url => !url.includes('/api/v1/artists')));
});


test('normalizes allowlisted Bilibili video links and drops unsafe cards', () => {
  const result = normalizeVideosPayload({
    collection: { key: 'global', name: '经典影像' },
    items: [
      {
        id: 'BV123',
        name: '晴天 MV',
        artist: '国内音乐频道',
        poster: 'https://i1.hdslb.com/bfs/archive/example.jpg',
        externalUrl: 'https://www.bilibili.com/video/BV123',
        releasedAt: '2026-03-24T07:00:00Z',
        genre: '音乐视频',
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
  assert.equal(result.items[0].id, 'BV123');
  assert.equal(result.items[0].previewUrl, '');
  assert.match(result.items[0].externalUrl, /^https:\/\/www\.bilibili\.com\//);
});


test('formats valid release dates and handles missing values', () => {
  assert.match(formatReleaseDate('2026-03-24T07:00:00Z'), /2026/);
  assert.equal(formatReleaseDate('not-a-date'), '近期发布');
});
