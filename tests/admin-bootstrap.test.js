import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { sqliteSQL, applyLocalAccountMigrations } from '../local-accounts.js';
import worker from '../sites/worker.js';
import { defaults } from '../sites/operations-store.js';
const origin='http://127.0.0.1:8787';
async function fixture(t) {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');applyLocalAccountMigrations(db);t.after(()=>db.close());
  const userId=crypto.randomUUID(),now=Date.now(),hash=await hashPassword('admin');
  db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,?,?,?,?)').run(userId,'admin','u-admin@password.users.invalid',0,now,now,'admin');
  db.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),userId,'credential',userId,hash,now,now);
  db.prepare('INSERT INTO cplayer_admin_bootstrap(userId) VALUES(?)').run(userId);
  const env={ACCOUNTS_DB:db,ACCOUNT_SQL:sqliteSQL(db),AUTH_URL:origin,AUTH_SECRET:'bootstrap-test-secret-thirty-two-characters',OPS_ADMIN_USER_IDS:userId};
  const call=(path,body,cookie,method=body?'POST':'GET',headers={})=>worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json','cf-connecting-ip':'127.0.0.1',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
  const login=async(password='admin')=>{const r=await call('/api/auth/sign-in/username',{username:'admin',password});assert.equal(r.status,200,await r.clone().text());return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');};
  return {db,env,userId,call,login};
}
test('initial admin login is valid but all management and private-data mutations require rotation',async t=>{
 const f=await fixture(t),cookie=await f.login();
 assert.equal((await f.call('/api/admin/dashboard',null,cookie)).status,403);
 assert.equal((await f.call('/api/admin/config',{...defaults(),revision:0},cookie,'PUT')).status,403);
 assert.equal((await f.call('/api/sync',{revision:0,records:{}},cookie,'PUT')).status,403);
 assert.equal((await f.call('/api/account/delete',{confirmation:'删除我的账号'},cookie)).status,403);
 assert.equal((await f.call('/api/auth/device/code',{client_id:'cplayer-desktop'},cookie)).status,403);
 assert.equal((await f.call('/api/auth/sign-up/username',{username:'ADMIN',password:'normal-password'})).status,400);
 assert.notEqual((await f.call('/api/auth/sign-up/username',{username:'other_user',password:'admin'})).status,200);
 assert.notEqual(f.db.prepare('SELECT password FROM account').get().password,'admin');
});
test('password replacement checks current password, length, confirmation, origin and freshness',async t=>{
 const f=await fixture(t),cookie=await f.login(),body={currentPassword:'admin',newPassword:'new-strong-password-123',confirmPassword:'new-strong-password-123'};
 assert.equal((await f.call('/api/admin/password',{...body,currentPassword:'incorrect'},cookie)).status,401);
 assert.equal((await f.call('/api/admin/password',{...body,newPassword:'short',confirmPassword:'short'},cookie)).status,400);
 assert.equal((await f.call('/api/admin/password',{...body,confirmPassword:'different'},cookie)).status,400);
 assert.equal((await f.call('/api/admin/password',body,cookie,'POST',{origin:'https://evil.example'})).status,403);
 assert.equal((await f.call('/api/admin/password',body)).status,401);
 f.db.prepare('UPDATE session SET createdAt=?').run(Date.now()-600000);
 assert.equal((await f.call('/api/admin/password',body,cookie)).status,403);
 assert.equal(f.db.prepare('SELECT mustChange FROM cplayer_admin_bootstrap').get().mustChange,1);
});
test('rotation revokes all old sessions, enables management after relogin and cannot reset to default',async t=>{
 const f=await fixture(t),one=await f.login(),two=await f.login(),password='unique-new-password-123';
 const r=await f.call('/api/admin/password',{currentPassword:'admin',newPassword:password,confirmPassword:password},one);assert.equal(r.status,200,await r.clone().text());
 assert.equal((await f.call('/api/admin/dashboard',null,one)).status,401);assert.equal((await f.call('/api/admin/dashboard',null,two)).status,401);
 assert.equal((await f.call('/api/auth/sign-in/username',{username:'admin',password:'admin'})).status,401);
 const current=await f.login(password);assert.equal((await f.call('/api/admin/dashboard',null,current)).status,200);
 assert.equal((await f.call('/api/admin/config',{...defaults(),revision:0},current,'PUT')).status,200);
 assert.equal((await f.call('/api/admin/password',{currentPassword:password,newPassword:'another-password-123',confirmPassword:'another-password-123'},current)).status,409);
 assert.equal(f.db.prepare('SELECT mustChange FROM cplayer_admin_bootstrap').get().mustChange,0);
 assert.ok(await verifyPassword({hash:f.db.prepare('SELECT password FROM account').get().password,password}));
});
test('racing rotations allow exactly one winning password and revoke sessions atomically',async t=>{
 const f=await fixture(t),cookie=await f.login();
 const replacements=['race-password-one-123','race-password-two-123'];
 const results=await Promise.all(replacements.map(password=>f.call('/api/admin/password',{currentPassword:'admin',newPassword:password,confirmPassword:password},cookie)));
 assert.equal(results.filter(r=>r.status===200).length,1);
 const winning=results.findIndex(r=>r.status===200);assert.ok(await verifyPassword({hash:f.db.prepare('SELECT password FROM account').get().password,password:replacements[winning]}));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM session').get().n,0);
});
