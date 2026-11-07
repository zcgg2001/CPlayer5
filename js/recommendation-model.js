import { aggregateSongs, extractMetadata, neteaseMetadataId, sourceKey, sourceBlocked } from './music-catalog.js';

export const PREFERENCE_GROUPS = Object.freeze({
  '语种': ['华语', '欧美', '日语', '韩语'], '年代': ['80s', '90s', '00s'],
  '风格': ['流行', '摇滚', '民谣', '电子', '爵士', '古典', 'City Pop', '后摇', '纯音乐'],
  '场景': ['通勤', '学习', '深夜', '跑步'],
});
export const SCENES = [
  { id: 'commute', name: '通勤', category: '在路上', note: '把路上的时间交给音乐', icon: 'TrainFront' },
  { id: 'study', name: '学习', category: '学习', note: '留一片专注的空间', icon: 'BookOpen' },
  { id: 'night', name: '深夜', category: '夜晚', note: '陪你慢慢放松下来', icon: 'Moon' },
  { id: 'run', name: '跑步', category: '运动', note: '找到自己的节奏', icon: 'Activity' },
];
const allowedTags = new Set(Object.values(PREFERENCE_GROUPS).flat());
const str = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
const normalize = value => str(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
export const recordingKey = song => { const id = neteaseMetadataId(song); return id ? `netease:${id}` : song.catalogId || sourceKey(song); };
export const artistNames = song => (song?.artistEntities?.length ? song.artistEntities.map(a => a.name) : song?.artists?.length ? song.artists.map(a => a.name) : str(song?.artist).split(/\s*[/、]\s*/)).filter(name => name && !/^未知|^unknown$/i.test(name));
export const canRecommend = song => song.playable !== false && !(song.sources || [song]).every(source => sourceBlocked(source));
export function dayKey(now = Date.now()) { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); }
export function hash(value) { let n = 2166136261; for (const char of value) { n ^= char.codePointAt(0); n = Math.imul(n, 16777619); } return n >>> 0; }

// An explicit projection keeps signed playback URLs, credentials and arbitrary file data out of storage.
export function storedSong(song) {
  if (!song || song.id == null || !str(song.name)) return null;
  const provider = str(song.provider) || 'gd';
  const info = extractMetadata(song);
  const cover = str(song.cover);
  return { id: String(song.id).slice(0, 300), sourceId: String(song.sourceId || song.id).slice(0, 300), provider,
    name: str(song.name), artist: str(song.artist) || info.artistEntities?.map(a => a.name).join(' / ') || '未知歌手',
    album: typeof song.album === 'string' ? str(song.album) : str(song.album?.name),
    cover: /^(https?:\/\/|\/api\/v1\/music\/cover\?)/.test(cover) ? cover : '',
    duration: info.metadata.duration, metadata: { ...info.metadata, description: '' },
    artistEntities: (info.artistEntities || []).slice(0, 10).map(a => ({ id: a.id, name: a.name })),
    ...(song.catalogId ? { catalogId: song.catalogId, sources: (song.sources || []).slice(0, 10).map(source => storedSong({ ...source, catalogId: undefined, sources: undefined })).filter(Boolean) } : {}),
  };
}
export function parsePlaylistInput(input) {
  const value = str(input);
  if (/^\d{1,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['music.163.com', 'y.music.163.com'].includes(url.hostname) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
    return /(?:^|\/)playlist(?:\/|$)/.test(route.pathname) && /^\d{1,20}$/.test(route.searchParams.get('id') || '') ? route.searchParams.get('id') : null;
  } catch { return null; }
}
export function parseLibraryJson(text) {
  if (text.length > 2 * 1024 * 1024) throw new Error('歌单文件不能超过 2 MB');
  const data = JSON.parse(text), rows = Array.isArray(data) ? data : data?.tracks || data?.songs || data?.playlist?.tracks;
  if (!Array.isArray(rows)) throw new Error('请使用歌曲数组或包含 tracks / songs 的 JSON 歌单');
  if (rows.length > 1000) throw new Error('一次最多导入 1,000 首，请拆分歌单');
  const tracks = rows.map(row => {
    if (typeof row === 'number' || typeof row === 'string') return /^\d{1,20}$/.test(String(row)) ? storedSong({ id: row, name: `歌曲 ID: ${row}` }) : null;
    const info = extractMetadata(row || {});
    return storedSong({ ...row, ...info, artist: typeof row?.artist === 'string' ? row.artist : info.artistEntities?.map(a => a.name).join(' / '),
      album: typeof row?.album === 'string' ? row.album : info.albumEntity?.name });
  }).filter(Boolean);
  if (!tracks.length) throw new Error('文件中没有带 id 和歌曲名称的曲目');
  return tracks;
}
export function analyzeLibrary(tracks) {
  const artists = new Map(), genres = new Map();
  for (const song of tracks) {
    artistNames(song).forEach(name => artists.set(name, (artists.get(name) || 0) + 1));
    (song.metadata?.genres || []).forEach(name => genres.set(name, (genres.get(name) || 0) + 1));
  }
  const ranked = map => [...map].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  return { count: tracks.length, artists: ranked(artists), genres: ranked(genres) };
}
export function matchesFilters(song, filters = {}) {
  const data = song.metadata || extractMetadata(song).metadata;
  const languages = { '华语': /华语|国语|普通话|粤语|闽南|中文|Chinese|Mandarin|Cantonese/i, '欧美': /英语|英文|English|法语|德语|西班牙|French|German|Spanish/i, '日语': /日语|日文|Japanese/i, '韩语': /韩语|韩文|Korean/i };
  if (filters.language && !languages[filters.language]?.test(data.language || '')) return false;
  if (filters.era) { const start = { '80s': 1980, '90s': 1990, '00s': 2000 }[filters.era], year = Number(data.releaseDate?.slice(0, 4)); if (!year || year < start || year > start + 9) return false; }
  if (filters.genre && !(data.genres || []).some(g => normalize(g) === normalize(filters.genre))) return false;
  for (const [min, max, value] of [[filters.bpmMin, filters.bpmMax, data.bpm], [filters.durationMin, filters.durationMax, data.duration]]) {
    if ((min !== '' && min != null || max !== '' && max != null) && !(Number(value) > 0)) return false;
    if (min !== '' && min != null && Number(value) < Number(min)) return false;
    if (max !== '' && max != null && Number(value) > Number(max)) return false;
  }
  return true;
}
export function rankRecommendations(tracks, { profile, favorites = [], context = new Map(), day = dayKey(), seed = null, limit = 30 } = {}) {
  const signals = [
    ...profile.history.filter(h => h.listened >= 15).slice(0, 30).map(h => ({ song: h.song, kind: '听了' })),
    ...favorites.slice(0, 50).map(song => ({ song, kind: '收藏了' })),
    ...profile.library.slice(0, 100).map(song => ({ song, kind: '导入了' })),
  ];
  if (seed) signals.unshift({ song: seed, kind: '选择了' });
  const blocked = new Set(profile.dismissed);
  const ranked = aggregateSongs(tracks).filter(song => !blocked.has(recordingKey(song)) && canRecommend(song)).map(song => {
    let score = 0, reason = context.get(recordingKey(song)) || '来自公开榜单，探索不同的声音';
    const artists = artistNames(song).map(normalize);
    const sameArtist = signals.find(item => artistNames(item.song).some(a => artists.includes(normalize(a))));
    if (sameArtist) { score += 30; reason = `因为你${sameArtist.kind}《${sameArtist.song.name}》· 同艺人作品`; }
    const preferredGenre = (song.metadata.genres || []).find(g => profile.tags.some(t => normalize(t) === normalize(g)));
    if (preferredGenre) { score += 20; if (!sameArtist) reason = `你偏好 ${preferredGenre}`; }
    const language = profile.tags.find(tag => PREFERENCE_GROUPS['语种'].includes(tag) && matchesFilters(song,{language:tag}));
    const era = profile.tags.find(tag => PREFERENCE_GROUPS['年代'].includes(tag) && matchesFilters(song,{era:tag}));
    if (language) { score += 15; if (!sameArtist && !preferredGenre) reason = `符合你的「${language}」语种偏好`; }
    if (era) { score += 15; if (!sameArtist && !preferredGenre && !language) reason = `你偏好 ${era} 年代的作品`; }
    if (profile.tags.some(tag => context.get(recordingKey(song))?.includes(`「${tag}」`))) score += 16;
    const favorite = favorites.some(f => recordingKey(f) === recordingKey(song));
    if (favorite) { score += 8; reason = '回味你收藏过的歌曲'; }
    if (profile.history.slice(0, 5).some(h => recordingKey(h.song) === recordingKey(song))) score -= 12;
    score += hash(`${day}:${profile.seed}:${recordingKey(song)}`) / 0xffffffff * 18;
    return { song, reason, score };
  }).sort((a, b) => b.score - a.score);
  const chosen = [], deferred = [], artistCounts = new Map(), cap = Math.max(2, Math.ceil(limit / 10));
  for (const entry of ranked) {
    const artists = artistNames(entry.song).map(normalize);
    if (artists.some(artist => (artistCounts.get(artist) || 0) >= cap)) { deferred.push(entry); continue; }
    chosen.push(entry); artists.forEach(artist => artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1));
  }
  return [...chosen, ...deferred].slice(0, limit);
}

export function createDiscoveryProfile({ storage, now = Date.now, random = Math.random } = {}) {
  const key = 'cp_discovery_profile_v1';
  let saved; try { saved = JSON.parse(storage?.getItem(key) || 'null'); } catch { /* Ignore corrupt data. */ }
  const profile = { seed: String(saved?.seed || random()), tags: Array.isArray(saved?.tags) ? saved.tags.filter(t => allowedTags.has(t)).slice(0, 12) : [],
    history: [], library: [], dismissed: Array.isArray(saved?.dismissed) ? saved.dismissed.filter(v => typeof v === 'string').slice(-500) : [] };
  profile.library = (Array.isArray(saved?.library) ? saved.library : []).slice(0, 1000).map(storedSong).filter(Boolean);
  profile.history = (Array.isArray(saved?.history) ? saved.history : []).slice(0, 100).filter(h => storedSong(h?.song)).map(h => ({ song: storedSong(h.song), position: Math.max(0, Number(h.position) || 0), listened: Math.max(0, Number(h.listened) || 0), at: Number(h.at) || 0 }));
  let persistent = true;
  const save = () => { try { storage?.setItem(key, JSON.stringify(profile)); persistent = Boolean(storage); } catch { persistent = false; } };
  save();
  return { profile, persistent: () => persistent,
    setTags(tags) { profile.tags = [...new Set(tags)].filter(t => allowedTags.has(t)).slice(0, 12); save(); },
    import(tracks) { profile.library = [...new Map([...tracks, ...profile.library].map(storedSong).filter(Boolean).map(s => [recordingKey(s), s])).values()].slice(0, 1000); save(); },
    dismiss(song) { profile.dismissed = [...new Set([...profile.dismissed, recordingKey(song)])].slice(-500); save(); },
    undoDismiss(song) { profile.dismissed = profile.dismissed.filter(k => k !== recordingKey(song)); save(); },
    resetDismissed() { profile.dismissed = []; save(); },
    record(song, position = 0, listenedDelta = 0) {
      const clean = storedSong(song); if (!clean) return;
      const identity = recordingKey(clean), prior = profile.history.find(h => recordingKey(h.song) === identity);
      profile.history = [{ song: clean, position: Math.max(0, Number(position) || 0), listened: (prior?.listened || 0) + Math.max(0, Math.min(15, listenedDelta)), at: now() }, ...profile.history.filter(h => recordingKey(h.song) !== identity)].slice(0, 100); save();
    },
  };
}
