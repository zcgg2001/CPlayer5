import { bootstrapRequired, replaceBootstrapPassword } from './admin-bootstrap.js';
import { accountCapabilities, createAccountAuth } from './account-auth.js';
import { SOURCE_NAMES, sqlDB, config, clock, rows, json, opsError, validateConfig, readJson, event } from './operations-store.js';

export async function handleOperations(request, env) {
  const path = new URL(request.url).pathname, db = sqlDB(env);
  if (path === '/api/runtime' && request.method === 'GET') {
    const settings = await config(env);
    const states = db ? await rows(db, 'SELECT source, openUntil FROM cplayer_source_state WHERE operation = ?', 'playback') : [];
    return json({ revision: settings.revision, sources: Object.fromEntries(Object.entries(settings.sources).map(([id, item]) => [id, { ...item, label: SOURCE_NAMES[id], coolingUntil: states.find(row => row.source === id)?.openUntil || 0 }])), modules: settings.modules, charts: settings.charts });
  }
  if (path === '/api/telemetry') {
    if (request.method !== 'POST') return opsError(405, 'method', '请使用 POST');
    const origin = new URL(request.url).origin;
    if (request.headers.get('origin') !== origin) return opsError(403, 'origin', '请求来源不受信任');
    const body = await readJson(request, 2048);
    const kinds = ['playback_started', 'playback_failed', 'source_switched', 'client_error', 'unhandled_rejection'];
    if (!kinds.includes(body?.kind) || (body.source && !Object.hasOwn(SOURCE_NAMES, body.source))) return opsError(400, 'invalid_event', '事件无效');
    // Client events never change circuit health: public input cannot remove sources.
    await event(env, 'client', body.source || 'site', body.kind);
    return json({ ok: true }, 202);
  }
  if (!path.startsWith('/api/admin/')) return null;
  const caps = accountCapabilities(env);
  if (!caps.enabled || !db) return opsError(503, 'admin_unconfigured', '管理服务尚未配置');
  if (new URL(request.url).origin !== caps.origin || (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== caps.origin)) return opsError(403, 'origin', '请求来源不受信任');
  const session = await createAccountAuth(env).api.getSession({ headers: request.headers });
  if (!session) return opsError(401, 'login_required', '请使用下方表单登录管理员账号');
  const admins = String(env.OPS_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (!admins.includes(session.user.id)) return opsError(403, 'admin_required', '当前账号没有管理权限');
  if (path === '/api/admin/password') return replaceBootstrapPassword(request, env, session);
  if (await bootstrapRequired(env, session.user.id)) return opsError(403, 'password_change_required', '请先修改初始密码，再使用管理功能');
  if (path === '/api/admin/dashboard' && request.method === 'GET') {
    const now = clock(env), cutoff = Math.floor(now / 3600000) - 23;
    const metrics = await rows(db, 'SELECT source, operation, SUM(requests) requests, SUM(failures) failures, SUM(latency) latency, MAX(maxLatency) maxLatency FROM cplayer_source_metrics WHERE bucket >= ? GROUP BY source, operation', cutoff);
    return json({ at: now, window: '24 hourly buckets', settings: await config(env), metrics: metrics.map(item => ({ ...item, availability: item.requests ? (item.requests - item.failures) / item.requests : null, failureRate: item.requests ? item.failures / item.requests : null, avgLatency: item.requests ? Math.round(item.latency / item.requests) : null })), states: await rows(db, 'SELECT * FROM cplayer_source_state WHERE updatedAt >= ?', 0), events: await rows(db, 'SELECT kind, source, code, count, createdAt FROM cplayer_events WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 100', now - 86400000), audit: await rows(db, 'SELECT revision, createdAt FROM cplayer_ops_audit WHERE createdAt >= ? ORDER BY revision DESC LIMIT 20', now - 90 * 86400000), alertConfigured: Boolean(env.OPS_ALERT_WEBHOOK) });
  }
  if (path === '/api/admin/config' && request.method === 'PUT') {
    const body = await readJson(request), settings = validateConfig(body), serialized = JSON.stringify(settings), now = clock(env), revision = body.revision + 1;
    const change = body.revision === 0
      ? db.prepare('INSERT INTO cplayer_ops_config (id, revision, body, updatedAt) VALUES (1, 1, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING revision').bind(serialized, now)
      : db.prepare('UPDATE cplayer_ops_config SET revision = revision + 1, body = ?, updatedAt = ? WHERE id = 1 AND revision = ? RETURNING revision').bind(serialized, now, body.revision);
    // SQL batch is atomic in D1 and in our Node adapter. Audit only the winning CAS.
    const audit = db.prepare('INSERT INTO cplayer_ops_audit (revision, actor, createdAt, body) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM cplayer_ops_config WHERE revision = ? AND body = ? AND updatedAt = ?) ON CONFLICT(revision) DO NOTHING').bind(revision, session.user.id, now, serialized, revision, serialized, now);
    const [result] = await db.batch([change, audit]);
    if (!result.results?.length) return opsError(409, 'config_conflict', '配置已被其他管理员更新，请刷新后重试');
    return json({ revision });
  }
  return opsError(404, 'not_found', '管理接口不存在');
}
