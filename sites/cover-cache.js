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
  const hit = await cache?.match(key); if (hit) return new Response(request.method === 'HEAD' ? null : hit.body, { headers: hit.headers });
  try {
    const response = await (env.COVER_FETCH || fetch)(target, { redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]), headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' } });
    const type = response.headers.get('content-type')?.split(';')[0].toLowerCase();
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(type)) { await response.body?.cancel(); return opsError(502, 'cover_unavailable', '封面暂不可用'); }
    const bytes = await boundedBytes(response, 2 * 1024 * 1024);
    const result = new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
    try { await cache?.put(key, result.clone()); } catch { /* Optional cache. */ }
    return request.method === 'HEAD' ? new Response(null, { headers: result.headers }) : result;
  } catch { return opsError(502, 'cover_unavailable', '封面暂不可用'); }
}
