import { boundedBytes } from './channel-http.js';
import { opsError } from './operations-store.js';
const HOSTS = ['music.126.net', 'gtimg.cn', 'qpic.cn', 'kugou.com', 'kuwo.cn', 'hdslb.com', 'mzstatic.com'];
export function safeCover(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048 || !HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url;
  } catch { return null; }
}
export async function handleCover(request, env) {
  const target = safeCover(new URL(request.url).searchParams.get('url'));
  if (!target) return opsError(400, 'invalid_cover', '封面地址不受支持');
  if (!['GET', 'HEAD'].includes(request.method)) return opsError(405, 'method', '请使用 GET');
  const cache = env.OPS_CACHE || globalThis.caches?.default, key = new Request(request.url, { method: 'GET' });
  let hit;
  try { hit = await cache?.match(key); } catch { /* Cache failure must not hide a healthy image. */ }
  if (hit) return new Response(request.method === 'HEAD' ? null : hit.body, { status: hit.status, headers: hit.headers });
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    let current = target, response;
    // CDNs legitimately redirect; validate every hop with the same allowlist.
    for (let hop = 0; hop <= 2; hop++) {
      response = await (env.COVER_FETCH || fetch)(current, { redirect: 'manual', signal, headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' } });
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      const next = location && safeCover(new URL(location, current).href);
      if (!next || hop === 2) return opsError(502, 'cover_unavailable', '封面暂不可用');
      current = next;
    }
    if ([404,410].includes(response.status)) {
      await response.body?.cancel();
      const missing = new Response(null, { status:404, headers:{'cache-control':'public, max-age=300', 'x-content-type-options':'nosniff'} });
      try { await cache?.put(key, missing.clone()); } catch { /* Optional negative cache. */ }
      return missing;
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    // NetEase's image resizing CDN returns image/jpg for valid JPEGs.
    const type = ({ 'image/jpg':'image/jpeg', 'image/pjpeg':'image/jpeg', 'image/x-png':'image/png' })[mime] || mime;
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(type)) { await response.body?.cancel(); return opsError(502, 'cover_unavailable', '封面暂不可用'); }
    const bytes = await boundedBytes(response, 2 * 1024 * 1024);
    const result = new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
    try { await cache?.put(key, result.clone()); } catch { /* Optional cache. */ }
    return request.method === 'HEAD' ? new Response(null, { headers: result.headers }) : result;
  } catch { return opsError(502, 'cover_unavailable', '封面暂不可用'); }
}
