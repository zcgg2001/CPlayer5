import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapCardText, fitCardLyrics, shareableLines, cardFileName } from '../js/lyrics/card.js';

test('card wrapping preserves complete CJK/Latin and emoji graphemes within width', () => {
  const texts = ['故事的小黄花从出生那年就飘着', 'A little flower in the wind', '家人 👩‍👩‍👧‍👦 在这里', 'supercalifragilisticexpialidocious'];
  const measure = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * 10;
  for (const text of texts) {
    const rows = wrapCardText(text, 80, measure);
    assert.equal(rows.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(rows.every(row => measure(row) <= 80));
  }
});
test('card fitting includes line gaps and rejects text that would clip at minimum size', () => {
  const texts = Array(6).fill('长句中文与 English words 混合排版，仍然需要完整保留。');
  const layout = fitCardLyrics(texts, { width: 920, height: 525, measure: (text, size) => text.length * size * .8, maxSize: 72 });
  assert.ok(layout.height <= 525); assert.ok(layout.fontSize >= 28); assert.ok(layout.fontSize < 72);
  assert.equal(layout.rows.filter(row => row.gap).length, 5);
  assert.equal(layout.rows.map(row => row.text || '').join('').replace(/\s/g, ''), texts.join('').replace(/\s/g, ''));
  assert.throws(() => fitCardLyrics(['长'.repeat(2000)], { width: 920, height: 100, measure: (text, size) => text.length * size }), /减少选句/);
});
test('plain lyric sharing preserves user line breaks without inventing timing', () => {
  assert.deepEqual(shareableLines({ plain: ' 第一行\n\n第二行 ', lines: [] }), [{ text: '第一行', start: null }, { text: '第二行', start: null }]);
  assert.deepEqual(shareableLines({ lines: [{ start: 1000, text: 'hello' }, { start: 2000, text: ' ' }] }), [{ start: 1000, text: 'hello' }]);
  assert.equal(cardFileName({ name: '歌/曲:分享' }), '歌_曲_分享-歌词卡片.png');
});
