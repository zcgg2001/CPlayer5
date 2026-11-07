// Original DOM compositions inspired by Folia's Cadenza / Tilt visual language.
// See docs/lyric-effects.md. Timing stays at the LRC line level.
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });

export function lyricUnits(text) {
  return Array.from(segmenter.segment(text), item => item.segment);
}

// Balance phrases without cutting Latin words or splitting a grapheme cluster.
export function splitLyricPhrases(text, maxLength = 16) {
  const units = lyricUnits(text);
  if (!text.trim()) return [text];
  const count = Math.min(4, Math.max(1, Math.ceil(Array.from(graphemes.segment(text)).length / maxLength)));
  const target = text.length / count;
  const phrases = [];
  let phrase = '';
  for (const unit of units) {
    if (phrase.trim() && phrase.length + unit.length / 2 > target && phrases.length < count - 1 && !/^[\s\p{P}]+$/u.test(unit)) {
      phrases.push(phrase);
      phrase = '';
    }
    phrase += unit;
  }
  if (phrase) phrases.push(phrase);
  return phrases;
}

// Word metrics are measured once, outside animation frames. The hero gets its
// own band; surrounding rows keep reading order and never overlap one another.
export function layoutMindscape(metrics, availableWidth, fontSize) {
  const width = Math.max(1, availableWidth);
  if (!metrics.length) return { width, height: 0, words: [] };
  const hero = metrics.reduce((best, item, index) => {
    const score = Math.min(item.length, 8) + (1 - Math.abs(index / Math.max(1, metrics.length - 1) - .5));
    return score > best.score ? { index, score } : best;
  }, { index: 0, score: -1 }).index;
  const gap = Math.min(18, fontSize * .45);
  const margin = Math.min(12, width * .05);
  const usable = Math.max(1, width - margin * 2);
  const sizes = metrics.map((item, index) => {
    const requested = fontSize * (index === hero ? 1.4 : .78 + (index % 3) * .08);
    const size = Math.min(requested, usable / Math.max(item.ratio, .1));
    return { ...item, index, size, width: Math.min(usable, size * item.ratio), height: size * 1.5, hero: index === hero };
  });
  const rows = [];
  let row = [], used = 0;
  const flush = () => { if (row.length) rows.push(row); row = []; used = 0; };
  for (const item of sizes) {
    if (item.hero) { flush(); rows.push([item]); continue; }
    if (row.length && used + gap + item.width > usable) flush();
    used += (row.length ? gap : 0) + item.width;
    row.push(item);
  }
  flush();
  let y = gap;
  const words = [];
  rows.forEach((items, rowIndex) => {
    const rowWidth = items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
    const rowHeight = Math.max(...items.map(item => item.height));
    const free = Math.max(0, usable - rowWidth);
    let x = margin + free * (items[0].hero ? .5 : rowIndex % 2 ? .72 : .28);
    for (const item of items) {
      words.push({ ...item, x, y: y + (rowHeight - item.height) / 2 });
      x += item.width + gap;
    }
    y += rowHeight + gap;
  });
  return { width, height: y, words: words.sort((a, b) => a.index - b.index) };
}

export function createLyricCompositions() {
  const active = new Map();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  function reset(line) {
    const record = active.get(line);
    if (!record) return;
    record.text.textContent = record.original;
    record.text.removeAttribute('aria-label');
    record.text.classList.remove('lyric-mindscape', 'lyric-tilt');
    record.text.style.removeProperty('height');
    record.text.style.removeProperty('--composition-size');
    active.delete(line);
  }

  function render(line, effect) {
    for (const held of [...active.keys()]) if (!held.isConnected) reset(held);
    reset(line);
    if (!['cadenza', 'tilt'].includes(effect)) return;
    const text = line?.querySelector('.lrc-text');
    if (!text || !context) return;
    const original = text.textContent;
    // Very long subtitles remain fully readable, with bounded DOM work.
    if (Array.from(graphemes.segment(original)).length > 240) return;
    const style = getComputedStyle(text);
    const width = text.clientWidth || line.clientWidth;
    active.set(line, { text, original, effect, width });
    if (!width) return; // ResizeObserver renders after the hidden player opens.
    const fontSize = parseFloat(style.fontSize) || 36;
    text.setAttribute('aria-label', original);
    const fragment = document.createDocumentFragment();
    if (effect === 'cadenza') {
      const units = lyricUnits(original);
      context.font = `750 100px ${style.fontFamily}`;
      const metrics = units.filter(unit => unit.trim()).map(unit => ({
        text: unit, length: Array.from(graphemes.segment(unit)).length,
        ratio: context.measureText(unit).width / 100,
      }));
      const layout = layoutMindscape(metrics, width, fontSize);
      let wordIndex = 0;
      for (const unit of units) {
        if (!unit.trim()) { fragment.append(unit); continue; }
        const item = layout.words[wordIndex++];
        const span = document.createElement('span');
        span.className = `mindscape-word${item.hero ? ' is-hero' : ''}`;
        span.textContent = unit;
        span.setAttribute('aria-hidden', 'true');
        span.style.cssText = `left:${item.x}px;top:${item.y}px;font-size:${item.size}px;--word-delay:${Math.min(item.index, 12) * 35}ms;--word-drift:${item.index % 2 ? -5 : 5}px`;
        fragment.appendChild(span);
      }
      text.classList.add('lyric-mindscape');
      text.style.height = `${layout.height}px`;
    } else {
      const phrases = splitLyricPhrases(original, width < 300 ? 11 : 17);
      phrases.forEach((content, index) => {
        const phrase = document.createElement('span');
        phrase.className = `tilt-phrase${index === Math.floor(phrases.length / 2) ? ' is-emphasis' : ''}`;
        phrase.setAttribute('aria-hidden', 'true');
        phrase.style.setProperty('--phrase-delay', `${index * 100}ms`);
        let glyphIndex = 0;
        for (const unit of lyricUnits(content)) {
          if (!unit.trim()) { phrase.append(unit); continue; }
          const word = document.createElement('span');
          word.className = 'tilt-word';
          for (const { segment } of graphemes.segment(unit)) {
            const glyph = document.createElement('span');
            glyph.className = 'tilt-glyph';
            glyph.textContent = segment;
            glyph.style.setProperty('--tilt-lift', `${glyphIndex++ % 2 ? .09 : -.09}em`);
            word.appendChild(glyph);
          }
          phrase.appendChild(word);
        }
        fragment.appendChild(phrase);
      });
      text.classList.add('lyric-tilt');
      text.style.setProperty('--composition-size', `${Math.min(fontSize, width / 6)}px`);
    }
    text.replaceChildren(fragment);
  }

  function refresh() {
    let changed = false;
    for (const [line, record] of [...active]) {
      if (!line.isConnected || !line.classList.contains('active')) { reset(line); continue; }
      if (Math.abs(record.text.clientWidth - record.width) > 1) { render(line, record.effect); changed = true; }
    }
    return changed;
  }
  return { render, reset, refresh, destroy() { [...active.keys()].forEach(reset); } };
}
