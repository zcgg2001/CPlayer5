import { cleanProviderTitle } from './music-content.js';

const API_ORIGIN = 'https://api.bilibili.com';
const REFERER = 'https://www.bilibili.com/';
const HEADERS = {
  accept: 'application/json',
  referer: REFERER,
  'user-agent': 'Mozilla/5.0 (compatible; CPlayer5/5.3)',
};
const CATEGORIES = new Map([
  ['all', null], ['original', '原创音乐'], ['cover', '翻唱'],
  ['live', '音乐现场'], ['instrumental', '演奏'],
]);

class BilibiliError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function invalid(message) {
  return new BilibiliError(400, 'invalid_request', message);
}

export function parseBilibiliId(value) {
  const input = String(value || '').trim();
  const key = /^(?:bili:)?(BV[0-9A-Za-z]{10})(?::([1-9]\d{0,3}))?$/.exec(input);
  if (key) return { bvid: key[1], page: Number(key[2] || 1) };
  try {
    const url = new URL(input);
    const video = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
    const page = url.searchParams.get('p') || '1';
    if (!['https:', 'http:'].includes(url.protocol)
      || !['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'].includes(url.hostname)
      || url.username || url.password || url.port || !video || !/^[1-9]\d{0,3}$/.test(page)) return null;
    return { bvid: video[1], page: Number(page) };
  } catch {
    return null;
  }
}

function mediaUrl(value, hosts) {
  try {
    const url = new URL(value, REFERER);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function safeBilibiliAudioUrl(value) {
  return mediaUrl(value, ['bilivideo.com', 'bilivideo.cn']);
}

export function safeBilibiliSubtitleUrl(value) {
  const safe = mediaUrl(value, ['hdslb.com']);
  if (!safe) return '';
  const url = new URL(safe);
  return /^\/bfs\/subtitle\/[A-Za-z0-9_-]+\.json$/.test(url.pathname) ? safe : '';
}

export function subtitleBodyToLrc(payload) {
  if (!Array.isArray(payload?.body)) throw new BilibiliError(502, 'invalid_subtitle', '字幕格式无法识别');
  if (payload.body.length > 10000) throw new BilibiliError(502, 'subtitle_too_large', '字幕内容过大');
  const lines = payload.body.map(line => ({
    start: typeof line?.from === 'number' ? line.from : NaN,
    end: typeof line?.to === 'number' ? line.to : NaN,
    text: typeof line?.content === 'string' ? line.content.replace(/[\r\n\u0000-\u001F]+/g, ' ').trim() : '',
  })).filter(line => Number.isFinite(line.start) && Number.isFinite(line.end)
    && line.start >= 0 && line.start < 60_000 && line.end > line.start && line.text && line.text.length <= 2000)
    .sort((a, b) => a.start - b.start);
  return lines.map(line => {
    const milliseconds = Math.floor(line.start * 1000);
    const minutes = String(Math.floor(milliseconds / 60_000)).padStart(2, '0');
    const seconds = String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0');
    const fraction = String(milliseconds % 1000).padStart(3, '0');
    return `[${minutes}:${seconds}.${fraction}]${line.text}`;
  }).join('\n');
}

export function bilibiliDownloadDisposition(name, id) {
  const title = String(name || 'Bilibili').replace(/[\\/:*?"<>|\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120).toWellFormed() || 'Bilibili';
  const parsed = parseBilibiliId(id);
  const fallback = parsed ? `${parsed.bvid}-P${parsed.page}` : 'bilibili-audio';
  const encoded = encodeURIComponent(`${title}.m4a`).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}.m4a"; filename*=UTF-8''${encoded}`;
}

async function readSubtitleJson(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new BilibiliError(502, 'subtitle_unavailable', '字幕文件暂时无法读取');
  }
  const maxBytes = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new BilibiliError(502, 'subtitle_too_large', '字幕内容过大');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new BilibiliError(502, 'invalid_subtitle', '字幕内容为空');
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new BilibiliError(502, 'subtitle_too_large', '字幕内容过大');
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function track(item, page = 1) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(item?.bvid || '')) return null;
  const id = `bili:${item.bvid}:${page}`;
  return {
    id, sourceId: id, bvid: item.bvid, page,
    name: cleanProviderTitle(item.title) || '未命名视频',
    artist: cleanProviderTitle(item.owner?.name || item.author) || '未知 UP 主',
    album: 'Bilibili',
    cover: mediaUrl(item.pic, ['hdslb.com']),
    provider: 'bilibili', source: 'Bilibili',
    externalUrl: `https://www.bilibili.com/video/${item.bvid}/?p=${page}`,
  };
}

function normalizeList(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map(item => track(item)).filter(item => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function createBilibiliClient({ fetchImpl = globalThis.fetch, now = Date.now, intervalMs = 350 } = {}) {
  const cache = new Map();
  const subtitleCache = new Map();
  let nextRequestAt = 0;
  let blockedUntil = 0;

  async function json(path, params, ttl = 60_000) {
    const url = new URL(path, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const key = url.href;
    const existing = cache.get(key);
    if (existing && existing.expires > now()) return existing.data;
    if (blockedUntil > now()) throw new BilibiliError(429, 'provider_rate_limited', 'Bilibili 请求频繁，请稍后重试');
    const wait = Math.max(0, nextRequestAt - now());
    if (wait > 5000) throw new BilibiliError(429, 'provider_busy', 'Bilibili 请求排队中，请稍后重试');
    nextRequestAt = now() + wait + intervalMs;
    const data = await (async () => {
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      if (blockedUntil > now()) throw new BilibiliError(429, 'provider_rate_limited', 'Bilibili 请求频繁，请稍后重试');
      const response = await fetchImpl(url.href, { headers: HEADERS, signal: AbortSignal.timeout(8000), redirect: 'manual' });
      if (response.status === 429 || response.status === 412) {
        blockedUntil = now() + 30_000;
        throw new BilibiliError(429, 'provider_rate_limited', 'Bilibili 暂时限制了请求，请稍后重试');
      }
      if (!response.ok) throw new BilibiliError(502, 'provider_unavailable', 'Bilibili 服务暂时不可用');
      const payload = await response.json();
      if ([-412, -352].includes(Number(payload?.code))) {
        blockedUntil = now() + 30_000;
        throw new BilibiliError(429, 'provider_rate_limited', 'Bilibili 暂时限制了请求，请稍后重试');
      }
      if (Number(payload?.code) !== 0) {
        throw new BilibiliError(502, 'provider_rejected', '该内容暂不可用，可能需要在 Bilibili 登录或已被下架');
      }
      return payload.data;
    })();
    // Cache completed data only; live fetch promises belong to one invocation.
    cache.delete(key);
    cache.set(key, { expires: now() + ttl, data });
    while (cache.size > 80) cache.delete(cache.keys().next().value);
    return data;
  }

  async function details(id) {
    const parsed = parseBilibiliId(id);
    if (!parsed) throw invalid('请输入有效 BV 号或 Bilibili 视频链接');
    const info = await json('/x/web-interface/view', { bvid: parsed.bvid }, 300_000);
    const part = info?.pages?.[parsed.page - 1];
    if (!part || !/^[1-9]\d{0,19}$/.test(String(part.cid))) throw invalid('视频分 P 不存在');
    return { info, part, parsed };
  }

  async function search(keyword) {
    if (!keyword || keyword.length > 120) throw invalid('请输入 1 到 120 字的搜索内容');
    const parsed = parseBilibiliId(keyword);
    if (parsed) {
      const { info, part } = await details(keyword);
      return [{ ...track(info, parsed.page), name: parsed.page > 1 ? `${cleanProviderTitle(info.title)} · ${cleanProviderTitle(part.part)}` : cleanProviderTitle(info.title) }];
    }
    if (/^(?:https?:\/\/|bili:|BV)/.test(keyword)) throw invalid('视频链接或 BV 号无效');
    const data = await json('/x/web-interface/search/type', {
      search_type: 'video', keyword, page: 1, page_size: 20, order: 'totalrank',
    });
    return normalizeList(data?.result).slice(0, 20);
  }

  async function discover(category = 'all') {
    if (!CATEGORIES.has(category)) throw invalid('不支持的音乐分类');
    if (category === 'all') {
      const data = await json('/x/web-interface/ranking/v2', { rid: 1003, type: 'all' }, 300_000);
      return normalizeList(data?.list).slice(0, 12);
    }
    const data = await json('/x/web-interface/search/type', {
      search_type: 'video', keyword: CATEGORIES.get(category), tids: 3,
      page: 1, page_size: 20, order: 'click',
    }, 300_000);
    return normalizeList(data?.result).slice(0, 12);
  }

  async function resolve(id, { download = false } = {}) {
    const { info, part, parsed } = await details(id);
    const rights = info.rights || {};
    if (rights.no_background || rights.pay || rights.ugc_pay || rights.arc_pay) {
      throw new BilibiliError(403, 'playback_restricted', '该视频不支持公开音频播放，请前往 Bilibili 观看');
    }
    if (download && Number(rights.download) !== 1) {
      throw new BilibiliError(403, 'download_restricted', '该视频未开放下载，请在 Bilibili 查看');
    }
    const data = await json('/x/player/playurl', {
      bvid: parsed.bvid, cid: part.cid, fnval: 16, fnver: 0, qn: 16,
    }, 30_000);
    if (data?.is_preview) throw new BilibiliError(403, 'playback_restricted', '该视频仅提供试看，请前往 Bilibili 观看');
    const tracks = (Array.isArray(data?.dash?.audio) ? data.dash.audio : [])
      .filter(item => (item.mimeType || item.mime_type) === 'audio/mp4'
        && (!item.codecs || item.codecs.startsWith('mp4a')))
      .map(item => {
        const backups = item.backupUrl || item.backup_url || [];
        const urls = [item.baseUrl || item.base_url, ...(Array.isArray(backups) ? backups : [])];
        return { ...item, url: urls.map(safeBilibiliAudioUrl).find(Boolean) || '' };
      })
      .filter(item => item.url && Number(item.bandwidth) > 0)
      .sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth));
    if (!tracks.length) throw new BilibiliError(403, 'audio_unavailable', '暂无可公开播放的音轨，请前往 Bilibili 观看');
    const audio = tracks[0];
    const item = track(info, parsed.page);
    const source = { ...item, name: parsed.page > 1 ? `${item.name} · ${cleanProviderTitle(part.part)}` : item.name,
      br: Number(audio.bandwidth), format: 'AAC', level: 'standard', cid: part.cid,
      downloadAllowed: Number(rights.download) === 1,
      url: `/api/v1/bilibili/audio?id=${encodeURIComponent(item.id)}` };
    return { source, mediaUrl: audio.url };
  }

  async function lyrics(id, { signal } = {}) {
    const { info, part, parsed } = await details(id);
    if (signal?.aborted) throw signal.reason;
    const empty = status => ({ lrc: '', tlrc: '', source: 'bilibili-subtitle', status });
    if (info.rights?.pay || info.rights?.ugc_pay || info.rights?.arc_pay) return empty('restricted');
    const data = await json('/x/player/v2', { bvid: parsed.bvid, cid: part.cid }, 300_000);
    if (data?.need_login_subtitle) return empty('login_required');
    if (data?.is_upower_exclusive || data?.is_ugc_pay_preview) return empty('restricted');
    const subtitles = Array.isArray(data?.subtitle?.subtitles) ? data.subtitle.subtitles : [];
    const tracks = subtitles.map(item => ({ ...item,
      url: safeBilibiliSubtitleUrl(item?.subtitle_url || item?.subtitle_url_v2),
    })).filter(item => item.url);
    if (!tracks.length) return empty('unavailable');
    const rank = item => (/^zh(?:-|$)/i.test(item.lan || '') ? 0 : 2) + (Number(item.ai_status) > 0 ? 1 : 0);
    tracks.sort((a, b) => rank(a) - rank(b));
    const selected = tracks[0];
    const key = `${parsed.bvid}:${part.cid}:${selected.id_str || selected.id || selected.lan}`;
    const cached = subtitleCache.get(key);
    let lrc;
    if (cached?.expires > now()) lrc = cached.lrc;
    else {
      const response = await fetchImpl(selected.url, {
        headers: HEADERS, redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      lrc = subtitleBodyToLrc(await readSubtitleJson(response));
      subtitleCache.delete(key);
      subtitleCache.set(key, { expires: now() + 300_000, lrc });
      while (subtitleCache.size > 30) subtitleCache.delete(subtitleCache.keys().next().value);
    }
    return { ...empty(lrc ? 'available' : 'unavailable'), lrc,
      language: String(selected.lan_doc || selected.lan || '').slice(0, 80),
      autoGenerated: Number(selected.ai_status) > 0,
    };
  }

  return { search, discover, resolve, lyrics };
}

const clients = new WeakMap();
function clientFor(env) {
  if (!clients.has(env)) clients.set(env, createBilibiliClient({ fetchImpl: env.BILIBILI_FETCH || globalThis.fetch }));
  return clients.get(env);
}

function jsonResponse(request, payload, status = 200) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (status === 429) headers['retry-after'] = '30';
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
    status, headers,
  });
}

async function streamAudio(request, env, client, { download = false } = {}) {
  const id = new URL(request.url).searchParams.get('id');
  const range = request.headers.get('range');
  if (range && (range.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) {
    throw new BilibiliError(416, 'invalid_range', '不支持的音频范围');
  }
  const resolved = await client.resolve(id, { download });
  const fetchImpl = env.BILIBILI_FETCH || globalThis.fetch;
  const headers = { referer: REFERER, 'user-agent': HEADERS['user-agent'] };
  if (range) headers.range = range;
  const upstream = await fetchImpl(resolved.mediaUrl, {
    method: request.method, headers, redirect: 'manual',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
  });
  if (![200, 206, 416].includes(upstream.status)) {
    await upstream.body?.cancel();
    throw new BilibiliError(502, 'audio_unavailable', '音频连接失败，请重新选择视频或前往 Bilibili');
  }
  const responseHeaders = new Headers({
    'content-type': 'audio/mp4', 'cache-control': 'no-store',
    'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
  });
  if (download && upstream.status !== 416) {
    responseHeaders.set('content-disposition', bilibiliDownloadDisposition(resolved.source.name, id));
  }
  for (const name of ['content-range', 'content-length']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (request.method === 'HEAD') await upstream.body?.cancel();
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}

export async function handleBilibiliRequest(request, env = {}) {
  const url = new URL(request.url);
  try {
    if (!['GET', 'HEAD'].includes(request.method)) throw new BilibiliError(405, 'method_not_allowed', '仅支持读取内容');
    const client = clientFor(env);
    if (url.pathname === '/api/v1/bilibili/audio') return await streamAudio(request, env, client);
    if (url.pathname === '/api/v1/bilibili/download') return await streamAudio(request, env, client, { download: true });
    const action = url.pathname.split('/').pop();
    let data;
    if (action === 'search') data = await client.search((url.searchParams.get('keyword') || '').trim());
    else if (action === 'discover') data = await client.discover(url.searchParams.get('category') || 'all');
    else if (action === 'song') data = (await client.resolve(url.searchParams.get('id'))).source;
    else if (action === 'lyric') data = await client.lyrics(url.searchParams.get('id'), { signal: request.signal });
    else throw invalid('Bilibili 暂不支持此接口');
    return jsonResponse(request, { code: 200, data });
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
    return jsonResponse(request, { error: {
      code: error.code || (timeout ? 'provider_timeout' : 'provider_unavailable'),
      message: error instanceof BilibiliError ? error.message : timeout
        ? 'Bilibili 响应超时，请稍后重试' : 'Bilibili 暂时不可用，请稍后重试',
    } }, error.status || 502);
  }
}
