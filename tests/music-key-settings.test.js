import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startServer } from '../server.js';
import worker from '../sites/worker.js';

// These keys are inert fixtures. All provider requests use a local stub.
const FIRST_KEY = 'chksz_test_fixture_only';
const SECOND_KEY = 'chksz_replacement_fixture_only';

// Node fetch rewrites Host. Use raw HTTP to exercise DNS-rebinding defenses.
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

async function setup(t, env = {}) {
  const calls = [];
  const server = await startServer({ port: 0, host: '127.0.0.1', env: {
    MUSIC_FETCH: async url => {
      calls.push(new URL(url));
      return Response.json({ data: { songs: [{ id: 1, name: '测试歌曲' }] } });
    },
    ...env,
  } });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const settings = (method = 'GET', key, options = {}) => request(`${origin}/api/v1/settings/music-key`, {
    method,
    headers: {
      origin,
      'x-cplayer-settings': '1',
      'content-type': 'application/json',
      ...options.headers,
    },
    ...(method === 'POST' ? { body: options.body ?? JSON.stringify({ key }) } : {}),
  });
  return { origin, settings, calls };
}

test('local UI credentials enable the existing proxy, replace and clear without disclosing the key', async t => {
  const originalEnvKey = process.env.CHKSZ_API_KEY;
  const { origin, settings, calls } = await setup(t);
  assert.deepEqual(await (await settings()).json(), { configured: false, editable: true, source: 'none' });
  for (const key of [FIRST_KEY, SECOND_KEY]) {
    const saved = await settings('POST', key);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get('cache-control'), 'no-store');
    const body = await saved.text();
    assert.doesNotMatch(body, /chksz_/);
    assert.deepEqual(JSON.parse(body), { configured: true, editable: true, source: 'session' });
    assert.equal((await (await settings()).json()).configured, true);
    const response = await fetch(`${origin}/api/v1/music/search?keyword=test`, { headers: { origin } });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).origin, 'https://api.chksz.com');
    assert.equal(calls.at(-1).searchParams.get('apikey'), key);
  }
  assert.equal(calls.length, 2, 'saving and checking configuration must not spend API quota');
  assert.equal((await (await settings('DELETE')).json()).configured, false);
  assert.equal((await fetch(`${origin}/api/v1/music/search?keyword=test`)).status, 503);
  assert.equal(calls.length, 2);
  assert.equal(process.env.CHKSZ_API_KEY, originalEnvKey);
  const secondServer = await setup(t);
  assert.equal((await (await secondServer.settings()).json()).configured, false);
});

test('bad input and cross-origin requests cannot replace a configured key or spend quota', async t => {
  const { origin, settings, calls } = await setup(t);
  await settings('POST', FIRST_KEY);
  for (const key of ['', 'invalid', 'chksz_has spaces', 'chksz_' + 'a'.repeat(513), null]) {
    assert.equal((await settings('POST', key)).status, 400);
  }
  assert.equal((await settings('POST', null, { body: '{broken' })).status, 400);
  assert.equal((await settings('POST', null, { body: 'x'.repeat(3000) })).status, 413);
  assert.equal((await settings('POST', SECOND_KEY, { headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const headers of [
    { origin: 'https://untrusted.example' },
    { origin: 'null' },
    { origin: '' },
    { 'x-cplayer-settings': '' },
    { 'sec-fetch-site': 'cross-site' },
    { host: 'untrusted.example' },
  ]) {
    assert.equal((await settings('POST', SECOND_KEY, { headers })).status, 403);
    assert.equal((await settings('DELETE', null, { headers })).status, 403);
  }
  for (const headers of [{ origin: 'https://untrusted.example' }, { host: 'untrusted.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await request(`${origin}/api/v1/music/search?keyword=test`, { headers })).status, 403);
  }
  assert.equal(calls.length, 0);
  await fetch(`${origin}/api/v1/music/search?keyword=test`);
  assert.equal(calls[0].searchParams.get('apikey'), FIRST_KEY);
});

test('startup environment stays untouched and the public worker exposes only read-only status', async t => {
  const env = { CHKSZ_API_KEY: FIRST_KEY };
  const { settings } = await setup(t, env);
  assert.equal((await (await settings()).json()).source, 'environment');
  await settings('POST', SECOND_KEY);
  await settings('DELETE');
  assert.equal(env.CHKSZ_API_KEY, FIRST_KEY);
  const publicUrl = 'https://player.example/api/v1/settings/music-key';
  const response = await worker.fetch(new Request(publicUrl), env);
  assert.deepEqual(await response.json(), { configured: true, editable: false, source: 'environment' });
  for (const method of ['POST', 'DELETE']) {
    assert.equal((await worker.fetch(new Request(publicUrl, { method }), env)).status, 405);
  }
});
