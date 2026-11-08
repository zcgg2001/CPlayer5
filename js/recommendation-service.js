import { requestJson } from './http.js';
import { catalogRecord, neteaseMetadataId } from './music-catalog.js';
import { artistNames, analyzeLibrary, canRecommend, recordingKey, rankRecommendations, storedSong, SCENES, hash, dayKey } from './recommendation-model.js';

export function createRecommendationService({ musicService, profileStore, storage, fetchImpl } = {}) {
  const memory = new Map();
  const get = async (action, params = {}, signal) => {
    const path = `/api/v1/discovery/${action}?${new URLSearchParams(params)}`;
    const cached = memory.get(path); if (cached?.expires > Date.now()) return cached.data;
    const data = await requestJson(path, { signal, fetchImpl, timeoutMs: 16_000 });
    memory.set(path, { data, expires: Date.now() + 300_000 });
    while (memory.size > 30) memory.delete(memory.keys().next().value);
    return data;
  };
  const playlist = (id, signal) => get('playlist', { id }, signal);
  const playlists = (category, signal, offset = 0) => get('playlists', { category, offset }, signal);
  const charts = signal => get('charts', {}, signal);
  const favorites = () => { try { const rows = JSON.parse(storage?.getItem('cp_favorites_v1') || '[]'); return rows.map(pair => storedSong(pair[1])).filter(Boolean); } catch { return []; } };
  const categoryFor = tag => SCENES.find(scene => scene.name === tag)?.category || ({ '80s': '80年代', '90s': '90年代', '00s': '00年代' }[tag]) || tag;
  let pool = [], newSongs = [], context = new Map();
  const add = (tracks, reason = '') => {
    for (const song of tracks) if (reason) context.set(recordingKey(song), reason);
    pool = [...new Map([...pool, ...tracks].filter(Boolean).map(song => [recordingKey(song), song])).values()].slice(-800);
  };
  const snapshotKey = 'cp_recommendation_pool_v1';
  try {
    const saved = JSON.parse(storage?.getItem(snapshotKey) || 'null');
    if (saved?.at > Date.now() - 86400000 && Array.isArray(saved.pool)) pool = saved.pool.map(storedSong).filter(Boolean).slice(0, 300);
  } catch { /* A corrupt snapshot never blocks the page. */ }
  const rank = (options = {}) => rankRecommendations(pool, { profile: profileStore.profile, favorites: favorites(), context, ...options });
  let homeGeneration = 0;
  async function loadHome(signal, onUpdate = () => {}) {
    const generation = ++homeGeneration;
    const current = () => generation === homeGeneration && !signal?.aborted;
    const sections = { hot: 'loading', news: 'loading' };
    const errors = new Map();
    const publish = (loading = true) => {
      if (current()) onUpdate({ errors: [...errors.values()], sections: { ...sections }, loading,
        stale: !loading && !Object.values(sections).includes('ready') });
    };
    add(profileStore.profile.library.filter(song => !song.name.startsWith('歌曲 ID:')));
    publish();
    const chartsPending = Promise.allSettled([['3778678', 'hot'], ['3779629', 'news']].map(async ([id, section]) => {
      try {
        const data = await playlist(id, signal);
        if (!current()) return;
        if (section === 'news') newSongs = data.tracks;
        add(data.tracks, section === 'news' ? '来自网易云新歌榜' : '来自网易云热歌榜');
        sections[section] = 'ready';
      } catch {
        if (!current()) return;
        sections[section] = 'error';
        errors.set(section, section === 'news' ? '新歌榜暂时不可用' : '热歌榜暂时不可用');
      }
      publish();
    }));
    const profile = profileStore.profile;
    const seed = profile.history.find(h => h.listened >= 15)?.song || favorites()[0] || profile.library.find(s => artistNames(s).length);
    const tasks = [];
    if (seed) {
      const artist = artistNames(seed)[0];
      if (artist) tasks.push(musicService.search(artist, { source: 'gd', limit: 10, signal }).then(songs => {
        if (current()) { add(songs); publish(); }
      }));
    }
    const rotation = hash(`${dayKey()}:${profile.seed}`) % Math.max(1,profile.tags.length);
    const todayTags = [...profile.tags.slice(rotation), ...profile.tags.slice(0,rotation)].slice(0,2);
    for (const tag of todayTags) tasks.push((async () => {
      const list = await playlists(categoryFor(tag), signal);
      if (!current()) return;
      if (list.items[0]) {
        const data = await playlist(list.items[0].id, signal);
        if (current()) { add(data.tracks, `来自你偏好的「${tag}」主题歌单`); publish(); }
      }
    })());
    await Promise.allSettled([chartsPending, ...tasks]);
    if (!current()) return;
    try { storage?.setItem(snapshotKey, JSON.stringify({ at: Date.now(), pool: pool.slice(-300).map(storedSong) })); } catch { /* optional */ }
    publish(false);
    return { errors: [...errors.values()] };
  }
  async function radioBatch({ mode, seed, page, signal }) {
    if (mode === 'personal' && page === 0) return rank({ limit: 100 });
    if (mode === 'song' && page === 0) {
      const seedArtists = artistNames(seed).map(name => name.normalize('NFKC').toLowerCase());
      const genres = seed?.metadata?.genres || [];
      const related = pool.filter(song => artistNames(song).some(name => seedArtists.includes(name.normalize('NFKC').toLowerCase()))
        || song.metadata?.genres?.some(genre => genres.includes(genre)));
      if (related.length > 1) return rankRecommendations(related, { profile:profileStore.profile, seed, limit:50 }).map(entry => ({ ...entry,
        reason: artistNames(entry.song).some(name => seedArtists.includes(name.normalize('NFKC').toLowerCase()))
          ? `因为你选择了《${seed.name}》· 同艺人作品` : `与《${seed.name}》有共同风格标签`,
      }));
    }
    if (mode === 'song' && page > 0 && page % 3 === 0 && seed?.metadata?.genres?.length) {
      const genre = seed.metadata.genres[Math.floor(page / 3 - 1) % seed.metadata.genres.length];
      const collections = await playlists(genre, signal, Math.floor(page / 3 - 1) * 6);
      if (collections.items[0]) {
        const data = await playlist(collections.items[0].id, signal);
        return data.tracks.map(song => ({ song:catalogRecord(song), reason:`从《${seed.name}》的 ${genre} 风格探索主题歌单` }));
      }
    }
    const artist = artistNames(seed)[0] || analyzeLibrary([...profileStore.profile.history.map(h => h.song), ...profileStore.profile.library, ...favorites()]).artists[page % 8]?.name;
    if (mode === 'artist' && page === 0) {
      const artistId = seed?.artistEntities?.[0]?.id || seed?.artists?.[0]?.providerId;
      if (neteaseMetadataId(seed) && /^\d+$/.test(String(artistId || ''))) {
        try { const data = await get('artist', { id: artistId }, signal); return data.tracks.map(song => ({ song: catalogRecord(song), reason: `艺人电台 · ${artist}` })); } catch (error) { if (signal.aborted) throw error; }
      }
    }
    if (artist) {
      const songs = await musicService.search(artist, { source: 'gd', limit: 10, offset: Math.max(0, page - 1) * 10, signal });
      const matches = mode === 'artist' ? songs.filter(song => artistNames(song).some(a => a.normalize('NFKC').toLowerCase() === artist.normalize('NFKC').toLowerCase())) : songs;
      add(matches);
      return matches.map(song => ({ song: catalogRecord(song), reason: mode === 'artist' ? `艺人电台 · ${artist}` : `因为你选择了《${seed?.name || artist}》· 同艺人候选` }));
    }
    const tag = profileStore.profile.tags[(page - 1) % Math.max(1, profileStore.profile.tags.length)] || ['华语', '欧美', '日语', '纯音乐'][(page - 1) % 4];
    const collections = await playlists(categoryFor(tag), signal, Math.floor((page - 1) / 4) * 6);
    const selected = collections.items[(page - 1) % Math.max(1, collections.items.length)];
    if (!selected) return [];
    const data = await playlist(selected.id, signal);
    return data.tracks.map(song => ({ song: catalogRecord(song), reason: `私人电台 · ${tag}主题歌单` }));
  }
  return { loadHome, playlist, playlists, charts, rank, add, favorites, radioBatch, categoryFor,
    newSongs: () => newSongs, pool: () => pool, context: () => context };
}

export function createRadio({ fetchBatch, profile, onChange = () => {} }) {
  let session = null, generation = 0;
  const notify = () => onChange(session ? { active: true, mode: session.mode, seed: session.seed, loading: session.loading, reason: session.reason, error: session.error } : { active: false });
  const stop = () => { generation++; session?.controller.abort(); session = null; notify(); };
  async function fill(current) {
    if (current.pending) return current.pending;
    current.pending = (async () => {
      // Bounded fetches per advance. An empty feed remains explicitly retryable.
      for (let attempt = 0; attempt < 3 && current.buffer.length < 5 && current.page < 100; attempt++) {
        const rows = await fetchBatch({ mode: current.mode, seed: current.seed, page: current.page, signal: current.controller.signal });
        if (session !== current) return;
        current.page++;
        for (const row of rows) {
          const id = recordingKey(row.song);
          if (!current.seen.has(id) && !current.queued.has(id) && !profile.dismissed.includes(id) && canRecommend(row.song)) { current.queued.add(id); current.buffer.push(row); }
        }
      }
    })().finally(() => { current.pending = null; });
    return current.pending;
  }
  async function next() {
    const current = session;
    if (!current || current.loading) return null;
    current.loading = true; current.error = ''; notify();
    try {
      if (!current.buffer.length) await fill(current);
      else await Promise.resolve();
      if (session !== current) return null;
      let row;
      while (current.buffer.length) {
        const candidate = current.buffer.shift();
        if (!profile.dismissed.includes(recordingKey(candidate.song))) { row = candidate; break; }
      }
      if (!row) { current.error = '这一轮候选已播完，点击下一首重试或重新开启电台'; return null; }
      current.seen.add(recordingKey(row.song)); current.reason = row.reason;
      if (current.seen.size >= 500) { current.error = '本轮已播放 500 首，请重新开启电台'; current.buffer = []; current.page = 100; }
      return { ...row.song, _radioSession: current.id };
    } catch (error) {
      if (session === current && !current.controller.signal.aborted) current.error = error.message || '电台暂时无法续播，请重试';
      return null;
    } finally { if (session === current) { current.loading = false; notify(); } }
  }
  return { next, stop, active: () => Boolean(session), owns: song => Boolean(session && song?._radioSession === session.id),
    async start(mode, seed = null) {
      stop(); session = { id: ++generation, mode, seed, page: 0, controller: new AbortController(), seen: new Set(seed ? [recordingKey(seed)] : []), queued: new Set(), buffer: [], loading: false, error: '', reason: '' };
      return next();
    },
  };
}
