import { normalizeDocument } from './document.js';
import { samePlaybackRecording } from '../playback-router.js';
import { neteaseMetadataId } from '../music-catalog.js';
const KEY = 'cp_lyricTracks_v1';
export function trackKey(track) {
  if (track?.id == null) return '';
  const neteaseId = neteaseMetadataId(track);
  if (neteaseId) return `netease:${neteaseId}`;
  return track.catalogId ? `catalog:${track.catalogId}` : `${track.provider || 'local'}:${track.sourceId || track.id}`;
}
export function createLyricMemory(storage) {
  let entries;
  try { entries = JSON.parse(storage.getItem(KEY)); } catch { /* Storage unavailable. */ }
  entries = Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.key === 'string').slice(0, 12) : [];
  return {
    get(key) {
      const value = entries.find(entry => entry.key === key);
      if (!value) return null;
      try { return { ...value, document: value.document ? normalizeDocument(value.document) : null }; }
      catch { return { ...value, document: null }; }
    },
    save(key, patch) {
      if (!key) return false;
      const value = { ...(entries.find(entry => entry.key === key) || {}), ...patch, key };
      const next = [value, ...entries.filter(entry => entry.key !== key)].slice(0, 12);
      try { storage.setItem(KEY, JSON.stringify(next)); entries = next; return true; } catch { return false; }
    },
  };
}
// Only already-linked recordings may be compared; never match unrelated titles by timestamp quality.
export function lyricQuality(doc) { return doc.lines.filter(line => line.words.length).length * 3 + doc.lines.filter(line => line.translation).length + doc.lines.filter(line => line.romanization).length; }
export function chooseBestLyrics(candidates) { return candidates.filter(item => item.document?.lines.length).sort((a, b) => lyricQuality(b.document) - lyricQuality(a.document))[0] || null; }
export function matchingLyricSources(track, candidates) {
  const seen = new Set();
  return [track, ...candidates.filter(candidate => samePlaybackRecording(track, candidate))].filter(candidate => {
    const identity = `${candidate.provider}:${candidate.sourceId || candidate.id}`;
    if (seen.has(identity)) return false; seen.add(identity); return true;
  });
}
