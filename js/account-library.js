import { LIBRARY_KEY, personalRecord } from './personal-library-store.js';
import { cleanRecords, cleanSong, SYNC_SETTINGS, MAX_SYNC_SETTING_LENGTH, same } from './account-data.js';

export function createAccountLibrary({ storage, player, refreshFavorites, onSettings }) {
  let progress = {}, currentQueue = null;
  let deviceId = storage.getItem('cp_device_id');
  if (!deviceId) { deviceId = crypto.randomUUID(); storage.setItem('cp_device_id', deviceId); }
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) || fallback; } catch { return fallback; } };
  const oversized = value => typeof value === 'string' && value.length > MAX_SYNC_SETTING_LENGTH;
  const localSettingsKey = owner => `cp_local_large_settings_v1:${owner || 'guest'}`;
  const songs = list => list.map(song => { try { return cleanSong(typeof song === 'object' ? song : { id: song }); } catch { return null; } }).filter(Boolean);
  return {
    saveGuestQueue() {
      storage.setItem('cp_guest_queue_v1', JSON.stringify(songs(player.queue())));
    },
    restoreGuestQueue() {
      const saved = read('cp_guest_queue_v1', null);
      if (Array.isArray(saved)) player.setQueue(songs(saved));
    },
    switchLocalSettings(nextOwner, { erase = false } = {}) {
      const owner = storage.getItem('cp_account_owner');
      if (owner === nextOwner) return;
      const previous = {};
      for (const key of SYNC_SETTINGS) {
        const value = storage.getItem(key);
        if (oversized(value)) previous[key] = value;
      }
      // Store the original before clearing it from the shared player keys.
      if (!erase && Object.keys(previous).length) {
        try { storage.setItem(localSettingsKey(owner), JSON.stringify({ ...read(localSettingsKey(owner), {}), ...previous })); }
        catch { return; } // Keep the local value if there is no room to copy it.
      } else if (erase) {
        storage.removeItem(localSettingsKey(owner));
      }
      for (const key of Object.keys(previous)) storage.removeItem(key);
      const next = read(localSettingsKey(nextOwner), {});
      try {
        for (const key of SYNC_SETTINGS) {
          if (oversized(next[key])) storage.setItem(key, next[key]);
        }
        storage.removeItem(localSettingsKey(nextOwner));
      } catch { /* Keep the backup if available storage is too small to restore. */ }
    },
    capture({ withProgress = false, cloudSettings = {} } = {}) {
      const records = {};
      for (const [key, value] of read('cp_favorites_v1', [])) { try { records[`favorite:${key}`] = cleanSong(value); } catch {} }
      for (const [id, value] of Object.entries(read('cp_saved_playlists_v1', {}))) records[`playlist:${id}`] = value;
      for (const key of SYNC_SETTINGS) {
        const record = `setting:${key}`;
        const value = storage.getItem(key);
        // A large local copy does not replace or delete its smaller cloud version.
        const shared = oversized(value) ? cloudSettings[record] : value;
        if (typeof shared === 'string' && !oversized(shared)) records[record] = shared;
      }
      records.queue = { name: '播放队列', songs: songs(player.queue()) };
      if (withProgress) {
        const value = player.progress();
        if (value?.song?.id && value.position > 0) progress[`progress:${deviceId}`] = { ...value, song: cleanSong(value.song), position: Math.floor(value.position), device: /Mobile|Android|iPhone/.test(navigator.userAgent) ? '手机' : window.cplayerDesktop ? '桌面客户端' : '浏览器', savedAt: Date.now() };
      }
      return cleanRecords({ ...records, ...progress, ...read(LIBRARY_KEY, {}) });
    },
    apply(records) {
      const favorites = [], playlists = {}; progress = {};
      for (const [key, value] of Object.entries(records)) {
        if (value === null) continue;
        if (key.startsWith('favorite:')) favorites.push([key.slice(9), value]);
        if (key.startsWith('playlist:')) playlists[key.slice(9)] = value;
        if (key.startsWith('progress:')) progress[key] = value;
      }
      storage.setItem(LIBRARY_KEY, JSON.stringify(Object.fromEntries(Object.entries(records).filter(([key]) => personalRecord(key)))));
      storage.setItem('cp_favorites_v1', JSON.stringify(favorites));
      storage.setItem('cp_saved_playlists_v1', JSON.stringify(playlists)); refreshFavorites();
      const changed = [];
      for (const key of SYNC_SETTINGS) {
        const current = storage.getItem(key);
        if (oversized(current)) continue;
        const value = records[`setting:${key}`] ?? null;
        if (value !== current) { changed.push(key); if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
      }
      if (changed.length) onSettings(changed);
      globalThis.window?.dispatchEvent(new Event('cplayer:library-applied'));
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
