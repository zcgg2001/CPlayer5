import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { sqlDB, json, opsError, readJson } from './operations-store.js';

export async function bootstrapRequired(env, userId) {
  const row = await sqlDB(env).prepare('SELECT mustChange FROM cplayer_admin_bootstrap WHERE userId = ?').bind(userId).first();
  return row?.mustChange === 1;
}
export async function replaceBootstrapPassword(request, env, session) {
  if (request.method !== 'POST') return opsError(405, 'method', '请使用 POST');
  if (Date.now() - new Date(session.session.createdAt).getTime() >= 300000) return opsError(403, 'fresh_login_required', '请重新登录后修改初始密码');
  const input = await readJson(request, 2048);
  if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 128 || typeof input.newPassword !== 'string' || input.newPassword.length < 12 || input.newPassword.length > 128 || input.newPassword !== input.confirmPassword || /^(admin|password|123456)+$/i.test(input.newPassword)) return opsError(400, 'invalid_password', '新密码需为 12–128 位，且两次输入一致，请勿使用默认密码');
  const db = sqlDB(env), userId = session.user.id;
  if (!await bootstrapRequired(env, userId)) return opsError(409, 'already_initialized', '初始密码已经修改，请重新登录');
  const account = await db.prepare("SELECT id, password FROM account WHERE userId = ? AND providerId = 'credential'").bind(userId).first();
  if (!account?.password || !await verifyPassword({ hash: account.password, password: input.currentPassword })) return opsError(401, 'wrong_password', '当前密码不正确');
  const hash = await hashPassword(input.newPassword), now = Date.now();
  const results = await db.batch([
    db.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE id = ? AND password = ? AND EXISTS (SELECT 1 FROM cplayer_admin_bootstrap WHERE userId = ? AND mustChange = 1) RETURNING userId').bind(hash, now, account.id, account.password, userId),
    db.prepare('UPDATE cplayer_admin_bootstrap SET mustChange = 0, changedAt = ? WHERE userId = ? AND EXISTS (SELECT 1 FROM account WHERE id = ? AND password = ?)').bind(now, userId, account.id, hash),
    db.prepare('DELETE FROM session WHERE userId = ? AND EXISTS (SELECT 1 FROM account WHERE id = ? AND password = ?)').bind(userId, account.id, hash),
    db.prepare('DELETE FROM deviceCode WHERE userId = ? AND EXISTS (SELECT 1 FROM account WHERE id = ? AND password = ?)').bind(userId, account.id, hash),
  ]);
  if (!results[0].results?.length) return opsError(409, 'password_conflict', '密码已被更新，请重新登录');
  return json({ ok: true, signInRequired: true });
}
