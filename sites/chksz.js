const RESPONSE_HEADERS = [
  'retry-after', 'x-ratelimit-limit', 'x-quota-free-remaining', 'x-quota-paid-remaining',
];
const STATUS_MESSAGES = {
  400: '请求参数有误，请检查输入',
  401: '密钥无效，请在设置中检查个人 API Key',
  402: '今日免费及付费额度已用尽，请等待次日或兑换额度',
  403: '音乐服务拒绝访问，请检查账户状态',
  404: '歌曲或歌单不存在',
  429: '请求过于频繁，请稍后再试',
  503: '音乐服务暂时不可用，请稍后再试',
};

function redact(value, key) {
  return String(value).split(key).join('[已隐藏密钥]').replace(/chksz_[A-Za-z0-9_-]+/g, '[已隐藏密钥]');
}

export class ChkszError extends Error {
  constructor(status, message, headers = {}, code = 'chksz_error') {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function chkszErrorResponse(error, method = 'GET') {
  return new Response(method === 'HEAD' ? null : JSON.stringify({
    error: { code: error.code, message: error.message },
  }), {
    status: error.status,
    headers: {
      ...error.headers,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

// Each operation makes exactly one request; authentication and quota errors never retry.
export async function requestChksz(endpoint, params, { apiKey, fetchImpl = globalThis.fetch, signal } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new ChkszError(503, '请在设置中填写网易云个人 API Key', {}, 'api_key_missing');
  const url = new URL(`https://api.chksz.com/api/${endpoint}`);
  for (const [name, value] of new URLSearchParams(params)) url.searchParams.set(name, value);
  url.searchParams.set('apikey', key);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), endpoint === '163_playlist' ? 30_000 : 10_000);
  try {
    const response = await fetchImpl(url.href, {
      headers: { accept: 'application/json', 'user-agent': 'CPlayer5/5.3 music-proxy' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const headers = {};
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    let payload;
    try {
      payload = JSON.parse(redact(await response.text(), key));
    } catch {
      if (response.ok) throw new ChkszError(502, '音乐接口返回了无法识别的数据');
    }
    const providerCode = Number(payload?.code);
    const status = !response.ok ? response.status
      : (Number.isInteger(providerCode) && providerCode >= 400 && providerCode <= 599 ? providerCode : 200);
    if (status >= 400) {
      const detail = payload?.msg || payload?.message || payload?.error?.message;
      const message = typeof detail === 'string' && detail.trim()
        ? detail.replace(/[\u0000-\u001f]/g, ' ').slice(0, 500)
        : STATUS_MESSAGES[status] || '音乐接口暂时不可用，请稍后重试';
      throw new ChkszError(status, message, headers);
    }
    return { payload, headers };
  } catch (error) {
    if (error instanceof ChkszError) throw error;
    throw new ChkszError(502, controller.signal.aborted
      ? '音乐接口响应超时，请稍后重试' : '音乐接口连接失败，请稍后重试');
  } finally {
    clearTimeout(timeoutId);
  }
}
