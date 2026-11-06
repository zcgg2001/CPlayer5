export class RequestTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'RequestTimeoutError';
  }
}

export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled');
    this.name = 'RequestCancelledError';
  }
}

export class HttpStatusError extends Error {
  constructor(status, payload = null, retryAfter = null) {
    super(`HTTP request failed with status ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
    this.payload = payload;
    this.code = payload?.error?.code || '';
    this.retryAfter = retryAfter;
  }
}

export class ResponseFormatError extends Error {
  constructor() {
    super('Response was not valid JSON');
    this.name = 'ResponseFormatError';
  }
}

export class NetworkRequestError extends Error {
  constructor(cause) {
    super('Network request failed', { cause });
    this.name = 'NetworkRequestError';
  }
}

export async function requestJson(
  url,
  {
    fetchImpl = globalThis.fetch,
    method = 'GET',
    headers,
    body,
    signal,
    timeoutMs = 10_000,
  } = {},
) {
  if (signal?.aborted) throw new RequestCancelledError();

  const controller = new AbortController();
  let timedOut = false;
  const handleExternalAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', handleExternalAbort, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // A non-JSON upstream error still maps to a stable local message.
      }
      throw new HttpStatusError(response.status, payload, response.headers?.get('retry-after') || null);
    }

    try {
      return await response.json();
    } catch {
      throw new ResponseFormatError();
    }
  } catch (error) {
    if (error instanceof HttpStatusError || error instanceof ResponseFormatError) {
      throw error;
    }
    if (timedOut) throw new RequestTimeoutError();
    if (signal?.aborted) throw new RequestCancelledError();
    throw new NetworkRequestError(error);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleExternalAbort);
  }
}

export function requestErrorMessage(error) {
  if (error instanceof RequestTimeoutError) return '请求超时，请稍后重试';
  if (error instanceof ResponseFormatError) return '服务返回了无法识别的数据';
  if (error instanceof NetworkRequestError) return '网络连接失败，请检查网络';
  if (error instanceof HttpStatusError) {
    if (['chksz_error', 'gd_error', 'music_key_settings'].includes(error.code) && typeof error.payload?.error?.message === 'string') {
      const seconds = Number(error.retryAfter);
      const wait = error.status === 429 && seconds > 0 && Number.isFinite(seconds)
        ? `（请至少等待 ${Math.ceil(seconds)} 秒）` : '';
      return error.payload.error.message + wait;
    }
    const codeMessages = {
      api_key_missing: '音乐服务尚未配置，请联系站点管理员',
      audio_unavailable: '音频连接失败，请重新选择内容',
      download_denied: '该内容未开放下载',
      invalid_request: '请求参数无效，请检查输入',
      invalid_source: '当前音乐源不可用，请重新选择',
      provider_failed: '上游音乐服务暂时不可用，请稍后重试',
      provider_rate_limited: '请求过于频繁，请稍后重试',
      provider_timeout: '上游音乐服务响应超时，请稍后重试',
      provider_unavailable: '上游音乐服务暂时不可用，请稍后重试',
      subtitle_login_required: '此内容的字幕需要登录后才能读取',
      subtitle_restricted: '此内容的字幕暂不开放',
    };
    if (codeMessages[error.code]) return codeMessages[error.code];
    if (error.status === 429) return '请求过于频繁，请稍后重试';
    if (error.status === 404) return '请求的内容不存在';
    if (error.status === 401 || error.status === 403) return '当前请求无权访问';
    if (error.status >= 500) return '服务暂时不可用，请稍后重试';
    return '请求未成功，请检查输入';
  }
  return '请求失败，请稍后重试';
}
