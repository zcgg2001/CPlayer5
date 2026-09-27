import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCPlayerServer } from '../server.js';

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
