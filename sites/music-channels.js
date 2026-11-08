import { MUSIC_CHANNELS, isMusicChannel } from '../js/music-channels.js';
import { ChannelError, USER_AGENT, checkedUrl, audioUrl, createChannelClient } from './channel-http.js';
import { searchChannel, resolveChannel, resolveJbsou, channelLyric } from './channel-providers.js';
import { OP_USER_AGENT } from './op-music.js';

export { isMusicChannel };
// Only completed, public metadata is cached; sessions, streams and promises stay request-local.
const caches = new WeakMap();
function cacheFor(fetchImpl) {
  if (!caches.has(fetchImpl)) caches.set(fetchImpl, new Map());
  return caches.get(fetchImpl);
}
async function cached(cache, key, ttl, create) {
  const saved = cache.get(key);
  if (saved?.expires > Date.now()) return saved.value;
  const value = await create();
  cache.delete(key);
  const size = JSON.stringify(value).length * 2;
  if (size <= 256 * 1024) cache.set(key, { value, size, expires: Date.now() + ttl });
  let bytes = [...cache.values()].reduce((total, entry) => total + entry.size, 0);
  while (cache.size > 160 || bytes > 8 * 1024 * 1024) {
    const oldest = cache.keys().next().value;
    bytes -= cache.get(oldest).size;
    cache.delete(oldest);
  }
  return value;
}
function coverUrl(value) {
  const url = checkedUrl(value);
  if (!['music.126.net', 'gtimg.cn', 'qpic.cn', 'kugou.com', 'kuwo.cn'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new ChannelError(502, '封面地址不可用');
  url.protocol = 'https:';
  return url.href;
}

async function streamAudio(request, info, platform, fetchImpl, source) {
  let url = audioUrl(info.url, platform, source);
  const originalPath = url.pathname;
  const range = request.headers.get('range');
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new ChannelError(416, '不支持的音频范围');
  for (let hop = 0; hop < 4; hop++) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: request.method, redirect: 'manual',
        headers: { 'user-agent': source.startsWith('op-') ? OP_USER_AGENT : USER_AGENT, ...(range ? { range } : {}) },
        signal: AbortSignal.any([request.signal, timeout.signal]),
      });
    } finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) {
      const target = response.headers.get('location');
      await response.body?.cancel();
      url = audioUrl(new URL(target || '', url).href, platform, source);
      if (source.startsWith('op-') && url.pathname !== originalPath) throw new ChannelError(502, 'OP Music 音频任务不匹配');
      continue;
    }
    if (response.status === 416) {
      await response.body?.cancel();
      return new Response(null, { status: 416, headers: { 'content-range': response.headers.get('content-range') || 'bytes */0' } });
    }
    const type = response.headers.get('content-type') || '';
    if (![200, 206].includes(response.status) || /(?:text|json|html|image)/i.test(type)) {
      await response.body?.cancel();
      throw new ChannelError([401,402,403,429].includes(response.status) ? response.status : 502, '此歌曲音频暂时无法读取，请换一个渠道', response.headers.get('retry-after'));
    }
    const contentType = { flac:'audio/flac', mp3:'audio/mpeg', m4a:'audio/mp4', aac:'audio/aac', ogg:'audio/ogg', opus:'audio/ogg', wav:'audio/wav' }[info.format] || 'application/octet-stream';
    const headers = new Headers({ 'content-type': contentType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    for (const name of ['content-range', 'content-length', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name); if (value) headers.set(name, value);
    }
    if (request.method === 'HEAD') await response.body?.cancel();
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  }
  throw new ChannelError(502, '音频跳转次数过多');
}

export async function handleMusicChannelRequest(request, env, url) {
  const params = url.searchParams, source = params.get('source');
  const channel = MUSIC_CHANNELS[source];
  const fetchImpl = env.CHANNEL_FETCH || globalThis.fetch;
  const cache = cacheFor(fetchImpl);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]);
  const client = createChannelClient(fetchImpl, signal);
  const json = (payload, status = 200, retryAfter) => new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
    status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...(retryAfter ? { 'retry-after': retryAfter } : {}) },
  });
  try {
    if (!channel) throw new ChannelError(400, '不支持的音乐渠道');
    const action = url.pathname.split('/').pop();
    if (!['search','song','lyric','audio','cover'].includes(action)) throw new ChannelError(422, '此渠道不提供该功能，请使用搜索');
    if (action === 'search') {
      const keyword = params.get('keyword')?.trim(), limit = Number(params.get('limit') || 20), offset = Number(params.get('offset') || 0);
      if (!keyword || keyword.length > 120 || !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 5000) throw new ChannelError(400, '搜索参数无效');
      const data = await cached(cache, `${source}:search:${keyword}:${limit}:${offset}`, 180_000,
        () => searchChannel(source, channel.platform, keyword, limit, offset, client));
      return json({ code:200, data: [...new Map(data.filter(song => song.id && song.name).map(song => [song.id, song])).values()] });
    }
    const id = params.get('id') || '';
    if (!id || id.length > 2048) throw new ChannelError(400, '歌曲 ID 无效');
    if (action === 'cover') {
      if (!source.startsWith('jianbin-')) throw new ChannelError(404, '此渠道不提供封面代理');
      const cover = await cached(cache, `${source}:cover:${id}`, 300_000, async () => coverUrl(await resolveJbsou(id, channel.platform, client, true)));
      return new Response(null, { status:302, headers:{ location:cover, 'cache-control':'public, max-age=300', 'referrer-policy':'no-referrer' } });
    }
    if (action === 'lyric') {
      const data = await cached(cache, `${source}:lyric:${id}`, 300_000, () => channelLyric(source, channel.platform, id, client));
      return json({ code:200, data });
    }
    const requested = params.get('level') || channel.qualities.at(-1) || 'standard';
    if (!['standard','exhigh','lossless','hires','jymaster'].includes(requested)) throw new ChannelError(400, '音质参数无效');
    const level = channel.qualities.includes(requested) ? requested : channel.qualities.at(-1) || 'standard';
    const info = await cached(cache, `${source}:song:${id}:${level}`, 60_000, async () => {
      const resolved = await resolveChannel(source, channel.platform, id, level, client);
      const url = audioUrl(resolved.url, channel.platform, source);
      const format = source.startsWith('op-') ? resolved.format : url.pathname.match(/\.(mp3|flac|m4a|aac|ogg|wav|opus)$/i)[1].toLowerCase();
      return { ...resolved, format, br: (Number(resolved.bitrate) || 0) * 1000, level: source.startsWith('op-') ? resolved.level : format === 'flac' ? 'lossless' : Number(resolved.bitrate) >= 300 ? 'exhigh' : 'standard' };
    });
    if (action === 'audio') {
      try { return await streamAudio(request, info, channel.platform, fetchImpl, source); }
      catch (error) { cache.delete(`${source}:song:${id}:${level}`); throw error; }
    }
    return json({ code:200, data: {
      id, url: `/api/v1/music/audio?${new URLSearchParams({ source, id, level })}`,
      format: info.format, level: info.level, br: info.br, cover: info.cover || '', downloadAllowed:false,
      ...(source.startsWith('op-') ? { name:info.name, artist:info.artist, album:info.album, duration:info.duration, sampleRate:info.sampleRate, bitDepth:info.bitDepth } : {}),
    } });
  } catch (error) {
    return json({ error: { code:'channel_error', message: error instanceof ChannelError ? error.message : '渠道连接失败或超时，请稍后重试或切换渠道' } }, error instanceof ChannelError ? error.status : 502, error.retryAfter);
  }
}
