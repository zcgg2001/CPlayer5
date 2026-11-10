import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createCipheriv } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { Miniflare, Response } from 'miniflare';

// Exercise the actual deploy bundle in workerd, not Node's fetch implementation.
const output = new URL('../.cloudflare/output/v0/workers/default/', import.meta.url);
const code = await readFile(new URL('bundle/index.js', output), 'utf8');
const { compatibilityDate, compatibilityFlags } = JSON.parse(await readFile(new URL('worker.config.json', output), 'utf8'));
const modules = Object.fromEntries(await Promise.all((await readdir(new URL('bundle/', output), { recursive: true })).filter(name => name.endsWith('.js')).map(async name => [name, { type: 'esm', contents: await readFile(new URL(`bundle/${name}`, output), 'utf8') }])));
const video = { bvid: 'BV1C9b76cEks', title: 'Runtime fixture', owner: { name: 'Test' }, rights: {}, pages: [{ cid: 123 }] };

function runtime(t, handler = upstream, extraEnv = {}, fixedNow) {
  // A test-only entrypoint injects the existing clock seam into the real bundle.
  // Fixed-window quota assertions must not depend on crossing a wall-clock minute.
  const manifest = fixedNow === undefined ? { mainModule: 'index.js', modules } : {
    mainModule: 'test-clock.js',
    modules: { ...modules, 'test-clock.js': { type: 'esm', contents: `import worker from './index.js'; export default { fetch(request, env, ctx) { return worker.fetch(request, { ...env, OPS_NOW: () => ${fixedNow} }, ctx); } };` } },
  };
  const mf = new Miniflare({ workers: [{
    config: {
      name: 'cplayer-runtime-test', compatibilityDate, compatibilityFlags,
      env: { CHKSZ_API_KEY: { type: 'json', value: 'fixture-key' }, ...extraEnv },
      manifest,
    },
    dev: { outboundService: { type: 'fetcher', handler } },
  }] });
  t.after(() => mf.dispose());
  return mf;
}

async function upstream(request) {
  const url = new URL(request.url);
  // Enough delay to overlap separate Worker invocations and exercise cached I/O.
  await new Promise(resolve => setTimeout(resolve, 80));
  if (url.hostname === 'api.chksz.com') return Response.json({ code: 200, data: [{ id: 1, name: 'Test' }] });
  if (url.hostname === 'music-api.gdstudio.xyz') return Response.json([{ id: '1', name: 'Test', artist: ['Test'] }]);
  if (url.pathname.endsWith('/view')) return Response.json({ code: 0, data: video });
  if (url.pathname.endsWith('/playurl')) return Response.json({ code: 0, data: { dash: { audio: [{
    mimeType: 'audio/mp4', codecs: 'mp4a.40.2', bandwidth: 128000, baseUrl: 'https://fixture.bilivideo.com/audio.m4s',
  }] } } });
  if (url.hostname === 'fixture.bilivideo.com') {
    assert.equal(request.headers.get('range'), 'bytes=0-3');
    return new Response(new Uint8Array([0, 1, 2, 3]), { status: 206, headers: { 'content-range': 'bytes 0-3/100', 'content-length': '4' } });
  }
  return Response.json({ code: 0, data: { result: [video] } });
}

for (const provider of ['chksz', 'gd', 'bilibili']) {
  test(`workerd: ${provider} search and overlapping requests complete`, { timeout: 10000 }, async t => {
    const mf = runtime(t);
    const target = `https://player.example/api/v1/music/search?source=${provider}&keyword=test`;
    const results = await Promise.all([0, 1].map(async () => {
      const response = await mf.dispatchFetch(target);
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.doesNotMatch(body, /fixture-key/);
      return JSON.parse(body);
    }));
    assert.equal(results[0].data.length, 1);
    assert.deepEqual(results[0], results[1]);
  });
}

test('workerd: upstream redirects fail without following the destination', async t => {
  let calls = 0;
  const mf = runtime(t, async request => {
    assert.notEqual(new URL(request.url).hostname, 'unexpected.example');
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } });
  });
  for (const provider of ['chksz', 'gd', 'bilibili']) {
    const response = await mf.dispatchFetch(`https://player.example/api/v1/music/search?source=${provider}&keyword=test`);
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
  }
  assert.equal(calls, 3);
});

test('workerd: Bilibili audio preserves range bytes and streams the response', async t => {
  const mf = runtime(t);
  const response = await mf.dispatchFetch(`https://player.example/api/v1/bilibili/audio?id=${video.bvid}`, { headers: { range: 'bytes=0-3' } });
  assert.equal(response.status, 206, await (response.status === 206 ? Promise.resolve('') : response.text()));
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 2, 3]));
});

test('workerd: new channels run crypto, parse HTML, and stream HTTP audio with ranges', async t => {
  const mf = runtime(t, async request => {
    const url = new URL(request.url);
    if (url.hostname === 'interface.music.163.com') {
      assert.equal(request.method,'POST');
      assert.match(await request.text(),/^params=[A-F0-9]+$/);
      const cipher = createCipheriv('aes-128-ecb',Buffer.from('e82ckenh8dichen8'),null);
      return new Response(Buffer.concat([cipher.update(JSON.stringify({code:200,result:{songs:[{id:123,name:'Meting fixture',ar:[{name:'Artist'}]}]}}),'utf8'),cipher.final()]));
    }
    if (url.hostname === 'www.at38.cn') {
      if(url.searchParams.has('keyword'))return new Response('<div class="music-card" data-id="mid123" data-type="qq"><div class="music-info"><h3>QQ fixture</h3><p>歌手：Artist | 专辑：Album | 来源：QQ</p></div></div>');
      if(url.searchParams.has('action')){
        assert.match(request.headers.get('cookie'),/sid=fixture/);
        return Response.json({code:1,url:'http://aqqmusic.tc.qq.com/fixture.mp3'});
      }
      return new Response('Home',{headers:{'set-cookie':'sid=fixture; HttpOnly'}});
    }
    if (url.hostname === 'aqqmusic.tc.qq.com') {
      assert.equal(request.headers.get('range'),'bytes=0-3');
      assert.equal(request.headers.get('cookie'),null);
      return new Response('ID3!',{status:206,headers:{'content-range':'bytes 0-3/100','content-type':'audio/mpeg'}});
    }
    throw new Error(`Unexpected host ${url.hostname}`);
  });
  for(const source of ['netease','at38-qq']) {
    const response=await mf.dispatchFetch(`https://player.example/api/v1/music/search?source=${source}&keyword=test`);
    assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json()).data.length,1);
  }
  const response=await mf.dispatchFetch('https://player.example/api/v1/music/audio?source=at38-qq&id=mid123',{headers:{range:'bytes=0-3'}});
  assert.equal(response.status,206,await response.clone().text());
  assert.equal(await response.text(),'ID3!');
});

test('workerd: public metadata enrichment and overlapping requests retain no request I/O', async t => {
  const mf=runtime(t,async request=>{
    const url=new URL(request.url);assert.equal(url.hostname,'music.163.com');
    await new Promise(resolve=>setTimeout(resolve,40));
    if(url.pathname.includes('/song/detail'))return Response.json({code:200,songs:[{id:1,name:'曲目',duration:200000,artists:[{id:2,name:'艺人'}],album:{id:3,name:'专辑'}}]});
    if(url.pathname==='/api/album/3')return Response.json({code:200,album:{id:3,name:'专辑',description:'专辑介绍',company:'厂牌'}});
    return Response.json({code:200,artist:{id:2,name:'艺人',briefDesc:'艺人介绍'}});
  });
  const responses=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://player.example/api/v1/music/metadata?source=netease&id=1')));
  for(const response of responses){assert.equal(response.status,200);const body=await response.json();assert.equal(body.data.duration,200);assert.equal(body.data.albumEntity.description,'专辑介绍');assert.equal(body.data.artistEntities[0].description,'艺人介绍');}
});

test('workerd: OP task polling, native FLAC detection and same-origin Range playback', async t => {
  const path='/api/v1/playbacks/runtime-op';let posts=0,polls=0;
  const task={id:'runtime-op',platform:'applemusic',selected_id:'123',track_id:'123',status:'completed',format:'m4a',quality:'hires',audio_url:`https://music.zr.wiki${path}/audio?rev=current`};
  const prefix=new Uint8Array(64);prefix.set(new TextEncoder().encode('fLaC'));prefix[7]=34;
  new DataView(prefix.buffer).setBigUint64(18,(44100n<<44n)|(15n<<36n));
  const mf=runtime(t,async request=>{
    const url=new URL(request.url);assert.equal(request.headers.get('cookie'),null);assert.match(request.headers.get('user-agent'),/^CPlayer5/);
    if(request.method==='POST'){posts++;assert.equal((await request.json()).quality,'hires');return Response.json({playback:{...task,status:'queued'},status_url:path});}
    if(url.pathname===path){polls++;return Response.json(task);}
    assert.equal(url.hostname,'music.zr.wiki');assert.equal(url.searchParams.get('rev'),'current');
    const probe=request.headers.get('range')==='bytes=0-63';
    return new Response(probe?prefix:new TextEncoder().encode('fLaC'),{status:206,headers:{'content-type':'audio/flac','content-range':probe?'bytes 0-63/1000':'bytes 0-3/1000'}});
  });
  const resolved=await mf.dispatchFetch('https://player.example/api/v1/music/song?source=op-applemusic&id=123&level=hires');
  assert.equal(resolved.status,200);const {data}=await resolved.json();assert.equal(data.level,'lossless');assert.equal(data.format,'flac');assert.equal(data.sampleRate,44100);
  const audio=await mf.dispatchFetch(new URL(data.url,'https://player.example').href,{headers:{range:'bytes=0-3'}});
  assert.equal(audio.status,206);assert.equal(await audio.text(),'fLaC');assert.equal(posts,1);assert.equal(polls,1);
});

test('workerd: quota-independent discovery playlists and concurrent chart requests', async t => {
  const mf=runtime(t,async request=>{
    const url=new URL(request.url);assert.equal(url.hostname,'music.163.com');
    assert.equal(request.headers.get('authorization'),null);
    await new Promise(resolve=>setTimeout(resolve,30));
    if(url.pathname==='/api/toplist')return Response.json({code:200,list:[{id:123,name:'新歌榜'}]});
    return Response.json({code:200,result:{id:123,name:'公开歌单',trackCount:1,tracks:[{id:1,name:'曲目',duration:210000,artists:[{id:2,name:'艺人'}],album:{name:'专辑'}}]}});
  });
  for(const path of ['charts','playlist?id=123']) {
    const responses=await Promise.all([1,2].map(()=>mf.dispatchFetch(`https://player.example/api/v1/discovery/${path}`)));
    for(const response of responses){assert.equal(response.status,200);const body=await response.json();if(body.tracks){assert.equal(body.tracks[0].provider,'gd');assert.equal(body.tracks[0].duration,210);}else assert.equal(body.items[0].name,'新歌榜');}
  }
});

test('workerd: D1 account OTP, authenticated CAS sync and deletion', { timeout: 20000 }, async t => {
  let otp;
  const mf = runtime(t, async request => {
    if (new URL(request.url).hostname === 'api.resend.com') { otp = (await request.json()).text.match(/\b\d{6}\b/)[0]; return Response.json({ id: 'test' }); }
    return upstream(request);
  }, { ACCOUNTS_DB: { type: 'd1', name: 'accounts-test' }, AUTH_URL: { type: 'json', value: 'https://player.example' }, AUTH_SECRET: { type: 'json', value: 'workerd-test-secret-thirty-two-characters' }, RESEND_API_KEY: { type: 'json', value: 'test' }, AUTH_EMAIL_FROM: { type: 'json', value: 'CPlayer <login@example.com>' } });
  const db = await mf.getD1Database('ACCOUNTS_DB');
  const migration = (await Promise.all(['0001_accounts.sql', '0002_username.sql', '0003_operations.sql', '0004_admin_bootstrap.sql', '0005_personal_library.sql'].map(name => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')))).join('\n');
  await db.batch(migration.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const call = async (path, body, cookie, method = 'POST') => {
    const response = await mf.dispatchFetch('https://player.example' + path, { method, headers: { origin: 'https://player.example', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return { response, data };
  };
  await call('/api/auth/email-otp/send-verification-otp', { email: 'runtime@example.com', type: 'sign-in' });
  assert.match(otp, /^\d{6}$/);
  const login = await call('/api/auth/sign-in/email-otp', { email: 'runtime@example.com', otp });
  const cookie = login.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  await call('/api/sync', { revision: 0, records: { 'favorite:gd:1': { id: '1' } } }, cookie, 'PUT');
  assert.equal((await call('/api/sync', undefined, cookie, 'GET')).data.records['favorite:gd:1'].id, '1');
  await call('/api/account/delete', { confirmation: '删除我的账号' }, cookie);
  assert.equal((await db.prepare('SELECT count(*) n FROM cplayer_sync').first()).n, 0);
});

test('workerd: username/password registration and login persist in D1 without mail services', { timeout: 20000 }, async t => {
  const mf = runtime(t, upstream, { ACCOUNTS_DB: { type: 'd1', name: 'password-test' }, AUTH_URL: { type: 'json', value: 'https://player.example' }, AUTH_SECRET: { type: 'json', value: 'workerd-password-secret-thirty-two-characters' } });
  const db = await mf.getD1Database('ACCOUNTS_DB');
  for (const file of ['0001_accounts.sql', '0002_username.sql', '0003_operations.sql', '0004_admin_bootstrap.sql', '0005_personal_library.sql']) {
    const sql = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  const call = (path, body) => mf.dispatchFetch('https://player.example' + path, { method: 'POST', headers: { origin: 'https://player.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const password = 'test-worker-password';
  let response = await call('/api/auth/sign-up/username', { username: 'worker_user', password });
  assert.equal(response.status, 200, await response.text());
  const account = await db.prepare("SELECT password FROM account WHERE providerId = 'credential'").first();
  assert.ok(account.password.length > 100); assert.ok(!account.password.includes(password));
  response = await call('/api/auth/sign-in/username', { username: 'WORKER_USER', password });
  assert.equal(response.status, 200, await response.text());
  response = await call('/api/auth/sign-in/username', { username: 'worker_user', password: 'wrong-password' });
  assert.equal(response.status, 401);
});

test('workerd: shared D1 circuits, telemetry isolation and global rate limits', { timeout: 20000 }, async t => {
  let calls=0;
  const mf=runtime(t,async()=>{calls++;return new Response('unavailable',{status:503});},{ACCOUNTS_DB:{type:'d1',name:'ops-runtime-test'}}, 1735689600000);
  const db=await mf.getD1Database('ACCOUNTS_DB');
  const sql=await readFile(new URL('../migrations/0003_operations.sql',import.meta.url),'utf8');
  await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  for(let i=0;i<3;i++) assert.equal((await mf.dispatchFetch(`https://player.example/api/v1/music/search?source=gd&keyword=fixture${i}`)).status,503);
  const held=await mf.dispatchFetch('https://player.example/api/v1/music/search?source=gd&keyword=held');
  assert.equal(held.status,503);assert.equal((await held.json()).error.code,'source_cooling');assert.equal(calls,3);
  assert.equal((await db.prepare('SELECT SUM(requests) n FROM cplayer_source_metrics').first()).n,3);
  const emit=()=>mf.dispatchFetch('https://player.example/api/telemetry',{method:'POST',headers:{origin:'https://player.example','content-type':'application/json','cf-connecting-ip':'127.0.0.8'},body:JSON.stringify({kind:'source_switched',source:'gd'})});
  for(let i=0;i<30;i++)assert.equal((await emit()).status,202);
  const limited=await emit();assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  assert.equal((await db.prepare("SELECT count FROM cplayer_events WHERE kind='client'").first()).count,30);
  const publicConfig=await mf.dispatchFetch('https://player.example/api/runtime');assert.equal(publicConfig.status,200);assert.doesNotMatch(await publicConfig.text(),/secret|cookie|sensitiveWords/);
});

test('workerd: bootstrap admin must rotate password and old D1 sessions are revoked', { timeout: 20000 }, async t => {
  const userId = crypto.randomUUID(), now = Date.now();
  const mf = runtime(t, upstream, {
    ACCOUNTS_DB: { type: 'd1', name: 'bootstrap-admin-test' },
    AUTH_URL: { type: 'json', value: 'https://player.example' },
    AUTH_SECRET: { type: 'json', value: 'workerd-admin-secret-thirty-two-characters' },
    OPS_ADMIN_USER_IDS: { type: 'json', value: userId },
  });
  const db = await mf.getD1Database('ACCOUNTS_DB');
  for (const file of ['0001_accounts.sql', '0002_username.sql', '0003_operations.sql', '0004_admin_bootstrap.sql', '0005_personal_library.sql']) {
    const sql = await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8');
    await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  await db.batch([
    db.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,?,?,?,?)').bind(userId, 'admin', 'u-admin@password.users.invalid', 0, now, now, 'admin'),
    db.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), userId, 'credential', userId, await hashPassword('admin'), now, now),
    db.prepare('INSERT INTO cplayer_admin_bootstrap(userId) VALUES(?)').bind(userId),
  ]);
  const call = (path, body, cookie) => mf.dispatchFetch('https://player.example' + path, {
    method: body ? 'POST' : 'GET', headers: { origin: 'https://player.example', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const login = await call('/api/auth/sign-in/username', { username: 'admin', password: 'admin' });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const blocked = await call('/api/admin/dashboard', null, cookie);
  assert.equal(blocked.status, 403); assert.equal((await blocked.json()).error.code, 'password_change_required');
  const password = 'runtime-new-admin-password-123';
  const changed = await call('/api/admin/password', { currentPassword: 'admin', newPassword: password, confirmPassword: password }, cookie);
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await call('/api/admin/dashboard', null, cookie)).status, 401);
  assert.equal((await call('/api/auth/sign-in/username', { username: 'admin', password: 'admin' })).status, 401);
  const relogin = await call('/api/auth/sign-in/username', { username: 'admin', password });
  assert.equal(relogin.status, 200, await relogin.clone().text());
  const freshCookie = relogin.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.equal((await call('/api/admin/dashboard', null, freshCookie)).status, 200);
  assert.equal((await db.prepare('SELECT mustChange FROM cplayer_admin_bootstrap WHERE userId=?').bind(userId).first()).mustChange, 0);
});

test('workerd: personal library D1 collaboration preserves private access and CAS updates', {timeout:20000}, async t=>{
 const mf=runtime(t,upstream,{ACCOUNTS_DB:{type:'d1',name:'personal-library-runtime'},AUTH_URL:{type:'json',value:'https://player.example'},AUTH_SECRET:{type:'json',value:'workerd-library-secret-thirty-two-characters'}});
 const db=await mf.getD1Database('ACCOUNTS_DB');
 for(const file of ['0001_accounts.sql','0002_username.sql','0003_operations.sql','0004_admin_bootstrap.sql','0005_personal_library.sql']){
  const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 }
 const call=(path,body,cookie,method=body?'POST':'GET')=>mf.dispatchFetch('https://player.example'+path,{method,headers:{origin:'https://player.example','content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 async function signup(username){const r=await call('/api/auth/sign-up/username',{username,password:'runtime-library-password'});assert.equal(r.status,200,await r.clone().text());return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
 const owner=await signup('runtime_owner'),editor=await signup('runtime_editor');
 const created=await call('/api/library/playlists',{name:'共享歌单',songs:[{id:'1',name:'歌曲',provider:'gd'}]},owner);assert.equal(created.status,201,await created.clone().text());
 const id=(await created.json()).id,path='/api/library/playlists/'+id;
 assert.equal((await call('/api/library/public/'+id)).status,404);
 assert.equal((await call(path+'/members',{username:'runtime_editor',role:'editor'},owner)).status,200);
 assert.equal((await call(path,null,editor)).status,404);
 assert.equal((await call(path+'/invitation',{accept:true},editor)).status,200);
 const state=await (await call(path,null,editor)).json();
 assert.equal((await call(path,{...state,visibility:undefined,name:'更新后的歌单'},editor,'PUT')).status,200);
 assert.equal((await call(path,{...state,visibility:undefined},owner,'PUT')).status,409);
 const current=await (await call(path,null,owner)).json();assert.equal((await call(path,{...current,visibility:'public'},owner,'PUT')).status,200);
 const publicResult=await call('/api/library/public/'+id);assert.equal(publicResult.status,200);assert.equal((await publicResult.json()).name,'更新后的歌单');
});

test('workerd: Xinghai concurrent requests keep tokens local and stream Range without credential leakage',async t=>{
  const tokens=new Set(),devices=new Set();let count=0;
  const mf=runtime(t,async request=>{
    const url=new URL(request.url);assert.equal(request.headers.get('cookie'),null);
    if(url.hostname==='yy.zddyr.top') {
      if(url.pathname.endsWith('token.php')) {
        const device=url.searchParams.get('device_id');assert.ok(device);devices.add(device);
        const token=`runtime-token-${++count}`;tokens.add(token);
        await new Promise(r=>setTimeout(r,50));return Response.json({code:0,data:{token}});
      }
      assert.ok(tokens.has(request.headers.get('x-token')));assert.equal(request.headers.get('x-license'),'runtime-license');
      return Response.json({code:200,url:'http://m801.music.126.net/runtime.mp3',br:128000});
    }
    assert.equal(url.hostname,'m801.music.126.net');assert.equal(url.protocol,'https:');assert.equal(request.headers.get('x-token'),null);assert.equal(request.headers.get('x-license'),null);
    const range=request.headers.get('range');assert.ok(['bytes=0-63','bytes=0-3'].includes(range));
    return new Response(range==='bytes=0-63'?'ID3 audio fixture for prefix':'ID3!',{status:206,headers:{'content-type':'audio/mpeg','content-range':range==='bytes=0-3'?'bytes 0-3/100':'bytes 0-27/100'}});
  },{XINGHAI_LICENSE:{type:'json',value:'runtime-license'}});
  const url='https://player.example/api/v1/music/song?source=xinghai-netease&id=259138&level=hires';
  const replies=await Promise.all([1,2].map(()=>mf.dispatchFetch(url)));
  for(const reply of replies){assert.equal(reply.status,200);const body=await reply.text();assert.doesNotMatch(body,/runtime-token|runtime-license/);assert.equal(JSON.parse(body).data.level,'standard');}
  assert.equal(devices.size,2);
  const audio=await mf.dispatchFetch(url.replace('/song?','/audio?'),{headers:{range:'bytes=0-3'}});assert.equal(audio.status,206);assert.equal(audio.headers.get('content-range'),'bytes 0-3/100');assert.equal(await audio.text(),'ID3!');assert.equal(count,3);
});
