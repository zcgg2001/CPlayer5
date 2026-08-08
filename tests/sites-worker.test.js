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
  env.CHKSZ_API_KEY = 'private-key';
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
  env.CHKSZ_API_KEY = 'private-key';
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


test('proxies authenticated music requests to chksz.com without exposing the key', async () => {
  const { env, requestedPaths } = createEnv();
  const requestedUrls = [];
  env.CHKSZ_API_KEY = 'private-key';
  env.MUSIC_FETCH = async url => {
    requestedUrls.push(url);
    return Response.json({ data: { id: 101, url: 'https://media.example/song.flac' } });
  };

  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/song?id=101&level=lossless'),
    env,
  );
  const body = await response.text();
  const providerUrl = new URL(requestedUrls[0]);

  assert.equal(response.status, 200);
  assert.equal(providerUrl.origin, 'https://api.chksz.com');
  assert.equal(providerUrl.pathname, '/api/163_music');
  assert.equal(providerUrl.searchParams.get('id'), '101');
  assert.equal(providerUrl.searchParams.get('level'), 'lossless');
  assert.equal(providerUrl.searchParams.get('apikey'), 'private-key');
  assert.doesNotMatch(body, /private-key/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(requestedPaths, []);
});


test('maps every public music route to its authenticated provider endpoint', async () => {
  const { env } = createEnv();
  const requestedPaths = [];
  env.CHKSZ_API_KEY = 'private-key';
  env.MUSIC_FETCH = async url => {
    requestedPaths.push(new URL(url).pathname);
    return Response.json({ data: [] });
  };

  for (const path of [
    '/api/v1/music/search?keyword=test&limit=30',
    '/api/v1/music/playlist?id=3778678',
    '/api/v1/music/song?id=101&level=standard',
    '/api/v1/music/lyric?id=101',
  ]) {
    const response = await worker.fetch(new Request(`https://player.example${path}`), env);
    assert.equal(response.status, 200);
  }

  assert.deepEqual(requestedPaths, [
    '/api/163_search',
    '/api/163_playlist',
    '/api/163_music',
    '/api/163_lyric',
  ]);
});


test('proxies ORS search requests with the selected platform', async () => {
  const { env, requestedPaths } = createEnv();
  const requestedUrls = [];
  env.MUSIC_FETCH = async url => {
    requestedUrls.push(new URL(url));
    return Response.json([{ id: '0039MnYb0qxYhV', name: '晴天' }]);
  };

  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/search?source=ors&platform=qq&keyword=%E6%99%B4%E5%A4%A9&limit=10'),
    env,
  );
  const payload = await response.json();
  const providerUrl = requestedUrls[0];

  assert.equal(response.status, 200);
  assert.equal(providerUrl.origin, 'https://music.ors.de5.net');
  assert.equal(providerUrl.pathname, '/search');
  assert.equal(providerUrl.searchParams.get('source'), 'qq');
  assert.equal(providerUrl.searchParams.get('keyword'), '晴天');
  assert.equal(providerUrl.searchParams.get('limit'), '10');
  assert.equal(payload[0].id, '0039MnYb0qxYhV');
  assert.deepEqual(requestedPaths, []);
});


test('proxies ORS parse requests and normalizes relative audio URLs', async () => {
  const { env, requestedPaths } = createEnv();
  const requestedUrls = [];
  env.MUSIC_FETCH = async url => {
    requestedUrls.push(new URL(url));
    return Response.json({
      url: '/play/qq/0039MnYb0qxYhV.flac',
      picture: 'data:image/png;base64,AAAA',
      lrc: '[00:01.00]晴天',
      ext: 'flac',
    });
  };

  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/song?source=ors&platform=qq&id=0039MnYb0qxYhV&level=lossless&name=%E6%99%B4%E5%A4%A9&singer=%E5%91%A8%E6%9D%B0%E4%BC%A6'),
    env,
  );
  const payload = await response.json();
  const providerUrl = requestedUrls[0];

  assert.equal(response.status, 200);
  assert.equal(providerUrl.pathname, '/lx/api/');
  assert.equal(providerUrl.searchParams.get('source'), 'qq');
  assert.equal(providerUrl.searchParams.get('songmid'), '0039MnYb0qxYhV');
  assert.equal(providerUrl.searchParams.get('quality'), 'flac');
  assert.equal(providerUrl.searchParams.get('name'), '晴天');
  assert.equal(providerUrl.searchParams.get('singer'), '周杰伦');
  assert.equal(payload.url, 'https://music.ors.de5.net/play/qq/0039MnYb0qxYhV.flac');
  assert.deepEqual(requestedPaths, []);
});


test('wraps ORS plain-text lyrics in a stable response shape', async () => {
  const { env } = createEnv();
  let requestedUrl;
  env.MUSIC_FETCH = async url => {
    requestedUrl = new URL(url);
    return new Response('[00:01.00]晴天', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  };

  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/lyric?source=ors&platform=qq&url=https%3A%2F%2Fmusic.ors.de5.net%2Fplay%2Fqq%2Fsong'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { lrc: '[00:01.00]晴天' });
  assert.equal(requestedUrl.pathname, '/lyric');
  assert.equal(requestedUrl.searchParams.get('url'), 'https://music.ors.de5.net/play/qq/song');
});


test('rejects ORS playlist requests with an explicit unsupported-source error', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/playlist?source=ors&id=3778678'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'invalid_request');
  assert.match(payload.error.message, /不支持歌单/);
});


test('fails safely when the music API key is missing', async () => {
  const { env, requestedPaths } = createEnv();
  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/playlist?id=3778678'),
    env,
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'api_key_missing');
  assert.deepEqual(requestedPaths, []);
});


test('turns provider authentication payloads into a stable server error', async () => {
  const { env } = createEnv();
  env.CHKSZ_API_KEY = 'invalid-key';
  env.MUSIC_FETCH = async () => Response.json({ code: 401, message: 'Unauthorized' });

  const response = await worker.fetch(
    new Request('https://player.example/api/v1/music/song?id=101&level=standard'),
    env,
  );
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.match(body, /音乐接口鉴权失败/);
  assert.doesNotMatch(body, /invalid-key|Unauthorized/);
});


test('serves the same-origin video API without touching static assets', async () => {
  const { env, requestedPaths } = createEnv();
  env.VIDEO_FETCH = async () => Response.json({
    code: 0,
    data: {
      result: [{
        bvid: 'BV201',
        title: '现场视频',
        author: '视频歌手',
        mid: 1,
        arcurl: 'https://www.bilibili.com/video/BV201',
        pic: '//i1.hdslb.com/bfs/archive/example.jpg',
        pubdate: 1782864000,
      }],
    },
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
