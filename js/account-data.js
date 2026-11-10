import { cleanSong, cleanPlaylist, cleanEntity, cleanAnnotation, cleanHistory, cleanListening } from './library-data.js';
export { cleanSong } from './library-data.js';
// Shared wire format. Never synchronize playable URLs, service keys or browser caches.
export const SYNC_SETTINGS = ['cp_theme', 'cp_quality', 'cp_source', 'cp_download_quality', 'cp_anime_thumb', 'cp_immersiveMode', 'cp_lyricAppearance', 'cp_lyricStudio_v1', 'cp_lyricTracks_v1'];
// D1 limits an entire row to 2,000,000 bytes, including metadata columns.
export const MAX_SYNC_BYTES = 1_990_000;
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function cleanRecords(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 2500) throw new Error('同步项目过多或格式无效');
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^(favorite:[\w:.\-]{1,200}|playlist:[\w-]{1,80}|setting:cp_[\w]+|entity:(album|artist|playlist):[\w:.\-]{1,180}|annotation:[\w:.\-]{1,200}|history:[\w-]{1,80}|listen:\d{4}-(?:0[1-9]|1[0-2]):[\w-]{1,80}|queue|progress:[\w-]{1,80})$/.test(key)) throw new Error('同步类型无效');
    if (key.startsWith('setting:') && !SYNC_SETTINGS.includes(key.slice(8))) throw new Error('设置不允许同步');
    if (value === null) { output[key] = null; continue; } // Durable tombstone.
    if (key.startsWith('favorite:')) output[key] = cleanSong(value);
    else if (key.startsWith('entity:')) output[key] = cleanEntity(value);
    else if (key.startsWith('annotation:')) output[key] = cleanAnnotation(value);
    else if (key.startsWith('history:')) output[key] = cleanHistory(value);
    else if (key.startsWith('listen:')) output[key] = cleanListening(value);
    else if (key.startsWith('playlist:')) output[key] = cleanPlaylist(value);
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
