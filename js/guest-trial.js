export const GUEST_LIMIT = 50;
export function createGuestTrial(storage) {
  const storageKey = 'cp_guest_trial_v1';
  let memory = new Set();
  const read = () => { try { const value = JSON.parse(storage.getItem(storageKey) || '[]'); memory = new Set([...memory, ...(Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(0, GUEST_LIMIT) : [])]); } catch {} return new Set(memory); };
  const key = song => `${song.provider || song.source || 'gd'}:${song.id}`;
  return {
    remaining: () => Math.max(0, GUEST_LIMIT - read().size),
    allows: song => read().has(key(song)) || read().size < GUEST_LIMIT,
    record(song) { const played = read(); if (played.size < GUEST_LIMIT) played.add(key(song)); memory = played; try { storage.setItem(storageKey, JSON.stringify([...played])); } catch { /* Keep a tab-local quota if storage is unavailable. */ } },
  };
}
