const CHKSZ_API_ORIGIN = 'https://api.chksz.top/api';

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

export function chartProviderUrl(chartKey) {
  const resolvedKey = resolveChartKey(chartKey);
  return `${CHKSZ_API_ORIGIN}/163_playlist?id=${CHART_DEFINITIONS[resolvedKey].id}`;
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

async function requestProviderJson(url, { fetchImpl, timeoutMs = 8_000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'CPlayer5/5.2 charts',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Chart provider failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function handleChartsRequest(request, env = {}) {
  const url = new URL(request.url);
  const chartKey = resolveChartKey(url.searchParams.get('chart'));
  const limit = resolveChartLimit(url.searchParams.get('limit'));
  const fetchImpl = typeof env.MUSIC_FETCH === 'function' ? env.MUSIC_FETCH : globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    return jsonResponse({
      error: {
        code: 'provider_unavailable',
        message: '排行榜服务暂时不可用',
      },
    }, { status: 503, method: request.method });
  }

  try {
    const payload = await requestProviderJson(chartProviderUrl(chartKey), { fetchImpl });
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
