import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../sites/worker.js';


function createEnv() {
  const requestedPaths = [];
  return {
    requestedPaths,
    env: {
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          requestedPaths.push(pathname);
          if (pathname === '/missing.js' || pathname === '/unknown') {
            return new Response('Not found', { status: 404 });
          }
          const body = pathname === '/index.html'
            ? '<meta property="og:image" content="__SITE_ORIGIN__/img/og.png">'
            : pathname;
          return new Response(body, { status: 200 });
        },
      },
    },
  };
}


test('maps friendly HTML routes to static files', async () => {
  const { env, requestedPaths } = createEnv();
  const response = await worker.fetch(new Request('https://player.example/playlist-downloader'), env);

  assert.equal(response.status, 200);
  assert.deepEqual(requestedPaths, ['/playlist-downloader.html']);
});


test('injects an absolute social image URL into the player shell', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(new Request('https://player.example/'), env);
  const html = await response.text();

  assert.match(html, /https:\/\/player\.example\/img\/og\.png/);
  assert.doesNotMatch(html, /__SITE_ORIGIN__/);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
});


test('serves the same-origin chart API without touching static assets', async () => {
  const { env, requestedPaths } = createEnv();
  env.MUSIC_FETCH = async () => Response.json({
    data: {
      id: 3778678,
      name: '热歌榜',
      trackCount: 1,
      creator: { nickname: '网易云音乐' },
      tracks: [{
        id: 101,
        name: '第一首',
        ar: [{ name: '歌手' }],
        al: { name: '专辑', picUrl: 'https://p1.music.126.net/cover.jpg' },
      }],
    },
  });
  const response = await worker.fetch(
    new Request('https://player.example/api/v1/charts?chart=hot'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.chart.key, 'hot');
  assert.equal(payload.items[0].name, '第一首');
  assert.deepEqual(requestedPaths, []);
});

test('serves the same-origin artist API without touching static assets', async () => {
  const { env, requestedPaths } = createEnv();
  env.MUSIC_FETCH = async () => Response.json({
    data: {
      id: 3779629,
      name: '新歌榜',
      trackCount: 1,
      creator: { nickname: '网易云音乐' },
      tracks: [{
        id: 102,
        name: '新作品',
        ar: [{ name: '新声歌手' }],
        al: { name: '新专辑', picUrl: 'https://p1.music.126.net/new.jpg' },
      }],
    },
  });
  const response = await worker.fetch(
    new Request('https://player.example/api/v1/artists?scope=new'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.collection.key, 'new');
  assert.equal(payload.items[0].name, '新声歌手');
  assert.deepEqual(requestedPaths, []);
});


test('serves the same-origin video API without touching static assets', async () => {
  const { env, requestedPaths } = createEnv();
  env.VIDEO_FETCH = async () => Response.json({
    results: [{
      kind: 'music-video',
      artistId: 1,
      trackId: 201,
      artistName: '视频歌手',
      trackName: '现场视频',
      artistViewUrl: 'https://music.apple.com/cn/artist/example/1',
      trackViewUrl: 'https://music.apple.com/cn/music-video/example/201',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/video/100x100bb.jpg',
      releaseDate: '2026-07-01T00:00:00Z',
      primaryGenreName: '流行',
    }],
  });
  const response = await worker.fetch(
    new Request('https://player.example/api/v1/videos?category=global&limit=1'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.collection.key, 'global');
  assert.equal(payload.items[0].name, '现场视频');
  assert.deepEqual(requestedPaths, []);
});


test('falls back to the player shell only for HTML navigation', async () => {
  const html = createEnv();
  const htmlResponse = await worker.fetch(new Request('https://player.example/unknown', {
    headers: { accept: 'text/html' },
  }), html.env);
  assert.equal(htmlResponse.status, 200);
  assert.deepEqual(html.requestedPaths, ['/unknown', '/index.html']);

  const asset = createEnv();
  const assetResponse = await worker.fetch(new Request('https://player.example/missing.js'), asset.env);
  assert.equal(assetResponse.status, 404);
  assert.deepEqual(asset.requestedPaths, ['/missing.js']);
});


test('rejects state-changing methods', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(new Request('https://player.example/', { method: 'POST' }), env);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});
