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
