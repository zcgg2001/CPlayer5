import { artworkIdentity, versionOf } from './music-catalog.js?v=2';
import { entityKey } from './library-data.js';
import { Converter } from './vendor/opencc/t2cn.js';

const INDEX = 'zp_artwork_choices_v1', SETTING = 'zp_artwork_lookup';
let simplify;
const text = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
const canonical = value => (simplify ||= Converter({ from: 'hk', to: 'cn' }))(text(value).normalize('NFKC'));
const normalized = value => canonical(value).toLowerCase().replace(/[\s·•]+/g, '');
const version = song => versionOf(canonical(song.name), canonical(song.versionLabel));
const known = value => value && !/^(unknown|未知.*)$/i.test(value);
const album = song => text(song?.albumEntity?.name || (typeof song?.album === 'object' ? song.album?.name : song?.album));
const artists = value => text(value).split(/\s*(?:\/|、|,|，|;|；| & | feat\. | ft\. )\s*/i).map(normalized).filter(Boolean).sort().join('|');
export const originalArtworkTrack = song => song?.artworkSource || song || {};
export function artworkChoiceKey(song) {
  const track = originalArtworkTrack(song);
  if (track.id == null || track.type && track.type !== 'song') return '';
  // Store a bounded fingerprint, including the selected release, rather than provider URLs.
  return entityKey({ provider: 'artwork', name: JSON.stringify([
    artworkIdentity(track) || `${track.provider || 'local'}:${track.sourceId || track.id}`,
    normalized(track.name), artists(track.artist), normalized(album(track)), version(track).descriptor,
  ]) });
}

export function itunesCover(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.mzstatic.com') && !url.username && !url.password
      && !url.port && !url.search && !url.hash && url.href.length <= 1500
      && /\/\d+x\d+bb\.(?:jpg|png|webp)$/.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}

export function artworkSearchCandidates(song, rows) {
  const track = originalArtworkTrack(song);
  if (!known(text(track.name)) || !known(text(track.artist)) || !Array.isArray(rows)) return [];
  const wantedVersion = version(track);
  const duration = Number(track.duration || track.metadata?.duration || track.durationSeconds || track.dt / 1000);
  const seen = new Set();
  return rows.slice(0, 40).flatMap(row => {
    if (row?.kind !== 'song' || !/^\d{1,20}$/.test(String(row.collectionId)) || !/^\d{1,20}$/.test(String(row.trackId))) return [];
    const cover = itunesCover(row.artworkUrl100), candidateVersion = version({ name: row.trackName });
    if (!cover || normalized(row.trackName) !== normalized(track.name) || artists(row.artistName) !== artists(track.artist)
        || wantedVersion.kind !== candidateVersion.kind || wantedVersion.descriptor !== candidateVersion.descriptor) return [];
    const seconds = Number(row.trackTimeMillis) / 1000;
    if (duration > 0 && seconds > 0 && Math.abs(duration - seconds) > 3) return [];
    const id = String(row.collectionId);
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, trackId: String(row.trackId), cover, name: text(row.trackName), artist: text(row.artistName),
      album: text(row.collectionName), source: 'iTunes',
      sameAlbum: Boolean(known(album(track)) && normalized(album(track)) === normalized(row.collectionName)) }];
  }).sort((a, b) => Number(b.sameAlbum) - Number(a.sameAlbum)).slice(0, 8);
}

async function boundedJSON(response) {
  if (!response.ok) throw new Error('封面查询暂时不可用，请稍后重试');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) throw new Error('封面查询结果过大');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(await new Blob(chunks).text());
}

export function createArtworkLookup({ fetchImpl = globalThis.fetch, native = false, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  return async (song, { signal } = {}) => {
    const track = originalArtworkTrack(song);
    signal?.throwIfAborted();
    if (!known(text(track.name)) || !known(text(track.artist))) return [];
    const term = `${text(track.name).slice(0, 120)} ${text(track.artist).slice(0, 120)}`;
    let rows = cache.get(term);
    if (!rows || rows.expires <= now()) {
      if (!pending.has(term)) {
        const request = (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6500);
          try {
            const url = native ? `/android-player/artwork-search?${new URLSearchParams({ term })}`
              : `https://itunes.apple.com/search?${new URLSearchParams({ term, country: 'hk', media: 'music', entity: 'song', limit: '30' })}`;
            const result = await boundedJSON(await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }));
            controller.signal.throwIfAborted();
            if (!Array.isArray(result.results)) throw new Error('封面查询返回了无效结果');
            const value = { rows: result.results.slice(0, 40), expires: now() + 300000 };
            cache.delete(term); cache.set(term, value);
            while (cache.size > 100) cache.delete(cache.keys().next().value);
            return value;
          } finally { clearTimeout(timer); }
        })().finally(() => pending.delete(term));
        pending.set(term, request);
      }
      rows = await waitFor(pending.get(term), signal);
    }
    signal?.throwIfAborted();
    return artworkSearchCandidates(track, rows.rows);
  };
}

async function waitFor(pending, signal) {
  if (!signal) return pending;
  signal.throwIfAborted();
  let abort;
  const canceled = new Promise((_, reject) => {
    abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([pending, canceled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export function createArtworkRecovery({ lookup, loadImage, toUrl, storage }) {
  const choices = new Map(), revisions = new Map(), retries = new Map();
  let enabled = true, settingVersion = 0;
  try {
    enabled = storage?.getItem(SETTING) !== 'off';
    const saved = JSON.parse(storage?.getItem(INDEX) || '[]');
    for (const [id, choice] of saved.slice(-100)) {
      if (!/^name:[a-f0-9]{1,16}$/.test(id)) continue;
      if (choice?.original === true) choices.set(id, { original: true });
      else if (itunesCover(choice?.cover)) choices.set(id, { cover: choice.cover, source: 'iTunes', album: text(choice.album), manual: choice.manual === true });
    }
  } catch { /* Choices remain available for this visit if persistence is unavailable. */ }
  const remember = (id, choice) => {
    choices.delete(id); choices.set(id, choice);
    while (choices.size > 100) choices.delete(choices.keys().next().value);
    try { storage?.setItem(INDEX, JSON.stringify([...choices])); return !!storage; } catch { return false; }
  };
  const revision = id => revisions.get(id) || 0;
  const bump = id => { revisions.set(id, revision(id) + 1); while (revisions.size > 200) revisions.delete(revisions.keys().next().value); };
  async function apply(song, candidate, { signal, manual = true, expected, isCurrent = () => true } = {}) {
    signal?.throwIfAborted();
    const id = artworkChoiceKey(song), cover = itunesCover(candidate?.cover);
    if (!id || !cover) throw new Error('此封面不可用');
    const url = toUrl(cover, 640);
    await loadImage(url, { signal });
    signal?.throwIfAborted();
    if (revision(id) !== expected || !isCurrent()) return null;
    bump(id);
    const saved = remember(id, { cover, source: 'iTunes', album: text(candidate.album), manual });
    return { url, status: 'ready', recovered: true, saved };
  }
  return {
    get: song => choices.get(artworkChoiceKey(song)),
    enabled: () => enabled,
    setEnabled(value) { enabled = !!value; settingVersion++; try { storage?.setItem(SETTING, enabled ? 'on' : 'off'); } catch {} },
    search(song, options) { return artworkChoiceKey(song) ? lookup(song, options) : Promise.resolve([]); },
    choose(song, candidate, options = {}) {
      const id = artworkChoiceKey(song); bump(id);
      return apply(song, candidate, { ...options, manual: true, expected: revision(id) });
    },
    restore(song) { const id = artworkChoiceKey(song); if (!id) return false; bump(id); return remember(id, { original: true }); },
    async recover(song, { signal } = {}) {
      const track = originalArtworkTrack(song), id = artworkChoiceKey(song), initial = revision(id), config = settingVersion;
      if (!enabled || !id || choices.get(id)?.original || choices.get(id)?.manual || ['bilibili', 'local'].includes(track.provider)
          || retries.get(id) > Date.now()) return null;
      retries.delete(id); retries.set(id, Date.now() + 30000);
      while (retries.size > 100) retries.delete(retries.keys().next().value);
      const matches = (await lookup(song, { signal })).filter(candidate => candidate.sameAlbum);
      signal?.throwIfAborted();
      if (matches.length !== 1 || revision(id) !== initial || config !== settingVersion) return null;
      return apply(song, matches[0], { signal, manual: false, expected: initial, isCurrent: () => config === settingVersion });
    },
  };
}
