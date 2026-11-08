import { extractMetadata } from './music-catalog.js?v=1';

function metadataFields(item) {
  const info = extractMetadata(item);
  const meaningful = Object.entries(info.metadata).some(([key,value]) => key !== 'duration' && key !== 'bitrate' && (Array.isArray(value) ? value.length : value));
  return meaningful || info.artistEntities?.some(artist => artist.id != null || artist.avatar) || info.albumEntity?.id != null || info.availability ? info : {};
}

function hasId(item) {
  return item?.id !== undefined && item?.id !== null && String(item.id).trim() !== '';
}

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function artistText(item, fallback = 'Unknown') {
  const artists = item?.artists ?? item?.artist ?? item?.ar;
  if (typeof artists === 'string') return text(artists, fallback);
  if (Array.isArray(artists)) {
    const names = artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name)
      .map(name => text(name))
      .filter(Boolean);
    return names.length ? names.join(item?.artists ? ', ' : '/') : fallback;
  }
  if (artists && typeof artists === 'object') return text(artists.name, fallback);
  return fallback;
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
    item?.picture,
    item?.pic,
    item?.album?.picUrl,
    item?.al?.picUrl,
  ]) {
    const value = text(candidate);
    if (value) return value;
  }
  return '';
}

function searchItems(payload) {
  if (payload?.code !== 200) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.songs)) return payload.data.songs;
  if (Array.isArray(payload.result?.songs)) return payload.result.songs;
  return [];
}

export function normalizeSearchPayload(payload) {
  return searchItems(payload).filter(hasId).map(item => ({
    id: item.id,
    ...metadataFields(item),
    name: text(item.name, '未知歌曲'),
    artist: artistText(item),
    album: albumText(item),
    cover: coverUrl(item),
    ...(item.duration != null || item.dt != null ? { duration: Number(item.duration ?? Number(item.dt) / 1000) || 0 } : {}),
    source: 'ChKSz',
  }));
}

export function bilibiliVideoUrl(song) {
  const match = /^bili:(BV[0-9A-Za-z]{10}):([1-9]\d{0,3})$/.exec(text(song?.id));
  return match ? `https://www.bilibili.com/video/${match[1]}/?p=${match[2]}` : '';
}

export function normalizeBilibiliPayload(payload) {
  if (payload?.code !== 200) return [];
  const items = Array.isArray(payload.data) ? payload.data : [payload.data];
  return items.filter(item => bilibiliVideoUrl(item)).map(item => ({
    id: item.id, sourceId: item.id,
    name: text(item.name, '未命名视频'), artist: text(item.artist, '未知 UP 主'),
    cover: text(item.cover), album: 'Bilibili',
    provider: 'bilibili', source: 'Bilibili', externalUrl: bilibiliVideoUrl(item),
    url: text(item.url), br: Number(item.br) || 0,
    downloadAllowed: item.downloadAllowed === true,
    level: 'standard', format: 'AAC',
  }));
}

export function normalizeSongPayload(payload, requestedLevel = 'jymaster') {
  if (payload?.code !== 200 || !payload.data) return null;
  const item = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!hasId(item) || !text(item?.url)) return null;

  return {
    id: item.id,
    ...metadataFields(item),
    url: text(item.url),
    name: text(item.name, '未知歌曲'),
    artist: artistText(item, '未知艺术家'),
    album: albumText(item),
    cover: coverUrl(item),
    ...(item.duration != null || item.dt != null ? { duration: Number(item.duration ?? Number(item.dt) / 1000) || 0 } : {}),
    source: 'ChKSz',
    level: text(item.level, requestedLevel),
    br: item.br ?? item.bitrate,
  };
}

export function normalizeLyricsPayload(payload) {
  if (payload?.code !== 200 || !payload.data) return null;
  const lrc = payload.data.lrc;
  const translated = payload.data.tlyric ?? payload.data.tlrc;
  return {
    lrc: text(typeof lrc === 'object' ? lrc?.lyric : lrc),
    tlrc: text(typeof translated === 'object' ? translated?.lyric : translated),
    yrc: text(typeof payload.data.yrc === 'object' ? payload.data.yrc?.lyric : payload.data.yrc),
    ...Object.fromEntries(['ttml', 'qrc', 'krc', 'vtt', 'romalrc', 'ytlrc', 'yromalrc'].filter(key => payload.data[key]).map(key => [key, text(typeof payload.data[key] === 'object' ? payload.data[key]?.lyric : payload.data[key])])),
  };
}

function playlistItems(payload) {
  if (Array.isArray(payload?.data?.tracks)) return payload.data.tracks;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.playlist?.tracks)) return payload.playlist.tracks;
  return [];
}

export function normalizePlaylistPayload(payload) {
  return playlistItems(payload).filter(hasId).map(item => ({
    id: item.id,
    ...metadataFields(item),
    name: text(item.name, '未知歌曲'),
    artist: artistText(item),
    album: albumText(item),
    cover: coverUrl(item),
    ...(item.duration != null || item.dt != null ? { duration: Number(item.duration ?? Number(item.dt) / 1000) || 0 } : {}),
  }));
}

export function normalizePlaylistCollectionPayload(payload) {
  const item = payload?.data ?? payload?.playlist;
  if (!item || typeof item !== 'object' || Array.isArray(item) || !hasId(item)) {
    return null;
  }

  const tracks = normalizePlaylistPayload(payload);
  const declaredTrackCount = Number(item.trackCount);
  const creator = item.creator;

  return {
    id: item.id,
    ...metadataFields(item),
    name: text(item.name, '未命名歌单'),
    cover: coverUrl(item),
    creator: typeof creator === 'string'
      ? text(creator)
      : text(creator?.nickname ?? creator?.name),
    trackCount: Number.isFinite(declaredTrackCount) && declaredTrackCount >= 0
      ? declaredTrackCount
      : tracks.length,
    tracks,
  };
}
