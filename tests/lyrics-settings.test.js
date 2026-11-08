import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudio, importStudio, readStudio, saveStudio } from '../js/lyrics/settings.js';
import { createLyricMemory, matchingLyricSources, chooseBestLyrics, trackKey } from '../js/lyrics/sources.js';
import { parseLyricsPayload } from '../js/lyrics/document.js';

test('settings import validates ranges, modes, asset schemes and schema version', () => {
  const value = normalizeStudio({ opacity: 0, offset: Infinity, backgroundUrl: 'javascript:alert(1)', image: 'https://test.invalid/image', font: 'bad', modes: { glow: { rotation: 900 }, unknown: {value:1} } });
  assert.equal(value.opacity, .3); assert.equal(value.offset, 0); assert.equal(value.backgroundUrl, ''); assert.equal(value.image, ''); assert.equal(value.font, 'sans-serif'); assert.equal(value.modes.glow.rotation, 20); assert.equal(value.modes.unknown, undefined);
  assert.throws(() => importStudio('{"version":2}'));
  assert.equal(importStudio('{"version":1,"offset":800}').offset, 0, 'appearance imports must not shift another song');
});
test('invalid saved lyric documents do not prevent the player from loading', () => {
  const storage = { getItem: () => JSON.stringify([null, {key:'source:1',document:{lines:'broken'}}]) };
  assert.equal(createLyricMemory(storage).get('source:1').document, null);
});
test('fountain choice and intensity survive save/reload; blocked storage is reported', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(saveStudio(storage, { fountain: false, fountainStrength: .8 }), true);
  assert.equal(readStudio(storage).fountain, false); assert.equal(readStudio(storage).fountainStrength, .8);
  assert.equal(saveStudio({setItem(){throw Error('quota');}}, {}), false);
});
test('manual lyrics and offsets stay isolated by recording and survive JSON serialization', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const memory = createLyricMemory(storage), doc = parseLyricsPayload({ lrc:'[00:01]hello' });
  assert.equal(memory.save('source:1', { document: doc, offset: 250 }), true);
  const restored = createLyricMemory(storage); assert.equal(restored.get('source:1').document.lines[0].end, Infinity); assert.equal(restored.get('source:1').offset, 250); assert.equal(restored.get('source:2'), null);
  restored.save('source:1', { document: null }); assert.equal(restored.get('source:1').document, null);
});
test('one recording keeps lyric preferences when playback falls back to another channel', () => {
  const key = trackKey({id:'123',provider:'chksz'});
  assert.equal(key, trackKey({id:'netease:123',provider:'netease'}));
  assert.equal(key, trackKey({id:'op-netease:123',sourceId:'123',provider:'op-netease'}));
  assert.notEqual(key, trackKey({id:'123',provider:'qq'}));
  assert.notEqual(key, trackKey({id:'124',provider:'gd'}));
});
test('automatic source selection rejects live/different-duration recordings before quality comparison', () => {
  const song = { id:'123',provider:'gd',name:'A song',artist:'Artist',album:'Album',duration:200 };
  const candidates = [song, {...song,id:'qq:abc',sourceId:'abc',provider:'qq'}, {...song,id:'qq:live',provider:'qq',name:'A song (Live)'}, {...song,id:'qq:short',provider:'qq',duration:100}];
  assert.equal(matchingLyricSources(song, candidates).length, 2);
  const line = parseLyricsPayload({lrc:'[00:01]hi'}), word = parseLyricsPayload({yrc:'[1000,1000](1000,900,0)hi'});
  assert.equal(chooseBestLyrics([{document:line},{document:word}]).document, word);
});
