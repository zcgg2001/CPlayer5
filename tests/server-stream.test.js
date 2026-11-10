import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCPlayerServer } from '../server.js';

test('Node uses the connection IP unless a trusted proxy is explicitly configured', async t => {
  for (const trustProxy of [false, true]) {
    const server = createCPlayerServer({ env: {}, trustProxy, workerImpl: {
      fetch: request => Response.json({ ip: request.headers.get('cf-connecting-ip') }),
    } });
    t.after(() => { server.closeAllConnections(); server.close(); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const forged = await (await fetch(origin, { headers: { 'cf-connecting-ip': '192.0.2.44' } })).json();
    assert.equal(forged.ip, trustProxy ? '192.0.2.44' : '127.0.0.1');
    assert.equal((await (await fetch(origin)).json()).ip, '127.0.0.1');
  }
});

test('the local server forwards chunks before the upstream body finishes and cancels on disconnect', async t => {
  let producer;
  let clientSignal;
  let cancelled = false;
  const server = createCPlayerServer({ env: {}, workerImpl: {
    fetch(request) {
      clientSignal = request.signal;
      return new Response(new ReadableStream({
        start(controller) { producer = controller; controller.enqueue(new TextEncoder().encode('first')); },
        cancel() { cancelled = true; },
      }), { headers: { 'content-type': 'audio/mp4' } });
    },
  } });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/audio`, { signal: controller.signal });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'first');
  assert.equal(first.done, false);
  const aborted = new Promise(resolve => clientSignal.addEventListener('abort', resolve, { once: true }));
  controller.abort();
  await reader.cancel().catch(() => {});
  await aborted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.ok(producer);
});
