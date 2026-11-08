import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricsPayload, parseText, normalizeDocument, activeLines, seekTime, timestamp, wordProgress, readLyricFile } from '../js/lyrics/document.js';
import { deflateSync } from 'node:zlib';

test('YRC keeps absolute words, silent gaps, explicit end and translation', () => {
  const doc = parseLyricsPayload({ yrc: '[1000,4000](1000,800,0)你(2500,1000,0)好', tlrc: '[00:01]Hello' });
  assert.equal(doc.hasWordLevel, true); assert.equal(doc.lines[0].text, '你好'); assert.equal(doc.lines[0].translation, 'Hello');
  assert.deepEqual(doc.lines[0].words.map(w => [w.start, w.end]), [[1000, 1800], [2500, 3500]]);
  assert.equal(wordProgress(doc.lines[0].words[0], 2100), 1); assert.equal(wordProgress(doc.lines[0].words[1], 2100), 0);
  assert.equal(wordProgress(doc.lines[0].words[1], 3000), .5); assert.equal(activeLines(doc, 5000).length, 0);
});
test('LRC multi-stamp lines, colon fractions, offset and empty interlude boundaries', () => {
  const doc = parseLyricsPayload({ lrc: '\uFEFF[offset:150]\n[00:01:25][00:03.250]重逢\n[00:05]\n[00:08]归来' }, 10000);
  assert.deepEqual(doc.lines.map(x => x.start), [1250, 3250, 5000, 8000]);
  assert.equal(doc.lines.at(-1).end, 10000); assert.equal(activeLines(doc, 6000).length, 0);
  assert.equal(seekTime(doc, doc.lines[0], 100), 1); assert.equal(doc.hasWordLevel, false);
});
test('enhanced LRC uses real inline word times and repeats their offsets', () => {
  const doc = parseLyricsPayload({ lrc: '[00:01][00:10]<00:01>hello <00:02>world<00:03>\n[00:20]end' });
  assert.equal(doc.hasWordLevel, true); assert.deepEqual(doc.lines[1].words.map(w => [w.start, w.end]), [[10000, 11000], [11000, 12000]]);
});
test('overlapping main and harmony lines survive normalization', () => {
  const doc = normalizeDocument({ lines: [{ start: 0, end: 5000, text: 'A' }, { start: 0, end: 2000, text: 'B', harmony: true }] });
  assert.equal(activeLines(doc, 1000).length, 2); assert.equal(activeLines(doc, 3000).length, 1);
});
test('invalid or out-of-order word data degrades to usable line timing', () => {
  for (const words of [[{ text: 'A', start: 100, end: 3000 }], [{ text: 'B', start: 100, end: 400 }]]) {
    const doc = normalizeDocument({ lines: [{ start: 0, end: 1000, text: 'A', words }] });
    assert.equal(doc.lines[0].words.length, 0); assert.equal(doc.lines[0].text, 'A');
  }
});
test('unknown duration remains open and is resolved when media metadata arrives', () => {
  const doc = parseLyricsPayload({ lrc: '[00:03]end' }); assert.equal(doc.lines[0].end, Infinity);
  assert.equal(normalizeDocument(doc, 5000).lines[0].end, 5000);
  assert.equal(normalizeDocument(JSON.parse(JSON.stringify(doc)), 5000).lines[0].end, 5000);
});
test('plain text and empty inputs are usable, markup is kept as text', () => {
  assert.equal(parseLyricsPayload({ lrc: '没有时间\n<script>hello</script>' }).plain, '没有时间\n<script>hello</script>');
  assert.deepEqual(parseLyricsPayload({}).lines, []);
});
test('VTT preserves real hours, end times, multiline text and entities', () => {
  const doc = normalizeDocument(parseText('WEBVTT\n\n1\n01:02:03.000 --> 01:02:05.000\n<v A>Hello &amp; bye</v>\nAgain', 'vtt'));
  assert.equal(timestamp('01:02:03'), 3723000); assert.equal(doc.lines[0].start, 3723000); assert.equal(doc.lines[0].end, 3725000); assert.equal(doc.lines[0].text, 'Hello & bye\nAgain');
});
test('text QRC uses absolute times; KRC uses offsets relative to the line', () => {
  const qrc = normalizeDocument(parseText('[5000,2000]你(5000,500)好(6000,500)', 'qrc'));
  const krc = normalizeDocument(parseText('[5000,2000]<0,500,0>你<1000,500,0>好', 'krc'));
  assert.deepEqual(qrc.lines[0].words, krc.lines[0].words); assert.equal(krc.hasWordLevel, true);
});
test('KRC container decoding checks header, XOR and compressed bytes', async () => {
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const compressed = deflateSync('[1000,1000]<0,500,0>好'); const encrypted = compressed.map((n, i) => n ^ key[i % 16]);
  const file = new File([Buffer.from('krc1'), encrypted], 'sample.krc');
  const doc = await readLyricFile(file); assert.equal(doc.lines[0].text, '好'); assert.equal(doc.lines[0].words[0].start, 1000);
});
test('richer payload objects and romanization are preserved and aligned once', () => {
  const doc = parseLyricsPayload({ yrc: { lyric: '[1000,1000](1000,1000,0)你' }, romalrc: { lyric: '[00:01]ni' } });
  assert.equal(doc.hasWordLevel, true); assert.equal(doc.lines[0].romanization, 'ni');
});
test('malformed richer format falls back to original LRC', () => {
  assert.equal(parseLyricsPayload({ yrc: 'broken', lrc: '[00:01]fallback' }).lines[0].text, 'fallback');
});
