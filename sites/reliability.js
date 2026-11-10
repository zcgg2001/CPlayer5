import { SOURCE_NAMES, sqlDB, config, clock, event, opsError, cleanup } from './operations-store.js';

const localLimits = new WeakMap();
export function routeSource(url) {
  if (url.pathname.startsWith('/api/v1/bilibili/')) return 'bilibili';
  if (!/^\/api\/v1\/music\/(search|song|playlist|lyric|audio|download|discover)$/.test(url.pathname)) return null;
  const source = (url.searchParams.get('source') || '').trim().toLowerCase() || 'chksz';
  return Object.hasOwn(SOURCE_NAMES, source) ? source : null;
}
const operationFor = url => /\/(song|audio|download)$/.test(url.pathname) ? 'playback' : /\/search$/.test(url.pathname) ? 'search' : 'metadata';
export async function rateLimit(request, env) {
  const url = new URL(request.url);
  const group = url.pathname === '/api/telemetry' ? 'telemetry' : url.pathname.startsWith('/api/admin/') ? 'admin'
    : url.pathname === '/api/cover' ? 'cover' : /\/(song|audio|download)$/.test(url.pathname) ? 'playback' : 'api';
  const cap = { telemetry: 30, admin: 30, cover: 240, playback: 90, api: 180 }[group];
  const now = clock(env), minute = Math.floor(now / 60000), seconds = 60 - Math.floor(now % 60000 / 1000);
  const identity = request.headers.get('cf-connecting-ip') || 'unknown';
  const bytes = new TextEncoder().encode(`${env.AUTH_SECRET || 'local'}:${minute}:${identity}`);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (env.API_RATE_LIMIT && !(await env.API_RATE_LIMIT.limit({ key: digest })).success) return opsError(429, 'site_rate_limited', '请求过于频繁，请稍后重试', { 'retry-after': String(seconds) });
  const key = `${minute}:${group}:${digest}`, db = sqlDB(env); let hits;
  if (db) {
    const row = await db.prepare('INSERT INTO cplayer_api_limits (key, hits, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 RETURNING hits').bind(key, (minute + 2) * 60000).first();
    hits = row.hits;
  } else {
    // Standalone, account-free Node deployments only. Production uses shared SQL.
    if (!localLimits.has(env)) localLimits.set(env, new Map());
    const map = localLimits.get(env);
    for (const [k, value] of map) if (value.expires < now) map.delete(k);
    if (map.size >= 5000 && !map.has(key)) return opsError(429, 'site_rate_limited', '请求过于频繁，请稍后重试', { 'retry-after': String(seconds) });
    hits = (map.get(key)?.hits || 0) + 1; map.set(key, { hits, expires: (minute + 2) * 60000 });
  }
  return hits > cap ? opsError(429, 'site_rate_limited', '请求过于频繁，请稍后重试', { 'retry-after': String(seconds) }) : null;
}
export async function sourceGate(env, source, operation, settings) {
  if (!settings.sources[source]?.enabled) return { response: opsError(503, 'source_disabled', '该音源已暂停，正在尝试其他音源') };
  const db = sqlDB(env); if (!db) return {};
  await db.prepare('INSERT INTO cplayer_source_state (source, operation) VALUES (?, ?) ON CONFLICT(source, operation) DO NOTHING').bind(source, operation).run();
  const row = await db.prepare('SELECT * FROM cplayer_source_state WHERE source = ? AND operation = ?').bind(source, operation).first();
  const now = clock(env);
  if (row.openUntil) {
    if (row.openUntil <= now) {
      // One shared half-open lease prevents all browsers probing a broken source.
      const probe = await db.prepare('UPDATE cplayer_source_state SET probeUntil = ? WHERE source = ? AND operation = ? AND openUntil <= ? AND probeUntil <= ? RETURNING source').bind(now + 90000, source, operation, now, now).first();
      if (probe) return { probe: true };
    }
    return { response: opsError(503, 'source_cooling', '音源暂时不可用，正在尝试其他音源', { 'retry-after': String(Math.max(1, Math.ceil((Math.max(row.openUntil, row.probeUntil) - now) / 1000))) }) };
  }
  return {};
}
async function alert(env, source, operation) {
  console.warn(JSON.stringify({ event: 'source_circuit_open', source, operation }));
  await event(env, 'alert', source, `${operation}_circuit_open`);
  if (!env.OPS_ALERT_WEBHOOK) return;
  try {
    const target = new URL(env.OPS_ALERT_WEBHOOK);
    if (target.protocol !== 'https:' || target.username || target.password) return;
    const response = await (env.OPS_ALERT_FETCH || fetch)(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'source_circuit_open', source, operation, at: new Date(clock(env)).toISOString() }) });
    await response.body?.cancel();
    if (!response.ok) await event(env, 'alert', source, 'delivery_failed');
  } catch { await event(env, 'alert', source, 'delivery_failed'); }
}
export async function recordSource(env, source, operation, response, elapsed, { probe = false } = {}, aborted = false) {
  const db = sqlDB(env); if (!db || aborted) return;
  // Invalid input, unavailable recordings and permissions are not source outages.
  let failed = response.status >= 500 || response.status === 429 || (source === 'chksz' && [401,402,403].includes(response.status));
  if (operation === 'playback' && response.status === 502 && response.headers.get('content-type')?.includes('application/json')) {
    try { const body = await response.clone().json(); if (/音质|此歌曲|未返回.*播放|未提供.*音频|没有.*音频/.test(body.error?.message || '')) failed = false; } catch {}
  }
  if (!response.ok && !failed) {
    if (probe) await db.prepare('UPDATE cplayer_source_state SET probeUntil = 0 WHERE source = ? AND operation = ?').bind(source, operation).run();
    return;
  }
  const now = clock(env), duration = Math.max(0, Math.min(120000, Math.round(elapsed)));
  await db.prepare('INSERT INTO cplayer_source_metrics (source, operation, bucket, requests, failures, latency, maxLatency) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT(source, operation, bucket) DO UPDATE SET requests = requests + 1, failures = failures + excluded.failures, latency = latency + excluded.latency, maxLatency = MAX(maxLatency, excluded.maxLatency)').bind(source, operation, Math.floor(now / 3600000), Number(failed), duration, duration).run();
  if (!failed) {
    // A late successful request from before the outage cannot close a new circuit.
    await db.prepare(`UPDATE cplayer_source_state SET failures = 0, openUntil = 0, probeUntil = 0, updatedAt = ? WHERE source = ? AND operation = ? AND ${probe ? 'probeUntil > 0' : 'openUntil = 0'}`).bind(now, source, operation).run();
    return;
  }
  const row = await db.prepare('UPDATE cplayer_source_state SET failures = MIN(failures + 1, 20), updatedAt = ? WHERE source = ? AND operation = ? RETURNING failures').bind(now, source, operation).first();
  if (row?.failures >= 3) {
    const cooldown = Math.min(900000, 120000 * 2 ** Math.min(3, row.failures - 3));
    const changed = await db.prepare('UPDATE cplayer_source_state SET openUntil = ?, probeUntil = 0 WHERE source = ? AND operation = ? AND (openUntil = 0 OR (openUntil <= ? AND probeUntil > 0)) RETURNING source').bind(now + cooldown, source, operation, now).first();
    if (changed) await alert(env, source, operation);
  }
}
const TTL = { search: 30, playlist: 300, lyric: 3600, metadata: 600, charts: 300, artists: 600, videos: 120, artist: 600, album: 600, playlists: 300 };
async function cacheKey(request, revision, credential) {
  const url = new URL(request.url); url.searchParams.sort(); url.searchParams.set('_ops_revision', String(revision));
  if (credential !== undefined) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
    url.searchParams.set('_credential_generation', [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''));
  }
  return new Request(url, { method: 'GET' });
}
export async function reliableRequest(request, env, handler) {
  const url = new URL(request.url), settings = await config(env), source = routeSource(url), operation = operationFor(url);
  if (source && !settings.sources[source]?.enabled) return opsError(503, 'source_disabled', '该音源已暂停，正在尝试其他音源');
  const action = url.pathname.split('/').at(-1);
  const ttl = /^(\/api\/v1\/(music|discovery)\/|\/api\/v1\/(charts|artists|videos)$)/.test(url.pathname) ? TTL[action] : 0;
  const cache = env.OPS_CACHE || globalThis.caches?.default;
  const key = ttl && request.method === 'GET' && !request.headers.has('range') ? await cacheKey(request, settings.revision, source === 'chksz' ? String(env.CHKSZ_API_KEY || '') : undefined) : null;
  if (key && cache) {
    const hit = await cache.match(key);
    if (hit) { const headers = new Headers(hit.headers); headers.set('x-cplayer-cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers }); }
  }
  const gate = source ? await sourceGate(env, source, operation, settings) : {};
  if (gate.response) return gate.response;
  const started = clock(env);
  let response;
  try { response = await handler(request, env, settings); }
  catch (error) {
    if (request.signal.aborted) throw error;
    await event(env, 'server', source || 'site', 'unexpected_error');
    response = opsError(502, 'provider_unavailable', '服务暂时不可用，请稍后重试');
  }
  if (source) await recordSource(env, source, operation, response, clock(env) - started, gate, request.signal.aborted);
  if (key && cache && response.ok && !response.headers.has('set-cookie') && response.headers.get('content-type')?.includes('application/json')) {
    // Only public metadata routes enter this cache. No session, signed audio URL,
    // auth, private library, sync or Range response can be stored here.
    const headers = new Headers(response.headers); headers.set('cache-control', `public, max-age=${ttl}`); headers.delete('cdn-cache-control');
    headers.set('x-cplayer-cache', 'MISS');
    response = new Response(response.body, { status: response.status, headers });
    try { await cache.put(key, response.clone()); } catch { /* A cache failure cannot break playback. */ }
  }
  return response;
}
export async function maintainOperations(env) { await cleanup(env); }
