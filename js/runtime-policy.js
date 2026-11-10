let cached, expires = 0, pending;
export async function runtimePolicy({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (expires > now()) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetchImpl('/api/runtime', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('unavailable');
      cached = await response.json(); expires = now() + 30000; return cached;
    } catch { expires = now() + 5000; return cached || null; }
    finally { pending = null; }
  })();
  return pending;
}
export function coverUrl(value, origin = globalThis.location?.origin) {
  if (!value || !origin) return value;
  try {
    const url = new URL(value, origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['music.126.net', 'gtimg.cn', 'qpic.cn', 'kugou.com', 'kuwo.cn', 'hdslb.com', 'mzstatic.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return value;
    return `/api/cover?${new URLSearchParams({ url: url.href })}`;
  } catch { return value; }
}
let sent = 0, windowStart = 0;
export function reportEvent(kind, source = '') {
  if (!globalThis.location?.origin || !globalThis.navigator?.onLine) return;
  try { if (globalThis.localStorage?.getItem('cp_diagnostics') === 'off') return; } catch {}
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); sent = 0; }
  if (sent >= 10) return; sent++;
  // No URLs, stacks, song names, search terms or identifiers leave this module.
  void fetch('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...(source ? { source } : {}) }), keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
}
export function initDiagnostics(target = globalThis) {
  target.addEventListener?.('error', () => reportEvent('client_error'));
  target.addEventListener?.('unhandledrejection', () => reportEvent('unhandled_rejection'));
}
