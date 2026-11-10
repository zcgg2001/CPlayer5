import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteSQL, applyLocalAccountMigrations } from '../local-accounts.js';
import worker from '../sites/worker.js';
import { defaults, config, event, cleanup } from '../sites/operations-store.js';
import { reliableRequest, rateLimit, sourceGate, recordSource } from '../sites/reliability.js';
import { handleAccounts } from '../sites/accounts.js';
import { handleCover } from '../sites/cover-cache.js';
import { createRequestBudget } from '../js/request-budget.js';
import { setLocale, t, translateLiteral } from '../js/i18n.js';

const origin = 'http://127.0.0.1:8787';
function fixture(t) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); applyLocalAccountMigrations(db); t.after(() => db.close());
  let time = 1800000000000;
  const env = { ACCOUNTS_DB: db, ACCOUNT_SQL: sqliteSQL(db), AUTH_URL: origin, AUTH_SECRET: 'operations-fixture-secret-with-32-characters', OPS_NOW: () => time };
  const call = (path, { body, method = body ? 'POST' : 'GET', cookie, headers = {} } = {}) => worker.fetch(new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1', ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  async function login(username) {
    const response = await handleAccounts(new Request(origin + '/api/auth/sign-up/username', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'fixture-password-123' }) }), env);
    assert.equal(response.status, 200); const user = (await response.json()).user;
    return { user, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
  }
  return { db, env, call, login, advance: ms => { time += ms; } };
}
const request = () => new Request(origin + '/api/v1/music/search?source=gd&keyword=test');
function memoryCache() { const map = new Map(); return { async match(key) { return map.get(key.url)?.clone(); }, async put(key, value) { map.set(key.url, value.clone()); }, map }; }

test('shared circuit opens after three failures, excludes 404 and admits exactly one recovery probe', async t => {
  const f = fixture(t); let calls = 0;
  const fail = () => { calls++; return new Response('bad', { status: 502 }); };
  await reliableRequest(request(), f.env, () => new Response('missing', { status: 404 }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_source_metrics').get().n, 0);
  for (let i = 0; i < 3; i++) assert.equal((await reliableRequest(request(), f.env, fail)).status, 502);
  const held = await reliableRequest(request(), { ...f.env }, fail);
  assert.equal(held.status, 503); assert.equal((await held.json()).error.code, 'source_cooling'); assert.equal(calls, 3);
  assert.equal(f.db.prepare("SELECT count FROM cplayer_events WHERE kind='alert'").get().count, 1);
  f.advance(120001);
  const gates = await Promise.all(Array.from({ length: 8 }, () => sourceGate({ ...f.env }, 'gd', 'search', defaults())));
  assert.equal(gates.filter(g => g.probe).length, 1);
  await recordSource(f.env, 'gd', 'search', new Response('ok'), 50, gates.find(g => g.probe));
  assert.equal((await sourceGate(f.env, 'gd', 'search', defaults())).response, undefined);
  const metric = f.db.prepare('SELECT SUM(requests) requests, SUM(failures) failures FROM cplayer_source_metrics').get();
  assert.equal(metric.requests, 4); assert.equal(metric.failures, 3);
});

test('disabled source and canceled calls cannot create requests or poison source health', async t => {
  const f = fixture(t), settings = defaults(); settings.sources.gd.enabled = false;
  f.db.prepare('INSERT INTO cplayer_ops_config VALUES (1,1,?,?)').run(JSON.stringify(settings), Date.now());
  let called = false;
  const result = await reliableRequest(request(), f.env, () => { called = true; return new Response('ok'); });
  assert.equal((await result.json()).error.code, 'source_disabled'); assert.equal(called, false);
  await recordSource(f.env, 'gd', 'search', new Response(null, { status: 502 }), 10, {}, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_source_metrics').get().n, 0);
});

test('SQL rate limits are shared, return Retry-After, expire and never store raw IPs', async t => {
  const f = fixture(t), req = new Request(origin + '/api/telemetry', { headers: { 'cf-connecting-ip': '198.51.100.7' } });
  for (let i = 0; i < 30; i++) assert.equal(await rateLimit(req, { ...f.env }), null);
  const limited = await rateLimit(req, { ...f.env }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.ok(!f.db.prepare('SELECT key FROM cplayer_api_limits').get().key.includes('198.51'));
  f.advance(60001); assert.equal(await rateLimit(req, f.env), null);
  f.advance(7 * 86400000 + 1); await cleanup(f.env); assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_api_limits').get().n, 0);
});

test('public metadata cache ignores cookies, excludes song URLs and invalidates on config revision', async t => {
  const f = fixture(t), cache = memoryCache(); f.env.OPS_CACHE = cache; let calls = 0;
  const handler = () => { calls++; return Response.json({ data: ['public'] }); };
  await reliableRequest(request(), f.env, handler);
  const hit = await reliableRequest(new Request(request(), { headers: { cookie: 'private=session' } }), f.env, handler);
  assert.equal(hit.headers.get('x-cplayer-cache'), 'HIT'); assert.equal(calls, 1);
  assert.ok([...cache.map.keys()].every(key => !key.includes('private')));
  f.db.prepare('INSERT INTO cplayer_ops_config VALUES (1,1,?,?)').run(JSON.stringify(defaults()), Date.now());
  await reliableRequest(request(), f.env, handler); assert.equal(calls, 2);
  const audio = new Request(origin + '/api/v1/music/song?source=gd&id=1');
  await reliableRequest(audio, f.env, handler); await reliableRequest(audio, f.env, handler); assert.equal(calls, 4);
});

test('admin access uses explicit immutable user IDs; CSRF and stale edits fail; successful edits are audited', async t => {
  const f = fixture(t), admin = await f.login('ops_admin'), ordinary = await f.login('ordinary');
  f.env.OPS_ADMIN_USER_IDS = admin.user.id;
  assert.equal((await f.call('/api/admin/dashboard')).status, 401);
  assert.equal((await f.call('/api/admin/dashboard', ordinary)).status, 403);
  let response = await f.call('/api/admin/config', { ...admin, method: 'PUT', body: { ...defaults(), revision: 0 }, headers: { origin: 'https://evil.example' } }); assert.equal(response.status, 403);
  const settings = { ...defaults(), revision: 0 }; settings.sources.gd.enabled = false;
  response = await f.call('/api/admin/config', { ...admin, method: 'PUT', body: settings }); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await config(f.env)).sources.gd.enabled, false); assert.equal(f.db.prepare('SELECT actor FROM cplayer_ops_audit').get().actor, admin.user.id);
  assert.equal((await f.call('/api/admin/config', { ...admin, method: 'PUT', body: settings })).status, 409);
  assert.equal((await f.call('/api/admin/config', { ...admin, method: 'PUT', body: { ...settings, revision: 1, sources: { arbitrary: { enabled: true } } } })).status, 400);
  const publicData = await (await f.call('/api/runtime')).text(); assert.ok(!publicData.includes(admin.user.id)); assert.ok(!publicData.includes(f.env.AUTH_SECRET));
});

test('anonymous telemetry is bounded, origin-checked, ignores secrets and cannot open source circuits', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/telemetry', { body: { kind: 'source_switched', source: 'gd', password: 'never-log' } })).status, 202);
  assert.equal((await f.call('/api/telemetry', { body: { kind: 'source_switched' }, headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await f.call('/api/telemetry', { body: { kind: 'arbitrary-message' } })).status, 400);
  assert.equal((await f.call('/api/telemetry', { body: { kind: 'client_error', padding: 'x'.repeat(3000) } })).status, 413);
  assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_source_state').get().n, 0);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM cplayer_events').all()).includes('never-log'));
});

test('cover CDN rejects SSRF, redirects, SVG and oversized bodies; public images cache', async t => {
  const f = fixture(t); let calls = 0; f.env.OPS_CACHE = memoryCache();
  f.env.COVER_FETCH = async (url, options) => { calls++; assert.equal(options.redirect, 'manual'); assert.equal(options.headers.cookie, undefined); return new Response('jpeg', { headers: { 'content-type': 'image/jpeg' } }); };
  const get = url => handleCover(new Request(origin + '/api/cover?url=' + encodeURIComponent(url)), f.env);
  for (const url of ['http://127.0.0.1/private', 'https://music.126.net.evil.example/a', 'https://user:pass@p1.music.126.net/a', 'https://p1.music.126.net:444/a']) assert.equal((await get(url)).status, 400);
  assert.equal(calls, 0); assert.equal((await get('https://p1.music.126.net/a.jpg')).status, 200); assert.equal((await get('https://p1.music.126.net/a.jpg')).status, 200); assert.equal(calls, 1);
  f.env.COVER_FETCH = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }); assert.equal((await get('https://p1.music.126.net/redirect')).status, 502);
  f.env.COVER_FETCH = async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }); assert.equal((await get('https://p1.music.126.net/svg')).status, 502);
  f.env.COVER_FETCH = async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }); assert.equal((await get('https://p1.music.126.net/large')).status, 502);
});

test('SSR only publishes approved pages, escapes upstream HTML and emits canonical/schema/sitemap', async t => {
  const f = fixture(t), settings = defaults(); settings.pages = [{ type: 'album', id: '42', status: 'published' }, { type: 'artist', id: '7', status: 'draft' }];
  f.db.prepare('INSERT INTO cplayer_ops_config VALUES (1,1,?,?)').run(JSON.stringify(settings), Date.now());
  f.env.DISCOVERY_FETCH = async () => Response.json({ code: 200, album: { id: 42, name: '<script>bad</script>', description: 'A public album' }, songs: [{ id: 1, name: 'Song', ar: [{ id: 7, name: 'Artist' }], al: { name: 'Album' }, dt: 180000 }] });
  let response = await f.call('/album/42?lang=en'), html = await response.text(); assert.equal(response.status, 200); assert.match(html, /<html lang="en">/); assert.match(html, /MusicAlbum/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>bad/); assert.match(html, /rel="canonical"/); assert.match(html, /Song/);
  assert.equal((await f.call('/artist/7')).status, 404); assert.equal((await f.call('/playlist/99')).status, 404);
  const sitemap = await (await f.call('/sitemap.xml')).text(); assert.match(sitemap, /album\/42/); assert.doesNotMatch(sitemap, /artist\/7/);
  settings.sensitiveWords = ['bad']; f.db.prepare('UPDATE cplayer_ops_config SET body = ?').run(JSON.stringify(settings)); assert.equal((await f.call('/album/42')).status, 404);
  assert.equal((await f.call('/api/v1/music/search?source=gd&keyword=bad')).status, 400);
});

test('client request budget observes Retry-After, caps bursts and supports global backoff', () => {
  let now = 10000; const budget = createRequestBudget({ now: () => now, max: 2 });
  assert.equal(budget.take('/api?source=gd'), 0); assert.equal(budget.take('/api?source=gd'), 0); assert.ok(budget.take('/api?source=gd') > 0);
  now += 10001; budget.retry('/api?source=gd', '60'); assert.equal(budget.take('/api?source=gd'), 60); assert.equal(budget.take('/api?source=qq'), 0);
  budget.retry('/api?source=qq', '30', true); assert.equal(budget.take('/api?source=chksz'), 30);
});

test('locale dictionaries preserve content and interpolate playback notices', () => {
  setLocale('en'); assert.equal(t('sourceSwitched', { source: 'GD' }), 'Switched your source to GD'); assert.equal(translateLiteral('欢迎回来'), 'Welcome back'); assert.equal(translateLiteral('曲目：夜曲'), '曲目：夜曲');
  setLocale('zh-CN'); assert.equal(t('opsTitle'), '运行控制台');
});

test('Node metadata cache expires and evicts bounded completed responses', async () => {
  const { createResponseCache } = await import('../sites/response-cache.js');
  let now=0;const cache=createResponseCache({now:()=>now,maxEntries:1,maxBytes:100});
  const a=new Request('https://test/a'),b=new Request('https://test/b');
  await cache.put(a,new Response('one',{headers:{'cache-control':'public, max-age=1'}}));
  assert.equal(await (await cache.match(a)).text(),'one');
  await cache.put(b,new Response('two',{headers:{'cache-control':'public, max-age=1'}}));
  assert.equal(await cache.match(a),undefined);now=1001;assert.equal(await cache.match(b),undefined);
});
test('edge limiter blocks requests before writing SQL counters', async t => {
  const f=fixture(t);f.env.API_RATE_LIMIT={async limit(){return {success:false};}};
  assert.equal((await rateLimit(request(),f.env)).status,429);assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_api_limits').get().n,0);
});

test('source disabling cannot be bypassed through accepted case or whitespace aliases', async t => {
  const f=fixture(t), settings=defaults();settings.sources.chksz.enabled=false;
  f.db.prepare('INSERT INTO cplayer_ops_config VALUES(1,1,?,?)').run(JSON.stringify(settings),Date.now());
  f.env.CHKSZ_API_KEY='fixture';f.env.MUSIC_FETCH=()=>assert.fail('Disabled provider must not be called');
  for(const source of ['chksz','CHKSZ',' chksz ']) {
    const response=await f.call('/api/v1/music/search?keyword=test&source='+encodeURIComponent(source));
    assert.equal(response.status,503);assert.equal((await response.json()).error.code,'source_disabled');
  }
});
