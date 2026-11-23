export const UPDATE_SOURCES = Object.freeze([
  { id: 'auto', label: '自动选择（镜像优先）', prefix: '' },
  { id: 'mirror1', label: '镜像 1 · gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { id: 'mirror2', label: '镜像 2 · gh-proxy.org', prefix: 'https://gh-proxy.org/' },
  { id: 'direct', label: 'GitHub 直连', prefix: '' },
]);
export const updateSource = id => UPDATE_SOURCES.find(item => item.id === id) || UPDATE_SOURCES[0];
export function updateDownloadUrl(url, source) {
  if (!/^https:\/\/github\.com\/zcgg2001\/CPlayer5\/releases\/download\/[^/?#]+\/(?:ZPlayer|CPlayer5)-android-preview-[1-9]\d*\.apk$/.test(url)) return '';
  const selected = updateSource(source);
  return (selected.id === 'auto' ? UPDATE_SOURCES[1] : selected).prefix + url;
}

// This bridge is only exposed to the bundled Android page. No generic URL or filesystem RPC.
export function createUpdateTransport(bridge = globalThis.ZPlayerUpdates) {
  if (!bridge?.postMessage) return null;
  let sequence = 0;
  const pending = new Map();
  bridge.onmessage = event => {
    let packet; try { packet = JSON.parse(event.data); } catch { return; }
    const request = pending.get(packet.id); if (!request) return;
    if (packet.status === 'progress') { request.progress(packet); return; }
    pending.delete(packet.id); request.cleanup();
    if (packet.status === 'error') request.reject(new Error(packet.error || '更新失败，请重试'));
    else request.resolve(packet);
  };
  function request(op, data = {}, { signal, progress = () => {} } = {}) {
    signal?.throwIfAborted();
    const id = `update_${++sequence}`;
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => {
        pending.delete(id); cleanup(); bridge.postMessage(JSON.stringify({ id, op: 'cancel' }));
        reject(signal.reason || new DOMException('已取消', 'AbortError'));
      };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      pending.set(id, { resolve, reject, progress, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        pending.delete(id); cleanup(); bridge.postMessage(JSON.stringify({ id, op: 'cancel' }));
        reject(new Error('更新请求超时，请重试'));
      }, op === 'download' ? 600000 : 40000);
      try { bridge.postMessage(JSON.stringify({ id, op, ...data })); }
      catch (error) { pending.delete(id); cleanup(); reject(error); }
    });
  }
  return {
    async fetch(url, { signal } = {}, source = 'auto') {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://api.github.com' || parsed.pathname !== '/repos/zcgg2001/CPlayer5/releases') throw new Error('不支持的更新地址');
      const result = await request('feed', { page: Number(parsed.searchParams.get('page') || 1), source }, { signal });
      return new Response(result.body, { status: result.httpStatus, headers: result.headers });
    },
    download: (release, source, options) => request('download', { url: release.download, code: release.code, size: release.size, sha256: release.sha256, source }, options),
    install: () => request('install'),
  };
}
