function runLxWorker() {
  const send = self.postMessage.bind(self);
  const events = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  const requests = new Map();
  let nextRequest = 0;
  let resolveMusic;
  let sources;
  self.onmessage = async ({ data }) => {
    if (data.type === 'http') {
      const callback = requests.get(data.id);
      requests.delete(data.id);
      if (callback) callback(data.error ? new Error('音源网络请求失败') : null, data.response, data.response?.body);
      return;
    }
    try {
      if (data.type === 'init') {
        const { code, cryptoCode } = data;
        const blob = URL.createObjectURL(new Blob([cryptoCode, '\n'], { type: 'text/javascript' }));
        try { importScripts(blob); } finally { URL.revokeObjectURL(blob); }
        const crypto = self.CryptoJS;
        self.lx = {
          EVENT_NAMES: events,
          env: 'mobile',
          version: '2.0.0',
          currentScriptInfo: { rawScript: code },
          on(event, callback) { if (event === events.request) resolveMusic = callback; },
          send(event, value) { if (event === events.inited && value?.status !== false) sources = value?.sources; },
          request(url, options, callback) {
            const id = ++nextRequest;
            requests.set(id, callback);
            send({ type: 'http', id, url, options });
            return () => { requests.delete(id); send({ type: 'cancel', id }); };
          },
          utils: {
            crypto: {
              md5: value => crypto.MD5(value).toString(),
              aesEncrypt(value, mode, key, iv) {
                const word = input => typeof input === 'string' ? crypto.enc.Utf8.parse(input) : crypto.lib.WordArray.create(new Uint8Array(input));
                return crypto.AES.encrypt(word(value), word(key), {
                  mode: mode.endsWith('ecb') ? crypto.mode.ECB : crypto.mode.CBC,
                  iv: iv ? word(iv) : undefined,
                }).ciphertext;
              },
            },
            buffer: { bufToString: (buffer, format) => buffer.toString(format === 'hex' ? crypto.enc.Hex : crypto.enc.Utf8) },
          },
        };
        self.__QINGLIU_CONFIG__ = { allowSameSongFallback: false };
        const script = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        try { importScripts(script); } finally { URL.revokeObjectURL(script); }
        if (typeof resolveMusic !== 'function' || !sources || typeof sources !== 'object') throw new Error();
        send({ type: 'result', value: sources });
      } else if (data.type === 'resolve') {
        const value = await resolveMusic(data.query);
        send({ type: 'result', value: typeof value === 'string' ? value : null });
      }
    } catch {
      send({ type: 'result', error: true });
    }
  };
}

function runLxFrame() {
  const start = ({ source, data, ports }) => {
    if (source !== parent || data.type !== 'zplayer-lx' || !ports[0]) return;
    removeEventListener('message', start);
    const [port] = ports;
    const blob = URL.createObjectURL(new Blob([data.worker], { type: 'text/javascript' }));
    const worker = new Worker(blob);
    worker.onmessage = event => {
      URL.revokeObjectURL(blob);
      port.postMessage(event.data);
    };
    worker.onerror = () => {
      URL.revokeObjectURL(blob);
      port.postMessage({ type: 'result', error: true });
    };
    port.onmessage = event => worker.postMessage(event.data);
    port.postMessage({ type: 'ready' });
  };
  addEventListener('message', start);
}

export function publicLxUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('请输入有效的 HTTPS 链接');
  const url = new URL(value.trim());
  const host = url.hostname.replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !/^(?:[a-z\d-]+\.)+[a-z\d-]+$/.test(host) || /^[\d.]+$/.test(host)
    || /\.(?:local|localhost|internal|lan|test)$/.test(host) || host === globalThis.location?.hostname) {
    throw new Error('仅支持公开的 HTTPS 链接');
  }
  url.hash = '';
  return url;
}

export async function readLxText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  try {
    for (;;) {
      const { value: bytes, done } = await reader.read();
      if (done) return value + decoder.decode();
      size += bytes.byteLength;
      if (size > limit) throw new Error('音源响应过大');
      value += decoder.decode(bytes, { stream: true });
    }
  } finally { void reader.cancel().catch(() => {}); }
}

let nativeRequestId = 0;
export async function lxHttp(url, options, signal) {
  url = publicLxUrl(url).href;
  const method = String(options?.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw new Error('不支持此请求方式');
  const headers = {};
  for (const [key, value] of Object.entries(options?.headers || {})) {
    const name = key.toLowerCase();
    if (['accept', 'content-type', 'referer', 'origin', 'user-agent', 'x-requested-with'].includes(name)
      && typeof value === 'string' && value.length < 512 && !/[\r\n]/.test(value)) headers[name] = value;
  }
  const body = method === 'POST' ? options?.body || '' : '';
  if (typeof body !== 'string' || body.length > 8192) throw new Error('请求内容无效');
  signal.throwIfAborted();
  const bridge = globalThis.ZPlayerLxHttp;
  if (bridge?.postMessage) {
    return new Promise((resolve, reject) => {
      const id = ++nativeRequestId;
      const finish = () => {
        bridge.removeEventListener('message', receive);
        signal.removeEventListener('abort', abort);
      };
      const receive = ({ data }) => {
        let reply;
        try { reply = JSON.parse(data); } catch { return; }
        if (reply.id !== id) return;
        finish();
        if (reply.error) reject(new Error('音源网络请求失败'));
        else resolve(reply.response);
      };
      const abort = () => {
        finish();
        try { bridge.postMessage(JSON.stringify({ cancel: id })); } catch {}
        reject(signal.reason);
      };
      bridge.addEventListener('message', receive);
      signal.addEventListener('abort', abort, { once: true });
      try { bridge.postMessage(JSON.stringify({ id, url, method, headers, body })); }
      catch (error) { finish(); reject(error); }
    });
  }
  delete headers['user-agent'];
  delete headers.referer;
  delete headers.origin;
  const response = await fetch(url, { method, headers, ...(method === 'POST' ? { body } : {}),
    signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  return { statusCode: response.status, body: await readLxText(response, 768 * 1024), headers: Object.fromEntries(response.headers) };
}

let cryptoScript;
export async function openLxSource(code, signal) {
  if (!cryptoScript) {
    cryptoScript = fetch(new URL('./vendor/lx-crypto.js', import.meta.url), { signal: AbortSignal.timeout(4000) })
      .then(response => {
        if (!response.ok) throw new Error('无法加载音源运行环境');
        return readLxText(response, 65536);
      }).catch(error => { cryptoScript = null; throw error; });
  }
  const cryptoCode = await cryptoScript;
  signal.throwIfAborted();
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = '音乐源运行环境';
  frame.sandbox = 'allow-scripts';
  frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:"><script>(${runLxFrame})()</script>`;
  const { port1, port2 } = new MessageChannel();
  const requests = new Map();
  let requestCount = 0;
  let pending;
  const close = () => {
    signal.removeEventListener('abort', close);
    port1.close();
    port2.close();
    frame.remove();
    for (const request of requests.values()) request.abort();
    requests.clear();
    pending?.reject(signal.reason || new Error('音源运行已结束'));
    pending = null;
  };
  const exchange = message => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    pending = { resolve, reject };
    if (message.type !== 'init') port1.postMessage(message);
  });
  port1.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ready') port1.postMessage({ type: 'init', code, cryptoCode });
    else if (data.type === 'result') {
      const current = pending;
      pending = null;
      if (data.error) current?.reject(new Error('LX 音源脚本无法运行或未返回可用资源'));
      else current?.resolve(data.value);
    } else if (data.type === 'cancel') requests.get(data.id)?.abort();
    else if (data.type === 'http') {
      const reply = { type: 'http', id: data.id };
      try {
        if (!pending || requests.has(data.id) || requests.size >= 8 || ++requestCount > 32) throw new Error();
        const request = new AbortController();
        requests.set(data.id, request);
        const timeout = Math.min(3000, Math.max(200, Number(data.options?.timeout) || 3000));
        try {
          reply.response = await lxHttp(data.url, data.options, AbortSignal.any([signal, request.signal, AbortSignal.timeout(timeout)]));
        } finally { requests.delete(data.id); }
      } catch { reply.error = true; }
      port1.postMessage(reply);
    }
  };
  frame.onload = () => frame.contentWindow.postMessage({ type: 'zplayer-lx', worker: `(${runLxWorker})()` }, '*', [port2]);
  signal.addEventListener('abort', close, { once: true });
  const initialized = exchange({ type: 'init' });
  document.body.append(frame);
  try {
    const sources = await initialized;
    if (!['wy', 'tx', 'kw', 'kg'].some(key => sources?.[key]?.actions?.includes('musicUrl') && Array.isArray(sources[key].qualitys))) {
      throw new Error('此脚本没有注册可用的 LX 播放音源');
    }
    return { sources, resolve: query => exchange({ type: 'resolve', query }), close };
  } catch (error) { close(); throw error; }
}
