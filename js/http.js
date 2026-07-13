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
  constructor(status) {
    super(`HTTP request failed with status ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
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

    if (!response.ok) throw new HttpStatusError(response.status);

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
    if (error.status === 404) return '请求的内容不存在';
    if (error.status === 401 || error.status === 403) return '当前请求无权访问';
    if (error.status >= 500) return '服务暂时不可用，请稍后重试';
    return '请求未成功，请检查输入';
  }
  return '请求失败，请稍后重试';
}
