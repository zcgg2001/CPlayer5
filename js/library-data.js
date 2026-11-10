// Shared, bounded metadata projections. Audio URLs and blobs never enter cloud data.
export const songKey = song => `${song.provider || 'gd'}:${song.id}`;
export const text = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function imageURL(value) {
  if (typeof value !== 'string' || value.length > 1500) return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[?&](token|key|signature)=/i.test(value) ? url.href : ''; } catch { return ''; }
}
export function cleanSong(song) {
  if (!song || typeof song !== 'object' || !/^[\w:.\-]{1,160}$/.test(String(song.id))) throw new Error('歌曲 ID 无效');
  const result = { id: String(song.id) };
  for (const key of ['name', 'artist', 'album', 'provider', 'source', 'sourceId', 'platform', 'mid']) if (typeof song[key] === 'string') result[key] = song[key].slice(0, 300);
  for (const key of ['duration', 'durationSeconds', 'dt']) if (Number.isFinite(song[key]) && song[key] >= 0) result[key] = song[key];
  const cover = imageURL(song.cover); if (cover) result.cover = cover;
  if (typeof song.downloadAllowed === 'boolean') result.downloadAllowed = song.downloadAllowed;
  const entity = item => ({ ...(item.id != null ? { id: text(String(item.id), 100) } : {}), name: text(item.name), ...(imageURL(item.cover || item.avatar) ? { cover: imageURL(item.cover || item.avatar) } : {}) });
  if (song.albumEntity?.name) result.albumEntity = entity(song.albumEntity);
  if (Array.isArray(song.artistEntities || song.artists)) result.artistEntities = (song.artistEntities || song.artists).filter(a => a?.name).slice(0, 10).map(entity);
  return result;
}
export function entityKey(item) {
  if (item.id) return `${item.provider || 'netease'}:${item.id}`;
  // Stable name reference when the provider supplies no catalog ID.
  let a = 2166136261, b = 5381;
  for (const c of `${item.provider || 'unknown'}:${item.name}:${item.artist || ''}`.normalize('NFKC').toLowerCase()) { a = Math.imul(a ^ c.codePointAt(0), 16777619); b = Math.imul(b, 33) ^ c.codePointAt(0); }
  return `name:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export function cleanEntity(item) {
  if (!item || !['album', 'artist', 'playlist'].includes(item.type) || !text(item.name)) throw new Error('收藏资料无效');
  const id = text(item.id == null ? '' : String(item.id), 100), provider = text(item.provider || 'netease', 40);
  if ((id && !/^[\w:.\-]+$/.test(id)) || !/^[\w-]+$/.test(provider)) throw new Error('收藏来源无效');
  return { type: item.type, id, provider, name: text(item.name), artist: text(item.artist), cover: imageURL(item.cover), description: text(item.description, 1200), addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0 };
}
export function cleanPlaylist(value) {
  if (!value || !Array.isArray(value.songs) || value.songs.length > 1000) throw new Error('歌单最多 1000 首歌曲');
  const songs = [...new Map(value.songs.map(cleanSong).map(s => [songKey(s), s])).values()];
  return { name: text(value.name, 80) || '我的歌单', description: text(value.description, 1200), cover: imageURL(value.cover), songs,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    order: Number.isFinite(value.order) ? Math.max(0, Math.min(10000, value.order)) : 0,
    ...(typeof value.sharedId === 'string' && /^[\w-]{1,80}$/.test(value.sharedId) ? { sharedId: value.sharedId } : {}) };
}
export function cleanAnnotation(value) {
  if (!value || !Array.isArray(value.tags) || value.tags.length > 12 || !Number.isInteger(value.rating) || value.rating < 0 || value.rating > 5) throw new Error('标签或评分无效');
  return { tags: [...new Set(value.tags.map(v => text(v, 30)).filter(Boolean))], rating: value.rating, note: text(value.note, 2000) };
}
export function cleanHistory(value) {
  if (!value || !Number.isFinite(value.at) || !Number.isFinite(value.seconds) || value.seconds < 0 || value.seconds > 86400 || !Number.isFinite(value.position) || value.position < 0 || value.position > 86400) throw new Error('播放记录无效');
  return { song: cleanSong(value.song), at: value.at, seconds: Math.round(value.seconds), position: Math.floor(value.position) };
}
export function cleanListening(value) {
  if (!value || !Number.isFinite(value.seconds) || value.seconds < 0 || value.seconds > 2678400 || !Number.isInteger(value.plays) || value.plays < 0 || value.plays > 100000) throw new Error('听歌统计无效');
  const days = {}, artists = {};
  if (Object.keys(value.days || {}).length > 31 || Object.keys(value.artists || {}).length > 100) throw new Error('统计项目过多');
  for (const [day, seconds] of Object.entries(value.days || {})) { if (!/^(0[1-9]|[12]\d|3[01])$/.test(day) || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error('每日统计无效'); days[day] = Math.round(seconds); }
  for (const [artist, seconds] of Object.entries(value.artists || {})) { if (!artist || artist.length > 300 || ['__proto__','constructor','prototype'].includes(artist) || !Number.isFinite(seconds) || seconds < 0 || seconds > 2678400) throw new Error('艺人统计无效'); artists[artist] = Math.round(seconds); }
  return { seconds: Math.round(value.seconds), plays: value.plays, days, artists };
}
export function libraryStats(records, year) {
  let seconds = 0, plays = 0; const artists = new Map(), days = new Map(), months = Array(12).fill(0);
  for (const [key, v] of Object.entries(records)) if (key.startsWith(`listen:${year}-`) && v) {
    const month = key.slice(7,14); seconds += v.seconds; plays += v.plays; months[Number(month.slice(5))-1] += v.seconds;
    for (const [day, n] of Object.entries(v.days)) days.set(`${month}-${day}`, (days.get(`${month}-${day}`) || 0) + n);
    for (const [name, n] of Object.entries(v.artists)) artists.set(name, (artists.get(name) || 0) + n);
  }
  return { seconds, plays, activeDays: days.size, months, artists: [...artists].sort((a,b) => b[1]-a[1]).slice(0,10) };
}
