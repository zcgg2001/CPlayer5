import { groupAvailability, AVAILABILITY_LABELS } from './music-catalog.js?v=1';
// Discovery UI uses real tracks; missing metadata stays visibly unknown.
export function trackDuration(song) {
  if (song?.duration == null && song?.dt == null) return 0;
  const value = Number(song.duration ?? Number(song.dt) / 1000);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
export function durationLabel(seconds) {
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '—';
}
export function filterDiscoveryTracks(songs, query = '', sort = 'default') {
  const keyword = query.trim().toLocaleLowerCase();
  const tracks = songs.filter(song => `${song.name || ''} ${song.artist || ''} ${song.album || ''}`.toLocaleLowerCase().includes(keyword));
  if (sort === 'name' || sort === 'artist') tracks.sort((a,b) => String(a[sort] || '').localeCompare(String(b[sort] || ''), 'zh-CN'));
  if (sort === 'duration') tracks.sort((a,b) => (trackDuration(a) || Infinity) - (trackDuration(b) || Infinity));
  return tracks;
}
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const keyOf = song => `${song.provider || 'gd'}:${song.id}`;

export function createDiscoveryTable({document, storage, list, onPlay, onQueue, onBatch, onDownload, onSearch, onRetry, onMore, onNotify = () => {}, onDetails = () => {}, getPlayback, canDownload, onLibrary = () => {}}) {
  let tracks = [], query = '', sort = 'default', favoritesOnly = false, hasMore = true, busy = false;
  let favorites;
  try { favorites = new Map(JSON.parse(storage.getItem('cp_favorites_v1') || '[]').filter(pair => Array.isArray(pair) && pair[1]?.id)); } catch { favorites = new Map(); }
  const get = id => document.getElementById(id);
  const button = (label, glyph, action, className = 'track-icon-button') => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className;
    node.setAttribute('aria-label', label); node.title = label; node.innerHTML = icon(glyph);
    node.addEventListener('click', event => { event.stopPropagation(); action(node); }); return node;
  };
  const save = () => { try { storage.setItem('cp_favorites_v1', JSON.stringify([...favorites])); } catch { /* In-memory favorites still work when storage is full. */ } };
  const favoriteSong = song => {
    const key = keyOf(song);
    if (favorites.has(key)) favorites.delete(key); else favorites.set(key, {...song, url: undefined});
    save(); sync(); if (favoritesOnly) render();
  };
  const visible = () => filterDiscoveryTracks(favoritesOnly ? [...favorites.values()] : tracks, query, sort);
  const closeMenu = () => { document.querySelectorAll('.track-more-menu').forEach(menu => menu.remove()); document.querySelectorAll('.track-more[aria-expanded="true"]').forEach(node => node.setAttribute('aria-expanded','false')); };
  document.addEventListener('click', event => { if (!event.target.closest('.track-more-menu, .track-more')) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.querySelector('.track-more-menu')) {
      const trigger = document.querySelector('.track-more[aria-expanded="true"]'); closeMenu(); trigger?.focus(); event.preventDefault();
    }
  });
  const menuFor = (song, trigger) => {
    const open = trigger.getAttribute('aria-expanded') === 'true'; closeMenu(); if (open) return;
    const menu = document.createElement('div'); menu.className = 'track-more-menu'; menu.setAttribute('role','menu');
    const item = (label, glyph, action) => {
      const node = button(label, glyph, () => { closeMenu(); action(); }, 'track-menu-item');
      const text = document.createElement('span'); text.textContent = label; node.append(text); node.setAttribute('role','menuitem'); menu.append(node); return node;
    };
    item('保存到歌单 / 标签与笔记', 'ListPlus', () => onLibrary(song));
    item('歌曲资料与音源', 'Info', () => onDetails(song,trigger));
    if (canDownload(song)) item('下载歌曲', 'ArrowDownToLine', () => onDownload(song,trigger));
    item('复制歌曲链接', 'Link', async () => {
      const url = new URL(document.baseURI); url.search = new URLSearchParams({source:song.provider || 'gd', q:`${song.name} ${song.artist || ''}`.trim()}); url.hash = '';
      try { await navigator.clipboard.writeText(url.href); onNotify('已复制歌曲搜索链接'); }
      catch { onNotify('无法访问剪贴板，请在搜索页复制地址', true); onSearch(song.name); }
    });
    item(song.album ? '搜索此专辑' : '搜索此歌手', 'Disc3', () => onSearch(song.album || song.artist || song.name));
    menu.addEventListener('keydown', event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault(); const items = [...menu.querySelectorAll('button')], current = items.indexOf(document.activeElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : (current + (event.key === 'ArrowDown' ? 1 : items.length-1)) % items.length].focus();
    });
    document.body.append(menu); trigger.setAttribute('aria-expanded','true');
    const bounds = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, bounds.right - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 96, bounds.bottom + 4))}px`;
    menu.querySelector('button').focus();
  };
  const makeRow = (song,index) => {
    const row = document.createElement('div'); row.className = 'discovery-track-row'; row.setAttribute('role','row');
    row.dataset.trackKey = keyOf(song);
    const disabled = song.playable === false;
    if (disabled) { row.classList.add('is-unavailable'); row.title = song.unavailableReason || '此音源暂不可播放'; row.setAttribute('aria-disabled','true'); }
    const cell = (className) => { const node = document.createElement('div'); node.className = className; node.setAttribute('role','cell'); row.append(node); return node; };
    const indexCell = cell('track-index');
    const play = button(`播放 ${song.name}`, 'Play', () => onPlay(song), 'track-icon-button track-play');
    play.disabled = disabled; play.setAttribute('aria-pressed','false');
    const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(index+1).padStart(2,'0');
    const bars = document.createElement('span'); bars.className = 'track-equalizer'; bars.setAttribute('aria-hidden','true'); bars.innerHTML = '<b></b><b></b><b></b>';
    indexCell.append(number,bars,play);
    const main = cell('track-main');
    const cover = document.createElement('span'); cover.className = 'track-cover'; cover.setAttribute('aria-hidden','true'); cover.innerHTML = icon('Music2');
    if (song.cover) {
      try {
        const url = new URL(song.cover, document.baseURI);
        if (['https:','http:'].includes(url.protocol)) {
          // Preserve signed/proxy query strings; native images do not need CORS.
          const image = document.createElement('img'); image.alt = ''; image.width = image.height = 40; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
          image.addEventListener('load', () => cover.classList.add('has-cover'));
          image.addEventListener('error', () => { image.remove(); cover.classList.remove('has-cover'); });
          if (url.protocol === 'http:' && location.protocol === 'https:') url.protocol = 'https:';
          image.src = url.href; cover.append(image);
        }
      } catch { /* Use the gradient fallback. */ }
    }
    const copy = document.createElement('div'); copy.className = 'track-copy';
    const title = document.createElement('span'); title.className = 'track-title'; title.textContent = song.name || '未知歌曲'; title.title = title.textContent;
    const artist = document.createElement('span'); artist.className = 'track-artist'; artist.textContent = song.artist || '未知歌手'; artist.title = artist.textContent;
    copy.append(title,artist); const state = document.createElement('span'); state.className='catalog-badge'; state.textContent=AVAILABILITY_LABELS[groupAvailability(song).status]; state.title='在更多操作中查看资料并检查音源'; artist.append(' · ',state); main.append(cover,copy);
    const album = cell('track-album'); album.textContent = song.album || '—'; album.title = song.album || '音源未提供专辑';
    const time = cell('track-duration'); time.textContent = durationLabel(trackDuration(song)); time.title = trackDuration(song) ? '歌曲时长' : '音源未提供时长，播放后更新';
    const actions = cell('track-actions');
    const add = button(`加入队列：${song.name}`, 'ListPlus', () => onQueue(song)); add.disabled = disabled;
    const favorite = button(`收藏：${song.name}`, 'Heart', () => favoriteSong(song)); favorite.classList.add('track-favorite');
    const more = button(`更多操作：${song.name}`, 'Ellipsis', trigger => menuFor(song,trigger)); more.classList.add('track-more'); more.setAttribute('aria-haspopup','menu'); more.setAttribute('aria-expanded','false');
    actions.append(add,favorite,more);
    row.addEventListener('click', event => { if (!disabled && !event.target.closest('button')) onPlay(song); });
    return row;
  };
  const sync = () => {
    const {song,playing,loading,duration} = getPlayback();
    list.querySelectorAll('.discovery-track-row').forEach(row => {
      const current = Boolean(song?.id && row.dataset.trackKey === keyOf(song));
      row.classList.toggle('is-current', current); row.classList.toggle('is-playing', current && playing); row.classList.toggle('is-loading', current && loading);
      const play = row.querySelector('.track-play'); play.setAttribute('aria-pressed', String(current && playing));
      const title = row.querySelector('.track-title').textContent;
      play.title = `${current && playing ? '暂停' : '播放'} ${title}`; play.setAttribute('aria-label', play.title);
      const glyph = current && playing ? 'Pause' : 'Play';
      if (play.dataset.glyph !== glyph) { play.innerHTML = icon(glyph); play.dataset.glyph = glyph; }
      const favorite = row.querySelector('.track-favorite'), saved = favorites.has(row.dataset.trackKey);
      favorite.setAttribute('aria-pressed', String(saved)); favorite.title = `${saved ? '取消收藏' : '收藏'}：${title}`; favorite.setAttribute('aria-label', favorite.title);
      if (current && duration > 0) row.querySelector('.track-duration').textContent = durationLabel(duration);
    });
    const favorite = get('desktopFavoriteBtn');
    if (favorite) {
      favorite.disabled = !song?.id; favorite.setAttribute('aria-pressed', String(Boolean(song?.id && favorites.has(keyOf(song)))));
      favorite.title = favorite.getAttribute('aria-pressed') === 'true' ? '取消收藏当前歌曲' : '收藏当前歌曲'; favorite.setAttribute('aria-label',favorite.title);
    }
  };
  const status = (message, {error = false, loading = false, action = null} = {}) => {
    closeMenu(); busy = loading; if (loading) tracks = []; list.replaceChildren();
    const node = document.createElement('div'); node.className = `discovery-state${error ? ' is-error' : ''}`; node.setAttribute('role','status');
    node.innerHTML = icon(error ? 'CloudOff' : 'Music2');
    const text = document.createElement('p'); text.textContent = message; node.append(text);
    if (!loading) { const action = button(error ? '重试' : '重置筛选', error ? 'RotateCw' : 'Search', () => error ? onRetry() : reset(), 'discovery-state-action'); const label = document.createElement('span'); label.textContent = error ? '重试' : '换个音源或关键词试试'; action.append(label); node.append(action); }
    else { node.classList.add('sr-only'); for (let i=0;i<8;i++) { const skeleton = document.createElement('div'); skeleton.className = 'track-skeleton'; skeleton.setAttribute('aria-hidden','true'); skeleton.innerHTML='<span></span><div><b></b><b></b></div><span></span>'; list.append(skeleton); } }
    if (action && !loading) { const fallback = button('使用 GD 音乐台', 'Music2', action, 'discovery-state-action'); const label = document.createElement('span'); label.textContent = '使用 GD 音乐台'; fallback.append(label); node.append(fallback); }
    list.append(node); list.setAttribute('aria-busy', String(loading));
    get('discoveryResultCount').textContent = loading ? '正在获取' : '0 首';
    get('discoveryLoadMore').hidden = true;
    for (const id of ['discoveryPlayAll','discoveryQueueAll']) get(id).disabled = true;
  };
  const render = () => {
    const songs = visible(); closeMenu();
    if (!songs.length) { status(favoritesOnly ? '还没有收藏歌曲，点击歌曲旁的心形即可收藏。' : '没有匹配的歌曲，换个音源或关键词试试。'); return; }
    const fragment = document.createDocumentFragment(); songs.forEach((song,index) => fragment.append(makeRow(song,index))); list.replaceChildren(fragment);
    get('discoveryResultCount').textContent = `${songs.length} 首${query ? ` / ${tracks.length}` : ''}`;
    get('discoveryLoadMore').hidden = favoritesOnly || !hasMore;
    for (const id of ['discoveryPlayAll','discoveryQueueAll']) get(id).disabled = !songs.some(song => song.playable !== false);
    sync();
  };
  const reset = () => { query = ''; favoritesOnly = false; get('discoveryFilter').value = ''; get('discoveryFavoritesOnly').setAttribute('aria-pressed','false'); render(); };
  get('discoveryFilter').addEventListener('input', event => { query = event.target.value; render(); });
  get('discoverySort').addEventListener('change', event => { sort = event.target.value; render(); });
  get('discoveryFavoritesOnly').addEventListener('click', event => { favoritesOnly = !favoritesOnly; event.currentTarget.setAttribute('aria-pressed',String(favoritesOnly)); render(); });
  get('discoveryPlayAll').addEventListener('click', () => onBatch(visible().filter(song => song.playable !== false), true));
  get('discoveryQueueAll').addEventListener('click', () => onBatch(visible().filter(song => song.playable !== false), false));
  get('discoveryLoadMore').addEventListener('click', async event => {
    if (busy) return; busy = true; event.currentTarget.disabled = true;
    try { await onMore(); } finally { busy = false; get('discoveryLoadMore').disabled = false; }
  });
  get('desktopFavoriteBtn').addEventListener('click', () => { const song = getPlayback().song; if (song?.id) favoriteSong(song); });
  return {sync, status, reset, refreshFavorites() { try { favorites = new Map(JSON.parse(storage.getItem('cp_favorites_v1') || '[]')); } catch { favorites = new Map(); } sync(); if (favoritesOnly) render(); }, setSongs(songs,{append = false, more = true} = {}) {
    tracks = [...new Map((append ? [...tracks,...songs] : songs).map(song => [keyOf(song),song])).values()];
    hasMore = more; busy = false; list.setAttribute('aria-busy','false'); render();
  }, count: () => tracks.length};
}
