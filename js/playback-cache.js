// Short-lived, memory-only resolutions. Concurrent consumers own independent
// cancellation leases; the upstream request stops when its last consumer leaves.
export function createPlaybackCache({ now = Date.now, ttlMs = 120000, limit = 64 } = {}) {
  const entries = new Map(), pending = new Map();
  function deadline(data) {
    const supplied = data.expiresAt;
    let expiry = typeof supplied === 'string' && !/^\d+(\.\d+)?$/.test(supplied)
      ? Date.parse(supplied) : Number(supplied);
    if (expiry > 0 && expiry < 1e12) expiry *= 1000;
    return Math.min(now() + ttlMs, expiry > 0 ? expiry - 5000 : Infinity);
  }
  function invalidate(data) {
    for (const [key, entry] of entries) {
      if (entry.data.provider === data?.provider && entry.data.url === data?.url) entries.delete(key);
    }
  }
  function get(key, resolve, signal) {
    signal?.throwIfAborted();
    const entry = entries.get(key);
    if (entry?.until > now()) {
      entries.delete(key); entries.set(key, entry);
      return Promise.resolve({ data: { ...entry.data }, hit: true });
    }
    entries.delete(key);
    let job = pending.get(key);
    if (!job) {
      job = { controller: new AbortController(), users: new Set() };
      pending.set(key, job);
      job.promise = Promise.resolve().then(() => {
        job.controller.signal.throwIfAborted();
        return resolve(job.controller.signal);
      }).then(data => {
        if (data?.url && !job.controller.signal.aborted) {
          const until = deadline(data);
          if (until > now()) entries.set(key, { data: { ...data }, until });
          while (entries.size > limit) entries.delete(entries.keys().next().value);
        }
        return data;
      }).finally(() => { if (pending.get(key) === job) pending.delete(key); });
    }
    return new Promise((accept, reject) => {
      const consumer = {};
      job.users.add(consumer);
      const release = () => {
        signal?.removeEventListener('abort', aborted);
        job.users.delete(consumer);
        if (!job.users.size && pending.get(key) === job) {
          pending.delete(key); job.controller.abort();
        }
      };
      const aborted = () => { release(); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
      signal?.addEventListener('abort', aborted, { once: true });
      job.promise.then(data => { release(); accept({ data: data ? { ...data } : data, hit: false }); }, error => { release(); reject(error); });
    });
  }
  return { get, invalidate };
}
