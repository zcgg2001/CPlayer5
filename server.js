import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import worker from './sites/worker.js';
import { createResponseCache } from './sites/response-cache.js';
import { maintainOperations } from './sites/reliability.js';
import { createMusicKeySettings, MUSIC_KEY_PATH } from './local-music-key.js';
import { localAccountsEnv } from './local-accounts.js';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolve(process.env.CPLAYER_STATIC_DIR || `${PROJECT_ROOT}/dist/static`);
const DEFAULT_HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT || 8787);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.otf', 'font/otf'],
  ['.ttf', 'font/ttf'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function safeStaticPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return { error: 400, message: 'Invalid URL path' };
  }

  if (decodedPath.includes('\0')) return { error: 400, message: 'Invalid URL path' };

  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const candidate = resolve(STATIC_ROOT, `.${requestedPath}`);
  const relativePath = relative(STATIC_ROOT, candidate);
  if (
    relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    return { error: 403, message: 'Forbidden' };
  }

  return { path: candidate, requestedPath };
}

async function fetchStaticAsset(request) {
  const { pathname } = new URL(request.url);
  const safePath = safeStaticPath(pathname);
  if (safePath.error) return new Response(safePath.message, { status: safePath.error });

  let fileInfo;
  try {
    fileInfo = await stat(safePath.path);
    if (!fileInfo.isFile()) return new Response('Not Found', { status: 404 });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return new Response('Not Found', { status: 404 });
    }
    throw error;
  }

  const headers = new Headers({
    'cache-control': safePath.requestedPath.endsWith('.html') || safePath.requestedPath === '/sw.js'
      ? 'no-cache'
      : 'public, max-age=3600',
    'content-length': String(fileInfo.size),
    'content-type': MIME_TYPES.get(extname(safePath.path).toLowerCase()) || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });

  return new Response(
    request.method === 'HEAD' ? null : await readFile(safePath.path),
    { status: 200, headers },
  );
}

function requestHeaders(incoming, trustProxy) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  // Direct Node clients cannot select their own authentication rate-limit bucket.
  // Only opt in to forwarded client IPs behind a proxy that replaces this header.
  if (!trustProxy || !headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', incoming.socket.remoteAddress || '127.0.0.1');
  return headers;
}

function toFetchRequest(incoming, signal, trustProxy) {
  const forwardedProto = incoming.headers['x-forwarded-proto'];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || 'http';
  const host = incoming.headers.host || `${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const url = new URL(incoming.url || '/', `${protocol}://${host}`);
  return new Request(url, {
    method: incoming.method || 'GET',
    headers: requestHeaders(incoming, trustProxy),
    signal,
    ...(incoming.method !== 'GET' && incoming.method !== 'HEAD' && url.pathname !== MUSIC_KEY_PATH ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
  });
}

function runtimeEnv() {
  return {
    ASSETS: { fetch: fetchStaticAsset },
    CHKSZ_API_KEY: process.env.CHKSZ_API_KEY || '',
    ...localAccountsEnv(),
  };
}

export function createCPlayerServer({ env = runtimeEnv(), workerImpl = worker, trustProxy = process.env.AUTH_TRUST_PROXY === '1' } = {}) {
  // Each running server has its own key; never mutate process.env or write it to disk.
  env = { ...env, OPS_CACHE: env.OPS_CACHE || createResponseCache() };
  const musicKeySettings = createMusicKeySettings(env);
  let nextCleanup = 0;
  return createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.once('close', () => controller.abort());
    try {
      if (Date.now() >= nextCleanup) { nextCleanup = Date.now() + 900000; await maintainOperations(env); }
      const request = toFetchRequest(incoming, controller.signal, trustProxy);
      const url = new URL(request.url);
      let response;
      if (url.pathname === MUSIC_KEY_PATH) {
        response = await musicKeySettings.handle(incoming, url);
      } else {
        response = (url.pathname.startsWith('/api/') && musicKeySettings.guard(incoming, url))
          || await workerImpl.fetch(request, env);
      }
      const responseHeaders = {};
      for (const [name, value] of response.headers) responseHeaders[name] = value;
      if (response.headers.getSetCookie().length) responseHeaders['set-cookie'] = response.headers.getSetCookie();
      outgoing.writeHead(response.status, response.statusText, responseHeaders);
      if (incoming.method === 'HEAD' || !response.body) {
        await response.body?.cancel();
        outgoing.end();
        return;
      }
      await pipeline(Readable.fromWeb(response.body), outgoing);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('[cplayer] request failed', error);
      if (outgoing.headersSent) {
        outgoing.destroy();
        return;
      }
      outgoing.writeHead(500, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      outgoing.end(JSON.stringify({
        error: { code: 'internal_error', message: '服务器暂时不可用' },
      }));
    }
  });
}

export function startServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, ...options } = {}) {
  const server = createCPlayerServer(options);
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const server = await startServer();
    const address = server.address();
    const displayHost = typeof address === 'object' && address ? address.address : DEFAULT_HOST;
    const displayPort = typeof address === 'object' && address ? address.port : DEFAULT_PORT;
    console.log(`CPlayer5 server listening on http://${displayHost}:${displayPort}`);

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(() => process.exit(0)));
    }
  } catch (error) {
    console.error('[cplayer] unable to start server:', error?.message || error);
    process.exitCode = 1;
  }
}
