import { bindArtwork, retryArtworkBindings } from './artwork.js?v=1';
import { recordingKey } from './recommendation-model.js';
import { wallWindow, wallMetrics, wallSongPosition, clampWallZoom, zoomWallCamera, advanceWallMotion, WALL_ZOOM } from './music-wall-field.js';

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

export function createMusicWall({ document, root, storage, getSnapshot, getCurrentSong, onPlay, onQueue, onDetails, onSearch, onRetry }) {
  const win = document.defaultView, reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let source = 'recommendations', zoom = 1, active = false, songs = [], signature = '', currentKey = '';
  let songRenders = [];
  let width = 0, height = 0, camera = { x: 2.2, y: 2.15 }, selectedKey = '', selectedCell = '';
  let frame = 0, moving = false, lastFrame = 0, velocity = { x: 0, y: 0 }, drag = null, pinch = null, suppressClickUntil = 0;
  const tiles = new Map(), pointers = new Map(), listeners = [];
  try {
    const saved = JSON.parse(storage?.getItem('zp_music_wall_v1') || '{}');
    if (Object.hasOwn(SOURCES, saved.source)) source = saved.source;
    zoom = clampWallZoom(saved.zoom ?? (saved.dense ? .75 : 1));
  } catch { /* Preferences are optional. */ }
  const listen = (node, event, handler, options) => { node.addEventListener(event, handler, options); listeners.push(() => node.removeEventListener(event, handler, options)); };
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text != null) node.textContent = text; return node; };
  const icon = name => { const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; };
  const button = (label, action, glyph, iconOnly = false) => {
    const node = el('button', `wall-button${iconOnly ? ' wall-icon-button' : ''}`); node.type = 'button';
    if (glyph) node.append(icon(glyph)); node.append(el('span', '', label));
    node.setAttribute('aria-label', label); node.title = label;
    node.addEventListener('click', action); return node;
  };
  const save = () => { try { storage?.setItem('zp_music_wall_v1', JSON.stringify({ source, zoom })); } catch { /* Optional. */ } };
  const viewport = el('div', 'wall-viewport'); viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', '无限封面墙'); viewport.setAttribute('aria-describedby', 'musicWallHelp');
  const field = el('div', 'music-wall-field'); viewport.append(field);
  const toolbar = el('div', 'wall-toolbar'), filters = el('div', 'wall-filters');
  filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', '音乐墙内容');
  for (const [key, label] of Object.entries(SOURCES)) {
    const tab = button(label, () => {
      if (source === key) return;
      stop(); closeFocus(); source = key; camera = { x: 2.2, y: 2.15 }; save(); refresh(true);
    });
    tab.dataset.wallSource = key; filters.append(tab);
  }
  const zoomControls = el('div', 'wall-zoom'); zoomControls.setAttribute('role', 'group'); zoomControls.setAttribute('aria-label', '封面大小');
  const zoomOut = button('缩小封面', () => setZoom(zoom - .15), 'Minus', true);
  const zoomIn = button('放大封面', () => setZoom(zoom + .15), 'Plus', true);
  zoomControls.append(zoomOut, zoomIn); toolbar.append(filters, zoomControls);
  const help = el('p', 'wall-hint', '向任意方向拖动 · 双指缩放');
  help.append(el('span', 'sr-only', '。键盘方向键移动，加减键缩放，回车展开中央封面。')); help.id = 'musicWallHelp';
  const count = el('p', 'sr-only'); count.setAttribute('role', 'status');
  const tools = el('div', 'wall-tools');
  const locate = button('定位正在播放', () => {
    const current = getCurrentSong(); if (!current) return;
    stop(); closeFocus(); source = 'queue'; save(); refresh(true);
    const index = songs.findIndex(song => recordingKey(song) === recordingKey(current));
    if (index >= 0) { camera = wallSongPosition(index, songs.length); schedule(); }
  }, 'LocateFixed', true);
  const navigation = el('div', 'wall-navigation'); navigation.id = 'musicWallNavigation'; navigation.hidden = true;
  navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', '移动音乐墙');
  for (const [label, dx, dy, glyph] of [['向上浏览', 0, -1, 'ArrowUp'], ['向左浏览', -1, 0, 'ArrowLeft'], ['向下浏览', 0, 1, 'ArrowDown'], ['向右浏览', 1, 0, 'ArrowRight']]) {
    const node = button(label, () => panBy(dx * width * .6, dy * height * .6), glyph, true);
    node.dataset.direction = glyph; navigation.append(node);
  }
  const navigate = button('移动音乐墙', () => { navigation.hidden = !navigation.hidden; navigate.setAttribute('aria-expanded', String(!navigation.hidden)); }, 'Move', true);
  navigate.setAttribute('aria-expanded', 'false'); navigate.setAttribute('aria-controls', navigation.id);
  tools.append(button('重新加载封面', () => retryArtworkBindings(root), 'RefreshCw', true), locate, navigate);
  const empty = el('div', 'wall-empty'), focus = el('article', 'wall-focus'); focus.hidden = true;
  root.classList.add('music-wall'); root.append(viewport, toolbar, tools, navigation, help, count, empty, focus);

  function image(song, size) {
    const node = el('img'); node.alt = ''; node.draggable = false; node.width = node.height = size;
    return bindArtwork(node, song, { size });
  }
  function closeFocus(restore = false) {
    const hadFocus = focus.contains(document.activeElement);
    focus.hidden = true; focus.replaceChildren(); selectedKey = ''; selectedCell = ''; root.classList.remove('has-focus');
    if (restore || hadFocus) viewport.focus({ preventScroll: true });
    schedule();
  }
  function showFocus(tile) {
    stop(); selectedKey = recordingKey(tile.song); selectedCell = tile.key; focus.replaceChildren();
    camera = { ...tile.center }; schedule();
    const song = tile.song, picture = image(song, 500); picture.classList.add('wall-focus-image');
    const copy = el('div', 'wall-focus-copy'), title = el('h2', '', song.name); title.id = 'musicWallSelectedTitle';
    focus.setAttribute('aria-labelledby', title.id);
    copy.append(el('span', 'wall-eyebrow', selectedKey === currentKey ? '正在播放' : '在这里，遇见一首歌'), title, el('p', '', song.artist || '未知歌手'));
    const actions = el('div', 'wall-focus-actions');
    const play = button('播放', () => onPlay(song), 'Play');
    const enqueue = button('加入队列', () => onQueue(song), 'ListPlus', true);
    const details = button('歌曲详情与收藏', () => onDetails(song, details), 'Ellipsis', true);
    const close = button('收起封面', () => closeFocus(true), 'X', true); close.classList.add('wall-focus-close');
    actions.append(play, enqueue, details); copy.append(actions); focus.append(picture, close, copy);
    focus.hidden = false; root.classList.add('has-focus'); play.focus({ preventScroll: true });
  }
  function updateZoomControls() {
    zoomOut.disabled = zoom <= WALL_ZOOM.min + .001; zoomIn.disabled = zoom >= WALL_ZOOM.max - .001;
    root.classList.toggle('is-dense', zoom < .9); root.dataset.wallZoom = zoom.toFixed(2);
  }
  function setZoom(value, anchor = { x: width / 2, y: height / 2 }) {
    stop(); closeFocus();
    const next = clampWallZoom(value);
    camera = zoomWallCamera({ camera, width, height, zoom, nextZoom: next, anchor }); zoom = next;
    updateZoomControls(); save(); schedule();
  }
  function stop() { moving = false; velocity = { x: 0, y: 0 }; }
  function panBy(x, y) {
    stop(); closeFocus(); const { pitch } = wallMetrics(width, height, zoom);
    camera.x += x / pitch; camera.y += y / pitch; schedule();
  }
  function schedule() { if (active && !document.hidden && !frame) frame = win.requestAnimationFrame(render); }
  function render(now) {
    frame = 0; if (!active || document.hidden) return;
    if (moving) {
      const result = advanceWallMotion(camera, velocity, now - lastFrame, wallMetrics(width, height, zoom).pitch);
      camera = result.camera; velocity = result.velocity; moving = result.moving;
    }
    lastFrame = now;
    const cells = wallWindow({ width, height, camera, zoom, count: songs.length }), keep = new Set();
    const central = cells.reduce((best, cell) => !best || Math.hypot(cell.center.x - camera.x, cell.center.y - camera.y) < Math.hypot(best.center.x - camera.x, best.center.y - camera.y) ? cell : best, null);
    for (const cell of cells) {
      const song = songs[cell.index], presentation = songRenders[cell.index], key = presentation.key; keep.add(cell.key);
      let tile = tiles.get(cell.key);
      if (!tile) {
        const node = el('button', 'wall-tile'); node.type = 'button';
        tile = { node, key: cell.key, fingerprint: '' };
        node.addEventListener('click', event => {
          if (performance.now() < suppressClickUntil && event.detail !== 0) return;
          showFocus(tile);
        });
        tiles.set(cell.key, tile); field.append(node);
      }
      tile.song = song; tile.center = cell.center;
      const rendition = cell.size > 170 ? 300 : 150;
      const fingerprint = presentation[rendition];
      if (fingerprint !== tile.fingerprint) {
        tile.fingerprint = fingerprint;
        tile.node.replaceChildren(image(song, rendition), el('span', 'wall-tile-caption', song.name), el('span', 'wall-playing', '播放中'));
        tile.state = '';
      }
      if (tile.size !== cell.size) { tile.size = cell.size; tile.node.style.width = tile.node.style.height = `${cell.size}px`; }
      tile.node.style.transform = `translate3d(${cell.x.toFixed(2)}px,${cell.y.toFixed(2)}px,0)`;
      const state = `${cell.visible}:${key === currentKey}:${cell.key === selectedCell}:${cell === central}`;
      if (tile.state !== state) {
        tile.state = state;
        tile.node.classList.toggle('is-large', cell.span > 1);
        tile.node.classList.toggle('is-playing', key === currentKey);
        tile.node.classList.toggle('is-selected', cell.key === selectedCell);
        tile.node.classList.toggle('is-central', cell === central);
        const label = `${song.name}，${song.artist || '未知歌手'}${key === currentKey ? '，正在播放' : ''}，展开封面`;
        if (tile.label !== label) { tile.label = label; tile.node.setAttribute('aria-label', label); }
        tile.node.setAttribute('aria-hidden', String(!cell.visible));
        // The viewport is the keyboard stop; arrows explore and Enter opens its
        // central cover. Recycling must never trap Tab among repeating tiles.
        tile.node.tabIndex = -1;
        tile.node.dataset.wallCell = cell.key;
      }
    }
    for (const [key, tile] of tiles) if (!keep.has(key)) {
      if (tile.node === document.activeElement) viewport.focus({ preventScroll: true });
      tile.node.remove(); tiles.delete(key);
    }
    root.dataset.wallX = camera.x.toFixed(3); root.dataset.wallY = camera.y.toFixed(3);
    root.classList.toggle('is-moving', moving || !!drag?.moved || !!pinch);
    if (moving) schedule();
  }
  function measure() {
    const nextWidth = viewport.clientWidth, nextHeight = viewport.clientHeight;
    if (!nextWidth || !nextHeight) return;
    width = nextWidth; height = nextHeight; schedule();
  }
  function refresh(force = false) {
    if (!active) return;
    const snapshot = getSnapshot(), next = musicWallSongs(snapshot, source);
    const current = getCurrentSong(); currentKey = current ? recordingKey(current) : '';
    const metadata = next.map(song => [recordingKey(song), song.name, song.artist, song.cover]);
    const nextSignature = JSON.stringify([source, currentKey, snapshot.loading, metadata]);
    if (!force && signature === nextSignature) return;
    signature = nextSignature; songs = next;
    // Artwork identity changes with the data or rendition, not with the camera.
    // Avoid normalizing IDs and serializing cover URLs for every tile per frame.
    songRenders = metadata.map(fields => ({ key: fields[0], 150: JSON.stringify([...fields, 150]), 300: JSON.stringify([...fields, 300]) }));
    filters.querySelectorAll('button').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.wallSource === source)));
    updateZoomControls(); locate.hidden = !current;
    const loading = snapshot.loading && source === 'recommendations';
    count.textContent = songs.length ? `${SOURCES[source]} · ${songs.length} 首，循环铺满音乐墙` : loading ? '正在整理音乐墙…' : '';
    viewport.hidden = help.hidden = !songs.length; empty.hidden = songs.length > 0;
    zoomControls.hidden = tools.hidden = !songs.length;
    if (!songs.length) {
      stop(); closeFocus(); navigation.hidden = true; navigate.setAttribute('aria-expanded', 'false');
      empty.replaceChildren(icon(loading ? 'Disc3' : 'Library'), el('h2', '', loading ? '好音乐，即将铺满这一面' : source === 'queue' ? '队列里还没有音乐' : source === 'favorites' ? '把喜欢的歌留在这面墙上' : '暂时没能取得推荐'),
        el('p', '', loading ? '封面会随歌曲一起出现' : source === 'favorites' ? '收藏歌曲后，回到这里就能看到。' : '搜索喜欢的歌曲，或稍后重新加载。'));
      if (!loading) empty.append(button(source === 'recommendations' ? '重新加载' : '去搜索', source === 'recommendations' ? onRetry : onSearch, source === 'recommendations' ? 'RefreshCw' : 'Search'));
    }
    if (selectedKey && !songs.some(song => recordingKey(song) === selectedKey)) closeFocus();
    measure(); schedule();
  }
  const point = event => ({ x: event.clientX, y: event.clientY });
  function beginPinch() {
    for (const id of pointers.keys()) viewport.setPointerCapture(id);
    const [a, b] = [...pointers.values()], rect = viewport.getBoundingClientRect();
    const midpoint = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    const { pitch } = wallMetrics(width, height, zoom);
    pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom, rect,
      anchor: { x: camera.x + (midpoint.x - width / 2) / pitch, y: camera.y + (midpoint.y - height / 2) / pitch } };
    drag = null; suppressClickUntil = performance.now() + 500; closeFocus();
  }
  listen(viewport, 'pointerdown', event => {
    if (event.button !== 0 || !active) return;
    const wasMoving = moving; stop(); pointers.set(event.pointerId, point(event));
    if (pointers.size === 1) drag = { id: event.pointerId, start: point(event), previous: point(event), time: event.timeStamp, moved: wasMoving };
    else if (pointers.size === 2) beginPinch();
  });
  listen(win, 'pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      zoom = clampWallZoom(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance);
      const { pitch } = wallMetrics(width, height, zoom);
      camera = { x: pinch.anchor.x - ((a.x + b.x) / 2 - pinch.rect.left - width / 2) / pitch,
        y: pinch.anchor.y - ((a.y + b.y) / 2 - pinch.rect.top - height / 2) / pitch };
      updateZoomControls(); schedule(); return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 7) return;
    if (!drag.moved) { drag.moved = true; closeFocus(); }
    if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
    const dx = drag.previous.x - event.clientX, dy = drag.previous.y - event.clientY;
    const dt = Math.max(8, event.timeStamp - drag.time), { pitch } = wallMetrics(width, height, zoom);
    camera.x += dx / pitch; camera.y += dy / pitch;
    velocity = { x: Math.max(-3, Math.min(3, .35 * velocity.x + .65 * dx / dt)), y: Math.max(-3, Math.min(3, .35 * velocity.y + .65 * dy / dt)) };
    drag.previous = point(event); drag.time = event.timeStamp; schedule();
  });
  function endPointer(event, cancelled = false) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pinch) { save(); pinch = null; drag = null; suppressClickUntil = performance.now() + 500; }
    else if (drag?.id === event.pointerId) {
      if (drag.moved) {
        suppressClickUntil = performance.now() + 500;
        moving = !cancelled && !reduced.matches && event.timeStamp - drag.time < 100 && Math.hypot(velocity.x, velocity.y) > .025;
        lastFrame = performance.now();
      }
      drag = null;
    }
    if (cancelled) stop();
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    schedule();
  }
  listen(win, 'pointerup', event => endPointer(event));
  listen(win, 'pointercancel', event => endPointer(event, true));
  listen(viewport, 'lostpointercapture', event => endPointer(event, true));
  listen(viewport, 'dragstart', event => event.preventDefault());
  listen(viewport, 'wheel', event => {
    if (event.ctrlKey || event.metaKey || !songs.length) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    panBy((event.shiftKey ? event.deltaY : event.deltaX) * unit, (event.shiftKey ? 0 : event.deltaY) * unit);
  }, { passive: false });
  listen(viewport, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (steps[event.key]) { event.preventDefault(); const [x, y] = steps[event.key]; panBy(x * width * .45, y * height * .45); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + .15); }
    else if (event.key === '-') { event.preventDefault(); setZoom(zoom - .15); }
    else if ((event.key === 'Enter' || event.key === ' ') && event.target === viewport) {
      event.preventDefault();
      const tile = [...tiles.values()].find(tile => tile.node.classList.contains('is-central'));
      if (tile) showFocus(tile);
    }
  });
  listen(root, 'keydown', event => { if (event.key === 'Escape' && !focus.hidden) { event.stopPropagation(); closeFocus(true); } });
  listen(root, 'focusin', event => { if (!focus.hidden && !focus.contains(event.target)) closeFocus(); });
  function cancelMotion() {
    stop(); drag = pinch = null;
    const captured = [...pointers.keys()]; pointers.clear();
    for (const id of captured) if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    if (frame) win.cancelAnimationFrame(frame); frame = 0; root.classList.remove('is-moving');
  }
  listen(document, 'visibilitychange', () => { if (document.hidden) cancelMotion(); else schedule(); });
  listen(win, 'blur', cancelMotion);
  listen(reduced, 'change', () => { if (reduced.matches) { stop(); schedule(); } });
  for (const event of ['cplayer:library-changed', 'cplayer:library-applied']) listen(win, event, () => refresh());
  const resize = new win.ResizeObserver(measure); resize.observe(root);
  return {
    refresh,
    handleBack() { if (!focus.hidden) { closeFocus(true); return true; } if (!navigation.hidden) { navigation.hidden = true; navigate.setAttribute('aria-expanded', 'false'); return true; } return false; },
    setActive(value) { active = value; if (active) { refresh(); measure(); schedule(); } else cancelMotion(); },
    destroy() { active = false; cancelMotion(); resize.disconnect(); listeners.forEach(remove => remove()); tiles.clear(); root.replaceChildren(); },
  };
}
