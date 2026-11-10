import { cleanRecords } from './account-data.js';
import { cleanSong, cleanPlaylist, cleanEntity, cleanAnnotation, songKey, entityKey, libraryStats } from './library-data.js';
export const LIBRARY_KEY = 'cp_personal_library_v2';
export const personalRecord = key => /^(entity:|annotation:|history:|listen:)/.test(key);
export function createPersonalLibraryStore({ storage, now = Date.now, onChange = () => {}, uuid = () => crypto.randomUUID() }) {
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) || fallback; } catch { return fallback; } };
  const records = () => read(LIBRARY_KEY, {});
  const write = (key, value) => { storage.setItem(key, JSON.stringify(value)); onChange(); };
  const update = (key, value) => { const next = { ...records(), [key]: value }; write(LIBRARY_KEY, cleanRecords(next)); };
  const lists = () => Object.entries(read('cp_saved_playlists_v1', {})).map(([id, p]) => ({ id, ...cleanPlaylist(p) })).sort((a,b) => a.order-b.order || b.createdAt-a.createdAt);
  function setList(id, value) { const all = read('cp_saved_playlists_v1', {}); if (value === null) delete all[id]; else all[id] = cleanPlaylist(value); cleanRecords(Object.fromEntries(Object.entries(all).map(([key,v]) => [`playlist:${key}`,v]))); write('cp_saved_playlists_v1', all); return id; }
  return {
    records, lists,
    favorites: () => read('cp_favorites_v1', []).map(([,s]) => s),
    toggleSong(song) { const clean = cleanSong(song), key = songKey(clean), all = new Map(read('cp_favorites_v1', [])); const added = !all.has(key); if (added) all.set(key, clean); else all.delete(key); write('cp_favorites_v1', [...all]); return added; },
    entities: type => Object.entries(records()).filter(([key,v]) => key.startsWith(`entity:${type}:`) && v).map(([key,v]) => ({ key,...v })).sort((a,b) => b.addedAt-a.addedAt),
    toggleEntity(input) { const item = cleanEntity({ ...input, addedAt: now() }), key = `entity:${item.type}:${entityKey(item)}`, added = !records()[key]; update(key, added ? item : null); return added; },
    removeEntity(key) { if (key.startsWith('entity:')) update(key,null); },
    annotation: song => records()[`annotation:${songKey(song)}`] || { tags: [], rating: 0, note: '' },
    annotate(song, value) { update(`annotation:${songKey(song)}`, cleanAnnotation(value)); },
    create(name, songs = []) { return setList(uuid(), { name, songs, createdAt: now(), updatedAt: now(), order: lists().length }); },
    updateList(id, value) { const old = read('cp_saved_playlists_v1', {})[id]; if (!old) throw new Error('歌单不存在'); return setList(id, { ...old, ...value, updatedAt: now() }); },
    removeList: id => setList(id,null),
    moveList(id, direction) { const all = lists(), index = all.findIndex(p => p.id===id), next = index+direction; if (index<0 || next<0 || next>=all.length) return; [all[index],all[next]]=[all[next],all[index]]; write('cp_saved_playlists_v1', Object.fromEntries(all.map(({id,...p},i) => [id,{...p,order:i}]))); },
    history: () => Object.entries(records()).filter(([k,v]) => k.startsWith('history:') && v).map(([id,v]) => ({id,...v})).sort((a,b) => b.at-a.at),
    record({ sessionId, deviceId, song, seconds, position, first = false }) {
      if (!(seconds > 0)) return;
      const next = records(), at = now(), date = new Date(at), month = date.toISOString().slice(0,7), day = date.toISOString().slice(8,10);
      const key = `history:${sessionId}`, prior = next[key];
      next[key] = { song: cleanSong(song), at, seconds: Math.min(86400,(prior?.seconds || 0)+seconds), position: Math.min(86400,position) };
      const statsKey = `listen:${month}:${deviceId}`, stats = next[statsKey] || { seconds:0,plays:0,days:{},artists:{} };
      const delta = Math.min(30, Math.max(0, seconds)); stats.seconds = Math.min(2678400,stats.seconds+delta); if (first) stats.plays++;
      stats.days[day] = Math.min(86400,(stats.days[day] || 0)+delta);
      const artist = String(song.artist || '未知歌手').trim().slice(0,300);
      if (!['__proto__','constructor','prototype'].includes(artist)) stats.artists[artist] = (stats.artists[artist] || 0)+delta;
      stats.artists = Object.fromEntries(Object.entries(stats.artists).sort((a,b)=>b[1]-a[1]).slice(0,100)); next[statsKey]=stats;
      // Recent sessions and two years of monthly totals keep cloud rows bounded.
      const recent = Object.entries(next).filter(([k,v])=>k.startsWith('history:') && v).sort((a,b)=>b[1].at-a[1].at);
      for (const [k] of recent.slice(200)) delete next[k];
      const cutoff = new Date(at); cutoff.setUTCDate(1); cutoff.setUTCMonth(cutoff.getUTCMonth()-23); const before=cutoff.toISOString().slice(0,7);
      for (const k of Object.keys(next)) if (k.startsWith('listen:') && k.slice(7,14)<before) delete next[k];
      write(LIBRARY_KEY, cleanRecords(next));
    },
    clearHistory() { write(LIBRARY_KEY, Object.fromEntries(Object.entries(records()).filter(([k])=>!k.startsWith('history:')))); },
    clearStats() { write(LIBRARY_KEY, Object.fromEntries(Object.entries(records()).filter(([k])=>!k.startsWith('listen:')))); },
    stats: year => libraryStats(records(),year),
  };
}

// Count elapsed listening only while media advances; seeks, buffering and pauses add no time.
export function createListeningTracker({ audio, store, getSong, getOwner, deviceId, now = () => performance.now(), uuid = () => crypto.randomUUID() }) {
  let active = null, previous = null, pending = 0;
  function flush() { if (!active || pending < 1) return; const seconds = Math.floor(pending); store.record({ ...active, seconds, position: Number(audio.currentTime)||0, first: !active.counted }); active.counted=true; pending-=seconds; }
  function reset() { flush(); active=null; previous=null; pending=0; }
  function tick() {
    const song=getSong(), owner=getOwner(); if (!song?.id || audio.paused || audio.ended || audio.seeking || audio.readyState<2) { previous=null; return; }
    const key=owner+':'+songKey(song), time=now(), media=audio.currentTime;
    if (active?.key!==key) { reset(); active={key,song:cleanSong(song),sessionId:uuid(),deviceId,owner,counted:false}; }
    if (previous) { const wall=(time-previous.time)/1000, moved=media-previous.media; if (wall>0 && wall<=30 && moved>0 && moved<=wall*Math.max(1,audio.playbackRate||1)+1) pending+=Math.min(wall,moved/Math.max(.25,audio.playbackRate||1)); }
    previous={time,media}; if(pending>=10)flush();
  }
  audio.addEventListener('timeupdate',tick);
  for(const event of ['pause','waiting','seeking','ended']) audio.addEventListener(event,()=>{flush();previous=null;if(event==='ended')reset();});
  audio.addEventListener('playing',()=>{previous=null;tick();});
  return { tick, flush, reset };
}
