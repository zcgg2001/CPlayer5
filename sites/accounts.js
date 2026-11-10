import { bootstrapRequired } from './admin-bootstrap.js';
import { accountCapabilities, createAccountAuth } from './account-auth.js';
import { cleanRecords, MAX_SYNC_BYTES } from '../js/account-data.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
// D1 and the Node development adapter expose the same small SQL interface.
const sqlDB = env => env.ACCOUNT_SQL || env.ACCOUNTS_DB;
async function readCloud(env, userId) {
  const row = await sqlDB(env).prepare('SELECT revision, records, updatedAt FROM cplayer_sync WHERE userId = ?').bind(userId).first();
  return row ? { revision: row.revision, records: JSON.parse(row.records), updatedAt: row.updatedAt } : { revision: 0, records: {}, updatedAt: null };
}
async function boundedRequest(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('body_size');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('body_size'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; } return body;
}
export async function handleAccounts(original, env) {
  const url = new URL(original.url), path = url.pathname, caps = accountCapabilities(env);
  if (path === '/api/account/config' && original.method === 'GET') return json(caps);
  if (!caps.enabled) return json({ message: '账号服务尚未配置，请参阅部署文档。' }, 503);
  if (url.origin !== caps.origin) return json({ message: '请在账号服务的正式地址登录。' }, 403);
  const nativeDevice = ['/api/auth/device/code', '/api/auth/device/token'].includes(path);
  const write = !['GET', 'HEAD'].includes(original.method);
  if (write && (original.headers.get('origin') ? original.headers.get('origin') !== caps.origin : !nativeDevice && !original.headers.get('authorization')?.startsWith('Bearer '))) return json({ message: '请求来源不受信任' }, 403);
  let request = original, body;
  try {
    if (write) {
      if (!original.headers.get('content-type')?.startsWith('application/json')) return json({ message: '需要 JSON 请求' }, 415);
      const bytes = await boundedRequest(original, path === '/api/sync' ? MAX_SYNC_BYTES + 2048 : 16384);
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ message: 'JSON 格式无效' }, 400); }
      request = new Request(original.url, { method: original.method, headers: original.headers, body: bytes });
    }
    const auth = createAccountAuth(env);
    if (path.startsWith('/api/auth/')) {
      // Deletion has one explicit, confirmed entry point; disable unused account mutations.
      const allowed = /^\/api\/auth\/(get-session|sign-out|sign-up\/username|sign-in\/(username|social|email-otp)|email-otp\/send-verification-otp|phone-number\/(send-otp|verify)|callback\/(github|google|wechat)|device\/(code|token|approve|deny)|device)$/.test(path);
      if (!allowed) return json({ message: '接口未开放' }, 404);
      if (path === '/api/auth/sign-up/username') {
        if (request.method !== 'POST') return json({ message: '请使用 POST' }, 405);
        const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
        if (username === 'admin') return json({ message: '该用户名为系统管理员保留' }, 400);
        if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ message: '用户名需为 3–24 位字母、数字或下划线' }, 400);
        // Adapt the library's required email field on the server; users only supply
        // a username and password. Never accept client-supplied email/identity fields.
        const target = new URL(request.url); target.pathname = '/api/auth/sign-up/email';
        const headers = new Headers(request.headers); headers.delete('content-length');
        request = new Request(target, { method: 'POST', headers, body: JSON.stringify({ username, name: username, email: `u-${username}@password.users.invalid`, password: body.password }) });
      }
      if (path.endsWith('/send-verification-otp') && (body?.type !== 'sign-in' || !caps.email)) return json({ message: '邮箱登录尚未开通' }, 400);
      if (path.includes('/phone-number/') && !caps.phone) return json({ message: '手机登录尚未开通' }, 400);
      if (body?.updatePhoneNumber) return json({ message: '不支持在登录时修改绑定手机号' }, 400);
      if (path.startsWith('/api/auth/device')) {
        const current = await auth.api.getSession({ headers: request.headers });
        if (current && await bootstrapRequired(env, current.user.id)) return json({ message: '请先在后台修改初始管理员密码' }, 403);
      }
      const response = await auth.handler(request);
      response.headers.set('cache-control', 'no-store');
      response.headers.delete('set-auth-token');
      return response;
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ message: '请先登录' }, 401);
    const userId = session.user.id;
    if (path !== '/api/account/me' && await bootstrapRequired(env, userId)) return json({ message: '请先在后台修改初始管理员密码' }, 403);
    if (path === '/api/account/me' && request.method === 'GET') return json({ user: { id: userId, name: session.user.name, username: session.user.username || null, email: session.user.email.endsWith('.invalid') ? null : session.user.email }, fresh: Date.now() - new Date(session.session.createdAt).getTime() < 300000 });
    if (path === '/api/sync' && request.method === 'GET') return json(await readCloud(env, userId));
    if (path === '/api/sync' && request.method === 'PUT') {
      if (!Number.isSafeInteger(body?.revision) || body.revision < 0) return json({ message: '版本号无效' }, 400);
      let records;
      try { records = cleanRecords(body.records); } catch (error) { return json({ message: error.message }, 400); }
      const serialized = JSON.stringify(records), now = new Date().toISOString();
      const statement = body.revision === 0
        ? sqlDB(env).prepare('INSERT INTO cplayer_sync (userId, revision, records, updatedAt) VALUES (?, 1, ?, ?) ON CONFLICT(userId) DO NOTHING RETURNING revision').bind(userId, serialized, now)
        : sqlDB(env).prepare('UPDATE cplayer_sync SET revision = revision + 1, records = ?, updatedAt = ? WHERE userId = ? AND revision = ? RETURNING revision').bind(serialized, now, userId, body.revision);
      const row = await statement.first();
      if (!row) return json({ message: '云端已有更新', ...await readCloud(env, userId) }, 409);
      return json({ revision: row.revision });
    }
    if (path === '/api/account/export' && request.method === 'GET') return json({ format: 'cplayer5-account-v1', exportedAt: new Date().toISOString(), user: { id: userId, name: session.user.name, username: session.user.username || null, email: session.user.email, createdAt: session.user.createdAt }, cloud: await readCloud(env, userId) });
    if (path === '/api/account/sessions' && request.method === 'GET') {
      const sessions = await auth.api.listSessions({ headers: request.headers });
      return json(sessions.map(s => ({ id: s.id, current: s.id === session.session.id, createdAt: s.createdAt, updatedAt: s.updatedAt, userAgent: s.userAgent })));
    }
    if (path === '/api/account/revoke' && request.method === 'POST') {
      const sessions = await auth.api.listSessions({ headers: request.headers });
      const target = sessions.find(s => s.id === body?.id);
      if (!target) return json({ message: '会话不存在' }, 404);
      await auth.api.revokeSession({ headers: request.headers, body: { token: target.token } });
      return json({ ok: true });
    }
    if (path === '/api/account/delete' && request.method === 'POST') {
      if (body?.confirmation !== '删除我的账号') return json({ message: '请输入“删除我的账号”确认' }, 400);
      if (Date.now() - new Date(session.session.createdAt).getTime() >= 300000) return json({ message: '请退出并重新登录，在 5 分钟内完成注销。' }, 403);
      // FK cascade deletes sync data. Clear pending grants too, so they cannot outlive the user.
      await sqlDB(env).prepare('DELETE FROM deviceCode WHERE userId = ?').bind(userId).run();
      return auth.api.deleteUser({ headers: request.headers, body: {}, asResponse: true });
    }
    return json({ message: '接口不存在' }, 404);
  } catch (error) {
    if (error.message === 'body_size') return json({ message: '请求过大' }, 413);
    // Do not leak provider responses, SQL, OTPs or authorization headers into logs.
    return json({ message: '账号服务暂时不可用，请稍后重试。' }, 503);
  }
}
