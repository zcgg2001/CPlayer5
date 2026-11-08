// All internal timing is milliseconds. Media adapters alone use seconds.
export const MAX_LYRIC_BYTES = 2 * 1024 * 1024;
const finite = value => Number.isFinite(Number(value));
const clean = value => typeof value === 'string' ? value.replace(/^\uFEFF/, '').replace(/\r/g, '') : '';
const field = value => clean(typeof value === 'object' ? value?.lyric : value);
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function timestamp(value) {
  const s = String(value).trim();
  const unit = s.match(/^([\d.]+)(ms|s|m|h)$/);
  if (unit) return Number(unit[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[unit[2]];
  if (!s) return NaN;
  const parts = s.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return NaN;
  return parts.reduce((sum, n) => sum * 60 + n, 0) * 1000;
}

export function parseLRC(raw) {
  const lines = [];
  const text = clean(raw);
  for (const row of text.split('\n')) {
    const stamps = [...row.matchAll(/\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const content = row.slice(stamps.at(-1).index + stamps.at(-1)[0].length).trim();
    const wordStamps = [...content.matchAll(/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>/g)];
    const plain = content.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '');
    for (const stamp of stamps) {
      const lrcTime = value => timestamp(value.replace(/^(\d+:\d+):(\d{2,3})$/, '$1.$2'));
      const start = lrcTime(stamp[1]);
      const delta = start - lrcTime(stamps[0][1]);
      const words = wordStamps.map((word, i) => ({
        text: content.slice(word.index + word[0].length, wordStamps[i + 1]?.index ?? content.length),
        start: lrcTime(word[1]) + delta,
        end: wordStamps[i + 1] ? lrcTime(wordStamps[i + 1][1]) + delta : undefined,
      })).filter(word => word.text);
      lines.push({ start, text: plain, words });
    }
  }
  return { lines, offset: Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0), format: /<\d+:\d+/.test(text) ? 'enhanced-lrc' : 'lrc' };
}

function parseWordFormat(raw, format) {
  const lines = [];
  for (const row of clean(raw).split('\n')) {
    const match = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;
    const start = Number(match[1]), end = start + Number(match[2]), words = [];
    if (format === 'yrc' || format === 'krc') {
      const pattern = format === 'yrc' ? /\((\d+),(\d+),\d+\)([^]*?)(?=\(\d+,\d+,\d+\)|$)/g : /<(\d+),(\d+)(?:,\d+)?>([^]*?)(?=<\d+,\d+(?:,\d+)?>|$)/g;
      for (const item of match[3].matchAll(pattern)) {
        const t = Number(item[1]) + (format === 'krc' ? start : 0);
        words.push({ text: item[3], start: t, end: t + Number(item[2]) });
      }
    } else {
      for (const item of match[3].matchAll(/([^]*?)\((\d+),(\d+)(?:,\d+)?\)/g)) {
        words.push({ text: item[1], start: Number(item[2]), end: Number(item[2]) + Number(item[3]) });
      }
    }
    lines.push({ start, end, text: words.length ? words.map(w => w.text).join('') : match[3], words });
  }
  if (format === 'krc') {
    const encoded = clean(raw).match(/\[language:([^\]]+)\]/)?.[1];
    if (encoded) try {
      const language = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
      for (const entry of language.content || []) {
        const field = entry.type === 1 ? 'translation' : entry.type === 0 ? 'romanization' : null;
        if (field && Array.isArray(entry.lyricContent)) entry.lyricContent.forEach((parts, i) => { if (lines[i]) lines[i][field] = Array.isArray(parts) ? parts.join('') : String(parts); });
      }
    } catch { /* A corrupt auxiliary language track must not discard the main timeline. */ }
  }
  return { lines, offset: Number(clean(raw).match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0), format };
}

function xmlDecode(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, s => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[s]);
}

export function parseVTT(raw) {
  const lines = [];
  const blocks = clean(raw).split(/\n\s*\n/);
  for (const block of blocks) {
    const rows = block.split('\n'), index = rows.findIndex(row => row.includes('-->'));
    if (index < 0) continue;
    const match = rows[index].match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
    if (!match) continue;
    lines.push({ start: timestamp(match[1]), end: timestamp(match[2]), text: xmlDecode(rows.slice(index + 1).join('\n').replace(/<[^>]*>/g, '')) });
  }
  return { lines, format: 'vtt', offset: 0 };
}

export function parseTTML(raw, Parser = globalThis.DOMParser) {
  if (!Parser) throw new Error('当前环境无法解析 TTML');
  const xml = new Parser().parseFromString(raw, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('TTML 文件格式错误');
  const attr = (el, name) => [...el.attributes].find(a => a.localName === name)?.value || '';
  const role = el => attr(el, 'role');
  const time = (value, base) => /(?:ms|s|m|h)$/.test(value) ? base + timestamp(value) : timestamp(value);
  const cache = new WeakMap();
  function bounds(el) {
    if (!el) return { start: 0, end: Infinity };
    if (cache.has(el)) return cache.get(el);
    const parent = bounds(el.parentElement);
    const start = attr(el, 'begin') ? time(attr(el, 'begin'), parent.start) : parent.start;
    const end = attr(el, 'end') ? time(attr(el, 'end'), parent.start) : attr(el, 'dur') ? start + timestamp(attr(el, 'dur')) : parent.end;
    const value = { start, end }; cache.set(el, value); return value;
  }
  const lines = [];
  for (const p of xml.getElementsByTagNameNS('*', 'p')) {
    const { start, end } = bounds(p);
    const excluded = el => /translation|roman|x-bg/.test(role(el));
    const collect = node => [...node.childNodes].map(child => {
      if (child.nodeType === 3) return !child.textContent.trim() && /[\n\r]/.test(child.textContent) ? '' : child.textContent;
      if (child.nodeType !== 1 || excluded(child)) return '';
      return child.localName === 'br' ? '\n' : collect(child);
    }).join('');
    const spans = [...p.getElementsByTagNameNS('*', 'span')];
    const timedLeaves = nodes => nodes.filter(s => attr(s, 'begin') && !nodes.some(child => child !== s && attr(child, 'begin') && s.contains(child)));
    const toWord = s => ({ text: collect(s), ...bounds(s) });
    const words = timedLeaves(spans).filter(s => !excluded(s) && !spans.some(parent => parent !== s && excluded(parent) && parent.contains(s))).map(toWord);
    const aux = pattern => spans.filter(s => pattern.test(role(s))).map(s => s.textContent).join('\n');
    lines.push({ start, end, text: collect(p).trim(), words, translation: aux(/translation/), romanization: aux(/roman/), agent: attr(p, 'agent'), harmony: false });
    for (const bg of spans.filter(s => /x-bg/.test(role(s)))) {
      const bgWords = timedLeaves([...bg.getElementsByTagNameNS('*', 'span')]).map(toWord);
      lines.push({ start: bgWords[0]?.start ?? bounds(bg).start, end: bgWords.at(-1)?.end ?? bounds(bg).end, text: collect(bg).trim(), words: bgWords, harmony: true, agent: attr(bg, 'agent') });
    }
  }
  return { lines, format: 'ttml', offset: 0 };
}

export function normalizeDocument(input, duration = Infinity) {
  if (input.lines?.length > 5000) throw new Error('歌词超过 5000 行，请精简后导入');
  const sorted = (input.lines || []).filter(line => finite(line.start) && line.start >= 0).map(line => ({ ...line, start: Number(line.start), text: clean(line.text) })).sort((a, b) => a.start - b.start);
  const nextStarts = []; let next = duration;
  for (let i = sorted.length - 1; i >= 0; i--) { if (i < sorted.length - 1 && sorted[i + 1].start > sorted[i].start) next = sorted[i + 1].start; nextStarts[i] = next; }
  const lines = sorted.map((line, i) => {
    const next = nextStarts[i];
    const end = finite(line.end) && line.end > line.start ? Number(line.end) : Math.max(line.start, next);
    let previous = line.start;
    const words = (line.words || []).map((word, j, all) => ({ text: clean(word.text), start: Number(word.start), end: finite(word.end) ? Number(word.end) : Number(all[j + 1]?.start ?? end) }));
    const valid = words.length && words.map(w => w.text).join('').trim() === line.text.trim() && words.every(word => {
      const ok = Number.isFinite(word.start) && word.start >= previous && word.start >= line.start && word.end >= word.start && word.end <= end;
      previous = word.start; return ok;
    });
    return { ...line, id: `line-${i}`, end, words: valid ? words : [], translation: clean(line.translation), romanization: clean(line.romanization), harmony: !!line.harmony };
  });
  return { version: 1, format: input.format || 'lrc', source: input.source || '在线歌词', offset: Number(input.offset) || 0, lines, hasWordLevel: lines.some(line => line.words.length > 0), plain: clean(input.plain) };
}

export function parseText(raw, format = '') {
  const text = clean(raw);
  if (text.length > MAX_LYRIC_BYTES) throw new Error('歌词文件过大（最多 2 MB）');
  if (format === 'ttml' || /<tt[\s>]/.test(text)) return parseTTML(text);
  if (format === 'vtt' || text.startsWith('WEBVTT') || /\d\s*-->/.test(text)) return parseVTT(text);
  if (/<Lyric_1|LyricContent=/.test(text)) {
    const content = text.match(/LyricContent="([^]*?)"\s*\/?\s*>/)?.[1];
    if (!content) throw new Error('QRC 中没有歌词内容');
    return parseWordFormat(xmlDecode(content).replace(/&#10;/g, '\n'), 'qrc');
  }
  if (format === 'krc' || /^\[\d+,\d+\]</m.test(text)) return parseWordFormat(text, 'krc');
  if (format === 'yrc' || /^\[\d+,\d+\]\(/m.test(text)) return parseWordFormat(text, 'yrc');
  if (format === 'qrc' || /^\[\d+,\d+\].*\(\d+,\d+\)/m.test(text)) return parseWordFormat(text, 'qrc');
  const result = parseLRC(text);
  if (!result.lines.length) result.plain = text.replace(/^\[(?:ar|al|ti|by|offset):[^]*?\]$/gm, '').trim();
  return result;
}

export function parseLyricsPayload(payload = {}, duration = Infinity) {
  if (typeof payload === 'string') payload = { lrc: payload };
  let result;
  for (const format of ['ttml', 'yrc', 'qrc', 'krc', 'vtt', 'lrc']) {
    const raw = field(payload[format]);
    if (!raw) continue;
    try {
      const candidate = parseText(raw, format);
      if (candidate.lines.length || candidate.plain) { result = candidate; break; }
    } catch { /* A malformed richer format may fall back to the supplied LRC. */ }
  }
  result ||= { lines: [] };
  for (const [name, raw] of [['translation', payload.ytlrc || payload.tlrc || payload.tlyric], ['romanization', payload.yromalrc || payload.romalrc || payload.romalyrics]]) {
    const aux = parseLRC(field(raw)).lines;
    const used = new Set();
    for (const line of result.lines) {
      if (line[name] || line.harmony) continue;
      const matches = aux.map((other, i) => ({ other, i, distance: Math.abs(other.start - line.start) })).filter(x => !used.has(x.i) && x.distance <= 500).sort((a, b) => a.distance - b.distance);
      if (matches[0]) { line[name] = matches[0].other.text; used.add(matches[0].i); }
    }
  }
  return normalizeDocument({ ...result, source: payload.source || result.source }, duration);
}

export function wordProgress(word, time) {
  if (time < word.start) return 0;
  if (word.end <= word.start) return 1;
  return clamp((time - word.start) / (word.end - word.start));
}

export function activeLines(doc, time, lead = 0) {
  return doc.lines.filter(line => line.start <= time + lead && line.end > time && line.text);
}

export function seekTime(doc, line, userOffset = 0) {
  return Math.max(0, (line.start - doc.offset - userOffset) / 1000);
}

export async function readLyricFile(file) {
  if (file.size > MAX_LYRIC_BYTES) throw new Error('歌词文件过大（最多 2 MB）');
  const format = file.name.split('.').at(-1).toLowerCase();
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'krc1') {
    const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
    bytes = bytes.slice(4).map((byte, i) => byte ^ key[i % key.length]);
    if (!globalThis.DecompressionStream) throw new Error('此浏览器不支持压缩 KRC，请导入解压后的歌词');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_LYRIC_BYTES) throw new Error('解压后的歌词超过 2 MB'); chunks.push(value); }
    } finally { await reader.cancel(); }
    bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (format === 'qrc' && !/[\[<]/.test(raw)) throw new Error('请先将加密 QRC 转为文本 QRC、TTML 或 LRC');
  const result = normalizeDocument({ ...parseText(raw, format), source: file.name });
  if (!result.lines.length && !result.plain) throw new Error('文件中没有可显示的歌词');
  return result;
}
