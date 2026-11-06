import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { fetchChartPayload } from '../js/charts-page.js';
import { fetchArtistsPayload } from '../js/music-explore.js';
import { HttpStatusError, requestErrorMessage } from '../js/http.js?v=37';

for (const status of [400, 401, 402, 403, 404, 429, 503]) {
  test(`preserves ChKSz ${status} and its explanation without retrying or revealing credentials`, async () => {
    let calls = 0;
    const key = 'chksz_test_fixture_only';
    const env = { CHKSZ_API_KEY: key, MUSIC_FETCH: async (_url, options) => {
      ++calls;
      assert.equal(options.redirect, 'error');
      return Response.json({ msg: `接口错误 ${status} ${key}` }, {
        status, headers: { 'retry-after': '42', 'x-quota-free-remaining': '0', 'x-quota-paid-remaining': '0' },
      });
    } };
    for (const path of ['/api/v1/music/search?keyword=test', '/api/v1/charts', '/api/v1/artists']) {
      const before = calls;
      const response = await worker.fetch(new Request(`https://player.example${path}`), env);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('retry-after'), '42');
      assert.equal(response.headers.get('x-quota-free-remaining'), '0');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const payload = await response.json();
      assert.equal(payload.error.message, `接口错误 ${status} [已隐藏密钥]`);
      assert.equal(calls, before + 1);
      const message = requestErrorMessage(new HttpStatusError(status, payload, '42'));
      assert.match(message, new RegExp(`接口错误 ${status}`));
      if (status === 429) assert.match(message, /42 秒/);
    }
  });
}

test('successful responses carry quota headers and redact accidental upstream key echoes', async () => {
  const response = await worker.fetch(new Request('https://player.example/api/v1/music/search?keyword=test'), {
    CHKSZ_API_KEY: 'chksz_test_fixture_only',
    MUSIC_FETCH: async () => Response.json({ data: [], debug: 'chksz_test_fixture_only' }, {
      headers: { 'x-quota-free-remaining': '37', 'x-quota-paid-remaining': '120', 'x-ratelimit-limit': '20' },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-quota-free-remaining'), '37');
  assert.doesNotMatch(await response.text(), /chksz_test_fixture_only/);
});

for (const status of [401, 402, 403, 429, 503]) {
  test(`charts and artists do not make fallback requests after ${status}`, async () => {
    for (const load of [
      fetchImpl => fetchChartPayload(fetchImpl, 'hot'),
      fetchImpl => fetchArtistsPayload(fetchImpl, 'trending', { locationProtocol: 'http:' }),
    ]) {
      let calls = 0;
      await assert.rejects(load(async () => {
        ++calls;
        return Response.json({ error: { message: '服务返回的原因' } }, { status });
      }), /服务返回的原因/);
      assert.equal(calls, 1);
    }
  });
}
