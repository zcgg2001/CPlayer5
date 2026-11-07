import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLyricPhrases, layoutMindscape } from '../js/lyric-composition.js';
import { readLyricSettings, saveLyricSettings } from '../js/lyric-effects.js';

test('phrase layout preserves spaces, punctuation, CJK, combining marks and joined emoji', () => {
  for (const text of ['We sing together tonight', '把未说出口的话，慢慢唱给你听。', '你好 👩🏻‍🎤 cafe\u0301  tonight!', '', '   ', 'Supercalifragilisticexpialidocious']) {
    const phrases = splitLyricPhrases(text, 8);
    assert.equal(phrases.join(''), text);
    assert.ok(phrases.length <= 4);
    assert.equal(phrases.filter(phrase => phrase.includes('👩🏻‍🎤')).length, text.includes('👩🏻‍🎤') ? 1 : 0);
    assert.ok(phrases.every(phrase => !phrase.startsWith('\u0301')));
    if (text.startsWith('We')) assert.ok(phrases.some(phrase => phrase.includes('together')));
  }
});

test('mindscape keeps each word within its container and has no overlapping text boxes at every supported size', () => {
  const metrics = Array.from({ length: 24 }, (_, index) => ({ text: String(index), ratio: index === 8 ? 27 : 1 + index % 6, length: 1 + index % 7 }));
  for (const width of [160, 240, 350, 650]) for (const fontSize of [12, 36, 60]) {
    const layout = layoutMindscape(metrics, width, fontSize);
    assert.equal(layout.words.length, metrics.length);
    assert.equal(layout.words.filter(word => word.hero).length, 1);
    for (const [index, word] of layout.words.entries()) {
      assert.equal(word.text, metrics[index].text);
      assert.ok(word.x >= 0 && word.x + word.width <= width + .01);
      assert.ok(word.y >= 0 && word.y + word.height <= layout.height);
      for (const other of layout.words.slice(index + 1)) {
        const overlapX = word.x < other.x + other.width && word.x + word.width > other.x;
        const overlapY = word.y < other.y + other.height && word.y + word.height > other.y;
        assert.equal(overlapX && overlapY, false);
      }
    }
  }
  assert.equal(layoutMindscape([], 300, 36).height, 0);
});

test('Folia-inspired effects survive storage alongside existing preferences', () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  for (const effect of ['cadenza', 'tilt', 'cappella', 'amll']) {
    saveLyricSettings(storage, { effect, fontSize: 46 });
    assert.deepEqual(readLyricSettings(storage), { effect, fontSize: 46 });
  }
});
