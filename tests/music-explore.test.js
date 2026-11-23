import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createArtistsController,
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
  assert.equal(result.items[0].tracks[0].provider, 'gd');
  assert.equal(result.items[0].tracks[0].sourceId, '101');
});


test('rejects artist payloads without playable track identities', () => {
  assert.throws(
    () => normalizeArtistsPayload({
      items: [{ id: 'artist-a', name: '歌手甲', tracks: [{ name: '无 ID 歌曲' }] }],
    }),
    /没有返回可播放内容/,
  );
});

test('aggregates public chart tracks into ranked artist cards', () => {
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
  assert.equal(result.collection.sourceName, '网易云公开榜单');
  assert.equal(result.items[0].name, '歌手甲');
  assert.equal(result.items[0].chartCount, 2);
  assert.equal(result.items[0].tracks.length, 2);
});

const chartPayload = {
  collection: { name: '热歌榜' },
  tracks: [{ id: '101', sourceId: '101', provider: 'gd', name: '第一首', artist: '歌手甲',
    album: '专辑一', cover: 'https://p1.music.126.net/song.jpg', duration: 180 }],
};

test('loads public artist feeds and preserves playback identity after saving', async () => {
  const requestedUrls = [];
  const result = await fetchArtistsPayload(async url => {
    requestedUrls.push(url);
    return Response.json(chartPayload);
  }, 'trending');
  assert.equal(result.items[0].name, '歌手甲');
  assert.deepEqual(requestedUrls, [
    '/api/v1/discovery/playlist?id=3778678', '/api/v1/discovery/playlist?id=19723756',
  ]);
  const track = normalizeArtistsPayload(JSON.parse(JSON.stringify(result))).items[0].featuredTrack;
  assert.equal(track.provider, 'gd');
  assert.equal(track.sourceId, '101');
  assert.equal(track.duration, 180);
});

test('keeps available artist charts when one feed fails and reports total failure', async () => {
  const partial = await fetchArtistsPayload(async url => url.includes('3778678')
    ? Response.json({ error: { message: '榜单暂不可用' } }, { status: 502 })
    : Response.json(chartPayload));
  assert.equal(partial.items[0].chartCount, 1);
  await assert.rejects(fetchArtistsPayload(async () =>
    Response.json({ error: { message: '榜单暂不可用' } }, { status: 502 })), /榜单暂不可用/);
});

test('switching artist tabs cancels stale loads and persisted snapshots work offline', async t => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { globalThis.document = oldDocument; });
  const requests = [], saved = new Map();
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const controller = createArtistsController({ storage, fetchImpl: (url, { signal }) =>
    new Promise(resolve => requests.push({ url, signal, resolve })) });
  const first = controller.select('new');
  const second = controller.select('original');
  const third = controller.select('new');
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, true);
  requests[2].resolve(Response.json(chartPayload));
  await third;
  requests[0].resolve(Response.json({ ...chartPayload, tracks: [{ ...chartPayload.tracks[0], artist: '旧内容' }] }));
  requests[1].resolve(Response.json(chartPayload));
  await Promise.all([first, second]);
  assert.equal(controller.current(), 'new');
  const offline = createArtistsController({ storage, onlineEnabled: () => false,
    fetchImpl: () => { throw Error('Offline must not fetch'); } });
  const cached = await offline.select('new');
  assert.equal(cached.items[0].name, '歌手甲');
  assert.equal(cached.items[0].featuredTrack.provider, 'gd');
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
