import { bindArtwork } from './artwork.js?v=1';
import { catalogRecord } from './music-catalog.js';
import { createChartCache } from './chart-cache.js';
const CHARTS = Object.freeze({
  hot: Object.freeze({ id: '3778678', name: '热歌榜' }),
  new: Object.freeze({ id: '3779629', name: '新歌榜' }),
  soaring: Object.freeze({ id: '19723756', name: '飙升榜' }),
  original: Object.freeze({ id: '2884035', name: '原创榜' }),
});

const DEFAULT_CHART = 'hot';
const CACHE_PREFIX = 'cp_chart_snapshot_v2_';

function text(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function normalizeArtist(item) {
  const artists = item?.artists ?? item?.artist ?? item?.ar;
  if (typeof artists === 'string') return text(artists, '未知艺术家');
  if (Array.isArray(artists)) {
    const names = artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name)
      .map(name => text(name))
      .filter(Boolean);
    if (names.length) return names.join('/');
  }
  return text(artists?.name, '未知艺术家');
}

function normalizeAlbum(item) {
  const album = item?.album ?? item?.al;
  return typeof album === 'string' ? text(album) : text(album?.name);
}

function normalizeCover(item) {
  for (const candidate of [
    item?.cover,
    item?.picUrl,
    item?.coverImgUrl,
    item?.album?.picUrl,
    item?.al?.picUrl,
  ]) {
    const value = text(candidate);
    if (value) return value;
  }
  return '';
}

export function normalizeDirectChartPayload(payload, chartKey = DEFAULT_CHART, limit = 50) {
  const resolvedKey = Object.hasOwn(CHARTS, chartKey) ? chartKey : DEFAULT_CHART;
  const root = payload?.data ?? payload?.playlist;
  const rawItems = Array.isArray(payload?.data?.tracks)
    ? payload.data.tracks
    : (Array.isArray(payload?.playlist?.tracks) ? payload.playlist.tracks : []);

  if (!root || !rawItems.length) throw new Error('排行榜没有返回歌曲');

  const items = rawItems
    .filter(item => item?.id !== undefined && item?.id !== null)
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)))
    .map((item, index) => ({
      rank: index + 1,
      id: text(item.id),
      playbackId: text(item.id),
      name: text(item.name, '未知歌曲'),
      artist: normalizeArtist(item),
      album: normalizeAlbum(item),
      cover: normalizeCover(item),
      source: 'ChKSz',
      playable: true,
    }));

  return {
    version: 1,
    chart: {
      key: resolvedKey,
      id: text(root.id, CHARTS[resolvedKey].id),
      name: text(root.name, CHARTS[resolvedKey].name),
      eyebrow: 'LIVE CHART',
      description: '榜单由实时音乐数据自动整理。',
      cover: normalizeCover(root),
      provider: 'chksz',
      sourceName: text(root?.creator?.nickname ?? root?.creator?.name, '网易云音乐'),
      trackCount: Number(root.trackCount) || rawItems.length,
      fetchedAt: new Date().toISOString(),
    },
    items,
  };
}

export function computeRankMovement(items, previousItems = null) {
  if (!Array.isArray(previousItems)) {
    return items.map(item => ({ ...item, movement: 0 }));
  }
  const previousRanks = new Map(
    previousItems.map(item => [String(item.id), Number(item.rank)]),
  );
  return items.map(item => {
    const previousRank = previousRanks.get(String(item.id));
    return {
      ...item,
      movement: Number.isFinite(previousRank) ? previousRank - Number(item.rank) : null,
    };
  });
}

function readSnapshot(storage, chartKey) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(`${CACHE_PREFIX}${chartKey}`));
    return value?.chart && Array.isArray(value?.items) ? value : null;
  } catch {
    return null;
  }
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

function createIcon(className) {
  const icon = document.createElement('i');
  icon.className = `fas ${className}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function movementNode(movement) {
  const element = document.createElement('span');
  element.className = 'chart-movement';
  if (movement === null) {
    element.classList.add('is-new');
    element.textContent = 'NEW';
    element.setAttribute('aria-label', '新上榜');
    return element;
  }
  if (movement > 0) {
    element.classList.add('is-up');
    element.append(createIcon('fa-caret-up'), document.createTextNode(String(movement)));
    element.setAttribute('aria-label', `上升 ${movement} 位`);
    return element;
  }
  if (movement < 0) {
    element.classList.add('is-down');
    element.append(createIcon('fa-caret-down'), document.createTextNode(String(Math.abs(movement))));
    element.setAttribute('aria-label', `下降 ${Math.abs(movement)} 位`);
    return element;
  }
  element.classList.add('is-steady');
  element.textContent = '—';
  element.setAttribute('aria-label', '排名不变');
  return element;
}

function createChartRow(item, { onPlay, onAdd }) {
  const row = document.createElement('article');
  row.className = 'chart-track-row';
  row.setAttribute('role', 'listitem');

  const rank = document.createElement('span');
  rank.className = 'chart-rank';
  rank.textContent = String(item.rank).padStart(2, '0');
  if (item.rank <= 3) rank.dataset.podium = String(item.rank);

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'chart-track-main';
  main.disabled = !item.playable;
  main.setAttribute('aria-label', `播放 ${item.name} - ${item.artist}`);

  const cover = document.createElement('span');
  cover.className = 'chart-track-cover';
  const image = document.createElement('img');
  image.alt = ''; image.width = image.height = 56; image.loading = 'lazy';
  cover.appendChild(bindArtwork(image, item, { size: 160 }));

  const copy = document.createElement('span');
  copy.className = 'chart-track-copy';
  const name = document.createElement('strong');
  name.textContent = item.name;
  name.title = item.name;
  const artist = document.createElement('span');
  artist.textContent = item.artist;
  artist.title = item.artist;
  copy.append(name, artist);

  const album = document.createElement('span');
  album.className = 'chart-track-album';
  album.textContent = item.album || '单曲';
  album.title = album.textContent;

  main.append(cover, copy, album);
  main.addEventListener('click', () => onPlay?.(item));

  const movement = movementNode(item.movement);

  const actions = document.createElement('span');
  actions.className = 'chart-track-actions';

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'chart-action chart-play-action';
  play.disabled = !item.playable;
  play.setAttribute('aria-label', `播放 ${item.name}`);
  play.appendChild(createIcon('fa-play'));
  play.addEventListener('click', () => onPlay?.(item));

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chart-action';
  add.disabled = !item.playable;
  add.setAttribute('aria-label', `将 ${item.name} 加入播放队列`);
  add.appendChild(createIcon('fa-plus'));
  add.addEventListener('click', () => onAdd?.(item));

  actions.append(play, add);
  row.append(rank, main, movement, actions);
  return row;
}

function chartSurfaces(documentRef) {
  return [
    {
      root: documentRef.getElementById('desktopChartsView'),
      list: documentRef.getElementById('desktopChartList'),
      title: documentRef.getElementById('desktopChartTitle'),
      description: documentRef.getElementById('desktopChartDescription'),
      source: documentRef.getElementById('desktopChartSource'),
      updated: documentRef.getElementById('desktopChartUpdated'),
      count: documentRef.getElementById('desktopChartCount'),
      cover: documentRef.getElementById('desktopChartCover'),
      refresh: documentRef.getElementById('desktopChartRefresh'),
    },
    {
      root: documentRef.getElementById('mobileChartsSheet'),
      list: documentRef.getElementById('mobileChartList'),
      title: documentRef.getElementById('mobileChartTitle'),
      description: documentRef.getElementById('mobileChartDescription'),
      source: documentRef.getElementById('mobileChartSource'),
      updated: documentRef.getElementById('mobileChartUpdated'),
      count: documentRef.getElementById('mobileChartCount'),
      cover: documentRef.getElementById('mobileChartCover'),
      refresh: documentRef.getElementById('mobileChartRefresh'),
    },
  ].filter(surface => surface.root && surface.list);
}

function setLoading(surface) {
  surface.list.setAttribute('aria-busy', 'true');
  const fragment = document.createDocumentFragment();
  const status = document.createElement('span');
  status.className = 'chart-sr-status';
  status.setAttribute('role', 'status');
  status.textContent = '正在更新排行榜';
  fragment.appendChild(status);
  for (let index = 0; index < 8; index += 1) {
    const row = document.createElement('div');
    row.className = 'chart-track-skeleton';
    row.setAttribute('aria-hidden', 'true');
    row.append(
      document.createElement('span'),
      document.createElement('span'),
      document.createElement('span'),
    );
    fragment.appendChild(row);
  }
  surface.list.replaceChildren(fragment);
  if (surface.refresh) {
    surface.refresh.disabled = true;
    surface.refresh.setAttribute('aria-busy', 'true');
  }
}

function setError(surface, message, retry, actionLabel = '重新加载') {
  surface.list.setAttribute('aria-busy', 'false');
  const status = document.createElement('div');
  status.className = 'chart-empty-state';
  status.setAttribute('role', 'alert');
  status.appendChild(createIcon('fa-exclamation-circle'));
  const copy = document.createElement('span');
  copy.textContent = message;
  status.appendChild(copy);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = actionLabel;
  button.addEventListener('click', retry);
  status.appendChild(button);
  surface.list.replaceChildren(status);
}

function renderSurface(surface, payload, options) {
  const { chart, items } = payload;
  surface.list.setAttribute('aria-busy', 'false');
  surface.title.textContent = chart.name;
  surface.description.textContent = chart.description || '实时音乐排行榜';
  surface.source.textContent = options.stale
    ? `${chart.sourceName || '音乐数据'} · 已保存的榜单`
    : `${chart.sourceName || '音乐数据'} · 自动更新`;
  surface.updated.textContent = formatUpdatedAt(chart.fetchedAt);
  surface.count.textContent = `${chart.trackCount || items.length} 首`;

  surface.cover.alt = `${chart.name}封面`;
  bindArtwork(surface.cover, { name: chart.name, cover: chart.cover || items[0]?.cover }, { size: 480 });

  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.appendChild(createChartRow(item, options)));
  surface.list.replaceChildren(fragment);

  if (surface.refresh) {
    surface.refresh.disabled = false;
    surface.refresh.removeAttribute('aria-busy');
  }
}

async function fetchJson(fetchImpl, url, { signal } = {}) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || '排行榜加载失败');
    error.status = response.status;
    throw error;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('排行榜服务返回了无法识别的数据');
  }
  if (payload.error) {
    throw new Error(payload.error?.message || '排行榜加载失败');
  }
  return payload;
}

export async function fetchChartPayload(fetchImpl, chartKey, { signal, definition } = {}) {
  const chart = definition && /^\d{1,20}$/.test(String(definition.id)) ? definition : CHARTS[chartKey] || CHARTS[DEFAULT_CHART];
  const data = await fetchJson(fetchImpl, `/api/v1/discovery/playlist?id=${chart.id}`, { signal });
  if (!Array.isArray(data.tracks) || !data.collection) throw new Error('公开榜单没有返回有效曲目');
  return {
    version: 2,
    chart: { ...chart, key: chartKey, name: data.collection.name || chart.name, description: '网易云公开榜单 · 按榜单原始顺序展示',
      provider:'gd', sourceName:'网易云公开榜单', cover:data.collection.cover, trackCount:data.collection.trackCount,
      fetchedAt:new Date(data.fetchedAt || Date.now()).toISOString() },
    items: data.tracks.slice(0,50).map((song,index) => ({...catalogRecord(song), rank:index+1, playbackId:song.id, playable:true})),
  };
}

export function createChartsController({
  documentRef = document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage,
  onPlay = () => {},
  onAdd = () => {},
  onlineEnabled = () => true,
  onSearch = () => {},
} = {}) {
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }
  const surfaces = chartSurfaces(documentRef);
  let activeChart = DEFAULT_CHART;
  let generation = 0, destroyed = false, prefetchPending = false;
  const definitions = new Map(Object.entries(CHARTS));
  const cache = createChartCache({ storage, pinnedKeys: ['directory'], validate: (key,value) => key === 'directory' ? Array.isArray(value.items) : value.chart && Array.isArray(value.items), fetchValue: async (key, signal) => {
    if (key === 'directory') {
      const data = await fetchJson(fetchImpl, '/api/v1/discovery/charts', { signal });
      if (!Array.isArray(data.items)) throw new Error('榜单目录暂不可用');
      return { items: data.items.filter(item => /^\d{1,20}$/.test(String(item.id)) && typeof item.name === 'string').slice(0,100) };
    }
    return fetchChartPayload(fetchImpl, key, { signal, definition: definitions.get(key) });
  } });
  const rails = [...documentRef.querySelectorAll('.chart-tabs[role="tablist"]')];
  const directoryButtons = new Map();
  function applyDirectory(data) {
    for (const item of data?.items || []) {
      const key = Object.keys(CHARTS).find(key => CHARTS[key].id === String(item.id)) || `list_${item.id}`;
      definitions.set(key, { id: String(item.id), name: item.name, cover: item.cover, trackCount: item.trackCount });
    }
  }
  applyDirectory(cache.peek('directory'));

  try {
    const saved = storage?.getItem('cp_active_chart');
    if (definitions.has(saved)) activeChart = saved;
  } catch {
    // Keep the default chart when preferences are unavailable.
  }

  const syncTabs = () => {
    documentRef.querySelectorAll('[data-chart-key]').forEach(button => {
      const selected = button.dataset.chartKey === activeChart;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };

  function renderDirectory() {
    for (const rail of rails) {
      const toggle = directoryButtons.get(rail);
      if (toggle) toggle.textContent = rail.classList.contains('is-expanded') ? '收起榜单' : `全部 ${definitions.size} 个榜单`;
      const focusKey = rail.contains(documentRef.activeElement) ? documentRef.activeElement.dataset.chartKey : null;
      const scroll = rail.scrollLeft;
      const fragment = documentRef.createDocumentFragment();
      for (const [key, chart] of definitions) {
        const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'chart-tab chart-cover-tab';
        button.dataset.chartKey = key; button.setAttribute('role','tab'); button.setAttribute('aria-label', `查看${chart.name}`);
        button.setAttribute('aria-controls', rail.closest('.charts-workspace')?.querySelector('[role="list"]')?.id || 'mobileChartList');
        const art = documentRef.createElement('span'); art.className = 'chart-cover-art'; art.setAttribute('aria-hidden','true');
        if (chart.cover) {
          const image = documentRef.createElement('img'); image.alt = ''; image.loading = 'lazy'; image.width = image.height = 144;
          bindArtwork(image, chart, { size: 240 }); art.append(image);
        } else {
          art.textContent = chart.name.replace(/云音乐|云村|网易云/g,'');
          art.dataset.tone = String([...definitions.keys()].indexOf(key) % 4);
        }
        const label = documentRef.createElement('strong'); label.textContent = chart.name; label.title = chart.name;
        const hint = documentRef.createElement('span'); hint.className = 'chart-cover-hint'; hint.textContent = chart.trackCount ? `${chart.trackCount} 首` : '查看榜单';
        button.append(art,label,hint); fragment.append(button);
      }
      rail.replaceChildren(fragment);
      rail.scrollLeft = scroll;
      if (focusKey) [...rail.children].find(button => button.dataset.chartKey === focusKey)?.focus({ preventScroll:true });
    }
    syncTabs();
  }
  async function directory() {
    if (!fetchImpl || !onlineEnabled() || destroyed) return;
    try { const data = await cache.get('directory'); if (destroyed) return; applyDirectory(data); renderDirectory(); }
    catch { /* The saved catalog and built-in charts remain selectable. */ }
  }
  async function prefetch() {
    if (prefetchPending || !onlineEnabled() || destroyed || globalThis.navigator?.connection?.saveData) return;
    prefetchPending = true;
    const owner = activeChart, keys = [...definitions.keys()], at = keys.indexOf(owner);
    try {
      for (const key of keys.slice(at + 1, at + 3)) {
        if (destroyed || !onlineEnabled() || activeChart !== owner) break;
        try { await cache.get(key); } catch { /* Selecting this card can retry. */ }
      }
    } finally {
      prefetchPending = false;
      if (activeChart !== owner) void prefetch();
    }
  }
  const load = async ({ force = false } = {}) => {
    const key = activeChart, token = ++generation;
    const previous = cache.peek(key) || readSnapshot(storage, key);
    if (!onlineEnabled()) {
      syncTabs();
      const cached = previous;
      surfaces.forEach(surface => {
        if (cached) {
          renderSurface(surface, cached, { onPlay, onAdd, stale: true });
        } else {
          surface.title.textContent = definitions.get(key).name;
          surface.description.textContent = '当前离线；你仍可查看已保存的榜单。';
          surface.source.textContent = '实时更新已暂停';
          surface.count.textContent = '暂无缓存';
          surface.updated.textContent = '';
          setError(surface, '暂无已保存的榜单，试试搜索喜欢的歌曲。', onSearch, '搜索音乐');
        }
        if (surface.refresh) {
          surface.refresh.disabled = false;
          surface.refresh.removeAttribute('aria-busy');
        }
      });
      return;
    }
    if (!fetchImpl) return;
    const fresh = cache.fresh(key);
    if (previous) surfaces.forEach(surface => {
      renderSurface(surface, previous, { onPlay, onAdd, stale: !fresh });
      if (force || !fresh) { surface.updated.textContent = '后台更新中 · 保留当前榜单'; if (surface.refresh) surface.refresh.disabled = true; }
    });
    else surfaces.forEach(surface => { surface.title.textContent = definitions.get(key).name; setLoading(surface); });
    syncTabs();
    if (previous && fresh && !force) { void prefetch(); return previous; }
    try {
      const payload = await cache.get(key, { force });
      if (destroyed || generation !== token) return;
      const withMovement = {
        ...payload,
        items: computeRankMovement(payload.items, previous ? previous.items : null),
      };
      surfaces.forEach(surface => renderSurface(surface, withMovement, { onPlay, onAdd, stale: false }));
      void prefetch();
      return withMovement;
    } catch (error) {
      if (destroyed || generation !== token) return;
      if (previous) {
        const cached = {
          ...previous,
          items: computeRankMovement(previous.items, previous.items),
        };
        surfaces.forEach(surface => renderSurface(surface, cached, { onPlay, onAdd, stale: true }));
        surfaces.forEach(surface => { surface.updated.textContent = '刷新失败 · 已保留上次内容'; });
      } else {
        surfaces.forEach(surface => setError(
          surface,
          error?.message || '排行榜加载失败，请检查网络后重试',
          () => load({ force: true }),
        ));
      }
    } finally {
      if (destroyed || generation !== token) return;
      surfaces.forEach(surface => {
        if (surface.refresh) {
          surface.refresh.disabled = false;
          surface.refresh.removeAttribute('aria-busy');
        }
      });
    }
  };

  rails.forEach(rail => {
    rail.classList.add('chart-cover-rail');
    const overview = rail.parentElement.querySelector('.chart-overview');
    if (overview) rail.parentElement.insertBefore(rail, overview);
    const heading = documentRef.createElement('div'); heading.className = 'chart-directory-heading';
    const label = documentRef.createElement('strong'); label.textContent = '选择榜单';
    const toggle = documentRef.createElement('button'); toggle.type = 'button';
    rail.id ||= `${rail.closest('[id]')?.id || 'charts'}CoverCatalog`;
    toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls',rail.id);
    toggle.addEventListener('click', () => {
      const expanded = rail.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded',String(expanded));
      toggle.textContent = expanded ? '收起榜单' : `全部 ${definitions.size} 个榜单`;
      rail.scrollTop = 0;
    });
    directoryButtons.set(rail,toggle); heading.append(label,toggle); rail.parentElement.insertBefore(heading,rail);
    rail.addEventListener('click', event => {
      const button = event.target.closest('[data-chart-key]'); if (!button) return;
      const next = button.dataset.chartKey;
      if (!definitions.has(next)) return;
      if (rail.classList.contains('is-expanded')) {
        rail.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded','false'); toggle.textContent = `全部 ${definitions.size} 个榜单`;
        button.scrollIntoView?.({block:'nearest',inline:'center'});
      }
      if (next === activeChart) return;
      activeChart = next;
      try {
        storage?.setItem('cp_active_chart', activeChart);
      } catch {
        // Preference persistence is optional.
      }
      void load();
    });
    rail.addEventListener('keydown', event => {
      const button = event.target.closest('[data-chart-key]'); if (!button) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(
        button.closest('[role="tablist"]')?.querySelectorAll('[data-chart-key]') || [],
      );
      if (!tabs.length) return;
      event.preventDefault();
      const currentIndex = Math.max(0, tabs.indexOf(button));
      let nextIndex = currentIndex;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  });

  surfaces.forEach(surface => {
    surface.refresh?.addEventListener('click', () => load({ force: true }));
  });
  renderDirectory();
  const warmup = setTimeout(() => {
    if (destroyed || !onlineEnabled() || globalThis.navigator?.connection?.saveData) return;
    void directory();
    void cache.get(activeChart).then(() => prefetch()).catch(() => {});
  }, 1000);

  return {
    load,
    ensureLoaded: () => { void directory(); return load(); },
    refresh: () => load({ force: true }),
    current: () => activeChart,
    destroy() {
      destroyed = true; generation++; clearTimeout(warmup); cache.destroy();
    },
  };
}
