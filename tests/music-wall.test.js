import test from 'node:test';
import assert from 'node:assert/strict';
import { musicWallSongs, musicWallPage } from '../js/music-wall.js';
import { recordingKey } from '../js/recommendation-model.js';

const songs = Array.from({ length: 85 }, (_, i) => ({ id: String(i + 1), provider: 'netease', name: `歌曲${i}`, artist: '艺人' }));

test('wall sources retain queue order and ignore invalid or duplicate recordings', () => {
  const snapshot = { queue: [songs[2], songs[1], songs[2], null, {}, songs[0]], favorites: [songs[4]] };
  assert.deepEqual(musicWallSongs(snapshot, 'queue'), [songs[2], songs[1], songs[0]]);
  assert.deepEqual(musicWallSongs(snapshot, 'favorites'), [songs[4]]);
  assert.deepEqual(musicWallSongs(snapshot, 'recommendations'), []);
});

test('a long library renders at most 36 covers and retains selection only on its page', () => {
  const second = musicWallPage(songs, 1, recordingKey(songs[42]));
  assert.equal(second.items.length, 36); assert.equal(second.selected, songs[42]); assert.equal(second.pages, 3);
  const last = musicWallPage(songs, 99, recordingKey(songs[42]));
  assert.equal(last.page, 2); assert.equal(last.items.length, 13); assert.equal(last.selected, songs[72]);
  assert.equal(musicWallPage([], 2, '').selected, undefined);
});

test('removing a favorite clamps the page and selects a remaining song', () => {
  const result = musicWallPage(songs.slice(0, 35), 1, recordingKey(songs[40]));
  assert.equal(result.page, 0); assert.equal(result.selected, songs[0]);
});
