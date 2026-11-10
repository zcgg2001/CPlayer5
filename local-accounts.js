import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export function sqliteSQL(db) {
  return { prepare(sql) { return { bind(...args) { return { async first() { return db.prepare(sql).get(...args) || null; }, async run() { return db.prepare(sql).run(...args); } }; } }; } };
}
export function applyLocalAccountMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS cplayer_migrations (name TEXT PRIMARY KEY)');
  const folder = new URL('./migrations/', import.meta.url);
  for (const name of readdirSync(folder).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    if (db.prepare('SELECT name FROM cplayer_migrations WHERE name = ?').get(name)) continue;
    db.exec('BEGIN');
    try { db.exec(readFileSync(new URL(name, folder), 'utf8')); db.prepare('INSERT INTO cplayer_migrations (name) VALUES (?)').run(name); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
export function localAccountsEnv(config = process.env) {
  const dev = config.ACCOUNTS_DEV === '1';
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(config.HOST || '127.0.0.1');
  if (!dev && !config.AUTH_URL && !localHost) return {};
  const origin = new URL(config.AUTH_URL || `http://127.0.0.1:${config.PORT || 8787}`);
  const local = localHost && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (dev && (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || !['127.0.0.1', 'localhost', '::1'].includes(config.HOST || '127.0.0.1'))) throw new Error('开发验证码仅限 loopback 服务');
  const folder = resolve('.local/accounts'); mkdirSync(folder, { recursive: true, mode: 0o700 });
  const secretPath = resolve(folder, 'secret');
  if (local && !existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString('base64url'), { mode: 0o600 });
  const dbPath = resolve(config.ACCOUNTS_SQLITE || `${folder}/accounts.sqlite`);
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath); chmodSync(dbPath, 0o600); db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  applyLocalAccountMigrations(db);
  const names = ['AUTH_SECRET', 'RESEND_API_KEY', 'AUTH_EMAIL_FROM', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'];
  return { ...Object.fromEntries(names.map(key => [key, config[key]])), AUTH_URL: origin.origin, AUTH_SECRET: config.AUTH_SECRET || (local ? readFileSync(secretPath, 'utf8') : ''), ACCOUNTS_DB: db, ACCOUNT_SQL: sqliteSQL(db), ...(dev ? { ACCOUNT_DELIVER_EMAIL: async data => { writeFileSync(resolve(folder, 'last-email.json'), JSON.stringify({ ...data, expiresAt: new Date(Date.now() + 300000).toISOString() }, null, 2), { mode: 0o600 }); } } : {}) };
}
