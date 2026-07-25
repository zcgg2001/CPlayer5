import {
  handleArtistsRequest,
  handleChartsRequest,
  handleVideosRequest,
} from './music-content.js';

const HTML_ROUTES = new Map([
  ['/', '/index.html'],
  ['/playlist-downloader', '/playlist-downloader.html'],
  ['/offline', '/offline.html'],
]);

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function withAbsoluteSiteMetadata(response, request) {
  if (!response.ok) return response;

  const origin = new URL(request.url).origin;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0, must-revalidate');
  headers.set('cdn-cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  const html = request.method === 'HEAD'
    ? null
    : (await response.text()).replaceAll('__SITE_ORIGIN__', origin);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/v1/charts') {
      return handleChartsRequest(request, env);
    }
    if (url.pathname === '/api/v1/artists') {
      return handleArtistsRequest(request, env);
    }
    if (url.pathname === '/api/v1/videos') {
      return handleVideosRequest(request, env);
    }

    const routeAsset = HTML_ROUTES.get(url.pathname.replace(/\/$/, '') || '/');
    if (routeAsset) {
      const response = await env.ASSETS.fetch(assetRequest(request, routeAsset));
      return routeAsset === '/index.html'
        ? withAbsoluteSiteMetadata(response, request)
        : response;
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const acceptsHtml = /(?:^|,)\s*text\/html\b/i.test(request.headers.get('accept') || '');
    if (acceptsHtml) {
      const fallback = await env.ASSETS.fetch(assetRequest(request, '/index.html'));
      return withAbsoluteSiteMetadata(fallback, request);
    }

    return response;
  },
};

export default worker;
