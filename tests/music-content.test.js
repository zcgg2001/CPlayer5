import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHART_DEFINITIONS,
  chartProviderUrl,
  handleChartsRequest,
  normalizeChkszChartPayload,
  resolveChartKey,
  resolveChartLimit,
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


test('resolves supported chart keys and clamps limits', () => {
  assert.equal(resolveChartKey('soaring'), 'soaring');
  assert.equal(resolveChartKey('unknown'), 'hot');
  assert.equal(resolveChartLimit('0'), 1);
  assert.equal(resolveChartLimit('500'), 100);
  assert.equal(resolveChartLimit('invalid'), 50);
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
