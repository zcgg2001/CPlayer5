const API_URL = 'https://music-api.gdstudio.xyz/api.php';
const QUALITY = { standard: 128, exhigh: 320, lossless: 740, hires: 999, jymaster: 999 };
const states = new WeakMap();

class GdError extends Error {
  constructor(status, message, retryAfter = '') {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

function stateFor(fetchImpl) {
  if (!states.has(fetchImpl)) states.set(fetchImpl, { cache: new Map(), tracks: new Map(), requests: [], busy: false, pending: [] });
  return states.get(fetchImpl);
}

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > 256) map.delete(map.keys().next().value);
}

async function reserve(state, type) {
  if (state.busy) await new Promise(resolve => {
    state.pending.push({ resolve, priority: type === 'pic' ? 1 : 0 });
    state.pending.sort((a, b) => a.priority - b.priority);
  });
  state.busy = true;
  return () => {
    const next = state.pending.shift();
    if (next) next.resolve();
    else state.busy = false;
  };
}

// Serialize upstream requests, cache successful responses, and never retry a refusal.
async function requestGd(params, fetchImpl, signal) {
  const state = stateFor(fetchImpl);
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ source: 'netease', ...params });
  // A pending song or lyric takes precedence over thumbnails.
  const release = await reserve(state, params.types);
  try {
    signal?.throwIfAborted();
    const cached = state.cache.get(url.href);
    if (cached?.expires > Date.now()) return cached.payload;
    if (state.blockedUntil > Date.now()) {
      throw new GdError(429, 'GD 音乐台请求过于频繁，请稍后重试', String(Math.ceil((state.blockedUntil - Date.now()) / 1000)));
    }
    state.requests = state.requests.filter(time => time > Date.now() - 300_000);
    if (state.requests.length >= 50) {
      throw new GdError(429, 'GD 音乐台每 5 分钟最多 50 次请求，请稍后重试', String(Math.max(1, Math.ceil((state.requests[0] + 300_000 - Date.now()) / 1000))));
    }
    state.requests.push(Date.now());
    const response = await fetchImpl(url.href, {
      headers: { accept: 'application/json', 'user-agent': 'CPlayer5/5.3 music-proxy' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
    });
    let payload;
    try { payload = await response.json(); } catch { /* HTML errors are not shown as provider messages. */ }
    const status = response.ok ? (Number(payload?.code) >= 400 ? Number(payload.code) : 200) : response.status;
    if (status >= 400) {
      const retryAfter = response.headers.get('retry-after') || '';
      if (status === 429) {
        const seconds = Number(retryAfter) || Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000) || 300;
        state.blockedUntil = Date.now() + seconds * 1000;
      }
      const detail = payload?.msg || payload?.message;
      throw new GdError(status <= 599 ? status : 502, typeof detail === 'string' && detail.trim()
        ? detail.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300)
        : status === 403 ? 'GD 音乐台暂时拒绝访问，请稍后重试或切换 ChKSz'
          : status === 429 ? 'GD 音乐台请求过于频繁，请稍后重试' : 'GD 音乐台暂时不可用，请稍后重试', retryAfter);
    }
    if (!payload || typeof payload !== 'object') throw new GdError(502, 'GD 音乐台返回了无法识别的数据');
    remember(state.cache, url.href, { payload, expires: Date.now() + (params.types === 'url' ? 60_000 : 300_000) });
    return payload;
  } finally { release(); }
}

export async function handleGdRequest(request, env, url) {
  const fetchImpl = env.GD_FETCH || globalThis.fetch;
  const state = stateFor(fetchImpl);
  const params = url.searchParams;
  const action = url.pathname.split('/').pop();
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const json = (payload, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), { status, headers: { ...headers, ...extra } });
  try {
    if (action === 'playlist') throw new GdError(422, 'GD 暂不提供歌单详情，请切换 ChKSz 后读取歌单');
    if (!['search', 'song', 'lyric', 'cover'].includes(action)) throw new GdError(404, 'GD 暂不支持此功能');
    const id = params.get('id') || '';
    if (action !== 'search' && !/^\d{1,32}$/.test(id)) throw new GdError(400, '歌曲或封面 ID 无效');
    const get = values => requestGd(values, fetchImpl, request.signal);
    if (action === 'search') {
      const keyword = params.get('keyword')?.trim();
      const count = Number(params.get('limit') || 30);
      const offset = Number(params.get('offset') || 0);
      if (!keyword || keyword.length > 120 || !Number.isInteger(count) || count < 1 || count > 100
        || !Number.isSafeInteger(offset) || offset < 0 || offset % count) throw new GdError(400, '搜索参数无效');
      const payload = await get({ types: 'search', name: keyword, count, pages: offset / count + 1 });
      if (!Array.isArray(payload)) throw new GdError(502, 'GD 音乐台未返回有效的搜索列表');
      const songs = payload.filter(item => /^\d{1,32}$/.test(String(item?.id))).map(item => {
        const song = {
          id: String(item.id), name: item.name, artists: item.artist, album: item.album,
          cover: /^\d{1,32}$/.test(String(item.pic_id)) ? `/api/v1/music/cover?source=gd&id=${item.pic_id}` : '',
        };
        remember(state.tracks, song.id, song);
        return song;
      });
      return json({ code: 200, data: songs });
    }
    if (action === 'cover') {
      const payload = await get({ types: 'pic', id, size: 300 });
      const cover = safeUrl(payload.url);
      if (!cover) throw new GdError(404, 'GD 暂未提供封面');
      return new Response(null, { status: 302, headers: { location: cover, 'cache-control': 'public, max-age=3600', 'referrer-policy': 'no-referrer' } });
    }
    if (action === 'lyric') {
      const payload = await get({ types: 'lyric', id });
      return json({ code: 200, data: { lrc: typeof payload.lyric === 'string' ? payload.lyric : '', tlyric: typeof payload.tlyric === 'string' ? payload.tlyric : '' } });
    }
    const quality = params.get('level') || 'lossless';
    if (!Object.hasOwn(QUALITY, quality)) throw new GdError(400, '不支持的音质参数');
    let payload;
    for (const br of [...new Set([QUALITY[quality], 320, 128])].filter(br => br <= QUALITY[quality])) {
      payload = await get({ types: 'url', id, br });
      if (payload.url) break;
    }
    const playUrl = safeUrl(payload.url);
    if (!playUrl) throw new GdError(404, 'GD 未返回可播放地址，请换一首歌曲或切换 ChKSz');
    // GD returns the actual bitrate/quality; never label an automatic downgrade as Hi-Res.
    const bitrate = Number(payload.br) || 0;
    const level = bitrate >= 999 ? 'hires' : bitrate >= 740 ? 'lossless' : bitrate >= 320 ? 'exhigh' : 'standard';
    return json({ code: 200, data: { ...state.tracks.get(id), id, url: playUrl, level, br: bitrate * 1000 } });
  } catch (error) {
    const known = error instanceof GdError;
    return json({ error: { code: 'gd_error', message: known ? error.message : 'GD 音乐台连接失败或超时，请稍后重试' } }, known ? error.status : 502,
      error.retryAfter ? { 'retry-after': error.retryAfter } : {});
  }
}
