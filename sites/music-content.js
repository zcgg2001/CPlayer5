const CHKSZ_PRIMARY_API_ORIGIN = 'https://api.chksz.com/api';
const BILIBILI_SEARCH_ORIGIN = 'https://api.bilibili.com/x/web-interface/search/type';

export const CHART_DEFINITIONS = Object.freeze({
  hot: Object.freeze({
    id: '3778678',
    name: '热歌榜',
    eyebrow: 'HOT 200',
    description: '聚合近期播放热度，快速找到此刻最受关注的声音。',
  }),
  new: Object.freeze({
    id: '3779629',
    name: '新歌榜',
    eyebrow: 'NEW RELEASES',
    description: '追踪最新发行与快速升温的新作品。',
  }),
  soaring: Object.freeze({
    id: '19723756',
    name: '飙升榜',
    eyebrow: 'RISING FAST',
    description: '发现排名增长最快、正在形成趋势的歌曲。',
  }),
  original: Object.freeze({
    id: '2884035',
    name: '原创榜',
    eyebrow: 'ORIGINAL',
    description: '聚焦华语原创音乐与独立表达。',
  }),
});

export const DEFAULT_CHART_KEY = 'hot';
export const MAX_CHART_LIMIT = 100;
export const ARTIST_SCOPES = Object.freeze({
  trending: Object.freeze({
    name: '趋势歌手',
    description: '综合热歌榜与飙升榜，发现此刻最受关注的音乐人。',
    chartKeys: Object.freeze(['hot', 'soaring']),
  }),
  new: Object.freeze({
    name: '新声力量',
    description: '从新歌榜中发现近期有新作品发布的音乐人。',
    chartKeys: Object.freeze(['new']),
  }),
  original: Object.freeze({
    name: '原创音乐人',
    description: '聚焦原创榜中持续创作与表达的音乐人。',
    chartKeys: Object.freeze(['original']),
  }),
  all: Object.freeze({
    name: '全部歌手',
    description: '汇总热歌、新歌、飙升与原创榜中的活跃音乐人。',
    chartKeys: Object.freeze(['hot', 'new', 'soaring', 'original']),
  }),
});
export const VIDEO_CATEGORIES = Object.freeze({
  trending: Object.freeze({
    name: '趋势视频',
    description: '根据国内实时榜单歌手自动发现近期音乐视频。',
    fallbackTerms: Object.freeze(['周杰伦', '林俊杰', '邓紫棋', '陈奕迅']),
  }),
  mandopop: Object.freeze({
    name: '华语现场',
    description: '聚合华语流行音乐视频与现场作品。',
    terms: Object.freeze(['华语流行 MV', '国语流行 MV', '华语音乐现场']),
  }),
  global: Object.freeze({
    name: '经典影像',
    description: '回顾华语经典歌曲与高人气音乐影像。',
    terms: Object.freeze(['经典华语 MV', '怀旧金曲 MV', '经典歌曲 MV']),
  }),
  live: Object.freeze({
    name: '现场精选',
    description: '发现演唱会、现场演出与不插电音乐影像。',
    terms: Object.freeze(['华语音乐 现场', '演唱会 现场', '不插电 音乐']),
  }),
});
export const DEFAULT_ARTIST_SCOPE = 'trending';
export const DEFAULT_VIDEO_CATEGORY = 'trending';
export const MAX_ARTIST_LIMIT = 48;
export const MAX_VIDEO_LIMIT = 48;

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function hasId(item) {
  return item?.id !== undefined && item?.id !== null && text(item.id) !== '';
}

function artistText(item) {
  const artists = item?.artists ?? item?.artist ?? item?.ar;
  if (typeof artists === 'string') return text(artists, '未知艺术家');
  if (Array.isArray(artists)) {
    const names = artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name)
      .map(name => text(name))
      .filter(Boolean);
    if (names.length) return names.join('/');
  }
  if (artists && typeof artists === 'object') {
    return text(artists.name, '未知艺术家');
  }
  return '未知艺术家';
}

function albumText(item) {
  const album = item?.album ?? item?.al;
  return typeof album === 'string' ? text(album) : text(album?.name);
}

function coverUrl(item) {
  for (const candidate of [
    item?.picUrl,
    item?.cover,
    item?.coverImgUrl,
    item?.album?.picUrl,
    item?.al?.picUrl,
  ]) {
    const value = text(candidate);
    if (value) return value;
  }
  return '';
}

function splitArtistNames(value) {
  return text(value)
    .split(/[\/／]/)
    .map(name => text(name))
    .filter(name => name && name !== '未知艺术家');
}

function stableTextId(value, prefix) {
  let hash = 2166136261;
  for (const character of text(value).toLowerCase()) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function httpsUrl(value, allowedHosts = null) {
  try {
    const raw = text(value);
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (url.protocol !== 'https:') return '';
    if (allowedHosts && !allowedHosts.some(host => (
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    ))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function playlistRoot(payload) {
  const root = payload?.data ?? payload?.playlist;
  return root && typeof root === 'object' && !Array.isArray(root) ? root : null;
}

function playlistTracks(payload) {
  if (Array.isArray(payload?.data?.tracks)) return payload.data.tracks;
  if (Array.isArray(payload?.playlist?.tracks)) return payload.playlist.tracks;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function resolveChartKey(value) {
  const key = text(value).toLowerCase();
  return Object.hasOwn(CHART_DEFINITIONS, key) ? key : DEFAULT_CHART_KEY;
}

export function resolveChartLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(MAX_CHART_LIMIT, parsed));
}

export function resolveArtistScope(value) {
  const scope = text(value).toLowerCase();
  return Object.hasOwn(ARTIST_SCOPES, scope) ? scope : DEFAULT_ARTIST_SCOPE;
}

export function resolveVideoCategory(value) {
  const category = text(value).toLowerCase();
  return Object.hasOwn(VIDEO_CATEGORIES, category) ? category : DEFAULT_VIDEO_CATEGORY;
}

function resolveContentLimit(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, parsed));
}

export function normalizeChkszChartPayload(
  payload,
  {
    chartKey = DEFAULT_CHART_KEY,
    limit = 50,
    fetchedAt = new Date().toISOString(),
  } = {},
) {
  const resolvedKey = resolveChartKey(chartKey);
  const definition = CHART_DEFINITIONS[resolvedKey];
  const root = playlistRoot(payload);
  const tracks = playlistTracks(payload);

  if (!root || !tracks.length) {
    throw new Error('Chart provider returned no tracks');
  }

  const creator = root.creator;
  const sourceName = typeof creator === 'string'
    ? text(creator, '网易云音乐')
    : text(creator?.nickname ?? creator?.name, '网易云音乐');

  const items = tracks
    .filter(hasId)
    .slice(0, resolveChartLimit(limit))
    .map((item, index) => ({
      rank: index + 1,
      id: text(item.id),
      playbackId: text(item.id),
      name: text(item.name, '未知歌曲'),
      artist: artistText(item),
      album: albumText(item),
      cover: coverUrl(item),
      source: 'ChKSz',
      playable: true,
    }));

  if (!items.length) throw new Error('Chart provider returned no playable tracks');

  return {
    version: 1,
    chart: {
      key: resolvedKey,
      id: text(root.id, definition.id),
      name: text(root.name, definition.name),
      eyebrow: definition.eyebrow,
      description: definition.description,
      cover: coverUrl(root),
      provider: 'chksz',
      sourceName,
      trackCount: Number(root.trackCount) || tracks.length,
      fetchedAt,
    },
    items,
  };
}

export function chartProviderUrl(
  chartKey,
  {
    apiKey = '',
    origin = CHKSZ_PRIMARY_API_ORIGIN,
  } = {},
) {
  const resolvedKey = resolveChartKey(chartKey);
  const url = new URL(`${origin}/163_playlist`);
  url.searchParams.set('id', CHART_DEFINITIONS[resolvedKey].id);
  if (apiKey) url.searchParams.set('apikey', apiKey);
  return url.href;
}

export function chartProviderUrls(chartKey, apiKey = '') {
  return [chartProviderUrl(chartKey, {
    apiKey: text(apiKey),
    origin: CHKSZ_PRIMARY_API_ORIGIN,
  })];
}

export function normalizeArtistsFromCharts(
  charts,
  {
    scope = DEFAULT_ARTIST_SCOPE,
    limit = 24,
    fetchedAt = new Date().toISOString(),
  } = {},
) {
  const resolvedScope = resolveArtistScope(scope);
  const definition = ARTIST_SCOPES[resolvedScope];
  const artistMap = new Map();

  for (const chartPayload of Array.isArray(charts) ? charts : []) {
    const chart = chartPayload?.chart;
    const items = Array.isArray(chartPayload?.items) ? chartPayload.items : [];
    for (const item of items) {
      const rank = Math.max(1, Number(item.rank) || 100);
      const chartKey = resolveChartKey(chart?.key);
      const chartWeight = chartKey === 'hot' ? 1.2 : chartKey === 'soaring' ? 1.1 : 1;
      const score = Math.max(1, 101 - rank) * chartWeight;
      for (const name of splitArtistNames(item.artist)) {
        const canonical = name.toLocaleLowerCase('zh-CN');
        let artist = artistMap.get(canonical);
        if (!artist) {
          artist = {
            id: stableTextId(name, 'artist'),
            name,
            cover: item.cover || '',
            score: 0,
            appearances: 0,
            charts: new Set(),
            tracks: new Map(),
          };
          artistMap.set(canonical, artist);
        }
        artist.score += score;
        artist.appearances += 1;
        artist.charts.add(chartKey);
        if (!artist.cover && item.cover) artist.cover = item.cover;
        const trackId = text(item.playbackId || item.id);
        if (!artist.tracks.has(trackId)) {
          artist.tracks.set(trackId, {
            id: text(item.id, trackId),
            playbackId: trackId,
            name: text(item.name, '未知歌曲'),
            artist: text(item.artist, name),
            album: text(item.album),
            cover: text(item.cover),
            rank,
            chart: chartKey,
            playable: item.playable !== false,
          });
        }
      }
    }
  }

  const artists = Array.from(artistMap.values())
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, resolveContentLimit(limit, 24, MAX_ARTIST_LIMIT))
    .map((artist, index) => {
      const tracks = Array.from(artist.tracks.values())
        .sort((left, right) => left.rank - right.rank)
        .slice(0, 8);
      return {
        rank: index + 1,
        id: artist.id,
        name: artist.name,
        cover: artist.cover,
        appearances: artist.appearances,
        chartCount: artist.charts.size,
        charts: Array.from(artist.charts),
        score: Math.round(artist.score),
        featuredTrack: tracks[0] || null,
        tracks,
      };
    });

  if (!artists.length) throw new Error('Artist provider returned no artists');

  return {
    version: 1,
    collection: {
      key: resolvedScope,
      name: definition.name,
      description: definition.description,
      provider: 'chksz',
      sourceName: '实时音乐榜单',
      artistCount: artists.length,
      fetchedAt,
    },
    items: artists,
  };
}

export function bilibiliVideoProviderUrl(term, limit = 8) {
  const url = new URL(BILIBILI_SEARCH_ORIGIN);
  url.searchParams.set('keyword', text(term));
  url.searchParams.set('search_type', 'video');
  url.searchParams.set('order', 'click');
  url.searchParams.set('page', '1');
  url.searchParams.set('pagesize', String(resolveContentLimit(limit, 8, 20)));
  return url.href;
}

function cleanProviderTitle(value) {
  return text(value)
    .replace(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

export function normalizeBilibiliVideoPayload(payload, { category = DEFAULT_VIDEO_CATEGORY } = {}) {
  const resolvedCategory = resolveVideoCategory(category);
  return (Array.isArray(payload?.data?.result) ? payload.data.result : [])
    .map(item => ({
      id: text(item.bvid),
      name: cleanProviderTitle(item.title) || '未命名音乐视频',
      artist: text(item.author, '未知上传者'),
      artistId: text(item.mid),
      poster: httpsUrl(item.pic, ['hdslb.com']),
      previewUrl: '',
      externalUrl: httpsUrl(
        item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : item.arcurl,
        ['bilibili.com'],
      ),
      artistUrl: item.mid
        ? httpsUrl(`https://space.bilibili.com/${item.mid}`, ['bilibili.com'])
        : '',
      releasedAt: Number(item.pubdate) > 0
        ? new Date(Number(item.pubdate) * 1000).toISOString()
        : '',
      genre: resolvedCategory === 'live' ? '现场影像' : '音乐视频',
      explicit: false,
      provider: '哔哩哔哩',
      category: resolvedCategory,
    }))
    .filter(item => item.poster && item.externalUrl);
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function trendingArtistTerms(chartPayload) {
  const items = Array.isArray(chartPayload?.items) ? chartPayload.items : [];
  const names = [];
  const seen = new Set();
  for (const item of items) {
    for (const name of splitArtistNames(item.artist)) {
      const canonical = name.toLocaleLowerCase('zh-CN');
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      names.push(name);
      if (names.length >= 5) return names;
    }
  }
  return names;
}

function jsonResponse(payload, { status = 200, cache = false, method = 'GET' } = {}) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  if (cache) {
    headers.set('cache-control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
  } else {
    headers.set('cache-control', 'no-store');
  }
  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), { status, headers });
}

async function requestProviderJson(
  url,
  {
    fetchImpl,
    timeoutMs = 8_000,
    headers = {},
  } = {},
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'CPlayer5/5.3 content',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Content provider failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestChartPayload(chartKey, { fetchImpl, apiKey = '' } = {}) {
  let lastError = null;
  for (const providerUrl of chartProviderUrls(chartKey, apiKey)) {
    try {
      return await requestProviderJson(providerUrl, { fetchImpl });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No chart provider is available');
}

async function fetchNormalizedCharts(chartKeys, fetchImpl, apiKey = '') {
  const results = await Promise.allSettled(chartKeys.map(async chartKey => {
    const payload = await requestChartPayload(chartKey, { fetchImpl, apiKey });
    return normalizeChkszChartPayload(payload, { chartKey, limit: 100 });
  }));
  return results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
}

export async function handleChartsRequest(request, env = {}) {
  const url = new URL(request.url);
  const chartKey = resolveChartKey(url.searchParams.get('chart'));
  const limit = resolveChartLimit(url.searchParams.get('limit'));
  const fetchImpl = typeof env.MUSIC_FETCH === 'function' ? env.MUSIC_FETCH : globalThis.fetch;
  const apiKey = text(env.CHKSZ_API_KEY);

  if (!apiKey) {
    return jsonResponse({
      error: {
        code: 'api_key_missing',
        message: '排行榜服务尚未配置，请联系站点管理员',
      },
    }, { status: 503, method: request.method });
  }

  if (typeof fetchImpl !== 'function') {
    return jsonResponse({
      error: {
        code: 'provider_unavailable',
        message: '排行榜服务暂时不可用',
      },
    }, { status: 503, method: request.method });
  }

  try {
    const payload = await requestChartPayload(chartKey, {
      fetchImpl,
      apiKey,
    });
    const normalized = normalizeChkszChartPayload(payload, { chartKey, limit });
    return jsonResponse(normalized, { cache: true, method: request.method });
  } catch (error) {
    return jsonResponse({
      error: {
        code: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_failed',
        message: error?.name === 'AbortError'
          ? '排行榜更新超时，请稍后重试'
          : '排行榜暂时无法更新，请稍后重试',
      },
    }, { status: 502, method: request.method });
  }
}

export async function handleArtistsRequest(request, env = {}) {
  const url = new URL(request.url);
  const scope = resolveArtistScope(url.searchParams.get('scope'));
  const limit = resolveContentLimit(url.searchParams.get('limit'), 24, MAX_ARTIST_LIMIT);
  const fetchImpl = typeof env.MUSIC_FETCH === 'function' ? env.MUSIC_FETCH : globalThis.fetch;
  const apiKey = text(env.CHKSZ_API_KEY);

  if (!apiKey) {
    return jsonResponse({
      error: {
        code: 'api_key_missing',
        message: '歌手中心尚未配置，请联系站点管理员',
      },
    }, { status: 503, method: request.method });
  }

  if (typeof fetchImpl !== 'function') {
    return jsonResponse({
      error: {
        code: 'provider_unavailable',
        message: '歌手中心暂时不可用',
      },
    }, { status: 503, method: request.method });
  }

  try {
    const charts = await fetchNormalizedCharts(
      ARTIST_SCOPES[scope].chartKeys,
      fetchImpl,
      apiKey,
    );
    const normalized = normalizeArtistsFromCharts(charts, { scope, limit });
    return jsonResponse(normalized, { cache: true, method: request.method });
  } catch (error) {
    return jsonResponse({
      error: {
        code: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_failed',
        message: error?.name === 'AbortError'
          ? '歌手数据更新超时，请稍后重试'
          : '歌手中心暂时无法更新，请稍后重试',
      },
    }, { status: 502, method: request.method });
  }
}

export async function handleVideosRequest(request, env = {}) {
  const url = new URL(request.url);
  const category = resolveVideoCategory(url.searchParams.get('category'));
  const limit = resolveContentLimit(url.searchParams.get('limit'), 24, MAX_VIDEO_LIMIT);
  const musicFetch = typeof env.MUSIC_FETCH === 'function' ? env.MUSIC_FETCH : globalThis.fetch;
  const videoFetch = typeof env.VIDEO_FETCH === 'function' ? env.VIDEO_FETCH : globalThis.fetch;

  if (typeof musicFetch !== 'function' || typeof videoFetch !== 'function') {
    return jsonResponse({
      error: {
        code: 'provider_unavailable',
        message: '视频中心暂时不可用',
      },
    }, { status: 503, method: request.method });
  }

  try {
    const definition = VIDEO_CATEGORIES[category];
    let terms = definition.terms ? [...definition.terms] : [];
    if (category === 'trending') {
      try {
        const chartPayload = await requestChartPayload('hot', {
          fetchImpl: musicFetch,
          apiKey: text(env.CHKSZ_API_KEY),
        });
        const chart = normalizeChkszChartPayload(chartPayload, { chartKey: 'hot', limit: 30 });
        terms = trendingArtistTerms(chart).map(term => `${term} 官方 MV`);
      } catch {
        terms = [];
      }
      if (!terms.length) terms = definition.fallbackTerms.map(term => `${term} 官方 MV`);
    }

    const perTermLimit = Math.max(4, Math.min(12, Math.ceil(limit / Math.max(1, terms.length)) + 2));
    const results = await Promise.allSettled(terms.map(async term => {
      const payload = await requestProviderJson(bilibiliVideoProviderUrl(term, perTermLimit), {
        fetchImpl: videoFetch,
        timeoutMs: 10_000,
        headers: {
          origin: 'https://www.bilibili.com',
          referer: 'https://www.bilibili.com/',
        },
      });
      return normalizeBilibiliVideoPayload(payload, { category });
    }));
    const videos = uniqueById(
      results
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => result.value),
    )
      .sort((left, right) => (
        new Date(right.releasedAt || 0).getTime() - new Date(left.releasedAt || 0).getTime()
      ))
      .slice(0, limit);

    if (!videos.length) throw new Error('Video provider returned no videos');

    return jsonResponse({
      version: 1,
      collection: {
        key: category,
        name: definition.name,
        description: definition.description,
        provider: 'bilibili',
        sourceName: 'ChKSz 热榜 · 哔哩哔哩',
        videoCount: videos.length,
        previewCount: 0,
        fetchedAt: new Date().toISOString(),
      },
      items: videos,
    }, { cache: true, method: request.method });
  } catch (error) {
    return jsonResponse({
      error: {
        code: error?.name === 'AbortError' ? 'provider_timeout' : 'provider_failed',
        message: error?.name === 'AbortError'
          ? '视频数据更新超时，请稍后重试'
          : '视频中心暂时无法更新，请稍后重试',
      },
    }, { status: 502, method: request.method });
  }
}
