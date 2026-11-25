import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodeOnlineLyrics, decodeQrc } from '../js/lyrics/encoded.js';
import { createNativeLyricLookup, nativeLyricIdentity } from '../js/lyrics/native-lookup.js';
import { parseLyricsPayload, wordProgress } from '../js/lyrics/document.js';
import { chooseBestLyrics, mergeLyricLayers } from '../js/lyrics/sources.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/online-lyrics.json', import.meta.url)));
const song = { id: 'qq:0039MnYb0qxYhV', provider: 'qq', name: '原创测试', artist: '测试歌手' };
const encoded = { provider: 'qq', id: '0039MnYb0qxYhV', encoding: 'qrc-hex', lyric: fixture.qrc,
  translation: fixture.qrcTranslation, romanization: fixture.qrcRomanization };
const krc = text => {
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  return Buffer.concat([Buffer.from('krc1'), deflateSync(text).map((v, i) => v ^ key[i % 16])]).toString('base64');
};

test('fixed QRC vectors preserve real word boundaries and both kinds of auxiliary timeline', async () => {
  assert.equal(await decodeQrc(fixture.qrc), fixture.text);
  const doc = parseLyricsPayload(await decodeOnlineLyrics(encoded));
  assert.equal(doc.lines.length, 3); assert.equal(doc.hasWordLevel, true);
  assert.deepEqual(doc.lines[0].words.map(w => [w.text, w.start, w.end]), [['风', 1000, 1700], ['吹', 2000, 2600], ['来', 3000, 3800]]);
  assert.equal(wordProgress(doc.lines[0].words[1], 2300), .5);
  assert.equal(doc.lines[0].translation, 'The wind arrives'); assert.equal(doc.lines[0].romanization, 'feng chui lai');
  const brokenAux = parseLyricsPayload(await decodeOnlineLyrics({ ...encoded, translation: 'broken', romanization: '' }));
  assert.equal(brokenAux.hasWordLevel, true); assert.equal(brokenAux.lines[0].translation, '');
  const plain = parseLyricsPayload(await decodeOnlineLyrics({ ...encoded, lyric: fixture.qrcTranslation }));
  assert.equal(plain.format, 'lrc'); assert.equal(plain.hasWordLevel, false);
});

test('online KRC keeps relative timing, file offset and embedded translation/romanization', async () => {
  const language = Buffer.from(JSON.stringify({ content: [{ type: 1, lyricContent: [['风吹过']] }, { type: 0, lyricContent: [['feng ', 'chui']] }] })).toString('base64');
  const payload = await decodeOnlineLyrics({ encoding: 'krc-base64', lyric: krc(`[offset:150]\n[language:${language}]\n[5000,2000]<0,500,0>风<1000,800,0>吹`) });
  const doc = parseLyricsPayload(payload); assert.equal(doc.offset, 150);
  assert.deepEqual(doc.lines[0].words.map(w => [w.start, w.end]), [[5000, 5500], [6000, 6800]]);
  assert.equal(doc.lines[0].translation, '风吹过'); assert.equal(doc.lines[0].romanization, 'feng chui');
  const lrc = await decodeOnlineLyrics({ encoding: 'lrc-base64', lyric: Buffer.from('[00:01]真实逐行').toString('base64') });
  assert.equal(parseLyricsPayload(lrc).hasWordLevel, false);
});

test('corrupt, oversized and decompression-bomb inputs cannot become lyrics', async () => {
  for (const value of ['', '0'.repeat(15), 'x'.repeat(16), '0'.repeat(262160)]) await assert.rejects(decodeQrc(value));
  await assert.rejects(decodeOnlineLyrics({ encoding: 'krc-base64', lyric: Buffer.from('wrong').toString('base64') }));
  await assert.rejects(decodeOnlineLyrics({ encoding: 'krc-base64', lyric: krc('a'.repeat(2 * 1024 * 1024 + 1)) }), /2 MB/);
  await assert.rejects(decodeOnlineLyrics({ encoding: 'lrc-base64', lyric: '!' }));
});

test('native identities unwrap known channels and reject opaque IDs or foreign jianbin URLs', () => {
  assert.deepEqual(nativeLyricIdentity(song), { provider: 'qq', id: '0039MnYb0qxYhV' });
  assert.deepEqual(nativeLyricIdentity({ ...song, id: '97773' }), { provider: 'qq', id: '97773' });
  assert.deepEqual(nativeLyricIdentity({ ...song, provider: 'op-qq', id: 'op-qq:0039MnYb0qxYhV' }), nativeLyricIdentity(song));
  const hash = 'ABCDEF0123456789ABCDEF0123456789';
  const url = `https://www.jbsou.cn/api.php?type=kg&id=${hash}`;
  assert.deepEqual(nativeLyricIdentity({ provider: 'jianbin-kugou', id: `jianbin-kugou:${encodeURIComponent(url)}` }), { provider: 'kugou', id: hash.toLowerCase() });
  for (const bad of [url.replace('www.jbsou.cn', 'other.test'), url.replace('type=kg', 'type=qq'), url + '&id=other', url.replace('/api.php', '/other')])
    assert.equal(nativeLyricIdentity({ provider: 'jianbin-kugou', id: bad }), null);
  assert.deepEqual(nativeLyricIdentity({ provider: 'gd', id: '97773' }), { provider: 'netease', id: '97773' });
  assert.deepEqual(nativeLyricIdentity({ provider: 'jianbin-netease', id: 'https://www.jbsou.cn/api.php?type=wy&id=97773' }), { provider: 'netease', id: '97773' });
  for (const track of [{ provider: 'local', id: song.id }, { provider: 'netease', id: 'opaque' }, { provider: 'qq', id: 'qq:%XX' }, { provider: 'qq', id: 'opaque-id' }])
    assert.equal(nativeLyricIdentity(track), null);
});

test('native NetEase lookup keeps real YRC, ordinary LRC and auxiliary layers, and caches the exact ID', async () => {
  let calls = 0;
  const lookup = createNativeLyricLookup({ fetchImpl: async url => {
    calls++; assert.equal(url, '/android-player/online-lyrics?provider=netease&id=186016');
    return Response.json({ encoding: 'netease-json', provider: 'netease', id: '186016',
      lrc: '[00:01]风吹来', yrc: '[1000,3000](1000,1000,0)风(2000,1000,0)吹(3000,1000,0)来', tlrc: '[00:01]Wind arrives' });
  } });
  const track = { provider: 'gd', id: '186016', duration: 30 };
  const result = (await lookup(track))[0].document;
  assert.equal(result.hasWordLevel, true); assert.equal(result.lines[0].text, '风吹来');
  assert.equal(result.lines[0].translation, 'Wind arrives'); assert.equal(result.source, '网易云音乐');
  await lookup({ ...track, provider: 'xinghai-netease' }); assert.equal(calls, 1);
  const plain = parseLyricsPayload(await decodeOnlineLyrics({ provider: 'netease', encoding: 'netease-json', lrc: '[00:01]真实逐行' }));
  assert.equal(plain.hasWordLevel, false); assert.equal(plain.lines[0].text, '真实逐行');
});

test('native lookup enforces exact response identity, short failure cooldown and explicit refresh', async () => {
  let calls = 0, time = 0, wrong = false;
  const lookup = createNativeLyricLookup({ now: () => time, fetchImpl: async (url, options) => {
    calls++; assert.match(url, /^\/android-player\/online-lyrics\?provider=qq&id=0039MnYb0qxYhV$/);
    assert.equal(options.credentials, 'omit');
    return Response.json(wrong ? { ...encoded, id: 'other' } : encoded);
  } });
  assert.equal((await lookup(song))[0].document.hasWordLevel, true);
  await lookup(song); assert.equal(calls, 1);
  time = 300001; await lookup(song); assert.equal(calls, 2);
  wrong = true; await assert.rejects(lookup(song, { refresh: true }), /不匹配/);
  assert.deepEqual(await lookup(song), []); assert.equal(calls, 3);
  time += 30001; wrong = false; assert.equal((await lookup(song)).length, 1);
  await lookup({ provider: 'local', id: 'x' }); assert.equal(calls, 4);
});

test('aborted, timed-out or oversized native responses cannot update a lyric cache', async () => {
  let aborted = false;
  const fetchImpl = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
  const ctrl = new AbortController(), lookup = createNativeLyricLookup({ fetchImpl });
  const pending = lookup(song, { signal: ctrl.signal }); ctrl.abort();
  await assert.rejects(pending); assert.equal(aborted, true);
  await assert.rejects(createNativeLyricLookup({ fetchImpl, timeoutMs: 5 })(song));
  await assert.rejects(createNativeLyricLookup({ fetchImpl: async () => new Response(' '.repeat(512 * 1024 + 1)) })(song), /过大/);
});

test('word timing never replaces the full song with an excerpt, and existing translations survive upgrades', async () => {
  const full = parseLyricsPayload({ lrc: '[00:01]风吹来\n[00:10]听见你\n[00:20]云散开', tlrc: '[00:01]The wind arrives' });
  const excerpt = parseLyricsPayload({ qrc: '[1000,3000]风(1000,1000)吹(2000,1000)来(3000,1000)' });
  assert.equal(chooseBestLyrics([{ document: full }, { document: excerpt }]).document, full);
  const word = parseLyricsPayload(await decodeOnlineLyrics({ ...encoded, translation: '', romanization: '' }));
  const chosen = chooseBestLyrics([{ document: full }, { document: word }]).document;
  assert.equal(chosen, word); assert.equal(mergeLyricLayers(chosen, full).lines[0].translation, 'The wind arrives');
});
