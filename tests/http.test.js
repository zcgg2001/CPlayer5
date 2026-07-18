import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HttpStatusError,
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
  ResponseFormatError,
  requestErrorMessage,
  requestJson,
} from '../js/http.js';


test('returns parsed JSON for a successful response', async () => {
  const payload = await requestJson('https://api.example/data', {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 200 }),
    }),
  });

  assert.deepEqual(payload, { code: 200 });
});

test('reports non-success HTTP status', async () => {
  await assert.rejects(
    requestJson('https://api.example/data', {
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    }),
    error => error instanceof HttpStatusError && error.status === 503,
  );
});

test('reports invalid JSON responses', async () => {
  await assert.rejects(
    requestJson('https://api.example/data', {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('invalid JSON');
        },
      }),
    }),
    ResponseFormatError,
  );
});

test('reports request timeouts', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  await assert.rejects(
    requestJson('https://api.example/slow', { fetchImpl, timeoutMs: 5 }),
    RequestTimeoutError,
  );
});

test('reports external request cancellation', async () => {
  const controller = new AbortController();
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const request = requestJson('https://api.example/search', {
    fetchImpl,
    signal: controller.signal,
  });

  controller.abort();

  await assert.rejects(request, RequestCancelledError);
});

test('reports low-level network failures', async () => {
  await assert.rejects(
    requestJson('https://api.example/data', {
      fetchImpl: async () => {
        throw new TypeError('network unavailable');
      },
    }),
    NetworkRequestError,
  );
});

test('maps request errors to user-facing Chinese messages', () => {
  assert.equal(requestErrorMessage(new RequestTimeoutError()), '请求超时，请稍后重试');
  assert.equal(requestErrorMessage(new HttpStatusError(503)), '服务暂时不可用，请稍后重试');
  assert.equal(requestErrorMessage(new ResponseFormatError()), '服务返回了无法识别的数据');
  assert.equal(requestErrorMessage(new NetworkRequestError()), '网络连接失败，请检查网络');
  assert.equal(requestErrorMessage(new Error('custom')), '请求失败，请稍后重试');
});
