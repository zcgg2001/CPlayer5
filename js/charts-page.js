const CHARTS = Object.freeze({
  hot: Object.freeze({ id: '3778678', name: '热歌榜' }),
  new: Object.freeze({ id: '3779629', name: '新歌榜' }),
  soaring: Object.freeze({ id: '19723756', name: '飙升榜' }),
  original: Object.freeze({ id: '2884035', name: '原创榜' }),
});

const DEFAULT_CHART = 'hot';
const CACHE_PREFIX = 'cp_chart_snapshot_v1_';

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

function writeSnapshot(storage, chartKey, payload) {
  if (!storage) return;
  try {
    storage.setItem(`${CACHE_PREFIX}${chartKey}`, JSON.stringify(payload));
  } catch {
    // A full or restricted storage area must not block the chart.
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

function safeImageUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function imageVariant(value, size) {
  const safe = safeImageUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  if (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net')) {
    url.searchParams.set('param', `${size}y${size}`);
  }
  return url.href;
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
  const coverUrl = imageVariant(item.cover, 160);
  if (coverUrl) {
    const image = document.createElement('img');
    image.src = coverUrl;
    image.alt = '';
    image.width = 56;
    image.height = 56;
    image.loading = 'lazy';
    image.decoding = 'async';
    cover.appendChild(image);
  } else {
    cover.appendChild(createIcon('fa-music'));
  }

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

function setError(surface, message, retry) {
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
  button.textContent = '重新加载';
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
    ? `${chart.sourceName || '音乐数据'} · 离线缓存`
    : `${chart.sourceName || '音乐数据'} · 自动更新`;
  surface.updated.textContent = formatUpdatedAt(chart.fetchedAt);
  surface.count.textContent = `${chart.trackCount || items.length} 首`;

  const coverUrl = imageVariant(chart.cover || items[0]?.cover, 480);
  if (coverUrl) {
    surface.cover.src = coverUrl;
    surface.cover.alt = `${chart.name}封面`;
  } else {
    surface.cover.src = './img/icon.png';
    surface.cover.alt = '';
  }

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
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || '排行榜加载失败');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('排行榜服务返回了无法识别的数据');
  }
  if (payload.error) {
    throw new Error(payload.error?.message || '排行榜加载失败');
  }
  return payload;
}

export async function fetchChartPayload(fetchImpl, chartKey, { signal } = {}) {
  try {
    return await fetchJson(
      fetchImpl,
      `/api/v1/charts?chart=${encodeURIComponent(chartKey)}&limit=50`,
      { signal },
    );
  } catch (edgeError) {
    if (signal?.aborted) throw edgeError;
    const chart = CHARTS[chartKey] || CHARTS[DEFAULT_CHART];
    try {
      const direct = await fetchJson(
        fetchImpl,
        `https://api.chksz.top/api/163_playlist?id=${encodeURIComponent(chart.id)}`,
        { signal },
      );
      return normalizeDirectChartPayload(direct, chartKey, 50);
    } catch {
      throw edgeError;
    }
  }
}

export function createChartsController({
  documentRef = document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage,
  onPlay = () => {},
  onAdd = () => {},
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
  let requestController = null;
  let loadedChart = '';

  try {
    const saved = storage?.getItem('cp_active_chart');
    if (Object.hasOwn(CHARTS, saved)) activeChart = saved;
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

  const load = async ({ force = false } = {}) => {
    if (!fetchImpl) return;
    if (!force && loadedChart === activeChart) return;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    surfaces.forEach(setLoading);
    syncTabs();

    const previous = readSnapshot(storage, activeChart);
    try {
      const payload = await fetchChartPayload(fetchImpl, activeChart, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const withMovement = {
        ...payload,
        items: computeRankMovement(payload.items, previous ? previous.items : null),
      };
      surfaces.forEach(surface => renderSurface(surface, withMovement, { onPlay, onAdd, stale: false }));
      writeSnapshot(storage, activeChart, payload);
      loadedChart = activeChart;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (previous) {
        const cached = {
          ...previous,
          items: computeRankMovement(previous.items, previous.items),
        };
        surfaces.forEach(surface => renderSurface(surface, cached, { onPlay, onAdd, stale: true }));
        loadedChart = activeChart;
      } else {
        surfaces.forEach(surface => setError(
          surface,
          error?.message || '排行榜加载失败，请检查网络后重试',
          () => load({ force: true }),
        ));
      }
    } finally {
      surfaces.forEach(surface => {
        if (surface.refresh) {
          surface.refresh.disabled = false;
          surface.refresh.removeAttribute('aria-busy');
        }
      });
    }
  };

  documentRef.querySelectorAll('[data-chart-key]').forEach(button => {
    button.addEventListener('click', () => {
      const next = button.dataset.chartKey;
      if (!Object.hasOwn(CHARTS, next) || next === activeChart) return;
      activeChart = next;
      loadedChart = '';
      try {
        storage?.setItem('cp_active_chart', activeChart);
      } catch {
        // Preference persistence is optional.
      }
      load({ force: true });
    });
    button.addEventListener('keydown', event => {
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
  syncTabs();

  return {
    load,
    ensureLoaded: () => load(),
    refresh: () => load({ force: true }),
    current: () => activeChart,
    destroy() {
      requestController?.abort();
    },
  };
}
