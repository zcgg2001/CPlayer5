import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAccounts } from '../sites/accounts.js';
import { wechatProvider } from '../sites/account-auth.js';
import { sqliteSQL, applyLocalAccountMigrations } from '../local-accounts.js';
import { createAccountLibrary } from '../js/account-library.js';
import { createAccountSync } from '../js/account-sync.js';
import { cleanRecords, mergeRecords } from '../js/account-data.js';
import { createRequire } from 'node:module';
const { appOrigin, tokenRoute } = createRequire(import.meta.url)('../desktop/policy.cjs');
const origin = 'http://127.0.0.1:8787';

test('remembered username login survives a new app session, refreshes its cookie and still obeys revocation', async t => {
  const f = fixture(t), body = {username:'persistent_user',password:'test-persistent-password',rememberMe:true};
  assert.equal((await f.call('/api/auth/sign-up/username', {body})).response.status, 200);
  const signedIn = await f.call('/api/auth/sign-in/username', {body});
  const cookieHeader = signedIn.response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token='));
  assert.match(cookieHeader, /Max-Age=2592000/i);
  assert.match(cookieHeader, /HttpOnly/i);
  const cookie = cookieHeader.split(';')[0];
  const resumed = await f.call('/api/auth/get-session', {cookie});
  assert.equal(resumed.data.user.username, body.username);
  assert.equal(resumed.data.user.id, signedIn.data.user.id);
  // Time since issuance is derived from expiry by Better Auth. Simulate a
  // later application launch so its HTTP response must renew the cookie too.
  f.db.prepare('UPDATE session SET expiresAt = ?, updatedAt = ?').run(Date.now()+27*86400000, Date.now()-3*86400000);
  const renewed = await f.call('/api/auth/get-session', {cookie});
  assert.match(renewed.response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')), /Max-Age=2592000/i);
  await f.call('/api/auth/sign-out', {cookie,body:{}});
  assert.equal((await f.call('/api/auth/get-session', {cookie})).data, null);
  assert.equal((await f.call('/api/account/me', {cookie})).response.status, 401);
});

test('remembered login clears an earlier temporary-session preference; cached identity cannot revive expired cookies', async t => {
  const f = fixture(t), body = {username:'upgrade_user',password:'test-upgrade-password'};
  await f.call('/api/auth/sign-up/username', {body});
  const old = await f.call('/api/auth/sign-in/username', {body:{...body,rememberMe:false}});
  const oldCookies = old.response.headers.getSetCookie();
  assert.ok(oldCookies.some(value => value.startsWith('better-auth.dont_remember=')));
  assert.doesNotMatch(oldCookies.find(value => value.startsWith('better-auth.session_token=')), /Max-Age/i);
  const cookie = oldCookies.map(value => value.split(';')[0]).join('; ');
  const upgraded = await f.call('/api/auth/sign-in/username', {cookie,body:{...body,rememberMe:true}});
  const headers = upgraded.response.headers.getSetCookie();
  assert.match(headers.find(value => value.startsWith('better-auth.dont_remember=')), /Max-Age=0/i);
  const persistent = headers.find(value => value.startsWith('better-auth.session_token='));
  assert.match(persistent, /Max-Age=2592000/i);
  f.db.prepare('UPDATE session SET expiresAt = ?').run(Date.now()-1000);
  assert.equal((await f.call('/api/auth/get-session', {cookie:persistent.split(';')[0]})).data, null);
});

function fixture(t, extra = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); applyLocalAccountMigrations(db);
  t.after(() => db.close()); const delivered = [];
  const env = { AUTH_URL: origin, AUTH_SECRET: 'test-secret-32-characters-long-no-production', ACCOUNTS_DB: db, ACCOUNT_SQL: sqliteSQL(db), ACCOUNT_DELIVER_EMAIL: data => delivered.push(data), ...extra };
  const call = async (path, { body, method = body ? 'POST' : 'GET', cookie, headers = {} } = {}) => {
    const response = await handleAccounts(new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
    const data = await response.json(); return { response, data };
  };
  const login = async email => {
    let result = await call('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } }); assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const otp = delivered.at(-1).otp;
    result = await call('/api/auth/sign-in/email-otp', { body: { email, otp } }); assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const cookie = result.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return { cookie, otp, user: result.data.user };
  };
  return { db, env, call, login, delivered };
}
test('real email OTP signs in, cannot replay, wrong origin and unauthenticated access fail', async t => {
  const f = fixture(t), user = await f.login('alice@example.com');
  assert.equal((await f.call('/api/account/me', user)).data.user.email, 'alice@example.com');
  assert.equal((await f.call('/api/account/me')).response.status, 401);
  assert.equal((await f.call('/api/auth/sign-in/email-otp', { body: { email: 'alice@example.com', otp: user.otp } })).response.status, 400);
  assert.equal((await f.call('/api/sync', { ...user, method: 'PUT', body: { revision: 0, records: {} }, headers: { origin: 'https://evil.example' } })).response.status, 403);
  assert.equal((await f.call('/api/auth/delete-user', { ...user, body: {} })).response.status, 404);
});
test('cloud CAS, tombstones, redaction, user isolation and deletion revoke sessions', async t => {
  const f = fixture(t), a = await f.login('a@example.com'), b = await f.login('b@example.com');
  const records = { 'favorite:gd:1': { id: '1', name: 'Song', url: 'https://private/audio', secret: 'secret' }, queue: { songs: [{ id: '1' }] } };
  let r = await f.call('/api/sync', { ...a, method: 'PUT', body: { revision: 0, records } }); assert.equal(r.response.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await f.call('/api/sync', b)).data.records, {});
  r = await f.call('/api/sync', { ...a, method: 'PUT', body: { revision: 0, records } }); assert.equal(r.response.status, 409);
  const exportData = (await f.call('/api/account/export', a)).data;
  assert.ok(!JSON.stringify(exportData).includes('private/audio')); assert.ok(!JSON.stringify(exportData).includes('secret')); assert.ok(!JSON.stringify(exportData).includes('token'));
  r = await f.call('/api/sync', { ...a, method: 'PUT', body: { revision: 1, records: { 'favorite:gd:1': null } } }); assert.equal(r.data.revision, 2);
  assert.equal((await f.call('/api/account/delete', { ...a, body: { confirmation: 'no' } })).response.status, 400);
  r = await f.call('/api/account/delete', { ...a, body: { confirmation: '删除我的账号' } }); assert.equal(r.response.status, 200, JSON.stringify(r.data));
  assert.equal((await f.call('/api/account/me', a)).response.status, 401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM cplayer_sync').get().n, 0);
  assert.equal((await f.call('/api/account/me', b)).response.status, 200);
});
test('session management hides tokens and cannot revoke another user', async t => {
  const f = fixture(t), a = await f.login('a@example.com'), b = await f.login('b@example.com');
  const sessions = (await f.call('/api/account/sessions', a)).data;
  assert.equal(sessions.length, 1); assert.equal(sessions[0].current, true); assert.equal(sessions[0].token, undefined);
  assert.equal((await f.call('/api/account/revoke', { ...b, body: { id: sessions[0].id } })).response.status, 404);
  assert.equal((await f.call('/api/account/revoke', { ...a, body: { id: sessions[0].id } })).response.status, 200);
  assert.equal((await f.call('/api/account/me', a)).response.status, 401);
});
test('device authorization requires login, explicit approval, issues bearer and prevents reuse', async t => {
  const f = fixture(t), a = await f.login('desktop@example.com');
  let r = await f.call('/api/auth/device/code', { body: { client_id: 'invalid' } }); assert.equal(r.response.status, 400);
  const code = (await f.call('/api/auth/device/code', { body: { client_id: 'cplayer-desktop' } })).data;
  const poll = { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: 'cplayer-desktop', device_code: code.device_code };
  assert.equal((await f.call('/api/auth/device/token', { body: poll })).data.error, 'authorization_pending');
  assert.equal((await f.call('/api/auth/device/approve', { body: { userCode: code.user_code } })).response.status, 401);
  assert.equal((await f.call('/api/auth/device?user_code=' + code.user_code, a)).data.client_id, 'cplayer-desktop');
  r = await f.call('/api/auth/device/approve', { ...a, body: { userCode: code.user_code } }); assert.equal(r.response.status, 200, JSON.stringify(r.data));
  f.db.prepare('UPDATE deviceCode SET lastPolledAt = NULL').run();
  r = await f.call('/api/auth/device/token', { body: poll }); assert.equal(r.response.status, 200, JSON.stringify(r.data));
  assert.equal((await f.call('/api/account/me', { headers: { authorization: `Bearer ${r.data.access_token}` } })).data.user.email, 'desktop@example.com');
  assert.notEqual((await f.call('/api/auth/device/token', { body: poll })).response.status, 200);
});
test('expired sessions cannot delete and oversized or unknown settings are rejected', async t => {
  const f = fixture(t), a = await f.login('fresh@example.com');
  f.db.prepare('UPDATE session SET createdAt = ?').run(Date.now() - 600000);
  assert.equal((await f.call('/api/account/delete', { ...a, body: { confirmation: '删除我的账号' } })).response.status, 403);
  assert.equal((await f.call('/api/sync', { ...a, method: 'PUT', body: { revision: 0, records: { 'setting:cp_musicKey': 'secret' } } })).response.status, 400);
  assert.equal((await f.call('/api/sync', { ...a, method: 'PUT', body: { revision: 0, records: {}, padding: 'x'.repeat(2100000) } })).response.status, 413);
});
test('Twilio custom verifier is authoritative; WeChat keeps unverified identity separate', async t => {
  const calls = [], f = fixture(t, { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test', TWILIO_VERIFY_SERVICE_SID: 'VAtest', ACCOUNT_FETCH: async (url, options) => { calls.push([url, options]); return Response.json({ status: String(options.body).includes('Code=123456') ? 'approved' : 'pending' }); } });
  assert.equal((await f.call('/api/auth/phone-number/send-otp', { body: { phoneNumber: '+8613800000000' } })).response.status, 200);
  assert.notEqual((await f.call('/api/auth/phone-number/verify', { body: { phoneNumber: '+8613800000000', code: '000000' } })).response.status, 200);
  const result = await f.call('/api/auth/phone-number/verify', { body: { phoneNumber: '+8613800000000', code: '123456' } }); assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(calls.some(([url]) => url.endsWith('/VerificationCheck')));
  const provider = wechatProvider({ WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'secret', ACCOUNT_FETCH: async url => Response.json(url.includes('/access_token') ? { access_token: 'wx-token', openid: 'openid-1', expires_in: 7200 } : { openid: 'openid-1', nickname: '微信' }) });
  const info = await provider.getUserInfo(await provider.getToken({ code: 'one-time-code' }));
  assert.equal(info.emailVerified, false); assert.match(info.email, /@users\.invalid$/); assert.equal(info.id, 'openid-1');
});
test('merge disjoint edits and deletion; flag competing offline writes', () => {
  assert.deepEqual(mergeRecords({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: null }), { records: { a: 2, b: null }, conflicts: [] });
  assert.deepEqual(mergeRecords({ a: 1 }, { a: 2 }, { a: 3 }).conflicts, ['a']);
  assert.throws(() => cleanRecords({ '__proto__:bad': {} }));
});
test('sync rejects large documents before they exceed the D1 row limit', () => {
  const song = { id: '1', name: 'x'.repeat(300), artist: 'x'.repeat(300), album: 'x'.repeat(300), source: 'x'.repeat(300), sourceId: 'x'.repeat(300), platform: 'x'.repeat(300), mid: 'x'.repeat(300) };
  const records = count => ({ 'playlist:large': { name: 'Large playlist', songs: Array.from({ length: count }, (_, id) => ({ ...song, id: String(id) })) } });
  assert.ok(new TextEncoder().encode(JSON.stringify(cleanRecords(records(800)))).byteLength < 1_990_000);
  assert.throws(() => cleanRecords(records(950)), /云端资料超过/);
});
function storage() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; }
test('oversized lyric settings cannot block login, leak to another account, or erase cloud settings', () => {
  const store = storage();
  const library = createAccountLibrary({
    storage: store,
    player: { queue: () => [], setQueue() {} },
    refreshFavorites() {},
    onSettings() {},
  });
  const key = 'cp_lyricTracks_v1', record = `setting:${key}`, guestTracks = 'g'.repeat(16001), accountTracks = 'a'.repeat(16001);
  store.setItem(key, guestTracks);
  store.setItem('cp_theme', 'night');
  assert.throws(() => cleanRecords({ [record]: guestTracks }), /设置过大/);
  assert.equal(library.capture()['setting:cp_theme'], 'night');
  assert.equal(library.capture()[record], undefined);

  library.switchLocalSettings('account');
  store.setItem('cp_account_owner', 'account');
  library.apply({ [record]: 'small cloud version' });
  assert.equal(store.getItem(key), 'small cloud version');
  store.setItem(key, accountTracks);
  const cloudSettings = { [record]: 'small cloud version' };
  assert.equal(library.capture({ cloudSettings })[record], 'small cloud version');
  library.apply(cloudSettings);
  assert.equal(store.getItem(key), accountTracks);

  library.switchLocalSettings(null);
  store.removeItem('cp_account_owner');
  assert.equal(store.getItem(key), guestTracks);
  library.switchLocalSettings('account');
  assert.equal(store.getItem(key), accountTracks);
});

test('offline journal survives reload and account switch cannot upload previous user data', async () => {
  const store = storage(); let offline = true, remote = { revision: 0, records: {} };
  const request = async (_path, opts) => { if (offline) throw Error('offline'); if (opts) { remote = { revision: remote.revision + 1, records: opts.body.records }; return { revision: remote.revision }; } return structuredClone(remote); };
  let sync = createAccountSync({ storage: store, request }); sync.connect('a'); sync.capture({ 'favorite:gd:1': { id: '1' } }); await sync.sync();
  sync = createAccountSync({ storage: store, request }); sync.connect('a'); assert.equal(sync.records()['favorite:gd:1'].id, '1');
  sync.disconnect(); sync.connect('b'); offline = false; await sync.sync(); assert.deepEqual(remote.records, {});
  sync.disconnect(); sync.connect('a'); await sync.sync(); assert.equal(remote.records['favorite:gd:1'].id, '1');
});
test('desktop only injects bearer into trusted private API routes', () => {
  const origin = appOrigin(); assert.ok(tokenRoute(origin + '/api/sync', origin));
  for (const path of ['/api/auth/get-session', '/api/v1/music/song', '/redirect']) assert.equal(tokenRoute(origin + path, origin), false);
  assert.equal(tokenRoute('https://evil.test/api/sync', origin), false);
  assert.throws(() => appOrigin('https://evil.test')); assert.throws(() => appOrigin('http://localhost:8787'));
  assert.equal(appOrigin('http://localhost:8787', true), 'http://localhost:8787');
});

test('OAuth initializes state and rejects forged callbacks without creating accounts', async t => {
  const f = fixture(t, { GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', WECHAT_APP_ID: 'test-wx', WECHAT_APP_SECRET: 'test-secret' });
  let r = await f.call('/api/auth/sign-in/social', { body: { provider: 'github', callbackURL: origin + '/#account' } });
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  const url = new URL(r.data.url); assert.equal(url.hostname, 'github.com'); assert.ok(url.searchParams.get('state'));
  r = await f.call('/api/auth/sign-in/social', { body: { provider: 'github', callbackURL: 'https://evil.example/' } }); assert.notEqual(r.response.status, 200);
  const response = await handleAccounts(new Request(origin + '/api/auth/callback/github?code=forged&state=invalid'), f.env);
  assert.notEqual(response.status, 200); assert.equal(f.db.prepare('SELECT count(*) n FROM user').get().n, 0);
  r = await f.call('/api/auth/sign-in/social', { body: { provider: 'wechat', disableRedirect: true, callbackURL: origin + '/#account' } });
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  const wx = new URL(r.data.url); assert.equal(wx.hostname, 'open.weixin.qq.com'); assert.equal(wx.searchParams.get('appid'), 'test-wx'); assert.equal(wx.searchParams.get('scope'), 'snsapi_login');
});

test('an account switch discards in-flight remote data and conflicts persist until chosen', async () => {
  const store = storage(); let finish;
  const sync = createAccountSync({ storage: store, request: () => new Promise(resolve => { finish = resolve; }) });
  sync.connect('a'); const old = sync.sync(); sync.connect('b');
  finish({ revision: 1, records: { 'favorite:gd:1': { id: '1' } } }); await old;
  assert.deepEqual(sync.records(), {});
  let remote = { revision: 1, records: { 'setting:cp_theme': 'night' } };
  const client = createAccountSync({ storage: store, request: async (_p, options) => { if (options) { remote = { revision: remote.revision + 1, records: options.body.records }; return { revision: remote.revision }; } return structuredClone(remote); } });
  client.connect('conflict'); await client.sync(); client.capture({ 'setting:cp_theme': 'light' });
  remote = { revision: 2, records: { 'setting:cp_theme': null } }; await client.sync();
  assert.equal(client.pending(), true); assert.deepEqual(JSON.parse(store.getItem('cp_cloud_v1:conflict')).conflicts, ['setting:cp_theme']);
  await client.sync(); assert.equal(remote.records['setting:cp_theme'], null);
  client.resolve('setting:cp_theme', 'local'); await client.sync(); assert.equal(remote.records['setting:cp_theme'], 'light');
});

test('username registration hashes passwords on the server and supports case-insensitive login', async t => {
  const f = fixture(t);
  const password = 'a-secure-test-password';
  let result = await f.call('/api/auth/sign-up/username', { body: { username: 'Music_Fan', password, email: 'attacker@example.com', emailVerified: true } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const cookie = result.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const profile = (await f.call('/api/account/me', { cookie })).data.user;
  assert.equal(profile.username, 'music_fan'); assert.equal(profile.email, null);
  const account = f.db.prepare('SELECT password FROM account WHERE providerId = ?').get('credential');
  assert.ok(account.password.length > 100); assert.ok(!account.password.includes(password));
  assert.equal(f.db.prepare('SELECT emailVerified FROM user').get().emailVerified, 0);
  await f.call('/api/auth/sign-out', { cookie, body: {} });
  assert.equal((await f.call('/api/account/me', { cookie })).response.status, 401);
  result = await f.call('/api/auth/sign-in/username', { body: { username: 'MUSIC_FAN', password: 'wrong-password' } });
  assert.equal(result.response.status, 401);
  result = await f.call('/api/auth/sign-in/username', { body: { username: 'MUSIC_FAN', password } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  const secondCookie = result.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await f.call('/api/account/me', { cookie: secondCookie })).data.user.id, profile.id);
  const exported = (await f.call('/api/account/export', { cookie: secondCookie })).data;
  assert.equal(exported.user.username, 'music_fan'); assert.ok(!JSON.stringify(exported).includes(account.password));
  result = await f.call('/api/auth/sign-up/username', { body: { username: 'music_FAN', password } });
  assert.notEqual(result.response.status, 200); assert.equal(f.db.prepare('SELECT count(*) n FROM user').get().n, 1);
});

test('username registration rejects weak passwords, bad names, bypass routes and foreign origins', async t => {
  const f = fixture(t);
  for (const username of ['ab', 'a@b.com', 'x'.repeat(25), '<script>', '__proto__:admin']) {
    assert.equal((await f.call('/api/auth/sign-up/username', { body: { username, password: 'strong-password' } })).response.status, 400);
  }
  for (const password of ['1234567', 'x'.repeat(129)]) assert.notEqual((await f.call('/api/auth/sign-up/username', { body: { username: 'testuser', password } })).response.status, 200);
  assert.equal((await f.call('/api/auth/sign-up/email', { body: { email: 'test@example.com', username: 'bypass', name: 'bypass', password: 'strong-password' } })).response.status, 404);
  assert.equal((await f.call('/api/auth/sign-up/username', { body: { username: 'tester', password: 'strong-password' }, headers: { origin: 'https://evil.example' } })).response.status, 403);
  assert.equal(f.db.prepare('SELECT count(*) n FROM user').get().n, 0);
});

test('local migrations are repeatable and preserve previous users and cloud data', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('old', 'Old User', 'old@example.com', 1, 1, 1);
  db.prepare('INSERT INTO cplayer_sync VALUES (?,?,?,?)').run('old', 3, '{"queue":null}', '2026-11-10');
  applyLocalAccountMigrations(db); applyLocalAccountMigrations(db);
  assert.equal(db.prepare('SELECT email FROM user WHERE id = ?').get('old').email, 'old@example.com');
  assert.equal(db.prepare('SELECT username FROM user WHERE id = ?').get('old').username, null);
  assert.equal(db.prepare('SELECT revision FROM cplayer_sync WHERE userId = ?').get('old').revision, 3);
});

test('username registration and login enforce per-IP request limits through the library handler', async t => {
  const f = fixture(t), password = 'a-secure-test-password';
  const body = { username: 'limited', password };
  assert.equal((await f.call('/api/auth/sign-up/username', { body })).response.status, 200);
  for (let i = 0; i < 4; i++) assert.notEqual((await f.call('/api/auth/sign-up/username', { body })).response.status, 429);
  assert.equal((await f.call('/api/auth/sign-up/username', { body })).response.status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await f.call('/api/auth/sign-in/username', { body: { ...body, password: 'incorrect-password' } })).response.status, 401);
  assert.equal((await f.call('/api/auth/sign-in/username', { body })).response.status, 429);
  assert.equal((await f.call('/api/auth/sign-in/username', { body, headers: { 'cf-connecting-ip': '192.0.2.8' } })).response.status, 200);
});
