import { handleMusicMetadata } from './music-metadata.js';
import {
  handleArtistsRequest,
  handleChartsRequest,
  handleVideosRequest,
} from './music-content.js';
import { handleBilibiliRequest } from './bilibili.js';
import { handleGdRequest } from './gd.js';
import { handleMusicChannelRequest, isMusicChannel } from './music-channels.js';

import { ChkszError, chkszErrorResponse, requestChksz } from './chksz.js';
const MUSIC_PROXY_ROUTES = new Map([
  ['/api/v1/music/search', Object.freeze({ endpoint: '163_search', required: ['keyword'], optional: ['limit', 'offset'] })],
  ['/api/v1/music/playlist', Object.freeze({ endpoint: '163_playlist', required: ['id'], optional: [] })],
  ['/api/v1/music/song', Object.freeze({ endpoint: '163_music', required: ['id'], optional: ['level'] })],
  ['/api/v1/music/lyric', Object.freeze({ endpoint: '163_lyric', required: ['id'], optional: [] })],
]);
const MUSIC_QUALITY_LEVELS = new Set(['standard', 'exhigh', 'lossless', 'hires', 'jymaster']);

const HTML_ROUTES = new Map([
  ['/', '/index.html'],
  ['/index.html', '/index.html'],
  ['/playlist-downloader', '/playlist-downloader.html'],
  ['/offline', '/offline.html'],
]);

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

async function withAbsoluteSiteMetadata(response, request) {
  if (!response.ok) return response;

  const origin = new URL(request.url).origin;
  const headers = new Headers(response.headers);
  // The HTML body is rewritten below, so any upstream length is stale.
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, max-age=0, must-revalidate');
  headers.set('cdn-cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  const html = request.method === 'HEAD'
    ? null
    : (await response.text()).replaceAll('__SITE_ORIGIN__', origin);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function musicProxyError(request, status, code, message) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    error: { code, message },
  }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function validatedMusicParams(requestUrl, route) {
  const params = new URLSearchParams();
  for (const name of route.required) {
    const value = requestUrl.searchParams.get(name)?.trim() || '';
    if (!value) return { error: `缺少参数：${name}` };
    params.set(name, value);
  }
  for (const name of route.optional) {
    const value = requestUrl.searchParams.get(name)?.trim() || '';
    if (value) params.set(name, value);
  }

  const id = params.get('id');
  if (id && !/^\d{1,32}$/.test(id)) return { error: '歌曲或歌单 ID 无效' };
  const keyword = params.get('keyword');
  if (keyword && keyword.length > 120) return { error: '搜索关键词过长' };
  const limit = params.get('limit');
  if (limit && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) {
    return { error: 'limit 必须是 1 到 100 的整数' };
  }
  const offset = params.get('offset');
  if (offset && (!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)))) {
    return { error: 'offset 必须是非负整数' };
  }
  const level = params.get('level');
  if (level && !MUSIC_QUALITY_LEVELS.has(level)) return { error: '不支持的音质参数' };
  return { params };
}

async function handleMusicProxyRequest(request, env, requestUrl, route) {
  const apiKey = String(env.CHKSZ_API_KEY || '').trim();
  if (!apiKey) {
    return musicProxyError(request, 503, 'api_key_missing', '音乐服务尚未配置，请联系站点管理员');
  }

  const validation = validatedMusicParams(requestUrl, route);
  if (validation.error) {
    return musicProxyError(request, 400, 'invalid_request', validation.error);
  }

  const fetchImpl = typeof env.MUSIC_FETCH === 'function' ? env.MUSIC_FETCH : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return musicProxyError(request, 503, 'provider_unavailable', '音乐服务暂时不可用');
  }

  try {
    const { payload, headers } = await requestChksz(route.endpoint, validation.params, {
      apiKey, fetchImpl, signal: request.signal,
    });
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
      headers: {
        ...headers,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ChkszError) return chkszErrorResponse(error, request.method);
    return musicProxyError(request, 502, 'provider_unavailable', '音乐接口暂时不可用，请稍后重试');
  }
}

const worker = {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/v1/music/metadata') return handleMusicMetadata(request,env,url);
    if (isMusicChannel(url.searchParams.get('source')) && url.pathname.startsWith('/api/v1/music/')) {
      return handleMusicChannelRequest(request, env, url);
    }
    if (url.searchParams.get('source') === 'gd' && url.pathname.startsWith('/api/v1/music/')) {
      return handleGdRequest(request, env, url);
    }
    if (url.pathname === '/api/v1/settings/music-key') {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({
        configured: Boolean(String(env.CHKSZ_API_KEY || '').trim()), editable: false, source: 'environment',
      }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/v1/bilibili/audio' || url.pathname === '/api/v1/bilibili/download') {
      return handleBilibiliRequest(request, env);
    }
    if (url.pathname === '/api/v1/music/discover') {
      return url.searchParams.get('source') === 'bilibili'
        ? handleBilibiliRequest(request, env)
        : musicProxyError(request, 400, 'invalid_source', '不支持的音乐源');
    }
    const musicProxyRoute = MUSIC_PROXY_ROUTES.get(url.pathname);
    if (musicProxyRoute) {
      const source = url.searchParams.get('source')?.trim().toLowerCase() || 'chksz';
      if (source === 'bilibili') return handleBilibiliRequest(request, env);
      if (source !== 'chksz') {
        return musicProxyError(request, 400, 'invalid_source', '不支持的音乐源');
      }
      return handleMusicProxyRequest(request, env, url, musicProxyRoute);
    }
    if (url.pathname === '/api/v1/charts') {
      return handleChartsRequest(request, env);
    }
    if (url.pathname === '/api/v1/artists') {
      return handleArtistsRequest(request, env);
    }
    if (url.pathname === '/api/v1/videos') {
      return handleVideosRequest(request, env);
    }
    if (url.pathname.startsWith('/api/')) {
      return musicProxyError(request, 404, 'not_found', '接口不存在');
    }

    const routeAsset = HTML_ROUTES.get(url.pathname.replace(/\/$/, '') || '/');
    if (routeAsset) {
      const response = await env.ASSETS.fetch(assetRequest(request, routeAsset));
      return routeAsset === '/index.html'
        ? withAbsoluteSiteMetadata(response, request)
        : response;
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const acceptsHtml = /(?:^|,)\s*text\/html\b/i.test(request.headers.get('accept') || '');
    if (acceptsHtml) {
      const fallback = await env.ASSETS.fetch(assetRequest(request, '/index.html'));
      return withAbsoluteSiteMetadata(fallback, request);
    }

    return response;
  },
};

export default worker;
