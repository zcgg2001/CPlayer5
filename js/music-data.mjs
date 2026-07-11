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
  return text(item?.picUrl ?? item?.cover ?? item?.album?.picUrl ?? item?.al?.picUrl);
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
    name: text(item.name, '未知歌曲'),
    artist: artistText(item),
    album: albumText(item),
    cover: coverUrl(item),
    source: 'ChKSz',
  }));
}

export function normalizeSongPayload(payload, requestedLevel = 'jymaster') {
  if (payload?.code !== 200 || !payload.data) return null;
  const item = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!hasId(item) || !text(item?.url)) return null;

  return {
    id: item.id,
    url: text(item.url),
    name: text(item.name, '未知歌曲'),
    artist: artistText(item, '未知艺术家'),
    album: albumText(item),
    cover: coverUrl(item),
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
    yrc: text(payload.data.yrc),
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
    name: text(item.name, '未知歌曲'),
    artist: artistText(item),
    album: albumText(item),
    cover: coverUrl(item),
  }));
}
