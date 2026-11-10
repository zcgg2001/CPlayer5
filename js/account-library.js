import { cleanRecords, cleanSong, SYNC_SETTINGS, same } from './account-data.js';

export function createAccountLibrary({ storage, player, refreshFavorites, onSettings }) {
  let progress = {}, currentQueue = null;
  let deviceId = storage.getItem('cp_device_id');
  if (!deviceId) { deviceId = crypto.randomUUID(); storage.setItem('cp_device_id', deviceId); }
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) || fallback; } catch { return fallback; } };
  const songs = list => list.map(song => { try { return cleanSong(typeof song === 'object' ? song : { id: song }); } catch { return null; } }).filter(Boolean);
  return {
    capture({ withProgress = false } = {}) {
      const records = {};
      for (const [key, value] of read('cp_favorites_v1', [])) { try { records[`favorite:${key}`] = cleanSong(value); } catch {} }
      for (const [id, value] of Object.entries(read('cp_saved_playlists_v1', {}))) records[`playlist:${id}`] = value;
      for (const key of SYNC_SETTINGS) { const value = storage.getItem(key); if (value !== null) records[`setting:${key}`] = value; }
      records.queue = { name: '播放队列', songs: songs(player.queue()) };
      if (withProgress) {
        const value = player.progress();
        if (value?.song?.id && value.position > 0) progress[`progress:${deviceId}`] = { ...value, song: cleanSong(value.song), position: Math.floor(value.position), device: /Mobile|Android|iPhone/.test(navigator.userAgent) ? '手机' : window.cplayerDesktop ? '桌面客户端' : '浏览器', savedAt: Date.now() };
      }
      return cleanRecords({ ...records, ...progress });
    },
    apply(records) {
      const favorites = [], playlists = {}; progress = {};
      for (const [key, value] of Object.entries(records)) {
        if (value === null) continue;
        if (key.startsWith('favorite:')) favorites.push([key.slice(9), value]);
        if (key.startsWith('playlist:')) playlists[key.slice(9)] = value;
        if (key.startsWith('progress:')) progress[key] = value;
      }
      storage.setItem('cp_favorites_v1', JSON.stringify(favorites));
      storage.setItem('cp_saved_playlists_v1', JSON.stringify(playlists)); refreshFavorites();
      const changed = [];
      for (const key of SYNC_SETTINGS) {
        const value = records[`setting:${key}`] ?? null;
        if (value !== storage.getItem(key)) { changed.push(key); if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
      }
      if (changed.length) onSettings(changed);
      const next = records.queue || { songs: [], name: '播放队列' };
      if (!same(next, currentQueue)) { currentQueue = next; player.setQueue(next.songs); }
    },
    saved: () => read('cp_saved_playlists_v1', {}),
    save(name) {
      const saved = read('cp_saved_playlists_v1', {}), id = crypto.randomUUID();
      saved[id] = { name: name.trim().slice(0, 80) || '我的歌单', songs: songs(player.queue()) };
      cleanRecords(Object.fromEntries(Object.entries(saved).map(([k, v]) => [`playlist:${k}`, v])));
      storage.setItem('cp_saved_playlists_v1', JSON.stringify(saved));
    },
    remove(id) { const saved = read('cp_saved_playlists_v1', {}); delete saved[id]; storage.setItem('cp_saved_playlists_v1', JSON.stringify(saved)); },
    load(id) { const saved = read('cp_saved_playlists_v1', {}); if (saved[id]) player.setQueue(saved[id].songs); },
    resume(value) { return player.resume(value); },
    deviceId,
  };
}
