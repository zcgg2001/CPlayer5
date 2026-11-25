import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkChoiceKey, artworkSearchCandidates, createArtworkLookup, createArtworkRecovery, itunesCover } from '../js/artwork-recovery.js';
import { artworkUrl, createArtworkResolver, createArtworkPresenter } from '../js/artwork.js';

const track = { id: '167876', provider: 'gd', name: '有何不可', artist: '许嵩', album: '自定义', duration: 241 };
const cover = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/album/100x100bb.jpg';
const row = { kind: 'song', trackId: 101, collectionId: 201, trackName: track.name, artistName: track.artist, collectionName: track.album, trackTimeMillis: 241000, artworkUrl100: cover };
const candidates = () => artworkSearchCandidates(track, [row]);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const store = () => { const data = new Map(); return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; };

test('cover matching keeps release identity and rejects covers, remixes, and duration mismatches', () => {
  const rows = [row, { ...row }, { ...row, collectionId: 202, collectionName: '精选集' },
    { ...row, collectionId: 203, artistName: '另一位歌手' }, { ...row, collectionId: 204, trackName: '有何不可 (Live)' },
    { ...row, collectionId: 205, trackTimeMillis: 260000 }, { ...row, collectionId: 206, kind: 'music-video' },
    { ...row, collectionId: 207, artworkUrl100: 'https://image.invalid/a.jpg' }];
  const matches = artworkSearchCandidates(track, rows);
  assert.deepEqual(matches.map(c => [c.id, c.sameAlbum]), [['201', true], ['202', false]]);
  assert.equal(artworkSearchCandidates({ ...track, album: '' }, [row])[0].sameAlbum, false);
  assert.equal(artworkSearchCandidates({ ...track, name: '未知歌曲' }, [row]).length, 0);
  assert.equal(itunesCover(cover + '?token=secret'), '');
  const traditional = artworkSearchCandidates(track, [{ ...row, artistName: '許嵩', collectionName: '自定義' }]);
  assert.equal(traditional[0].sameAlbum, true);
});

test('cover choices follow the selected original recording across provider fallback, but separate releases', () => {
  assert.equal(artworkChoiceKey(track), artworkChoiceKey({ ...track, provider: 'qq', id: 'other', artworkSource: track }));
  assert.equal(artworkChoiceKey(track), artworkChoiceKey({ ...track, provider: 'xinghai-netease' }));
  assert.notEqual(artworkChoiceKey(track), artworkChoiceKey({ ...track, album: '精选集' }));
  assert.notEqual(artworkChoiceKey(track), artworkChoiceKey({ ...track, name: '有何不可 (Live)' }));
  assert.equal(artworkChoiceKey({ ...track, type: 'playlist' }), '');
});

test('shared public search omits credentials and a canceled view does not cancel another', async () => {
  const response = deferred(); let calls = 0, request;
  const lookup = createArtworkLookup({ native: true, fetchImpl: (url, options) => { calls++; request = { url, options }; return response.promise; } });
  const abort = new AbortController();
  const first = lookup(track, { signal: abort.signal }), second = lookup(track);
  abort.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(request.options.signal.aborted, false);
  assert.equal(request.options.credentials, 'omit');
  assert.match(request.url, /^\/android-player\/artwork-search\?term=/);
  response.resolve(Response.json({ results: [row] }));
  assert.equal((await second).length, 1);
  assert.equal((await lookup(track)).length, 1); assert.equal(calls, 1);
});

test('temporary search failures can retry and oversized responses do not enter the cache', async () => {
  let calls = 0;
  const lookup = createArtworkLookup({ fetchImpl: async () => ++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ results: [row] }) });
  await assert.rejects(lookup(track)); assert.equal((await lookup(track)).length, 1);
  const huge = createArtworkLookup({ fetchImpl: async () => new Response(' '.repeat(512 * 1024 + 1)) });
  await assert.rejects(huge(track), /过大/);
});

test('automatic recovery only uses an unambiguous same-release result', async () => {
  const make = lookup => createArtworkRecovery({ lookup, loadImage: async () => {}, toUrl: value => value, storage: store() });
  assert.equal((await make(async () => candidates()).recover(track)).status, 'ready');
  assert.equal(await make(async () => artworkSearchCandidates(track, [{ ...row, collectionName: '精选集' }])).recover(track), null);
  assert.equal(await make(async () => artworkSearchCandidates(track, [row, { ...row, collectionId: 202 }])).recover(track), null);
  const disabled = make(assert.fail); disabled.setEnabled(false); assert.equal(await disabled.recover(track), null);
});

test('manual choice and restore outrank pending automatic results, even when storage is full', async () => {
  const lookup = deferred(), storage = { getItem: () => null, setItem() { throw Error('quota'); } };
  const recovery = createArtworkRecovery({ lookup: () => lookup.promise, loadImage: async () => {}, toUrl: value => value, storage });
  const auto = recovery.recover(track), manual = { ...candidates()[0], cover: cover.replace('/album/', '/manual/') };
  assert.equal((await recovery.choose(track, manual)).saved, false);
  lookup.resolve(candidates()); assert.equal(await auto, null);
  assert.equal(recovery.get(track).cover, manual.cover);
  const loading = deferred();
  const another = createArtworkRecovery({ lookup: async () => candidates(), loadImage: () => loading.promise, toUrl: value => value, storage });
  const pending = another.choose(track, manual); another.restore(track); loading.resolve();
  assert.equal(await pending, null); assert.equal(another.get(track).original, true);
});

test('disabling automatic recovery during image loading prevents its result from being saved', async () => {
  const loading = deferred(), entered = deferred();
  const recovery = createArtworkRecovery({ lookup: async () => candidates(), loadImage: () => { entered.resolve(); return loading.promise; }, toUrl: value => value, storage: store() });
  const pending = recovery.recover(track); await entered.promise;
  recovery.setEnabled(false); loading.resolve();
  assert.equal(await pending, null); assert.equal(recovery.get(track), undefined);
});

test('manual covers survive restart, win over supplied images, and restoring returns the original image', async () => {
  const storage = store(), baseUrl = 'https://player.test/';
  const make = () => createArtworkResolver({ storage, baseUrl, lookupCovers: async () => candidates(), loadImage: async () => {}, fetchImpl: assert.fail });
  const resolver = make(); await resolver.recovery.choose(track, candidates()[0]);
  const restored = make(), original = { ...track, cover: 'https://p1.music.126.net/original.jpg' };
  assert.equal((await restored.resolve(original)).url, artworkUrl(cover, 640, baseUrl));
  assert.equal(restored.knownCover(track), '', 'supplemental choices do not contaminate original cover references');
  restored.recovery.restore(track);
  assert.equal((await restored.resolve(original)).url, artworkUrl(original.cover, 640, baseUrl));
  assert.equal(make().recovery.get(track).original, true);
});

test('only the current player initiates recovery; browsing rows and working covers do not search', async () => {
  let calls = 0;
  const resolver = createArtworkResolver({ baseUrl: 'https://player.test/', lookupCovers: async () => { calls++; return candidates(); },
    loadImage: async () => {}, fetchImpl: async () => new Response(null, { status: 404 }) });
  assert.equal((await resolver.resolve(track)).status, 'fallback'); assert.equal(calls, 0);
  const changes = [], presenter = createArtworkPresenter({ resolver, images: () => [], onChange: value => changes.push(value) });
  await presenter.show({ ...track, cover: 'https://p1.music.126.net/working.jpg' }); assert.equal(calls, 0);
  const missing = { ...track, id: '999' };
  await presenter.show(missing); assert.equal(calls, 1);
  assert.equal(changes.at(-1).recovered, true);
});

test('a stale recovery cannot repaint the new song or save its canceled result', async () => {
  const pending = deferred(), began = deferred();
  const resolver = createArtworkResolver({ baseUrl: 'https://player.test/', storage: store(),
    lookupCovers: async () => { began.resolve(); return pending.promise; },
    loadImage: async () => {}, fetchImpl: async () => new Response(null, { status: 404 }) });
  const changes = [], presenter = createArtworkPresenter({ resolver, images: () => [], onChange: (value, song) => changes.push([song.id, value.status]) });
  const first = presenter.show(track); await began.promise;
  await presenter.show({ ...track, id: 'next', cover: 'https://p1.music.126.net/working.jpg' });
  pending.resolve(candidates()); await first;
  assert.deepEqual(changes.at(-1), ['next', 'ready']); assert.equal(resolver.recovery.get(track), undefined);
});
