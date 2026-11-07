import { extractMetadata } from '../js/music-catalog.js';
import { boundedBytes, USER_AGENT } from './channel-http.js';

const caches = new WeakMap();
const validId = value => /^\d{1,20}$/.test(String(value || ''));
const text = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const image = value => { try { const url = new URL(value); return /(^|\.)music\.126\.net$/.test(url.hostname) && ['http:', 'https:'].includes(url.protocol) ? url.href.replace(/^http:/, 'https:') : ''; } catch { return ''; } };
export function discoveryTrack(raw) {
  if (!validId(raw?.id) || !text(raw.name)) return null;
  const artists = (raw.artists || raw.ar || []).slice(0, 10).map(a => ({ id: String(a.id || ''), name: text(a.name) })).filter(a => a.name);
  const album = raw.album || raw.al || {};
  const info = extractMetadata({ ...raw, artists, duration: Number(raw.duration || raw.dt) / 1000 });
  return { ...info, id: String(raw.id), sourceId: String(raw.id), name: text(raw.name), artist: artists.map(a => a.name).join(' / ') || '未知歌手',
    album: text(album.name), cover: image(album.picUrl), duration: info.metadata.duration,
    provider: 'gd', source: 'GD 音乐台', metadataSource: '网易云公开资料', availability: { status: 'unknown' }, downloadAllowed: false };
}
function collection(raw) {
  return { id: String(raw.id), name: text(raw.name), cover: image(raw.coverImgUrl), description: text(raw.description, 1200),
    tags: (raw.tags || []).slice(0, 10).map(tag => text(tag, 40)), trackCount: Number(raw.trackCount) || 0,
    updatedAt: Number(raw.updateTime) || null, source: '网易云公开歌单' };
}

export async function handleDiscoveryContent(request, env, url) {
  const json = (body, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=300' : 'no-store', 'x-content-type-options': 'nosniff',
  } });
  const action = url.pathname.slice('/api/v1/discovery/'.length), id = url.searchParams.get('id');
  const category = url.searchParams.get('category') || '全部';
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!['charts', 'playlist', 'playlists', 'artist'].includes(action) || (['playlist', 'artist'].includes(action) && !validId(id))
    || category.length > 40 || /[\u0000-\u001f]/.test(category) || !Number.isInteger(offset) || offset < 0 || offset > 1000) {
    return json({ error: { message: '发现音乐查询参数无效' } }, 400);
  }
  const searchCategory = ['City Pop','后摇','80年代','90年代','00年代'].includes(category);
  const path = action === 'charts' ? '/api/toplist' : action === 'artist' ? `/api/artist/${id}`
    : action === 'playlist' ? `/api/playlist/detail?${new URLSearchParams({ id, n: '200', s: '0' })}`
      : searchCategory ? `/api/search/get?${new URLSearchParams({s:category,type:'1000',limit:'6',offset:String(offset)})}`
      : `/api/playlist/list?${new URLSearchParams({ cat: category, order: 'hot', limit: '6', offset: String(offset) })}`;
  const fetchImpl = env.DISCOVERY_FETCH || globalThis.fetch;
  if (!caches.has(fetchImpl)) caches.set(fetchImpl, new Map());
  const cache = caches.get(fetchImpl), cached = cache.get(path);
  if (cached?.expires > Date.now()) return json(cached.body);
  try {
    const response = await fetchImpl(`https://music.163.com${path}`, { redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]), headers: { 'user-agent': USER_AGENT, referer: 'https://music.163.com/' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error('upstream'); }
    const data = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 2 * 1024 * 1024)));
    if (data.code !== 200) throw new Error('upstream');
    let body;
    if (action === 'charts' || action === 'playlists') {
      const rows = action === 'charts' ? data.list : searchCategory ? data.result?.playlists || [] : data.playlists;
      if (!Array.isArray(rows)) throw new Error('shape');
      body = { code: 200, items: rows.filter(row => validId(row?.id)).slice(0, action === 'charts' ? 80 : 6).map(collection), fetchedAt: Date.now() };
    } else {
      const root = action === 'playlist' ? data.result || data.playlist : data.artist;
      if (!root || String(root.id) !== id) throw new Error('identity');
      const raw = action === 'playlist' ? root.tracks : data.hotSongs;
      if (!Array.isArray(raw)) throw new Error('shape');
      const tracks = raw.slice(0, 200).map(discoveryTrack).filter(Boolean);
      const total = action === 'playlist' ? Number(root.trackCount) || raw.length : raw.length;
      body = { code: 200, collection: { ...collection(root), cover: image(root.coverImgUrl || root.picUrl), trackCount: total }, tracks,
        partial: tracks.length < total || (action === 'artist' && Boolean(data.more)), fetchedAt: Date.now() };
    }
    // Public, completed JSON only; never retain streams, credentials or promises across requests.
    if (JSON.stringify(body).length < 300_000) { cache.delete(path); cache.set(path, { body, expires: Date.now() + 300_000 }); }
    while (cache.size > 24) cache.delete(cache.keys().next().value);
    return json(body);
  } catch { return json({ error: { message: '公开曲库暂时不可用，请稍后重试；搜索和播放仍可使用' } }, 502); }
}
