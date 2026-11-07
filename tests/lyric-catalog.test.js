import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LYRIC_EFFECTS, resolveLyricEffect, pickLyricEffect } from '../js/lyric-catalog.js';
import { LYRIC_SCENE_IDS } from '../js/lyric-scenes.js';
import { readLyricSettings, saveLyricSettings } from '../js/lyric-effects.js';

// Authoritative Folia builtin list at 50a3e5239922a32ca0d55cbfa1cdcea9cdfe0278.
const FOLIA_MODES = ['cadenza', 'cappella', 'claddagh', 'classic', 'diorama', 'nebbia', 'fume', 'hanabi', 'lumiere', 'machi', 'monet', 'partita', 'pendolo', 'sonnet', 'still', 'tempera', 'tilt'];
test('every Folia builtin has exactly one selectable implementation', () => {
  assert.deepEqual(LYRIC_EFFECTS.filter(effect => effect.sourceId).map(effect => effect.sourceId).sort(), FOLIA_MODES.sort());
  assert.equal(new Set(LYRIC_EFFECTS.map(effect => effect.id)).size, 20);
  const sceneStyles = readFileSync(new URL('../css/lyric-scenes.css', import.meta.url), 'utf8');
  for (const effect of LYRIC_EFFECTS) {
    if (effect.renderer === 'stage') {
      assert.ok(LYRIC_SCENE_IDS.includes(effect.id), `${effect.id} needs a scene renderer`);
      assert.ok(sceneStyles.includes(`.scene-${effect.id}`), `${effect.id} needs scene styling`);
    }
  }
});

test('all modes and random persist; upstream aliases keep existing saved selections compatible', () => {
  let stored;
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  for (const effect of [...LYRIC_EFFECTS.map(effect => effect.id), 'random']) {
    assert.equal(saveLyricSettings(storage, { effect, fontSize: 42 }), true);
    assert.deepEqual(readLyricSettings(storage), { effect, fontSize: 42 });
  }
  for (const [upstream, local] of [['classic', 'glow'], ['partita', 'cloud']]) {
    stored = JSON.stringify({ effect: upstream, fontSize: 36 });
    assert.equal(readLyricSettings(storage).effect, local);
    assert.equal(resolveLyricEffect(upstream).id, local);
  }
});

test('random never repeats the current style and reaches every other style', () => {
  for (const previous of LYRIC_EFFECTS.map(effect => effect.id)) {
    const selected = new Set(Array.from({ length: 19 }, (_, index) => pickLyricEffect(previous, () => index / 19)));
    assert.equal(selected.size, 19);
    assert.equal(selected.has(previous), false);
    for (const value of [-1, 1, NaN, Infinity]) assert.ok(resolveLyricEffect(pickLyricEffect(previous, () => value)));
  }
});

test('all effect modules and styles are available to the offline shell', () => {
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const asset of ['js/lyric-catalog.js', 'js/lyric-composition.js', 'js/lyric-scenes.js', 'js/lyric-effects.js', 'css/lyric-effects.css', 'css/lyric-scenes.css']) assert.ok(worker.includes(asset));
});
