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
  if (!response.ok || request.method === 'HEAD') return response;

  const origin = new URL(request.url).origin;
  const html = (await response.text()).replaceAll('__SITE_ORIGIN__', origin);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
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
