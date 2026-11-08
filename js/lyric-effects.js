import { createLyricsController } from './lyrics/controller.js';
import { RANDOM_LYRIC_EFFECT, resolveLyricEffect } from './lyric-catalog.js';
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

export function createLyricEffects(options = {}) {
  return createLyricsController({ ...options, readAppearance: readLyricSettings, saveAppearance: saveLyricSettings });
}
