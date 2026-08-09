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
    name: text(item.name, '未知歌曲'),
    artist: artistText(item),
    album: albumText(item),
    cover: coverUrl(item),
    source: 'ChKSz',
  }));
}

function orsSearchItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const candidate of [
    payload?.data?.songs,
    payload?.data?.list,
    payload?.result?.songs,
    payload?.result?.list,
    payload?.data,
    payload?.result,
  ]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function orsArtistText(item) {
  const artists = item?.singer
    ?? item?.artist
    ?? item?.artists
    ?? item?.author
    ?? item?.singerName;
  if (Array.isArray(artists)) {
    const names = artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name ?? artist?.singer)
      .map(name => text(name))
      .filter(Boolean);
    return names.length ? names.join(item?.artists ? ', ' : '/') : '未知艺术家';
  }
  if (artists && typeof artists === 'object') {
    return text(artists.name ?? artists.singer ?? artists.author, '未知艺术家');
  }
  return text(artists, '未知艺术家');
}

function orsAlbumText(item) {
  const album = item?.albumName ?? item?.album ?? item?.album_name;
  return album && typeof album === 'object'
    ? text(album.name ?? album.title)
    : text(album);
}

function orsId(item) {
  return text(item?.id ?? item?.songmid ?? item?.songMid ?? item?.mid);
}

function orsPlatform(value) {
  const platform = text(value, 'qq').toLowerCase();
  return ['qq', 'kg', 'kw', 'mg'].includes(platform) ? platform : 'qq';
}

export function normalizeOrsSearchPayload(payload, platform = 'qq') {
  const resolvedPlatform = orsPlatform(platform);
  return orsSearchItems(payload).filter(item => orsId(item)).map(item => {
    const id = orsId(item);
    return {
      id,
      sourceId: id,
      name: text(item?.name ?? item?.songname ?? item?.title, '未知歌曲'),
      artist: orsArtistText(item),
      album: orsAlbumText(item),
      cover: coverUrl(item),
      source: `ORS · ${resolvedPlatform.toUpperCase()}`,
      provider: 'ors',
      platform: resolvedPlatform,
      interval: text(item?.interval ?? item?.duration),
      albumId: text(item?.albumId ?? item?.album_id),
      mainHash: text(item?.mainHash ?? item?.main_hash),
    };
  });
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

export function normalizeOrsSongPayload(
  payload,
  requestedLevel = 'lossless',
  platform = 'qq',
  fallbackId = '',
) {
  const wrapped = payload?.data ?? payload?.result;
  const item = Array.isArray(wrapped)
    ? wrapped[0]
    : wrapped && typeof wrapped === 'object'
      ? wrapped
      : payload;
  if (!item || typeof item !== 'object') return null;
  const url = text(item.url);
  if (!url) return null;
  const id = orsId(item) || text(item.songmid) || text(fallbackId);
  const resolvedPlatform = orsPlatform(platform);
  return {
    id,
    sourceId: id,
    url,
    name: text(item.name ?? item.songname ?? item.title, '未知歌曲'),
    artist: orsArtistText(item),
    album: orsAlbumText(item),
    cover: coverUrl(item),
    lrc: text(item.lrc ?? item.lyric),
    source: `ORS · ${resolvedPlatform.toUpperCase()}`,
    provider: 'ors',
    platform: resolvedPlatform,
    level: text(item.level, requestedLevel),
    ext: text(item.ext),
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

export function normalizeOrsLyricsPayload(payload) {
  if (typeof payload === 'string') return { lrc: text(payload), tlrc: '', yrc: '' };
  const item = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    lrc: text(item?.lrc ?? item?.lyric ?? item?.lyrics),
    tlrc: text(item?.tlrc ?? item?.tlyric),
    yrc: text(item?.yrc),
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
