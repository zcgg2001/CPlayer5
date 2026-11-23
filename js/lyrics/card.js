export const CARD_FORMATS = Object.freeze({ square: [1080, 1080], story: [1080, 1920] });
export const CARD_THEMES = Object.freeze({ cover: '封面色', ink: '唱片黑', paper: '暖纸笺' });
export const MAX_CARD_LINES = 6;
export const MAX_CARD_CHARACTERS = 500;

export function shareableLines(doc) {
  if (doc.lines?.some(line => line.text.trim())) return doc.lines.filter(line => line.text.trim()).map(line => ({ text: line.text, start: line.start }));
  return (doc.plain || '').split('\n').map(text => ({ text: text.trim(), start: null })).filter(line => line.text);
}

const graphemes = text => globalThis.Intl?.Segmenter ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment) : Array.from(text);
export function wrapCardText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    const tokens = paragraph.match(/\s+|[\p{L}\p{N}'’-]+|[^\s]/gu) || [''];
    for (const token of tokens) {
      if (line && measure(line + token) > maxWidth) { lines.push(line.trimEnd()); line = ''; }
      if (measure(token) > maxWidth) {
        for (const glyph of graphemes(token)) {
          if (line && measure(line + glyph) > maxWidth) { lines.push(line); line = ''; }
          line += glyph;
        }
      } else line += line ? token : token.trimStart();
    }
    if (line.trim() || !paragraph) lines.push(line.trimEnd());
  }
  return lines;
}

export function fitCardLyrics(texts, { width, height, measure, maxSize = 78, minSize = 28 }) {
  for (let fontSize = maxSize; fontSize >= minSize; fontSize -= 2) {
    const rows = texts.flatMap((text, i) => [...(i ? [{ gap: true }] : []), ...wrapCardText(text, width, text => measure(text, fontSize)).map(text => ({ text }))]);
    const lineHeight = fontSize * 1.45;
    const used = rows.reduce((sum, row) => sum + (row.gap ? fontSize * .45 : lineHeight), 0);
    if (used <= height) return { rows, fontSize, lineHeight, height: used };
  }
  throw new Error('选中的文字较长，请减少选句或使用竖版卡片');
}

export function cardFileName(song) {
  return `${String(song?.name || '歌词').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').slice(0, 60)}-歌词卡片.png`;
}

function palette(theme, art) {
  if (theme === 'paper') return { bg: '#f5ecdd', ink: '#30291f', muted: '#695a48', accent: '#885020', rule: '#d4c5b0' };
  if (theme === 'cover' && art) {
    try {
      const sample = document.createElement('canvas'); sample.width = sample.height = 1;
      const ctx = sample.getContext('2d', { willReadFrequently: true }); ctx.drawImage(art, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return { bg: `rgb(${[r, g, b].map(c => Math.round(c * .18 + 18)).join(',')})`, ink: '#fff6ef', muted: '#d4c8bd', accent: '#ffd0ab', rule: '#77685c' };
    } catch { /* Tainted images never prevent a card without artwork. */ }
  }
  return { bg: '#211e1c', ink: '#fff6ef', muted: '#c9bcb0', accent: '#ffc59f', rule: '#756050' };
}

export async function loadCardArtwork(url, { signal } = {}) {
  if (!url) return null;
  signal?.throwIfAborted();
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    let timer;
    const finish = value => { clearTimeout(timer); img.onload = img.onerror = null; signal?.removeEventListener('abort', abort); if (!value) img.removeAttribute('src'); resolve(value); };
    const abort = () => finish(null);
    img.onload = () => finish(img); img.onerror = abort;
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, 5000); img.src = url;
  });
}

// Draw the preview and export from the same canvas. Every lyric is measured, never cropped.
export function drawLyricCard(canvas, { song, texts, theme = 'cover', format = 'square', artwork = null }) {
  if (!texts.length) throw new Error('请至少选择一句歌词');
  if (texts.length > MAX_CARD_LINES || texts.join('').length > MAX_CARD_CHARACTERS) throw new Error('最多选择 6 句、500 个字');
  const [width, height] = CARD_FORMATS[format] || CARD_FORMATS.square;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), colors = palette(theme, artwork), margin = 80;
  const font = '"Noto Sans SC", Roboto, system-ui, sans-serif';
  ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.muted; ctx.font = `500 24px ${font}`;
  ctx.fillText('ZPLAYER  /  LYRIC NOTES', margin, 94);
  ctx.fillStyle = colors.accent; ctx.fillRect(margin, 137, 60, 5);
  const top = format === 'story' ? 340 : 225, bottom = height - 330;
  const layout = fitCardLyrics(texts, { width: width - margin * 2, height: bottom - top, maxSize: format === 'story' ? 88 : 72,
    measure: (text, size) => { ctx.font = `650 ${size}px ${font}`; return ctx.measureText(text).width; } });
  ctx.font = `650 ${layout.fontSize}px ${font}`; ctx.fillStyle = colors.ink; ctx.textBaseline = 'top';
  let y = top + (bottom - top - layout.height) / 2;
  for (const row of layout.rows) {
    if (row.gap) y += layout.fontSize * .45;
    else { ctx.fillText(row.text, margin, y); y += layout.lineHeight; }
  }
  const footer = height - 254;
  ctx.strokeStyle = colors.rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin, footer - 36); ctx.lineTo(width - margin, footer - 36); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.roundRect(margin, footer, 128, 128, 16); ctx.clip();
  if (artwork) {
    const size = Math.min(artwork.naturalWidth || artwork.width, artwork.naturalHeight || artwork.height);
    ctx.drawImage(artwork, ((artwork.naturalWidth || artwork.width) - size) / 2, ((artwork.naturalHeight || artwork.height) - size) / 2, size, size, margin, footer, 128, 128);
  } else {
    ctx.fillStyle = colors.rule; ctx.fillRect(margin, footer, 128, 128);
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 3;
    for (const radius of [43, 32, 8]) { ctx.beginPath(); ctx.arc(margin + 64, footer + 64, radius, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
  function metadata(text, size, y, color, maxRows) {
    ctx.font = `500 ${size}px ${font}`; ctx.fillStyle = color;
    const rows = wrapCardText(String(text), width - margin * 2 - 160, text => ctx.measureText(text).width);
    for (const [i, row] of rows.slice(0, maxRows).entries()) {
      let value = row;
      if (i === maxRows - 1 && rows.length > maxRows) { while (ctx.measureText(value + '…').width > width - margin * 2 - 160) value = value.slice(0, -1); value += '…'; }
      ctx.fillText(value, margin + 160, y + i * size * 1.3);
    }
  }
  metadata(song.name || '未命名歌曲', 36, footer + 2, colors.ink, 2);
  metadata(song.artist || '未知歌手', 27, footer + 100, colors.muted, 1);
  ctx.fillStyle = colors.muted; ctx.font = `400 22px ${font}`; ctx.fillText('歌词摘录 · 分享此刻的共鸣', margin, height - 56);
  return { width, height, fontSize: layout.fontSize };
}
