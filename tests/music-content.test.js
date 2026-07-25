import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTIST_SCOPES,
  CHART_DEFINITIONS,
  VIDEO_CATEGORIES,
  appleVideoProviderUrl,
  chartProviderUrl,
  handleArtistsRequest,
  handleChartsRequest,
  handleVideosRequest,
  normalizeAppleVideoPayload,
  normalizeArtistsFromCharts,
  normalizeChkszChartPayload,
  resolveArtistScope,
  resolveChartKey,
  resolveChartLimit,
  resolveVideoCategory,
} from '../sites/music-content.js';


function providerPayload() {
  return {
    data: {
      id: 3778678,
      name: '热歌榜',
      coverImgUrl: 'https://p1.music.126.net/chart.jpg',
      trackCount: 2,
      creator: { nickname: '网易云音乐' },
      tracks: [
        {
          id: 101,
          name: '第一首',
          ar: [{ name: '歌手甲' }, { name: '歌手乙' }],
          al: { name: '专辑一', picUrl: 'https://p1.music.126.net/one.jpg' },
        },
        {
          id: 102,
          name: '第二首',
          artists: [{ name: '歌手丙' }],
          album: { name: '专辑二', picUrl: 'https://p1.music.126.net/two.jpg' },
        },
      ],
    },
  };
}

function appleVideoPayload() {
  return {
    resultCount: 1,
    results: [{
      wrapperType: 'track',
      kind: 'music-video',
      artistId: 300117743,
      trackId: 1887481475,
      artistName: '周杰伦',
      trackName: '太阳之子',
      artistViewUrl: 'https://music.apple.com/cn/artist/example/300117743?uo=4',
      trackViewUrl: 'https://music.apple.com/cn/music-video/example/1887481475?uo=4',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Video211/example/100x100bb.jpg',
      releaseDate: '2026-03-24T07:00:00Z',
      trackExplicitness: 'notExplicit',
      primaryGenreName: '国语流行',
    }],
  };
}


test('resolves supported chart keys and clamps limits', () => {
  assert.equal(resolveChartKey('soaring'), 'soaring');
  assert.equal(resolveChartKey('unknown'), 'hot');
  assert.equal(resolveChartLimit('0'), 1);
  assert.equal(resolveChartLimit('500'), 100);
  assert.equal(resolveChartLimit('invalid'), 50);
});


test('resolves allowlisted artist scopes and video categories', () => {
  assert.equal(resolveArtistScope('original'), 'original');
  assert.equal(resolveArtistScope('unknown'), 'trending');
  assert.equal(resolveVideoCategory('live'), 'live');
  assert.equal(resolveVideoCategory('unknown'), 'trending');
  assert.deepEqual(ARTIST_SCOPES.trending.chartKeys, ['hot', 'soaring']);
  assert.equal(VIDEO_CATEGORIES.global.name, '全球流行');
});


test('normalizes provider playlists into the chart contract', () => {
  const result = normalizeChkszChartPayload(providerPayload(), {
    chartKey: 'hot',
    limit: 1,
    fetchedAt: '2026-07-25T00:00:00.000Z',
  });

  assert.equal(result.version, 1);
  assert.equal(result.chart.key, 'hot');
  assert.equal(result.chart.name, '热歌榜');
  assert.equal(result.chart.sourceName, '网易云音乐');
  assert.equal(result.chart.fetchedAt, '2026-07-25T00:00:00.000Z');
  assert.deepEqual(result.items, [{
    rank: 1,
    id: '101',
    playbackId: '101',
    name: '第一首',
    artist: '歌手甲/歌手乙',
    album: '专辑一',
    cover: 'https://p1.music.126.net/one.jpg',
    source: 'ChKSz',
    playable: true,
  }]);
});


test('builds provider URLs from allowlisted chart definitions', () => {
  assert.equal(
    chartProviderUrl('original'),
    `https://api.chksz.top/api/163_playlist?id=${CHART_DEFINITIONS.original.id}`,
  );
  assert.equal(
    chartProviderUrl('not-allowed'),
    `https://api.chksz.top/api/163_playlist?id=${CHART_DEFINITIONS.hot.id}`,
  );
});


test('aggregates chart tracks into ranked artists with playable selections', () => {
  const hot = normalizeChkszChartPayload(providerPayload(), {
    chartKey: 'hot',
    fetchedAt: '2026-07-25T00:00:00.000Z',
  });
  const result = normalizeArtistsFromCharts([hot], {
    scope: 'all',
    fetchedAt: '2026-07-25T01:00:00.000Z',
  });

  assert.equal(result.collection.key, 'all');
  assert.equal(result.collection.fetchedAt, '2026-07-25T01:00:00.000Z');
  assert.equal(result.items[0].name, '歌手甲');
  assert.equal(result.items[0].featuredTrack.playbackId, '101');
  assert.equal(result.items[0].tracks[0].playable, true);
  assert.equal(result.items.length, 3);
});


test('normalizes Apple music videos and upgrades artwork size', () => {
  const videos = normalizeAppleVideoPayload(appleVideoPayload(), { category: 'mandopop' });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].id, '1887481475');
  assert.equal(videos[0].artist, '周杰伦');
  assert.equal(videos[0].category, 'mandopop');
  assert.match(videos[0].poster, /900x506bb\.jpg$/);
  assert.equal(videos[0].externalUrl, 'https://music.apple.com/cn/music-video/example/1887481475?uo=4');
  assert.equal(videos[0].previewUrl, '');
  assert.match(appleVideoProviderUrl('周杰伦', 6), /entity=musicVideo/);
});


test('serves normalized charts with cache and security headers', async () => {
  let requestedUrl = '';
  const response = await handleChartsRequest(
    new Request('https://player.example/api/v1/charts?chart=new&limit=1'),
    {
      async MUSIC_FETCH(url) {
        requestedUrl = url;
        return Response.json(providerPayload());
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /stale-while-revalidate/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(requestedUrl, chartProviderUrl('new'));
  assert.equal(payload.chart.key, 'new');
  assert.equal(payload.items.length, 1);
});


test('returns a stable user-facing error when the provider fails', async () => {
  const response = await handleChartsRequest(
    new Request('https://player.example/api/v1/charts'),
    {
      async MUSIC_FETCH() {
        return new Response('Unavailable', { status: 503 });
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, 'provider_failed');
  assert.equal(payload.error.message, '排行榜暂时无法更新，请稍后重试');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});


test('serves artists aggregated from the selected chart scope', async () => {
  const requestedUrls = [];
  const response = await handleArtistsRequest(
    new Request('https://player.example/api/v1/artists?scope=new&limit=2'),
    {
      async MUSIC_FETCH(url) {
        requestedUrls.push(url);
        return Response.json(providerPayload());
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(requestedUrls, [chartProviderUrl('new')]);
  assert.equal(payload.collection.key, 'new');
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].tracks[0].playbackId, '101');
});


test('serves video cards from the Apple music video directory', async () => {
  const requestedUrls = [];
  const response = await handleVideosRequest(
    new Request('https://player.example/api/v1/videos?category=global&limit=3'),
    {
      async VIDEO_FETCH(url) {
        requestedUrls.push(url);
        return Response.json(appleVideoPayload());
      },
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(requestedUrls.length, VIDEO_CATEGORIES.global.terms.length);
  assert.ok(requestedUrls.every(url => url.startsWith('https://itunes.apple.com/search?')));
  assert.equal(payload.collection.key, 'global');
  assert.equal(payload.collection.sourceName, 'Apple Music');
  assert.equal(payload.items[0].name, '太阳之子');
});
