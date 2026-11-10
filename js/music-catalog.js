import { MUSIC_CHANNELS, channelSourceId } from './music-channels.js';

const clean = value => typeof value === 'string' ? value.trim() : '';
const key = value => clean(value).normalize('NFKC').toLocaleLowerCase().replace(/[\s·•]+/g, '');
const entityId = (type, value) => `${type}:${encodeURIComponent(value)}`;
const unknown = value => !value || /^(unknown|未知.*)$/i.test(value);
export const CATALOG_SOURCES = Object.freeze(['gd', ...Object.keys(MUSIC_CHANNELS)]);
export const AVAILABILITY_LABELS = Object.freeze({ playable: '已验证可播', resolved: '已解析 · 待验证', unknown: '待验证', checking: '检查中', login_required: '需登录', no_copyright: '无版权', region_restricted: '地区限制', unavailable: '暂不可用' });
const restrictions = new Set(['login_required', 'no_copyright', 'region_restricted']);
export function availability(value, now = Date.now()) {
  const state = value?.availability || value || {};
  if (!AVAILABILITY_LABELS[state.status] || (state.expiresAt && state.expiresAt < now)) return { status: 'unknown' };
  return state;
}
export const sourceBlocked = (source, level) => { const state=availability(source); return restrictions.has(state.status) && (!level || !state.requestedLevel || state.requestedLevel===level); };
export function groupAvailability(song) {
  const states = (song.sources || [song]).map(source => availability(source));
  for (const status of ['playable', 'checking', 'resolved', 'unknown']) if (states.some(item => item.status === status)) return { status };
  if (states.every(item => item.status === states[0]?.status)) return states[0];
  return { status: 'unavailable' };
}

export function versionOf(name, explicit = '') {
  const title = clean(name).normalize('NFKC');
  const qualifiers = [...title.matchAll(/[（(\[]([^\])）]+)[\])）]/g)].map(match => match[1]);
  const text = `${title} ${explicit}`;
  const kinds = [];
  if (/\bremix\b|混音/i.test(text)) kinds.push('remix');
  if (/\blive\b|现场|演唱会/i.test(text)) kinds.push('live');
  if (/伴奏|\b(?:karaoke|accompaniment)\b/i.test(text)) kinds.push('accompaniment');
  if (/纯音乐|器乐|\binstrumental\b/i.test(text)) kinds.push('instrumental');
  // Qualifiers are part of the recording identity: two live shows/remixers must not collapse.
  const descriptor = key([explicit, ...qualifiers].filter(Boolean).join(' '));
  const baseTitle = title.replace(/[（(\[]([^\])）]+)[\])）]/g, (all, part) => /remix|live|混音|现场|演唱会|伴奏|karaoke|accompaniment|纯音乐|器乐|instrumental/i.test(part) ? '' : all).trim();
  return { kind: kinds.join('+') || 'original', label: kinds.map(kind => ({remix:'Remix',live:'Live',accompaniment:'伴奏',instrumental:'纯音乐'})[kind]).join(' · ') || '原版 / 未标注', descriptor, baseTitle };
}

export function artworkVariants(cover) {
  if (!cover) return [];
  const original = { label: '原图', url: cover };
  try {
    const url = new URL(cover);
    if (!['https:', 'http:'].includes(url.protocol)) return [];
    // Only known unsigned CDN paths have a supported size contract.
    if (url.hostname.endsWith('.music.126.net') && [...url.searchParams.keys()].every(k => k === 'param')) {
      return [160, 400, 800].map(size => { const sized = new URL(url); sized.protocol = 'https:'; sized.searchParams.set('param', `${size}y${size}`); return { size, label: `${size} px`, url: sized.href }; });
    }
    if (url.hostname === 'y.gtimg.cn' && !url.search && /\/T002R\d+x\d+M000/.test(url.pathname)) {
      return [150, 300, 800].map(size => ({ size, label: `${size} px`, url: url.href.replace(/T002R\d+x\d+M000/, `T002R${size}x${size}M000`).replace(/^http:/,'https:') }));
    }
    return [original];
  } catch { return /^\/api\/(?:v1\/music\/)?cover\?/.test(cover) ? [original] : []; }
}

// Preserve only known metadata fields, never an arbitrary upstream object or signed audio URL.
export function extractMetadata(item) {
  const supplied = item.metadata || {};
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const artistItems = item.artistEntities || item.artists || item.ar || item.singer;
  const album = item.albumEntity || (typeof item.album === 'object' ? item.album : item.al);
  let date = supplied.releaseDate || item.releaseDate || item.publishDate || item.time_public || album?.releaseDate;
  // NetEase publication timestamps represent a calendar date in China Standard Time.
  if (!date && positive(item.publishTime || album?.publishTime)) { const parsed = new Date(Number(item.publishTime || album.publishTime) + 8 * 60 * 60 * 1000); if (Number.isFinite(parsed.getTime())) date = parsed.toISOString().slice(0,10); }
  const genres = supplied.genres || item.genres || item.genre;
  const bitrate = positive(supplied.bitrate ?? item.bitrate ?? item.br);
  const metadata = {
    duration: positive(supplied.duration ?? item.duration ?? (item.dt ? Number(item.dt) / 1000 : item.interval)),
    bitrate: bitrate > 10000 ? bitrate / 1000 : bitrate,
    bpm: positive(supplied.bpm ?? item.bpm),
    releaseDate: clean(date), language: clean(supplied.language || item.language).replace(/^(?:-?\d+|unknown)$/i,''),
    genres: (Array.isArray(genres) ? genres : typeof genres === 'string' ? genres.split(/[,、;/]/) : []).map(clean).filter(Boolean),
    label: clean(supplied.label || item.label || item.company || album?.company).replace(/^(?:0|-1|unknown)$/i,''),
    isrc: clean(supplied.isrc || item.isrc || item.ISRC).toUpperCase().replace(/[ -]/g, ''),
    description: clean(supplied.description || item.description || item.summary),
  };
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(metadata.isrc)) metadata.isrc = '';
  const result = { metadata };
  if (Array.isArray(artistItems)) result.artistEntities = artistItems.map(artist => typeof artist === 'string' ? {name:artist} : { id: artist?.id ?? artist?.mid, name: clean(artist?.name), avatar: clean(artist?.avatar || artist?.picUrl), description: clean(artist?.description || artist?.briefDesc) }).filter(artist => artist.name);
  if (album) result.albumEntity = { id: album.id ?? album.mid, ...(album.mid ? {mid:clean(album.mid)} : {}), name: clean(album.name || album.title), description: clean(album.description || album.briefDesc), cover: clean(album.cover || album.picUrl) };
  if (restrictions.has(item.availability?.status)) result.availability = { status: item.availability.status, reason: clean(item.availability.reason), evidence: 'source' };
  return result;
}

function platformIdentity(song) {
  const platform = MUSIC_CHANNELS[song.provider]?.platform || (['gd','chksz'].includes(song.provider) ? 'netease' : song.provider);
  let id = String(song.sourceId || channelSourceId(song.provider, song.id));
  if (song.provider?.startsWith('jianbin-')) {
    try { const url = new URL(id); id = url.searchParams.get('id') || id; } catch { /* Keep opaque IDs separate. */ }
  }
  // Gequke IDs belong to its own catalogue, not the Kuwo catalogue.
  return `${song.provider === 'gequke' ? 'gequke' : platform}:${id}`;
}
export function neteaseMetadataId(song) {
  for (const source of song.sources || [song]) {
    const identity = platformIdentity(source);
    if (/^netease:\d{1,20}$/.test(identity)) return identity.slice(8);
  }
  return null;
}

export const sourceKey = song => `${song.provider || 'gd'}:${song.sourceId || song.id}`;

export function catalogRecord(song) {
  if (song.catalogId && song.sources?.length) return song;
  const provider = song.provider || 'gd', raw = { ...song, provider };
  const info = extractMetadata(raw), version = versionOf(raw.name, raw.versionLabel);
  const artistNames = info.artistEntities?.length ? info.artistEntities : [{ name: raw.artist || '未知歌手' }];
  const artists = artistNames.map(artist => ({ ...artist, id: entityId('artist', key(artist.name)), providerId: artist.id ?? null }));
  const artistKey = artistNames.map(artist => key(artist.name)).sort().join('/');
  const workId = entityId('song', `${key(version.baseTitle)}|${artistKey}`);
  const albumName = typeof raw.album === 'string' ? raw.album : info.albumEntity?.name || '';
  const album = { ...info.albumEntity, name: albumName, id: entityId('album', `${key(albumName)}|${artistKey}`), artwork: artworkVariants(raw.cover || info.albumEntity?.cover) };
  const recordingId = entityId('recording', platformIdentity(raw));
  const source = { id: raw.id, sourceId: raw.sourceId || channelSourceId(provider, raw.id), provider, source: raw.source, name: raw.name, artist: raw.artist, album: albumName, cover: raw.cover, duration: info.metadata.duration, metadata: info.metadata, availability: raw.availability || info.availability || {status:'unknown'}, downloadAllowed: raw.downloadAllowed };
  return { ...raw, ...info, catalogId: recordingId, songEntity: {id:workId, title:version.baseTitle, artistIds:artists.map(artist=>artist.id)}, version: {...version,id:recordingId,songId:workId}, artists, albumEntity: album, sources: [source], provenance: Object.fromEntries(Object.entries(info.metadata).filter(([,value]) => Array.isArray(value) ? value.length : value).map(([field,value])=>[field,[{provider,value}]])) };
}

function sameRecording(a, b) {
  if (a.provider === 'bilibili' || b.provider === 'bilibili') return sourceKey(a) === sourceKey(b);
  if (a.sources.some(left => b.sources.some(right => platformIdentity(left) === platformIdentity(right)))) return true;
  if (a.version.kind !== b.version.kind || a.version.descriptor !== b.version.descriptor) return false;
  if (a.metadata.isrc && b.metadata.isrc && a.metadata.isrc !== b.metadata.isrc) return false;
  if (a.metadata.isrc && a.metadata.isrc === b.metadata.isrc) return true;
  if (unknown(a.artist) || unknown(b.artist) || key(a.name) !== key(b.name) || key(a.artist) !== key(b.artist)) return false;
  const durationA = a.metadata.duration, durationB = b.metadata.duration;
  if (durationA && durationB && Math.abs(durationA-durationB) > 3) return false;
  const albumMatch = a.album && b.album && key(a.album) === key(b.album);
  return Boolean(albumMatch && (!durationA || !durationB || Math.abs(durationA-durationB) <= 3));
}
export function aggregateSongs(songs) {
  const groups = [];
  for (const raw of songs) {
    if (!raw?.id || !raw.name) continue;
    const song = catalogRecord(raw), group = groups.find(item => sameRecording(item, song));
    if (!group) { groups.push(structuredClone(song)); continue; }
    for (const source of song.sources) if (!group.sources.some(item => sourceKey(item) === sourceKey(source))) group.sources.push(source);
    for (const [field, value] of Object.entries(song.metadata)) {
      if (!(Array.isArray(value) ? value.length : value)) continue;
      if (!(Array.isArray(group.metadata[field]) ? group.metadata[field].length : group.metadata[field])) group.metadata[field] = value;
      const evidence = group.provenance[field] ||= [];
      if (!evidence.some(item => item.provider === song.provider && JSON.stringify(item.value) === JSON.stringify(value))) evidence.push({provider:song.provider,value});
    }
    if (!group.cover && song.cover) group.cover = song.cover;
    if (!group.albumEntity.artwork.length) group.albumEntity.artwork = song.albumEntity.artwork;
    if (!group.albumEntity.description) group.albumEntity.description = song.albumEntity.description;
    for (const artist of group.artists) { const match = song.artists.find(item => key(item.name) === key(artist.name)); if (match) { artist.avatar ||= match.avatar; artist.description ||= match.description; } }
  }
  return groups;
}

export function relatedMusic(song, catalog, limit = 6) {
  const artistNames = new Set(song.artists.map(artist => key(artist.name)));
  const ranked = catalog.filter(other => other.catalogId !== song.catalogId).map(other => {
    const reasons = [];
    if (other.artists.some(artist => artistNames.has(key(artist.name)) && !unknown(artist.name))) reasons.push('同一歌手');
    if (song.album && key(song.album) === key(other.album)) reasons.push('同一专辑');
    const sharedGenres = song.metadata.genres.filter(genre => other.metadata.genres.includes(genre));
    if (sharedGenres.length) reasons.push(`相同风格：${sharedGenres.join('、')}`);
    return {song:other,reasons,score:reasons.length};
  }).filter(item => item.score).sort((a,b)=>b.score-a.score);
  const artists = new Map();
  for (const entry of ranked) for (const artist of entry.song.artists) {
    if (!artistNames.has(key(artist.name)) && !unknown(artist.name) && entry.reasons.some(reason => reason.startsWith('相同风格'))) artists.set(artist.id,{...artist,reason:entry.reasons.find(reason=>reason.startsWith('相同风格'))});
  }
  return {songs:ranked.slice(0,limit),artists:[...artists.values()].slice(0,limit)};
}

export function mergeMetadata(record, details) {
  const extra = catalogRecord({...details,provider:'netease-metadata'});
  const merged = aggregateSongs([record, {...extra, catalogId:record.catalogId, sources:record.sources}])[0];
  // A detail query is not an additional playable channel.
  merged.sources = record.sources;
  if (details.cover) { merged.cover = details.cover; merged.albumEntity.artwork = artworkVariants(details.cover); }
  merged.metadataRetrievedAt = details.retrievedAt;
  merged.metadataSource = details.metadataSource;
  return merged;
}
