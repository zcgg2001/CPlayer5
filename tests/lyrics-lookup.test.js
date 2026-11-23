import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesLyricRecording, lyricSearchCandidates, lookupLyrics } from '../js/lyrics/lookup.js';
import { createLyricMemory, chooseBestLyrics, hasLyrics } from '../js/lyrics/sources.js';
import { parseLyricsPayload } from '../js/lyrics/document.js';

const song = { name: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, id: 'qq:one', provider: 'qq' };
const row = { id: 1, trackName: '晴天', artistName: '周杰伦', albumName: '叶惠美', duration: 270, syncedLyrics: '[00:01]故事的小黄花', plainLyrics: '故事的小黄花' };
const response = rows => new Response(JSON.stringify(rows));

test('lyrics match the recording, not just the title or the first search hit', () => {
  assert.equal(matchesLyricRecording(song, row), true);
  for (const changed of [{ artistName: '其他歌手' }, { duration: 299 }, { trackName: '晴天 (Live)' }, { artistName: '周杰伦 / 其他歌手' }])
    assert.equal(matchesLyricRecording(song, { ...row, ...changed }), false);
  assert.equal(matchesLyricRecording({ ...song, versionLabel: '伴奏' }, row), false);
  assert.equal(matchesLyricRecording({ ...song, name: '晴天 (Live A)' }, { ...row, trackName: '晴天 (Live B)' }), false);
  assert.equal(matchesLyricRecording({ ...song, artist: '未知歌手' }, row), false);
});
test('unknown duration requires an exact album; collaborators can differ in order', () => {
  assert.equal(matchesLyricRecording({ ...song, duration: 0 }, row), true);
  assert.equal(matchesLyricRecording({ ...song, duration: 0, album: '' }, row), false);
  assert.equal(matchesLyricRecording({ ...song, duration: 0 }, { ...row, albumName: '演唱会' }), false);
  assert.equal(matchesLyricRecording({ ...song, name: '素颜', artist: '许嵩 / 何曼婷' }, { ...row, trackName: '素颜', artistName: '何曼婷、许嵩' }), true);
  assert.equal(matchesLyricRecording({ ...song, name: '素颜', artist: '许嵩, 何曼婷' }, { ...row, trackName: '素颜', artistName: '何曼婷 / 许嵩' }), true);
});
test('matching candidates prefer real sync, deduplicate and retain plain text as fallback', () => {
  const results = lyricSearchCandidates(song, [ { ...row, duration: 300 }, { ...row, syncedLyrics: null }, row, { ...row, id: 2 }, { ...row, instrumental: true }]);
  assert.equal(results.length, 2);
  assert.equal(results[0].document.lines[0].start, 1000);
  assert.equal(results[1].document.plain, '故事的小黄花');
  assert.equal(results[1].document.lines.length, 0, 'plain lyrics must not acquire made-up timestamps');
  assert.equal(lyricSearchCandidates(song, { data: [row] }).length, 0);
});
test('public lookup retries combined search only when the structured query has no matching recording', async () => {
  const calls = [];
  const result = await lookupLyrics(song, { fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'omit');
    return response(calls.length === 1 ? [{ ...row, artistName: '其他歌手' }] : [row]);
  } });
  assert.equal(calls.length, 2); assert.match(calls[1], /\?q=/); assert.equal(result.length, 1);
});
test('aborting or timing out a lyric lookup cannot return a late result', async () => {
  const abort = new AbortController(); let finish;
  const pending = lookupLyrics(song, { signal: abort.signal, fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  abort.abort(); finish(response([row]));
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(lookupLyrics(song, { timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }), /超时/);
});
test('lookup bounds response size and does not query without usable metadata', async () => {
  let calls = 0;
  assert.deepEqual(await lookupLyrics({ name: '本地音乐', artist: '未知歌手' }, { fetchImpl: () => { calls++; } }), []);
  assert.equal(calls, 0);
  await assert.rejects(lookupLyrics(song, { fetchImpl: async () => new Response(' '.repeat(2 * 1024 * 1024 + 1)) }), /过大/);
  await assert.rejects(lookupLyrics(song, { fetchImpl: async () => new Response('', { status: 429 }) }), /稍后重试/);
});
test('online cache survives reopening without overwriting imported lyrics or offset', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const memory = createLyricMemory(storage), manual = parseLyricsPayload({ lrc: '自己的歌词', source: '导入' });
  memory.save('qq:one', { document: manual, offset: 450 });
  memory.save('qq:one', { onlineDocument: lyricSearchCandidates(song, [row])[0].document });
  const reopened = createLyricMemory(storage).get('qq:one');
  assert.equal(reopened.document.plain, '自己的歌词'); assert.equal(reopened.offset, 450);
  assert.equal(reopened.onlineDocument.lines[0].text, '故事的小黄花');
  assert.equal(reopened.onlineDocument.lines[0].end, Infinity);
  assert.equal(createLyricMemory(storage).get('qq:two'), null);
});
test('placeholders do not block supplementation; real plain text remains usable', () => {
  assert.equal(hasLyrics(parseLyricsPayload({ lrc: '[00:00]纯音乐，请欣赏' })), false);
  assert.equal(hasLyrics(parseLyricsPayload({ lrc: '暂无歌词' })), false);
  const plain = parseLyricsPayload({ lrc: '故事的小黄花' }), synced = parseLyricsPayload({ lrc: row.syncedLyrics });
  assert.equal(chooseBestLyrics([{ document: plain }]).document, plain);
  assert.equal(chooseBestLyrics([{ document: plain }, { document: synced }]).document, synced);
});
test('supplementation replaces a partial synced lyric with a fuller matching document', () => {
  const partial = parseLyricsPayload({ lrc: '[00:01]第一句' });
  const complete = parseLyricsPayload({ lrc: '[00:01]第一句\n[00:05]第二句\n[00:10]第三句' });
  assert.equal(chooseBestLyrics([{ document: partial }, { document: complete }]).document, complete);
});
