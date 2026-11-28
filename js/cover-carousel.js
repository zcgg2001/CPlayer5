import { bindArtwork } from './artwork.js?v=1';
import { t } from './i18n.js';
import { findQueueSongIndex } from './queue-store.js?v=1';

const track = song => typeof song === 'object' && song ? song : { id: song };
const identity = song => {
  const source = song?.artworkSource || track(song);
  return `${source.provider || ''}:${source.id ?? ''}`;
};

// Preview the same queue order used by manual next/previous, without reshuffling it.
export function coverQueueWindow(state, song) {
  const { playlist = [], shuffledOrder = [], playMode } = state;
  const index = song ? findQueueSongIndex(playlist, song, state.currentIndex) : state.currentIndex;
  if (!Number.isInteger(index) || index < 0 || index >= playlist.length) {
    return { entries: song ? [{ slot: 0, key: `detached:${identity(song)}`, song: track(song) }] : [], position: 0, total: 0 };
  }
  const shuffled = playMode === 'random' && shuffledOrder.length === playlist.length;
  const order = shuffled ? shuffledOrder : playlist.map((_, i) => i);
  const position = order.indexOf(index);
  if (position < 0) return { entries: [], position: 0, total: 0 };
  const slots = playlist.length > 1 ? [-1, 0, 1] : [0];
  return {
    entries: slots.map(slot => {
      const target = order[(position + slot + order.length) % order.length];
      return { slot, key: `${target}:${identity(playlist[target])}`, song: slot === 0 && song
        ? { ...track(playlist[target]), ...track(song) } : track(playlist[target]) };
    }),
    position: position + 1, total: playlist.length,
  };
}

export function coverSwipeDirection({ dx, dy, elapsed, size }) {
  if (Math.abs(dx) <= Math.abs(dy) * 1.2) return 0;
  const distance = Math.abs(dx);
  const threshold = Math.max(40, Math.min(90, size * .24));
  const flick = distance >= 24 && elapsed > 0 && distance / elapsed >= .5;
  return distance >= threshold || flick ? (dx < 0 ? 1 : -1) : 0;
}

export function createCoverCarousel({ host, caption, getSnapshot, onNavigate, onLyrics }) {
  const stage = document.createElement('div');
  stage.className = 'cover-carousel'; stage.setAttribute('role', 'region');
  stage.setAttribute('aria-roledescription', 'carousel');
  stage.setAttribute('aria-label', t('coverCarousel'));
  const help = document.createElement('span');
  help.id = 'coverCarouselHelp'; help.className = 'sr-only'; help.textContent = t('coverCarouselHelp');
  stage.setAttribute('aria-describedby', help.id);
  host.classList.add('has-cover-carousel'); host.append(stage, help);
  const legacy = host.querySelector('#mobileAlbumArtWrapper');
  if (legacy) { legacy.inert = true; legacy.setAttribute('aria-hidden', 'true'); }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let cards = [], leaving = [], signature = '', drag = null, width = 0, size = 0, step = 0;
  let requestedDirection = 0, suppressClickUntil = 0, cleanupTimer, frame;
  const timers = () => { clearTimeout(cleanupTimer); cancelAnimationFrame(frame); leaving.forEach(card => card.node.remove()); leaving = []; };
  const positionCard = (card, slot, offset = 0) => {
    const distance = Math.min(1, Math.abs(slot + offset / (step || 1)));
    card.node.style.transform = `translate(-50%, -50%) translateX(${slot * step + offset}px) scale(${1 - .18 * distance})`;
    card.node.style.opacity = Math.abs(slot + offset / (step || 1)) > 1.7 ? '0' : String(1 - .42 * distance);
    card.node.style.zIndex = String(Math.round((2 - distance) * 10));
  };
  function layout() {
    width = host.clientWidth;
    size = Math.max(1, Math.min(width * .86, width - 48, host.clientHeight - 16, 420));
    step = size * .86;
    stage.style.setProperty('--carousel-size', `${size}px`);
    cards.forEach(card => positionCard(card, card.slot));
  }
  function cardFor(entry) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'cover-carousel-card';
    const image = document.createElement('img'); image.alt = ''; image.draggable = false;
    const spinner = document.createElement('span'); spinner.className = 'cover-carousel-spinner'; spinner.setAttribute('aria-hidden', 'true');
    node.append(image, spinner); stage.append(node);
    return { node, image, key: entry.key, slot: entry.slot, fingerprint: '' };
  }
  function update({ animate = true } = {}) {
    const snapshot = getSnapshot();
    const { entries, position, total, loading = false } = snapshot;
    stage.classList.toggle('is-loading', loading);
    stage.setAttribute('aria-busy', String(loading));
    stage.setAttribute('aria-label', t('coverCarousel'));
    help.textContent = t('coverCarouselHelp');
    const center = entries.find(entry => entry.slot === 0);
    caption.hidden = !center;
    caption.querySelector('[data-cover-album]').textContent = center?.song.album || t('coverAlbum');
    const count = caption.querySelector('[data-cover-position]');
    count.textContent = total ? `${position} / ${total}` : '';
    count.setAttribute('aria-label', t('coverQueuePosition', { position, total }));
    const nextSignature = JSON.stringify(entries.map(e => [e.slot, e.key]));
    let direction = requestedDirection; requestedDirection = 0;
    if (nextSignature === signature) {
      cards.forEach(card => refreshCard(card, entries.find(entry => entry.slot === card.slot)));
      return;
    }
    signature = nextSignature;
    const focused = cards.some(card => card.node === document.activeElement);
    const oldCenter = cards.find(card => card.slot === 0);
    if (!direction && oldCenter?.key !== center?.key) {
      direction = cards.find(card => card.slot === 1)?.key === center?.key ? 1
        : cards.find(card => card.slot === -1)?.key === center?.key ? -1 : 0;
    }
    if (!animate || reduced.matches || !oldCenter || oldCenter.key === center?.key) direction = 0;
    timers();
    const previous = cards.slice(), used = new Set();
    cards = [...entries].sort((a, b) => Math.abs(a.slot) - Math.abs(b.slot)).map(entry => {
      const card = previous.find(c => !used.has(c) && c.key === entry.key && c.slot === entry.slot + direction)
        || previous.find(c => !used.has(c) && c.key === entry.key) || cardFor(entry);
      const fresh = !previous.includes(card); used.add(card);
      refreshCard(card, entry);
      if (fresh || !direction) {
        card.node.style.transition = 'none'; positionCard(card, entry.slot + direction);
      }
      return card;
    });
    leaving = previous.filter(card => !used.has(card));
    leaving.forEach(card => { card.node.disabled = true; card.node.setAttribute('aria-hidden', 'true'); if (direction) positionCard(card, card.slot - direction); else card.node.remove(); });
    cards.sort((a, b) => a.slot - b.slot).forEach(card => stage.append(card.node));
    // One layout read starts transitions together; pointer moves only write transforms.
    stage.getBoundingClientRect();
    stage.classList.remove('is-dragging'); drag = null;
    frame = requestAnimationFrame(() => {
      cards.forEach(card => { card.node.style.transition = ''; positionCard(card, card.slot); });
      if (focused) cards.find(card => card.slot === 0)?.node.focus({ preventScroll: true });
    });
    cleanupTimer = setTimeout(() => { leaving.forEach(card => card.node.remove()); leaving = []; }, reduced.matches ? 0 : 420);
  }
  function refreshCard(card, entry) {
    card.key = entry.key; card.song = entry.song; card.slot = entry.slot;
    card.node.dataset.slot = entry.slot;
    const fingerprint = JSON.stringify([entry.key, entry.song.cover, entry.song.albumEntity, entry.song.name]);
    if (card.fingerprint !== fingerprint) { card.fingerprint = fingerprint; bindArtwork(card.image, entry.song, { size: 640 }); }
    label(card);
  }
  function label(card) {
    const action = card.slot === 0 ? 'coverShowLyrics' : card.slot < 0 ? 'coverPrevious' : 'coverNext';
    card.node.setAttribute('aria-label', t(action, { title: card.song.name || t('coverUnknown') }));
    if (card.slot === 0) card.node.setAttribute('aria-current', 'true'); else card.node.removeAttribute('aria-current');
  }
  function navigate(direction) {
    if (!getSnapshot().entries.some(entry => entry.slot === direction)) return;
    requestedDirection = direction;
    try { onNavigate(direction); update(); }
    finally { requestedDirection = 0; }
    // A blocked playback command must not leave a dragged cover between positions.
    stage.classList.remove('is-dragging'); cards.forEach(card => positionCard(card, card.slot));
  }
  const stopDrag = () => {
    drag = null; stage.classList.remove('is-dragging'); cards.forEach(card => positionCard(card, card.slot));
  };
  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.clientX < 24 || event.clientX > innerWidth - 24 || cards.length < 2) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), locked: false };
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.locked) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { suppressClickUntil = performance.now() + 450; stopDrag(); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      drag.locked = true; stage.setPointerCapture(event.pointerId); stage.classList.add('is-dragging');
    }
    event.preventDefault();
    const offset = Math.max(-step * 1.1, Math.min(step * 1.1, dx));
    cards.forEach(card => positionCard(card, card.slot, offset));
  });
  stage.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const gesture = drag; drag = null;
    if (!gesture.locked) return;
    suppressClickUntil = performance.now() + 450;
    const direction = coverSwipeDirection({ dx: event.clientX - gesture.x, dy: event.clientY - gesture.y, elapsed: performance.now() - gesture.time, size });
    if (direction) navigate(direction); else stopDrag();
  });
  stage.addEventListener('pointercancel', () => { suppressClickUntil = performance.now() + 450; stopDrag(); });
  stage.addEventListener('lostpointercapture', () => { if (drag) stopDrag(); });
  stage.addEventListener('click', event => {
    event.stopPropagation();
    if (event.detail > 0 && performance.now() < suppressClickUntil) return;
    const card = cards.find(card => card.node.contains(event.target));
    if (!card) return;
    if (card.slot) navigate(card.slot); else onLyrics();
  });
  stage.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); navigate(event.key === 'ArrowLeft' ? -1 : 1);
  });
  reduced.addEventListener('change', stopDrag);
  window.addEventListener('blur', stopDrag);
  window.addEventListener('cplayer:locale', () => update({ animate: false }));
  const observer = new ResizeObserver(() => { stopDrag(); layout(); }); observer.observe(host);
  layout(); update({ animate: false });
  return { update, expectDirection(direction) { requestedDirection = direction; } };
}
