// Public chart metadata only. Never cache audio URLs, account data or playback requests here.
export function createChartCache({ fetchValue, storage, now = Date.now, ttl = 300000, limit = 24, key = 'zp_chart_cache_v1', validate = () => true, pinnedKeys = [] } = {}) {
  const memory = new Map(), pending = new Map(), lifetime = new AbortController();
  try {
    for (const [id, entry] of JSON.parse(storage?.getItem(key) || '[]').slice(-limit)) {
      if (typeof id === 'string' && Number.isFinite(entry?.at) && entry.value && typeof entry.value === 'object' && validate(id,entry.value)) memory.set(id, entry);
    }
  } catch { /* A corrupt snapshot should behave like a cold start. */ }
  function peek(id) { return memory.get(id)?.value || null; }
  function fresh(id) { const at = memory.get(id)?.at; return Number.isFinite(at) && at <= now() && now() - at < ttl; }
  function get(id, { force = false } = {}) {
    if (!force && fresh(id)) return Promise.resolve(peek(id));
    if (pending.has(id)) return pending.get(id);
    const request = Promise.resolve().then(() => fetchValue(id, lifetime.signal)).then(value => {
      lifetime.signal.throwIfAborted();
      if (!value || !validate(id,value)) throw new Error('返回的音乐资料无效');
      memory.delete(id); memory.set(id, { at: now(), value });
      while (memory.size > limit) memory.delete([...memory.keys()].find(key => !pinnedKeys.includes(key)) ?? memory.keys().next().value);
      try { storage?.setItem(key, JSON.stringify([...memory])); } catch { /* In-memory caching remains available. */ }
      return value;
    }).finally(() => pending.delete(id));
    pending.set(id, request); return request;
  }
  return { peek, fresh, get, destroy() { lifetime.abort(); pending.clear(); } };
}
