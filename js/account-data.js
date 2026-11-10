// Shared wire format. Never synchronize playable URLs, service keys or browser caches.
export const SYNC_SETTINGS = ['cp_theme', 'cp_quality', 'cp_source', 'cp_download_quality', 'cp_anime_thumb', 'cp_immersiveMode', 'cp_lyricAppearance', 'cp_lyricStudio_v1', 'cp_lyricTracks_v1'];
// D1 limits an entire row to 2,000,000 bytes, including metadata columns.
export const MAX_SYNC_BYTES = 1_990_000;
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function cleanSong(song) {
  if (!song || typeof song !== 'object' || !/^[\w:.\-]{1,160}$/.test(String(song.id))) throw new Error('歌曲 ID 无效');
  const result = { id: String(song.id) };
  for (const key of ['name', 'artist', 'album', 'provider', 'source', 'sourceId', 'platform', 'mid']) {
    if (typeof song[key] === 'string') result[key] = song[key].slice(0, 300);
  }
  for (const key of ['duration', 'durationSeconds', 'dt']) if (Number.isFinite(song[key]) && song[key] >= 0) result[key] = song[key];
  // Album art is public metadata; signed audio URLs and arbitrary object fields are excluded.
  if (typeof song.cover === 'string' && song.cover.length < 1500 && /^https:\/\//.test(song.cover) && !/[?&](token|key|signature)=/i.test(song.cover)) result.cover = song.cover;
  return result;
}
export function cleanRecords(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 2500) throw new Error('同步项目过多或格式无效');
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^(favorite:[\w:.\-]{1,200}|playlist:[\w-]{1,80}|setting:cp_[\w]+|queue|progress:[\w-]{1,80})$/.test(key)) throw new Error('同步类型无效');
    if (key.startsWith('setting:') && !SYNC_SETTINGS.includes(key.slice(8))) throw new Error('设置不允许同步');
    if (value === null) { output[key] = null; continue; } // Durable tombstone.
    if (key.startsWith('favorite:')) output[key] = cleanSong(value);
    else if (key.startsWith('setting:')) {
      if (typeof value !== 'string' || value.length > 16000) throw new Error('设置过大');
      output[key] = value;
    } else if (key.startsWith('progress:')) {
      if (!Number.isFinite(value.position) || value.position < 0 || value.position > 86400 || !Number.isFinite(value.savedAt)) throw new Error('播放进度无效');
      output[key] = { song: cleanSong(value.song), position: Math.floor(value.position), savedAt: value.savedAt, device: String(value.device || '设备').slice(0, 60) };
    } else {
      if (!Array.isArray(value.songs) || value.songs.length > 1000) throw new Error('每个队列或歌单最多同步 1000 首歌曲');
      output[key] = { name: String(value.name || '我的歌单').slice(0, 80), songs: value.songs.map(cleanSong) };
    }
  }
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_SYNC_BYTES) throw new Error('云端资料超过 2 MB，请减少歌单数量');
  return output;
}
// Three-way merge: disjoint edits merge, competing edits require a user's choice.
export function mergeRecords(base, local, remote) {
  const records = {}, conflicts = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[key] ?? null, l = local[key] ?? null, r = remote[key] ?? null;
    if (same(l, b) || same(l, r)) records[key] = r;
    else if (same(r, b)) records[key] = l;
    else { records[key] = l; conflicts.push(key); }
  }
  return { records, conflicts };
}
