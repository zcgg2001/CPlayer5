import { bindArtwork } from './artwork.js?v=1';
import { recordingKey } from './recommendation-model.js';

const PAGE_SIZE = 36;
const SOURCES = { recommendations: '推荐', queue: '队列', favorites: '收藏' };

export function musicWallSongs(snapshot, source) {
  const seen = new Set();
  return (snapshot[source] || []).filter(song => {
    if (!song?.id || !song.name) return false;
    const key = recordingKey(song);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// A bounded page keeps image decoding and DOM size independent of library size.
export function musicWallPage(songs, page, selectedKey) {
  const pages = Math.max(1, Math.ceil(songs.length / PAGE_SIZE));
  page = Math.max(0, Math.min(pages - 1, Math.floor(Number(page) || 0)));
  const items = songs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selected = items.find(song => recordingKey(song) === selectedKey) || items[0];
  return { items, selected, page, pages };
}

export function createMusicWall({ document, root, storage, getSnapshot, getCurrentSong, onPlay, onQueue, onDetails, onSearch, onRetry }) {
  let source = 'recommendations', dense = false, active = false, page = 0, selectedKey = '', signature = '';
  try {
    const saved = JSON.parse(storage?.getItem('zp_music_wall_v1') || '{}');
    if (Object.hasOwn(SOURCES, saved.source)) source = saved.source;
    dense = saved.dense === true;
  } catch { /* Optional preference only. */ }
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text != null) node.textContent = text; return node; };
  const icon = name => { const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; };
  const button = (label, action, glyph) => {
    const node = el('button', 'wall-button'); node.type = 'button';
    if (glyph) node.append(icon(glyph)); node.append(el('span', '', label));
    node.addEventListener('click', action); return node;
  };
  const save = () => { try { storage?.setItem('zp_music_wall_v1', JSON.stringify({ source, dense })); } catch { /* optional */ } };
  const toolbar = el('div', 'wall-toolbar'), filters = el('div', 'wall-filters');
  filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', '音乐墙内容');
  for (const [key, label] of Object.entries(SOURCES)) {
    const tab = button(label, () => { source = key; page = 0; selectedKey = ''; save(); refresh(true); });
    tab.dataset.wallSource = key; filters.append(tab);
  }
  const density = button('紧凑排列', () => { dense = !dense; save(); refresh(true); }, 'Grid2X2');
  density.classList.add('wall-density'); density.title = '切换封面排列密度';
  toolbar.append(filters, density);
  const note = el('div', 'wall-note'), count = el('p'), locate = button('正在播放', () => {
    const current = getCurrentSong(); if (!current) return;
    source = 'queue'; selectedKey = recordingKey(current);
    const songs = musicWallSongs(getSnapshot(), source);
    page = Math.max(0, Math.floor(songs.findIndex(song => recordingKey(song) === selectedKey) / PAGE_SIZE));
    save(); refresh(true); root.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, 'LocateFixed');
  count.setAttribute('role', 'status'); note.append(count, locate);
  const grid = el('div', 'music-wall-grid'); grid.setAttribute('aria-label', '歌曲封面');
  const empty = el('div', 'wall-empty'), pager = el('div', 'wall-pager'), pageLabel = el('span');
  const changePage = offset => { page += offset; selectedKey = ''; refresh(true); root.scrollIntoView({ block: 'start', behavior: 'auto' }); };
  const prev = button('上一组', () => changePage(-1), 'ChevronLeft'), next = button('下一组', () => changePage(1), 'ChevronRight');
  pager.append(prev, pageLabel, next); root.append(toolbar, note, grid, empty, pager);
  root.classList.add('music-wall');

  function image(song, size) {
    const node = el('img'); node.alt = ''; node.width = node.height = size;
    return bindArtwork(node, song, { size });
  }
  function refresh(force = false) {
    if (!active) return;
    const snapshot = getSnapshot(), songs = musicWallSongs(snapshot, source);
    const current = getCurrentSong(), currentKey = current ? recordingKey(current) : '';
    const data = musicWallPage(songs, page, selectedKey); page = data.page;
    selectedKey = data.selected ? recordingKey(data.selected) : '';
    const nextSignature = JSON.stringify([source, dense, page, selectedKey, currentKey, snapshot.loading,
      songs.length, data.items.map(song => [recordingKey(song), song.name, song.artist, song.cover])]);
    if (!force && signature === nextSignature) return;
    signature = nextSignature;
    root.classList.toggle('is-dense', dense);
    filters.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.wallSource === source)));
    density.setAttribute('aria-pressed', String(dense));
    locate.hidden = !current;
    count.textContent = songs.length ? `${songs.length} 首 · 点封面，选一首喜欢的` : snapshot.loading && source === 'recommendations' ? '正在整理音乐墙…' : '';
    grid.replaceChildren(); empty.replaceChildren(); empty.hidden = songs.length > 0;
    pager.hidden = data.pages <= 1; prev.disabled = page === 0; next.disabled = page === data.pages - 1;
    pageLabel.textContent = `${page + 1} / ${data.pages}`;
    if (!songs.length) {
      const loading = source === 'recommendations' && snapshot.loading;
      empty.append(icon(loading ? 'Disc3' : 'Library'), el('h2', '', loading ? '好音乐，即将铺满这一面' : source === 'queue' ? '队列里还没有音乐' : source === 'favorites' ? '把喜欢的歌留在这面墙上' : '暂时没能取得推荐'),
        el('p', '', loading ? '封面会随歌曲一起出现' : source === 'favorites' ? '收藏歌曲后，回到这里就能看到。' : '搜索喜欢的歌曲，或稍后重新加载。'));
      if (!loading) empty.append(button(source === 'recommendations' ? '重新加载' : '去搜索', source === 'recommendations' ? onRetry : onSearch, source === 'recommendations' ? 'RefreshCw' : 'Search'));
      return;
    }
    const song = data.selected;
    const hero = el('article', 'wall-focus'), heroImage = image(song, 500);
    heroImage.classList.add('wall-focus-image');
    const info = el('div', 'wall-focus-copy');
    if (selectedKey === currentKey) info.append(el('span', 'wall-eyebrow', '正在播放'));
    const title = el('h2', '', song.name); title.id = 'musicWallSelectedTitle';
    hero.setAttribute('aria-labelledby', title.id);
    info.append(title, el('p', '', song.artist || '未知歌手'));
    const actions = el('div', 'wall-focus-actions');
    const play = button('播放', () => onPlay(song), 'Play');
    const details = button('歌曲详情', () => onDetails(song, details), 'Ellipsis');
    details.classList.add('wall-icon-button'); details.setAttribute('aria-label', '歌曲详情与收藏');
    actions.append(play, details); info.append(actions); hero.append(heroImage, info); grid.append(hero);
    for (const track of data.items) {
      if (recordingKey(track) === selectedKey) continue;
      const tile = el('button', 'wall-tile'); tile.type = 'button';
      const playing = recordingKey(track) === currentKey;
      tile.setAttribute('aria-label', `${track.name}，${track.artist || '未知歌手'}${playing ? '，正在播放' : ''}，查看封面`);
      tile.title = `${track.name} · ${track.artist || '未知歌手'}`;
      const caption = el('span', 'wall-tile-caption', track.name);
      tile.append(image(track, dense ? 150 : 300), caption);
      if (playing) {
        tile.classList.add('is-playing');
        tile.append(el('span', 'wall-index', '播放中'));
      }
      tile.addEventListener('click', () => {
        selectedKey = recordingKey(track); refresh(true);
        root.scrollIntoView({ block: 'start', behavior: 'auto' });
        grid.querySelector('.wall-focus-actions button')?.focus({ preventScroll: true });
      });
      grid.append(tile);
    }
    // Queue action belongs beside the focused song rather than on every small tile.
    const enqueue = button('加入队列', () => onQueue(song), 'ListPlus');
    enqueue.classList.add('wall-enqueue'); info.insertBefore(enqueue, actions);
  }
  for (const event of ['cplayer:library-changed', 'cplayer:library-applied']) globalThis.window?.addEventListener(event, () => refresh());
  return { refresh, setActive(value) { active = value; if (active) refresh(); } };
}
