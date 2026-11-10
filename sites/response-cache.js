import { boundedBytes } from './channel-http.js';
// Node adapter: only completed byte values, bounded by age, entry count and bytes.
export function createResponseCache({ now = Date.now, maxEntries = 64, maxBytes = 16 * 1024 * 1024 } = {}) {
  const values = new Map(); let total = 0;
  const remove = key => { total -= values.get(key)?.body.byteLength || 0; values.delete(key); };
  return {
    async match(request) {
      const item = values.get(request.url); if (!item) return;
      if (item.expires <= now()) { remove(request.url); return; }
      values.delete(request.url); values.set(request.url, item);
      return new Response(item.body.slice(), { status: item.status, headers: item.headers });
    },
    async put(request, response) {
      const ttl = Number(response.headers.get('cache-control')?.match(/\bmax-age=(\d+)/)?.[1]);
      if (!ttl || !response.ok || response.headers.has('set-cookie')) { await response.body?.cancel(); return; }
      let body; try { body = await boundedBytes(response, 2 * 1024 * 1024); } catch { return; }
      if (body.byteLength > maxBytes) return;
      remove(request.url);
      while (values.size && (values.size >= maxEntries || total + body.byteLength > maxBytes)) remove(values.keys().next().value);
      values.set(request.url, { body, headers: [...response.headers], status: response.status, expires: now() + ttl * 1000 }); total += body.byteLength;
    },
  };
}
