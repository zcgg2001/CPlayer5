import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LYRIC_SETTINGS, LYRIC_SETTINGS_KEY, readLyricSettings, saveLyricSettings } from '../js/lyric-effects.js';

test('missing, corrupt and obsolete lyric settings leave a usable default', () => {
  for (const value of [null, '{broken', 'null', '[]', '42', '{"effect":"removed","fontSize":"huge"}']) {
    assert.deepEqual(readLyricSettings({ getItem: () => value }), DEFAULT_LYRIC_SETTINGS);
  }
  assert.deepEqual(readLyricSettings({ getItem() { throw new Error('Storage blocked'); } }), DEFAULT_LYRIC_SETTINGS);
});

test('saved effects and bounded font sizes survive a fresh settings read', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  for (const [requested, expected] of [[-5, 12], [1000, 60], [45.8, 46]]) {
    assert.equal(saveLyricSettings(storage, { effect: 'bounce', fontSize: requested }), true);
    assert.deepEqual(readLyricSettings(storage), { effect: 'bounce', fontSize: expected });
    assert.equal(entries.size, 1);
    assert.ok(entries.has(LYRIC_SETTINGS_KEY));
  }
  assert.equal(saveLyricSettings(storage, DEFAULT_LYRIC_SETTINGS), true);
  assert.deepEqual(readLyricSettings(storage), DEFAULT_LYRIC_SETTINGS);
});

test('storage failures report unsaved settings without throwing during interaction', () => {
  const storage = { setItem() { throw new Error('Quota exceeded'); } };
  assert.equal(saveLyricSettings(storage, { effect: 'cloud', fontSize: 40 }), false);
  assert.equal(saveLyricSettings(undefined, DEFAULT_LYRIC_SETTINGS), false);
});
