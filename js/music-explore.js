const ARTIST_SCOPES = Object.freeze({
  trending: '趋势歌手',
  new: '新声力量',
  original: '原创音乐人',
  all: '全部歌手',
});

const VIDEO_CATEGORIES = Object.freeze({
  trending: '趋势视频',
  mandopop: '华语现场',
  global: '经典影像',
  live: '现场精选',
});

const ARTIST_CACHE_PREFIX = 'cp_artist_snapshot_v1_';
const VIDEO_CACHE_PREFIX = 'cp_video_snapshot_v2_';

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function safeHttpsUrl(value, allowedHosts = null) {
  try {
    const url = new URL(value, globalThis.location?.href || 'https://cplayer.invalid/');
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return '';
    if (allowedHosts && !allowedHosts.some(host => (
      url.hostname === host || url.hostname.endsWith(`.${host}`)
    ))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function imageVariant(value, width, height = width) {
  const safe = safeHttpsUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  if (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net')) {
    url.searchParams.set('param', `${width}y${height}`);
  }
  return url.href;
}

function createIcon(className) {
  const icon = document.createElement('i');
  icon.className = `fas ${className}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatReleaseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '近期发布';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function normalizeTrack(item) {
  const id = text(item?.playbackId ?? item?.id);
  if (!id) return null;
  return {
    id: text(item?.id, id),
    playbackId: id,
    name: text(item?.name, '未知歌曲'),
    artist: text(item?.artist, '未知艺术家'),
    album: text(item?.album),
    cover: text(item?.cover),
    chart: text(item?.chart),
    rank: Math.max(1, Number(item?.rank) || 1),
    playable: item?.playable !== false,
  };
}

export function normalizeArtistsPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map((item, index) => {
      const tracks = (Array.isArray(item?.tracks) ? item.tracks : [])
        .map(normalizeTrack)
        .filter(Boolean);
      if (!text(item?.id) || !text(item?.name) || !tracks.length) return null;
      return {
        rank: Math.max(1, Number(item.rank) || index + 1),
        id: text(item.id),
        name: text(item.name),
        cover: text(item.cover || tracks[0]?.cover),
        appearances: Math.max(1, Number(item.appearances) || tracks.length),
        chartCount: Math.max(1, Number(item.chartCount) || 1),
        charts: Array.isArray(item.charts) ? item.charts.map(value => text(value)).filter(Boolean) : [],
        score: Math.max(0, Number(item.score) || 0),
        featuredTrack: normalizeTrack(item.featuredTrack) || tracks[0],
        tracks,
      };
    })
    .filter(Boolean);

  if (!items.length) throw new Error('歌手中心没有返回可播放内容');
  return {
    version: Number(payload?.version) || 1,
    collection: {
      key: Object.hasOwn(ARTIST_SCOPES, payload?.collection?.key)
        ? payload.collection.key
        : 'trending',
      name: text(payload?.collection?.name, '趋势歌手'),
      description: text(payload?.collection?.description, '从实时音乐榜单发现歌手。'),
      sourceName: text(payload?.collection?.sourceName, '实时音乐榜单'),
      artistCount: Number(payload?.collection?.artistCount) || items.length,
      fetchedAt: text(payload?.collection?.fetchedAt, new Date().toISOString()),
    },
    items,
  };
}

export function normalizeVideosPayload(payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map(item => {
      const id = text(item?.id);
      const poster = safeHttpsUrl(item?.poster, ['hdslb.com']);
      const externalUrl = safeHttpsUrl(item?.externalUrl, ['bilibili.com']);
      if (!id || !poster || !externalUrl) return null;
      return {
        id,
        name: text(item.name, '未命名音乐视频'),
        artist: text(item.artist, '未知艺术家'),
        artistId: text(item.artistId),
        poster,
        previewUrl: '',
        externalUrl,
        artistUrl: safeHttpsUrl(item.artistUrl, ['bilibili.com']),
        releasedAt: text(item.releasedAt),
        genre: text(item.genre, '音乐视频'),
        explicit: Boolean(item.explicit),
        provider: text(item.provider, '哔哩哔哩'),
      };
    })
    .filter(Boolean);

  if (!items.length) throw new Error('视频中心没有返回可展示内容');
  return {
    version: Number(payload?.version) || 1,
    collection: {
      key: Object.hasOwn(VIDEO_CATEGORIES, payload?.collection?.key)
        ? payload.collection.key
        : 'trending',
      name: text(payload?.collection?.name, '趋势视频'),
      description: text(payload?.collection?.description, '自动发现音乐视频。'),
      sourceName: text(payload?.collection?.sourceName, 'ChKSz 热榜 · 哔哩哔哩'),
      videoCount: Number(payload?.collection?.videoCount) || items.length,
      previewCount: Number(payload?.collection?.previewCount) || 0,
      fetchedAt: text(payload?.collection?.fetchedAt, new Date().toISOString()),
    },
    items,
  };
}

function readSnapshot(storage, prefix, key, normalizer) {
  if (!storage) return null;
  try {
    const payload = JSON.parse(storage.getItem(`${prefix}${key}`));
    return payload ? normalizer(payload) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(storage, prefix, key, payload) {
  if (!storage) return;
  try {
    storage.setItem(`${prefix}${key}`, JSON.stringify(payload));
  } catch {
    // Storage restrictions must not block browsing.
  }
}

async function requestJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message || '内容加载失败');
    }
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function syncTabs(tabLists, dataName, currentKey) {
  for (const tabList of tabLists) {
    const tabs = Array.from(tabList?.querySelectorAll(`[${dataName}]`) || []);
    tabs.forEach(tab => {
      const selected = tab.getAttribute(dataName) === currentKey;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  }
}

function bindTabList(tabList, dataName, onSelect) {
  if (!tabList) return;
  const tabs = () => Array.from(tabList.querySelectorAll(`[${dataName}]`));
  tabList.addEventListener('click', event => {
    const target = event.target.closest(`[${dataName}]`);
    if (target) onSelect(target.getAttribute(dataName));
  });
  tabList.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const available = tabs();
    const selectedIndex = Math.max(0, available.indexOf(document.activeElement));
    let nextIndex = selectedIndex;
    if (event.key === 'ArrowLeft') nextIndex = (selectedIndex - 1 + available.length) % available.length;
    if (event.key === 'ArrowRight') nextIndex = (selectedIndex + 1) % available.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = available.length - 1;
    event.preventDefault();
    available[nextIndex]?.focus();
    available[nextIndex]?.click();
  });
}

function setSurfaceBusy(surface, busy) {
  surface.root?.setAttribute('aria-busy', String(busy));
  surface.refresh?.toggleAttribute('disabled', busy);
  surface.refresh?.classList.toggle('is-loading', busy);
}

function renderArtistSkeleton(surface) {
  if (!surface.grid) return;
  surface.grid.replaceChildren();
  const status = document.createElement('span');
  status.className = 'content-sr-only';
  status.setAttribute('role', 'status');
  status.textContent = '正在更新歌手中心';
  surface.grid.appendChild(status);
  for (let index = 0; index < 8; index += 1) {
    const card = document.createElement('div');
    card.className = 'artist-card artist-card-skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.append(document.createElement('span'), document.createElement('span'));
    surface.grid.appendChild(card);
  }
}

function createTrackAction(track, action, iconName, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'artist-track-action';
  button.disabled = !track.playable;
  button.setAttribute('aria-label', `${label} ${track.name}`);
  button.appendChild(createIcon(iconName));
  button.addEventListener('click', () => action?.(track));
  return button;
}

function renderArtistDetail(surface, artist, { onPlay, onAdd }) {
  if (!surface.detail) return;
  surface.detail.replaceChildren();
  const heading = document.createElement('header');
  heading.className = 'artist-detail-heading';

  const portrait = document.createElement('span');
  portrait.className = 'artist-detail-portrait';
  const imageUrl = imageVariant(artist.cover, 240);
  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.width = 72;
    image.height = 72;
    image.loading = 'lazy';
    image.decoding = 'async';
    portrait.appendChild(image);
  } else {
    portrait.appendChild(createIcon('fa-user'));
  }

  const copy = document.createElement('div');
  const kicker = document.createElement('span');
  kicker.textContent = `趋势 #${artist.rank}`;
  const title = document.createElement('h3');
  title.textContent = artist.name;
  const meta = document.createElement('p');
  meta.textContent = `${artist.appearances} 次上榜 · ${artist.tracks.length} 首精选`;
  copy.append(kicker, title, meta);

  const playAll = document.createElement('button');
  playAll.type = 'button';
  playAll.className = 'content-primary-action';
  playAll.append(createIcon('fa-play'), document.createTextNode('播放热门'));
  playAll.addEventListener('click', () => onPlay?.(artist.featuredTrack));
  heading.append(portrait, copy, playAll);

  const list = document.createElement('div');
  list.className = 'artist-track-list';
  list.setAttribute('role', 'list');
  artist.tracks.slice(0, 6).forEach((track, index) => {
    const row = document.createElement('article');
    row.className = 'artist-track-row';
    row.setAttribute('role', 'listitem');
    const rank = document.createElement('span');
    rank.textContent = String(index + 1).padStart(2, '0');
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'artist-track-info';
    info.disabled = !track.playable;
    info.setAttribute('aria-label', `播放 ${track.name}`);
    const name = document.createElement('strong');
    name.textContent = track.name;
    const album = document.createElement('span');
    album.textContent = track.album || track.artist;
    info.append(name, album);
    info.addEventListener('click', () => onPlay?.(track));
    const actions = document.createElement('span');
    actions.className = 'artist-track-actions';
    actions.append(
      createTrackAction(track, onPlay, 'fa-play', '播放'),
      createTrackAction(track, onAdd, 'fa-plus', '加入播放队列'),
    );
    row.append(rank, info, actions);
    list.appendChild(row);
  });
  surface.detail.append(heading, list);
}

function createArtistCard(artist, { onSelect, onPlay }) {
  const card = document.createElement('article');
  card.className = 'artist-card';
  card.setAttribute('role', 'listitem');

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'artist-card-main';
  main.setAttribute('aria-label', `查看 ${artist.name} 的精选作品`);
  const portrait = document.createElement('span');
  portrait.className = 'artist-card-portrait';
  const imageUrl = imageVariant(artist.cover, 360);
  if (imageUrl) {
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = artist.name;
    image.width = 180;
    image.height = 180;
    image.loading = 'lazy';
    image.decoding = 'async';
    portrait.appendChild(image);
  } else {
    portrait.appendChild(createIcon('fa-user'));
  }
  const rank = document.createElement('span');
  rank.className = 'artist-card-rank';
  rank.textContent = `#${artist.rank}`;
  portrait.appendChild(rank);

  const copy = document.createElement('span');
  copy.className = 'artist-card-copy';
  const name = document.createElement('strong');
  name.textContent = artist.name;
  const meta = document.createElement('span');
  meta.textContent = `${artist.appearances} 次上榜 · ${artist.chartCount} 个榜单`;
  const track = document.createElement('span');
  track.textContent = artist.featuredTrack?.name || '精选作品';
  copy.append(name, meta, track);
  main.append(portrait, copy);
  main.addEventListener('click', () => onSelect?.(artist));

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'artist-card-play';
  play.disabled = !artist.featuredTrack?.playable;
  play.setAttribute('aria-label', `播放 ${artist.name} 的热门歌曲`);
  play.appendChild(createIcon('fa-play'));
  play.addEventListener('click', () => onPlay?.(artist.featuredTrack));
  card.append(main, play);
  return card;
}

function renderArtists(surface, payload, actions) {
  if (!surface.root || !surface.grid) return;
  const { collection, items } = payload;
  surface.title.textContent = collection.name;
  surface.description.textContent = collection.description;
  surface.source.textContent = collection.sourceName;
  surface.updated.textContent = formatUpdatedAt(collection.fetchedAt);
  surface.count.textContent = `${items.length} 位`;
  surface.grid.replaceChildren();

  const selectArtist = artist => {
    surface.grid.querySelectorAll('.artist-card').forEach(card => {
      card.classList.toggle('is-selected', card.dataset.artistId === artist.id);
    });
    renderArtistDetail(surface, artist, actions);
  };
  items.forEach(artist => {
    const card = createArtistCard(artist, {
      onSelect: selectArtist,
      onPlay: actions.onPlay,
    });
    card.dataset.artistId = artist.id;
    surface.grid.appendChild(card);
  });
  selectArtist(items[0]);
  setSurfaceBusy(surface, false);
}

function artistSurface(prefix) {
  const id = name => document.getElementById(`${prefix}${name}`);
  return {
    root: id('ArtistWorkspace'),
    title: id('ArtistTitle'),
    description: id('ArtistDescription'),
    source: id('ArtistSource'),
    updated: id('ArtistUpdated'),
    count: id('ArtistCount'),
    refresh: id('ArtistRefresh'),
    tabs: id('ArtistTabs'),
    grid: id('ArtistGrid'),
    detail: id('ArtistDetail'),
  };
}

function renderVideoSkeleton(surface) {
  if (!surface.grid) return;
  surface.grid.replaceChildren();
  const status = document.createElement('span');
  status.className = 'content-sr-only';
  status.setAttribute('role', 'status');
  status.textContent = '正在更新视频中心';
  surface.grid.appendChild(status);
  for (let index = 0; index < 8; index += 1) {
    const card = document.createElement('div');
    card.className = 'video-card video-card-skeleton';
    card.setAttribute('aria-hidden', 'true');
    card.append(document.createElement('span'), document.createElement('span'));
    surface.grid.appendChild(card);
  }
}

function createVideoCard(item, onOpen) {
  const card = document.createElement('article');
  card.className = 'video-card';
  card.setAttribute('role', 'listitem');
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'video-card-main';
  main.setAttribute('aria-label', `查看音乐视频 ${item.name} - ${item.artist}`);

  const artwork = document.createElement('span');
  artwork.className = 'video-card-artwork';
  const image = document.createElement('img');
  image.src = item.poster;
  image.alt = `${item.name} 音乐视频封面`;
  image.width = 360;
  image.height = 203;
  image.loading = 'lazy';
  image.decoding = 'async';
  const play = document.createElement('span');
  play.className = 'video-card-play';
  play.appendChild(createIcon(item.previewUrl ? 'fa-play' : 'fa-external-link-alt'));
  artwork.append(image, play);

  const copy = document.createElement('span');
  copy.className = 'video-card-copy';
  const badges = document.createElement('span');
  badges.className = 'video-card-badges';
  const genre = document.createElement('span');
  genre.textContent = item.genre;
  const source = document.createElement('span');
  source.textContent = item.previewUrl ? '可预览' : item.provider;
  badges.append(genre, source);
  const name = document.createElement('strong');
  name.textContent = item.name;
  name.title = item.name;
  const artist = document.createElement('span');
  artist.textContent = item.artist;
  const date = document.createElement('time');
  date.dateTime = item.releasedAt;
  date.textContent = formatReleaseDate(item.releasedAt);
  copy.append(badges, name, artist, date);
  main.append(artwork, copy);
  main.addEventListener('click', () => onOpen?.(item, main));
  card.appendChild(main);
  return card;
}

function renderVideos(surface, payload, onOpen) {
  if (!surface.root || !surface.grid) return;
  const { collection, items } = payload;
  surface.title.textContent = collection.name;
  surface.description.textContent = collection.description;
  surface.source.textContent = collection.sourceName;
  surface.updated.textContent = formatUpdatedAt(collection.fetchedAt);
  surface.count.textContent = `${items.length} 条`;
  surface.grid.replaceChildren(...items.map(item => createVideoCard(item, onOpen)));
  setSurfaceBusy(surface, false);
}

function videoSurface(prefix) {
  const id = name => document.getElementById(`${prefix}${name}`);
  return {
    root: id('VideoWorkspace'),
    title: id('VideoTitle'),
    description: id('VideoDescription'),
    source: id('VideoSource'),
    updated: id('VideoUpdated'),
    count: id('VideoCount'),
    refresh: id('VideoRefresh'),
    tabs: id('VideoTabs'),
    grid: id('VideoGrid'),
  };
}

export function createArtistsController({
  onPlay,
  onAdd,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
} = {}) {
  const surfaces = [artistSurface('desktop'), artistSurface('mobile')].filter(surface => surface.root);
  const state = {
    scope: 'trending',
    payloads: new Map(),
    loading: new Map(),
  };

  const load = async (scope = state.scope, { force = false } = {}) => {
    const resolved = Object.hasOwn(ARTIST_SCOPES, scope) ? scope : 'trending';
    state.scope = resolved;
    syncTabs(surfaces.map(surface => surface.tabs), 'data-artist-scope', resolved);
    if (!force && state.payloads.has(resolved)) {
      surfaces.forEach(surface => renderArtists(surface, state.payloads.get(resolved), { onPlay, onAdd }));
      return state.payloads.get(resolved);
    }
    if (state.loading.has(resolved)) return state.loading.get(resolved);

    surfaces.forEach(surface => {
      setSurfaceBusy(surface, true);
      renderArtistSkeleton(surface);
    });
    const cached = readSnapshot(storage, ARTIST_CACHE_PREFIX, resolved, normalizeArtistsPayload);
    if (cached && !force) {
      state.payloads.set(resolved, cached);
      surfaces.forEach(surface => renderArtists(surface, cached, { onPlay, onAdd }));
    }

    const pending = requestJson(`/api/v1/artists?scope=${encodeURIComponent(resolved)}&limit=24`, fetchImpl)
      .then(normalizeArtistsPayload)
      .then(payload => {
        state.payloads.set(resolved, payload);
        writeSnapshot(storage, ARTIST_CACHE_PREFIX, resolved, payload);
        surfaces.forEach(surface => renderArtists(surface, payload, { onPlay, onAdd }));
        return payload;
      })
      .catch(error => {
        if (cached) return cached;
        surfaces.forEach(surface => {
          setSurfaceBusy(surface, false);
          surface.grid.replaceChildren();
          const empty = document.createElement('div');
          empty.className = 'content-empty-state';
          empty.setAttribute('role', 'status');
          empty.append(createIcon('fa-user-slash'), document.createTextNode(error.message || '歌手中心加载失败'));
          surface.grid.appendChild(empty);
        });
        throw error;
      })
      .finally(() => state.loading.delete(resolved));
    state.loading.set(resolved, pending);
    return pending;
  };

  surfaces.forEach(surface => {
    bindTabList(surface.tabs, 'data-artist-scope', scope => load(scope).catch(() => {}));
    surface.refresh?.addEventListener('click', () => load(state.scope, { force: true }).catch(() => {}));
  });

  return {
    ensureLoaded: () => load(state.scope).catch(() => null),
    refresh: () => load(state.scope, { force: true }).catch(() => null),
    select: scope => load(scope).catch(() => null),
    current: () => state.scope,
  };
}

export function createVideosController({
  onOpen,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
} = {}) {
  const surfaces = [videoSurface('desktop'), videoSurface('mobile')].filter(surface => surface.root);
  const state = {
    category: 'trending',
    payloads: new Map(),
    loading: new Map(),
  };

  const load = async (category = state.category, { force = false } = {}) => {
    const resolved = Object.hasOwn(VIDEO_CATEGORIES, category) ? category : 'trending';
    state.category = resolved;
    syncTabs(surfaces.map(surface => surface.tabs), 'data-video-category', resolved);
    if (!force && state.payloads.has(resolved)) {
      surfaces.forEach(surface => renderVideos(surface, state.payloads.get(resolved), onOpen));
      return state.payloads.get(resolved);
    }
    if (state.loading.has(resolved)) return state.loading.get(resolved);

    surfaces.forEach(surface => {
      setSurfaceBusy(surface, true);
      renderVideoSkeleton(surface);
    });
    const cached = readSnapshot(storage, VIDEO_CACHE_PREFIX, resolved, normalizeVideosPayload);
    if (cached && !force) {
      state.payloads.set(resolved, cached);
      surfaces.forEach(surface => renderVideos(surface, cached, onOpen));
    }

    const pending = requestJson(`/api/v1/videos?category=${encodeURIComponent(resolved)}&limit=24`, fetchImpl)
      .then(normalizeVideosPayload)
      .then(payload => {
        state.payloads.set(resolved, payload);
        writeSnapshot(storage, VIDEO_CACHE_PREFIX, resolved, payload);
        surfaces.forEach(surface => renderVideos(surface, payload, onOpen));
        return payload;
      })
      .catch(error => {
        if (cached) return cached;
        surfaces.forEach(surface => {
          setSurfaceBusy(surface, false);
          surface.grid.replaceChildren();
          const empty = document.createElement('div');
          empty.className = 'content-empty-state';
          empty.setAttribute('role', 'status');
          empty.append(createIcon('fa-video-slash'), document.createTextNode(error.message || '视频中心加载失败'));
          surface.grid.appendChild(empty);
        });
        throw error;
      })
      .finally(() => state.loading.delete(resolved));
    state.loading.set(resolved, pending);
    return pending;
  };

  surfaces.forEach(surface => {
    bindTabList(surface.tabs, 'data-video-category', category => load(category).catch(() => {}));
    surface.refresh?.addEventListener('click', () => load(state.category, { force: true }).catch(() => {}));
  });

  return {
    ensureLoaded: () => load(state.category).catch(() => null),
    refresh: () => load(state.category, { force: true }).catch(() => null),
    select: category => load(category).catch(() => null),
    current: () => state.category,
  };
}
