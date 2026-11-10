import { MUSIC_CHANNELS } from '../js/music-channels.js';

export const SOURCE_NAMES = Object.freeze({ chksz: 'ChKSz · 网易云', gd: 'GD 音乐台', ...Object.fromEntries(Object.entries(MUSIC_CHANNELS).map(([id, item]) => [id, item.label])), bilibili: 'Bilibili' });
export const HOME_MODULES = ['daily', 'radio', 'history', 'recommendations', 'news', 'scenes'];
export const sqlDB = env => env.ACCOUNT_SQL || env.ACCOUNTS_DB;
export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
export const opsError = (status, code, message, headers) => json({ error: { code, message } }, status, headers);
export const clock = env => typeof env.OPS_NOW === 'function' ? env.OPS_NOW() : Date.now();
export const defaults = () => ({ sources: Object.fromEntries(Object.keys(SOURCE_NAMES).map((id, priority) => [id, { enabled: true, priority }])), charts: [], modules: [...HOME_MODULES], sensitiveWords: [], pages: [] });
export async function config(env) {
  const row = await sqlDB(env)?.prepare('SELECT revision, body FROM cplayer_ops_config WHERE id = ?').bind(1).first();
  const base = defaults();
  if (!row) return { revision: 0, ...base };
  const saved = JSON.parse(row.body);
  // Newly installed channels must also appear on sites with an existing config.
  // Preserve the operator's existing switches, priorities and revision.
  return { ...base, ...saved, sources: { ...base.sources, ...saved.sources }, revision: row.revision };
}
export function validateConfig(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('版本号无效');
  const result = defaults();
  if (!value.sources || Object.keys(value.sources).some(id => !Object.hasOwn(SOURCE_NAMES, id))) throw new Error('音源不在允许列表中');
  for (const id of Object.keys(SOURCE_NAMES)) {
    const item = value.sources[id];
    if (!item || typeof item.enabled !== 'boolean' || !Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100) throw new Error('音源开关或优先级无效');
    result.sources[id] = { enabled: item.enabled, priority: item.priority };
  }
  if (!Array.isArray(value.modules) || value.modules.length > HOME_MODULES.length || value.modules.some(id => !HOME_MODULES.includes(id)) || new Set(value.modules).size !== value.modules.length) throw new Error('首页模块无效');
  result.modules = value.modules;
  if (!Array.isArray(value.charts) || value.charts.length > 40 || value.charts.some(id => !/^\d{1,20}$/.test(id))) throw new Error('榜单需为数字 ID，最多 40 个');
  result.charts = [...new Set(value.charts)];
  if (!Array.isArray(value.sensitiveWords) || value.sensitiveWords.length > 200 || value.sensitiveWords.some(word => typeof word !== 'string' || !word.trim() || word.length > 40)) throw new Error('敏感词最多 200 个，每个 1–40 字');
  result.sensitiveWords = [...new Set(value.sensitiveWords.map(word => word.trim().toLowerCase()))];
  if (!Array.isArray(value.pages) || value.pages.length > 200) throw new Error('公开页面最多 200 个');
  result.pages = value.pages.map(page => {
    if (!['artist', 'album', 'playlist'].includes(page?.type) || !/^\d{1,20}$/.test(page.id) || !['draft', 'published', 'rejected'].includes(page.status)) throw new Error('页面类型、ID 或审核状态无效');
    return { type: page.type, id: page.id, status: page.status };
  });
  if (new Set(result.pages.map(page => `${page.type}:${page.id}`)).size !== result.pages.length) throw new Error('公开页面不能重复');
  return result;
}
export const blockedText = (text, settings) => settings.sensitiveWords.some(word => String(text).toLowerCase().includes(word));
export async function readJson(request, max = 32768) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw Object.assign(new Error('需要 JSON 请求'), { status: 415 });
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  if (Number(request.headers.get('content-length')) > max) throw Object.assign(new Error('请求过大'), { status: 413 });
  try {
    if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > max) throw Object.assign(new Error('请求过大'), { status: 413 }); chunks.push(value); }
  } finally { await reader?.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('JSON 格式无效'); }
}
export async function rows(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results; }
export async function event(env, kind, source, code) {
  const db = sqlDB(env), now = clock(env);
  // Aggregate a fixed vocabulary, never URLs, search text, account IDs or raw errors.
  if (!db) return;
  const id = `${Math.floor(now / 300000)}:${kind}:${source}:${code}`;
  await db.prepare('INSERT INTO cplayer_events (id, kind, source, code, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1').bind(id, kind, source, code, now).run();
}
export async function cleanup(env) {
  const db = sqlDB(env); if (!db) return;
  const now = clock(env);
  await db.prepare('DELETE FROM cplayer_api_limits WHERE expires < ?').bind(now).run();
  await db.prepare('DELETE FROM cplayer_source_metrics WHERE bucket < ?').bind(Math.floor((now - 7 * 86400000) / 3600000)).run();
  await db.prepare('DELETE FROM cplayer_events WHERE createdAt < ?').bind(now - 7 * 86400000).run();
  await db.prepare('DELETE FROM cplayer_ops_audit WHERE createdAt < ?').bind(now - 90 * 86400000).run();
}
