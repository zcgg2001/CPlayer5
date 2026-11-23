import { normalizeDocument } from './document.js';
import { samePlaybackRecording } from '../playback-router.js';
import { neteaseMetadataId } from '../music-catalog.js';
const KEY = 'cp_lyricTracks_v1';
export function trackKey(track) {
  if (track?.id == null) return '';
  // Audio fallback keeps the queue recording in artworkSource; use that stable
  // identity for lyrics too, so a later provider choice still finds the cache.
  if (track.artworkSource?.id != null && track.artworkSource !== track) return trackKey({ ...track.artworkSource, artworkSource: undefined });
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
      const read = doc => { try { return doc ? normalizeDocument(doc) : null; } catch { return null; } };
      return { ...value, document: read(value.document), onlineDocument: read(value.onlineDocument) };
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
export function hasLyrics(doc) {
  const text = doc?.lines?.map(line => line.text).filter(Boolean).join('\n') || doc?.plain || '';
  return Boolean(text.trim() && !/^(?:\s*(?:纯音乐.*|暂无歌词|没有歌词|歌词暂无|no lyrics.*|instrumental)\s*)$/i.test(text));
}
export function lyricQuality(doc) { return (doc.lines.some(line => line.text) ? 100 : 0) + doc.lines.filter(line => line.words.length).length * 3 + doc.lines.filter(line => line.translation).length + doc.lines.filter(line => line.romanization).length; }
const lyricCoverage = doc => (doc.lines.length ? doc.lines.map(line => line.text).join('') : doc.plain).replace(/\s/g, '').length;
export function chooseBestLyrics(candidates) { return candidates.filter(item => hasLyrics(item.document)).sort((a, b) => lyricQuality(b.document) - lyricQuality(a.document) || lyricCoverage(b.document) - lyricCoverage(a.document))[0] || null; }
export function matchingLyricSources(track, candidates) {
  const seen = new Set();
  return [track, ...candidates.filter(candidate => samePlaybackRecording(track, candidate))].filter(candidate => {
    const identity = `${candidate.provider}:${candidate.sourceId || candidate.id}`;
    if (seen.has(identity)) return false; seen.add(identity); return true;
  });
}
