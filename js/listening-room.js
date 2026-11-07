// Original DOM implementation inspired by AMLL's ambient artwork and lyric focus.
// LRC remains line-timed: no synthetic word timestamps are introduced.
export function createLyricFollower(scroller, resumeButton, {
  reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.lyricEffect === 'still',
  visible = () => !document.hidden && scroller.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let frame = null;
  let timer = null;
  let target = 0;
  let velocity = 0;
  let position = null;
  let lastTime = null;
  let following = true;

  function stop() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    velocity = 0;
    position = null;
    lastTime = null;
  }

  function tick(time) {
    frame = null;
    if (!following || !visible()) return stop();
    const dt = Math.min((time - (lastTime ?? time - 16)) / 1000, 0.032);
    lastTime = time;
    // Keep subpixel integration independent of browsers that quantize scrollTop.
    position ??= scroller.scrollTop;
    const distance = target - position;
    velocity += (distance * 110 - velocity * 22) * dt;
    if (reducedMotion() || (Math.abs(distance) < 0.5 && Math.abs(velocity) < 2)) {
      scroller.scrollTop = target;
      stop();
      return;
    }
    position += velocity * dt;
    scroller.scrollTop = position;
    frame = requestFrame(tick);
  }

  function follow(top) {
    target = Math.max(0, Math.min(top, Math.max(0, scroller.scrollHeight - scroller.clientHeight)));
    if (!following || !visible()) return stop();
    if (reducedMotion()) {
      stop();
      scroller.scrollTop = target;
    } else if (frame === null) frame = requestFrame(tick);
  }

  function recenter() {
    const line = scroller.querySelector('.lrc-line.active');
    if (line) follow(line.offsetTop - scroller.clientHeight / 2 + line.clientHeight / 2);
  }

  function resume() {
    clearTimer(timer);
    following = true;
    if (resumeButton) resumeButton.hidden = true;
    recenter();
  }

  function hold() {
    if (!scroller.querySelector('[data-time]')) return;
    following = false;
    stop();
    if (resumeButton) resumeButton.hidden = false;
    clearTimer(timer);
    timer = setTimer(resume, 6000);
  }

  function onKey(event) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) hold();
  }

  scroller.addEventListener('wheel', hold, { passive: true });
  scroller.addEventListener('touchmove', hold, { passive: true });
  scroller.addEventListener('keydown', onKey);
  scroller.addEventListener('scroll-mascot-interaction', hold);
  resumeButton?.addEventListener('click', resume);

  return {
    follow, recenter, resume, stop,
    reset() { stop(); clearTimer(timer); following = true; if (resumeButton) resumeButton.hidden = true; },
    destroy() {
      stop(); clearTimer(timer);
      scroller.removeEventListener('wheel', hold);
      scroller.removeEventListener('touchmove', hold);
      scroller.removeEventListener('keydown', onKey);
      scroller.removeEventListener('scroll-mascot-interaction', hold);
      resumeButton?.removeEventListener('click', resume);
    },
  };
}

export function createListeningRoom({ audio, artwork, titleSource, artistSource }) {
  const root = document.documentElement;
  const room = document.getElementById('desktopLayout');
  const title = document.getElementById('immersiveTitle');
  const artist = document.getElementById('immersiveArtist');
  const status = document.getElementById('immersivePlaybackState');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const followers = new Map([
    ['lyricsScroller', 'desktopLyricsResume'],
    ['mobileLyricsScroller', 'mobileLyricsResume'],
  ].map(([id, button]) => [id, createLyricFollower(document.getElementById(id), document.getElementById(button))]));
  const backgrounds = Array.from(document.querySelectorAll('.listening-ambient'), element => {
    const layers = [0, 1].map(() => {
      const layer = document.createElement('div');
      layer.className = 'listening-ambient-art';
      element.appendChild(layer);
      return layer;
    });
    return { layers, active: 0 };
  });
  let artworkVersion = 0;
  let lastArtwork = '';

  function syncArtwork() {
    const src = artwork.getAttribute('src') || '';
    if (src === lastArtwork) return;
    lastArtwork = src;
    const version = ++artworkVersion;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (version !== artworkVersion) return;
      for (const background of backgrounds) {
        const next = 1 - background.active;
        background.layers[next].style.backgroundImage = `url(${JSON.stringify(image.src)})`;
        background.layers[next].classList.add('is-visible');
        background.layers[background.active].classList.remove('is-visible');
        background.active = next;
      }
    };
    image.onerror = () => {
      if (version === artworkVersion) backgrounds.forEach(({ layers }) => layers.forEach(layer => layer.classList.remove('is-visible')));
    };
    image.src = src;
  }

  function syncMetadata() {
    title.textContent = titleSource.textContent || '让音乐，填满此刻';
    artist.textContent = artistSource.textContent || '选一首喜欢的歌，开始聆听';
  }

  function syncState() {
    const playing = !audio.paused && !audio.ended;
    root.classList.toggle('listening-playing', playing && !document.hidden && !motion.matches);
    status.textContent = !audio.currentSrc ? '准备聆听' : playing ? '正在播放' : '已暂停';
    followers.forEach(follower => document.hidden ? follower.stop() : follower.recenter());
  }

  const metadataObserver = new MutationObserver(syncMetadata);
  [titleSource, artistSource].forEach(element => metadataObserver.observe(element, { childList: true, characterData: true, subtree: true }));
  const artworkObserver = new MutationObserver(syncArtwork);
  artworkObserver.observe(artwork, { attributes: true, attributeFilter: ['src'] });
  const viewObserver = new MutationObserver(() => followers.forEach(follower => follower.recenter()));
  viewObserver.observe(room, { attributes: true, attributeFilter: ['aria-hidden'] });
  viewObserver.observe(document.getElementById('mobileLyricsPage'), { attributes: true, attributeFilter: ['class'] });
  const resizeObserver = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (!target.clientHeight) continue;
      target.style.setProperty('--lyrics-inset', `${target.clientHeight / 2}px`);
      followers.get(target.id)?.recenter();
    }
  });
  followers.forEach((_, id) => resizeObserver.observe(document.getElementById(id)));
  ['play', 'pause', 'ended', 'loadedmetadata', 'emptied'].forEach(event => audio.addEventListener(event, syncState));
  audio.addEventListener('seeking', () => followers.forEach(follower => follower.resume()));
  document.addEventListener('visibilitychange', syncState);
  motion.addEventListener('change', syncState);
  // Reopening a translated/animated mobile page may initially have opacity zero.
  document.getElementById('mobileLyricsPage').addEventListener('transitionend', () => followers.get('mobileLyricsScroller').recenter());
  syncMetadata(); syncArtwork(); syncState();
  return {
    follow(id, top) { followers.get(id)?.follow(top); },
    recenterLyrics() { followers.forEach(follower => follower.recenter()); },
    resetLyrics() { followers.forEach(follower => follower.reset()); },
  };
}
