import { createLyricCompositions } from './lyric-composition.js';
import { createLyricScenes } from './lyric-scenes.js';
import { LYRIC_EFFECTS, RANDOM_LYRIC_EFFECT, resolveLyricEffect, pickLyricEffect } from './lyric-catalog.js';
export { LYRIC_EFFECTS } from './lyric-catalog.js';

export const LYRIC_SETTINGS_KEY = 'cp_lyricAppearance';
export const DEFAULT_LYRIC_SETTINGS = Object.freeze({ effect: 'amll', fontSize: 36 });

export function normalizeLyricSettings(value) {
  const size = value?.fontSize;
  return {
    effect: value?.effect === RANDOM_LYRIC_EFFECT ? RANDOM_LYRIC_EFFECT : resolveLyricEffect(value?.effect)?.id || DEFAULT_LYRIC_SETTINGS.effect,
    fontSize: typeof size === 'number' && Number.isFinite(size)
      ? Math.min(60, Math.max(12, Math.round(size))) : DEFAULT_LYRIC_SETTINGS.fontSize,
  };
}

export function readLyricSettings(storage) {
  try { return normalizeLyricSettings(JSON.parse(storage.getItem(LYRIC_SETTINGS_KEY))); }
  catch { return { ...DEFAULT_LYRIC_SETTINGS }; }
}

export function saveLyricSettings(storage, settings) {
  try { storage.setItem(LYRIC_SETTINGS_KEY, JSON.stringify(normalizeLyricSettings(settings))); return true; }
  catch { return false; }
}

// These are entrance animations for line-timed LRC, never invented word timings.
// Decorate only active lines that need individual glyphs; preserve complete words.
export function decorateLyricLine(line) {
  const text = line?.querySelector('.lrc-text');
  if (!text || text.dataset.effectReady) return;
  const content = text.textContent;
  const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  const glyphSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
  const words = wordSegmenter ? Array.from(wordSegmenter.segment(content), item => item.segment) : content.split(/(\s+)/);
  const fragment = text.ownerDocument.createDocumentFragment();
  let index = 0;
  for (const word of words) {
    if (/^\s+$/.test(word) || index >= 240) { fragment.append(word); continue; }
    const group = text.ownerDocument.createElement('span');
    group.className = 'lyric-word';
    const glyphs = glyphSegmenter ? Array.from(glyphSegmenter.segment(word), item => item.segment) : Array.from(word);
    for (const [position, glyph] of glyphs.entries()) {
      if (index >= 240) { group.append(glyphs.slice(position).join('')); break; }
      const span = text.ownerDocument.createElement('span');
      span.className = 'lyric-glyph';
      span.textContent = glyph;
      span.style.setProperty('--glyph-delay', `${Math.min(index++, 24) * 24}ms`);
      group.appendChild(span);
    }
    fragment.appendChild(group);
  }
  text.replaceChildren(fragment);
  text.dataset.effectReady = 'true';
}

export function createLyricEffects({ onLayoutChange = () => {} } = {}) {
  const root = document.documentElement;
  const modal = document.getElementById('settingsModal');
  const select = document.getElementById('lyricEffectSelect');
  const description = document.getElementById('lyricEffectDescription');
  const preview = document.getElementById('lyricEffectPreview');
  const fontInput = document.getElementById('lyricFontSize');
  const decrease = document.getElementById('lyricFontDecrease');
  const increase = document.getElementById('lyricFontIncrease');
  const reset = document.getElementById('lyricEffectReset');
  const pause = document.getElementById('lyricPreviewToggle');
  const feedback = document.getElementById('lyricEffectFeedback');
  const randomNext = document.getElementById('lyricRandomNext');
  const catalogNote = document.getElementById('lyricCatalogNote');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const compositions = createLyricCompositions();
  const scenes = createLyricScenes({ artwork: () => document.getElementById('albumArt')?.getAttribute('src') || '' });
  const groups = new Map();
  select.replaceChildren();
  for (const effect of LYRIC_EFFECTS) {
    if (!groups.has(effect.group)) {
      const group = document.createElement('optgroup'); group.label = effect.group;
      groups.set(effect.group, group); select.appendChild(group);
    }
    const option = document.createElement('option'); option.value = effect.id; option.textContent = effect.name;
    groups.get(effect.group).appendChild(option);
  }
  const randomOption = document.createElement('option');
  randomOption.value = RANDOM_LYRIC_EFFECT; randomOption.textContent = '随机 · 每首歌换一种'; select.appendChild(randomOption);
  catalogNote.textContent = `${LYRIC_EFFECTS.length} 种效果 · 支持随机切换`;
  let storage;
  try { storage = window.localStorage; } catch { /* Settings still work for this visit. */ }
  let settings = readLyricSettings(storage);
  let effective = settings.effect === RANDOM_LYRIC_EFFECT ? pickLyricEffect() : settings.effect;
  let timer = null;
  let inView = false;
  let paused = false;
  let demoIndex = 0;
  const demo = [
    ['We sing together tonight', '今夜我们一同歌唱'],
    ['Let the music carry you', '让音乐带你去远方'],
    ['Every moment comes alive', '每一刻都闪闪发亮'],
  ];

  function activateLine(line) {
    scenes.reset(line);
    compositions.reset(line);
    if (effective === 'bounce') {
      decorateLyricLine(line);
    } else {
      const text = line?.querySelector('.lrc-text');
      if (text?.dataset.effectReady) { text.textContent = text.textContent; delete text.dataset.effectReady; }
    }
    compositions.render(line, effective);
    scenes.render(line, effective);
  }

  function deactivateLine(line) {
    scenes.reset(line);
    compositions.reset(line);
  }

  function renderPreview() {
    const previous = preview.querySelector('.active');
    if (previous) deactivateLine(previous);
    const fragment = document.createDocumentFragment();
    [-1, 0, 1].forEach(offset => {
      const sample = demo[(demoIndex + offset + demo.length) % demo.length];
      const line = document.createElement('div');
      line.className = offset === 0 ? 'lrc-line active' : 'lrc-line near';
      const text = document.createElement('span');
      text.className = 'lrc-text';
      text.textContent = sample[0];
      line.appendChild(text);
      if (offset === 0) {
        const translation = document.createElement('span');
        translation.className = 'lrc-trans';
        translation.textContent = sample[1];
        line.appendChild(translation);
      }
      fragment.appendChild(line);
    });
    preview.replaceChildren(fragment);
    activateLine(preview.querySelector('.active'));
  }

  function syncPreview() {
    clearTimeout(timer);
    timer = null;
    const running = inView && !paused && !motion.matches && effective !== 'still' && !document.hidden && modal.getAttribute('aria-hidden') === 'false';
    preview.classList.toggle('is-preview-playing', running);
    pause.disabled = motion.matches || effective === 'still';
    pause.textContent = motion.matches ? '已减少动态效果' : effective === 'still' ? '静态预览' : paused ? '播放预览' : '暂停预览';
    pause.setAttribute('aria-pressed', String(paused || motion.matches || effective === 'still'));
    if (running) timer = setTimeout(() => { demoIndex = (demoIndex + 1) % demo.length; renderPreview(); syncPreview(); }, 3600);
  }

  function syncChoice() {
    root.dataset.lyricEffect = effective;
    const effect = resolveLyricEffect(effective);
    randomNext.hidden = settings.effect !== RANDOM_LYRIC_EFFECT;
    description.textContent = `${settings.effect === RANDOM_LYRIC_EFFECT ? `当前：${effect.name} · ` : ''}${effect.description}`;
  }

  function apply(persist = false) {
    if (settings.effect !== RANDOM_LYRIC_EFFECT) effective = settings.effect;
    syncChoice();
    root.style.setProperty('--lyric-font-size', `${settings.fontSize}px`);
    select.value = settings.effect;
    fontInput.value = String(settings.fontSize);
    decrease.disabled = settings.fontSize <= 12;
    increase.disabled = settings.fontSize >= 60;
    document.querySelectorAll('#lyricsScroller .active, #mobileLyricsScroller .active').forEach(activateLine);
    renderPreview();
    syncPreview();
    onLayoutChange();
    if (persist) feedback.textContent = saveLyricSettings(storage, settings) ? '已保存，立即生效' : '已应用；浏览器暂时无法保存，刷新后会恢复默认。';
  }

  const listeners = [];
  function listen(target, event, handler) { target.addEventListener(event, handler); listeners.push(() => target.removeEventListener(event, handler)); }
  function setSize(value) { settings = normalizeLyricSettings({ ...settings, fontSize: value }); apply(true); }
  listen(select, 'change', () => {
    settings = normalizeLyricSettings({ ...settings, effect: select.value });
    if (settings.effect === RANDOM_LYRIC_EFFECT) effective = pickLyricEffect(effective);
    apply(true);
  });
  listen(randomNext, 'click', () => { effective = pickLyricEffect(effective); apply(); });
  listen(fontInput, 'change', () => setSize(fontInput.value.trim() === '' ? settings.fontSize : Number(fontInput.value)));
  listen(fontInput, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); fontInput.blur(); } });
  listen(decrease, 'click', () => setSize(settings.fontSize - 2));
  listen(increase, 'click', () => setSize(settings.fontSize + 2));
  listen(reset, 'click', () => { settings = { ...DEFAULT_LYRIC_SETTINGS }; apply(true); });
  listen(pause, 'click', () => { paused = !paused; syncPreview(); });
  listen(document, 'visibilitychange', syncPreview);
  listen(motion, 'change', syncPreview);
  listen(window, 'storage', event => {
    if (event.key === LYRIC_SETTINGS_KEY || event.key === null) { settings = readLyricSettings(storage); apply(); }
  });
  const visibilityObserver = new IntersectionObserver(entries => { inView = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.15; syncPreview(); }, { threshold: 0.15 });
  visibilityObserver.observe(preview);
  const modalObserver = new MutationObserver(syncPreview);
  modalObserver.observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });
  const layoutObserver = new ResizeObserver(() => {
    if (compositions.refresh()) onLayoutChange();
  });
  [preview, document.getElementById('lyricsScroller'), document.getElementById('mobileLyricsScroller')].forEach(element => layoutObserver.observe(element));
  let destroyed = false;
  document.fonts.ready.then(() => {
    if (destroyed) return;
    document.querySelectorAll('#lyricsScroller .active, #mobileLyricsScroller .active, #lyricEffectPreview .active').forEach(activateLine);
    onLayoutChange();
  });
  apply();
  return {
    activateLine,
    deactivateLine,
    resetLyrics(newTrack = false) {
      compositions.destroy(); scenes.destroy();
      if (newTrack && settings.effect === RANDOM_LYRIC_EFFECT) { effective = pickLyricEffect(effective); syncChoice(); }
      renderPreview(); syncPreview();
    },
    destroy() { destroyed = true; clearTimeout(timer); visibilityObserver.disconnect(); modalObserver.disconnect(); layoutObserver.disconnect(); compositions.destroy(); scenes.destroy(); listeners.forEach(remove => remove()); },
  };
}
