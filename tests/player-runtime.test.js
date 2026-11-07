import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createPlaybackSession } from '../js/playback-session.js';
import { normalizeMediaUrl } from '../js/security.js';
import * as musicData from '../js/music-data.js';
import { RequestCancelledError } from '../js/http.js?v=37';
import { MusicService } from '../js/music-service.js';
import { createQueueStore } from '../js/queue-store.js';
import { createPlaybackController } from '../js/playback-controller.js';
import { createCacheStore } from '../js/cache-store.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function block(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing inline block: ${startMarker}`);
  return html.slice(start, end);
}

function inlineFunction(name) {
  const match = html.match(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(match, `Missing inline function: ${name}`);
  const end = html.indexOf('\n        }', match.index);
  return html.slice(match.index, end + '\n        }'.length);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function element() {
  const classes = new Set();
  return {
    style: {}, textContent: '', innerHTML: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    setAttribute() {}, removeAttribute() {},
  };
}

function playbackHarness() {
  const songs = new Map();
  const lyrics = new Map();
  const images = [];
  const metadata = [];
  const parsed = [];
  const errors = [];
  const dom = Object.fromEntries([
    'desktopLoaderOverlay', 'mobileLoaderOverlay', 'progressBar', 'currentTime',
    'totalTime', 'sourceTag', 'songIdTag', 'songTitle', 'artistName', 'albumArt',
    'desktopMiniCover', 'playbackQualityDialog',
  ].map(id => [id, element()]));
  const timers = [];
  const timer = callback => timers.push(callback);
  const audio = { src: '', paused: true, ended: false, readyState: 0, currentTime: 0, duration: 0,
    play: async () => {}, pause() {}, load() {}, addEventListener() {}, removeEventListener() {},
    removeAttribute() {},
  };
  const service = {
    config: { source: 'chksz', quality: 'standard' },
    getSong(id, options) {
      const request = { ...deferred(), options };
      songs.set(id, request);
      return request.promise;
    },
    getLyric(id, options) {
      const request = { ...deferred(), options };
      lyrics.set(id, request);
      return request.promise;
    },
  };
  const queueStore = createQueueStore();
  const playback = createPlaybackController({ audio, musicService: service, queueStore, setTimer: timer, clearTimer() {} });
  playback.state.quality.controller = new AbortController();
  const context = vm.createContext({
    dom, playlist: [], currentIndex: -1, currentPlaybackSong: null,
    playbackRequestVersion: 0,
    playbackQualityState: { version: 0, controller: new AbortController() },
    playbackSession: createPlaybackSession(),
    audio, musicService: service, playback, queueStore, queue: queueStore.state,
    LyricService: {
      fetchLyrics(id, song, options) {
        const request = { ...deferred(), options };
        lyrics.set(id, request);
        return request.promise;
      },
    },
    Image: class { constructor() { images.push(this); } },
    window: { location: { href: 'https://player.example/' } },
    console: { error: error => errors.push(error) },
    normalizeMediaUrl,
    musicSourceOption: () => ({ label: 'NetEase' }),
    getQualityBadge: () => null,
    playbackDetailText: song => song.name,
    updateMediaSessionMetadata: song => metadata.push(song.id),
    parseLyrics: lrc => parsed.push(lrc),
    setLyricsStatus: message => { context.lyricStatus = message; },
    updateDoraemonProgress() {}, resetBufferedProgress() {},
    syncPlaybackQualityDisplay() {}, syncDesktopPlayerAvailability() {},
    syncPlaybackControls() {}, setPlaybackTransitionPending() {},
    saveLastCover() {}, highlightCurrentSong() {}, showToast() {},
    setTimeout: timer,
    preloadNextSong: () => { context.preloads += 1; },
    preloads: 0, mobileUI: null, fluidBg: null,
  });
  Object.defineProperty(context, 'currentPlaybackSong', { get: () => playback.state.currentSong, set: value => { playback.state.currentSong = value; } });
  Object.defineProperty(context, 'playbackQualityState', { get: () => playback.state.quality, set: value => Object.assign(playback.state.quality, value) });
  vm.runInContext(inlineFunction('loadAndPlaySong'), context);
  return { context, songs, lyrics, images, metadata, parsed, errors, timers };
}

const song = id => ({
  id, name: id, artist: 'Artist', provider: 'chksz',
  url: `https://media.example/${id}.mp3`, cover: `https://media.example/${id}.jpg`,
});

test('late song responses cannot replace a newer selection or its loader', async () => {
  const { context, songs } = playbackHarness();
  const first = context.loadAndPlaySong('A');
  const second = context.loadAndPlaySong('B');
  assert.equal(songs.get('A').options.signal.aborted, true);
  songs.get('A').resolve(song('A'));
  await first;
  assert.equal(context.audio.src, '');
  assert.equal(context.dom.desktopLoaderOverlay.classList.contains('opacity-0'), false);
  songs.get('B').resolve(song('B'));
  await second;
  assert.equal(context.audio.src, song('B').url);
  assert.equal(context.currentPlaybackSong.id, 'B');
  assert.equal(context.dom.desktopLoaderOverlay.classList.contains('opacity-0'), true);
});

test('lyrics, artwork and deferred preload remain owned by the current song', async () => {
  const { context, songs, lyrics, images, metadata, parsed, timers } = playbackHarness();
  const first = context.loadAndPlaySong('A');
  songs.get('A').resolve(song('A'));
  await first;
  const second = context.loadAndPlaySong('B');
  assert.equal(lyrics.get('A').options.signal.aborted, true);
  songs.get('B').resolve(song('B'));
  await second;
  lyrics.get('B').resolve({ lrc: 'B lyrics' });
  lyrics.get('A').resolve({ lrc: 'A lyrics' });
  await Promise.resolve();
  await Promise.resolve();
  images[0].onload();
  timers.forEach(callback => callback());
  assert.deepEqual(parsed, ['B lyrics']);
  assert.deepEqual(metadata, ['A', 'B']);
  assert.equal(context.preloads, 1);
});

test('subtitle attribution and cue text cannot be replaced by a stale Bilibili response', async () => {
  const { context, songs, lyrics, parsed } = playbackHarness();
  context.dom.desktopSubtitleSource = element();
  context.dom.mobileSubtitleSource = element();
  const firstSong = { ...song('bili:BV1C9b76cEks:1'), provider: 'bilibili' };
  const secondSong = { ...song('bili:BV1Jt411P77c:1'), provider: 'bilibili' };
  const first = context.loadAndPlaySong(firstSong.id, firstSong);
  songs.get(firstSong.id).resolve(firstSong);
  await first;
  const second = context.loadAndPlaySong(secondSong.id, secondSong);
  songs.get(secondSong.id).resolve(secondSong);
  await second;
  lyrics.get(secondSong.id).resolve({ status: 'available', lrc: 'New subtitles', language: '中文', autoGenerated: true });
  await Promise.resolve();
  lyrics.get(firstSong.id).resolve({ status: 'available', lrc: 'Old subtitles', language: 'English' });
  await Promise.resolve();
  assert.deepEqual(parsed, ['New subtitles']);
  assert.equal(context.dom.desktopSubtitleSource.textContent, 'Bilibili 视频字幕 · 中文 · 自动生成');
  assert.equal(context.dom.mobileSubtitleSource.hidden, false);
});

test('login-required subtitle responses leave audio playback intact', async () => {
  const { context, songs, lyrics } = playbackHarness();
  const selected = { ...song('bili:BV1C9b76cEks:1'), provider: 'bilibili' };
  const loading = context.loadAndPlaySong(selected.id, selected);
  songs.get(selected.id).resolve(selected);
  await loading;
  lyrics.get(selected.id).resolve({ status: 'login_required', lrc: '' });
  await Promise.resolve();
  await Promise.resolve();
  assert.match(context.lyricStatus, /需要登录/);
  assert.equal(context.audio.src, selected.url);
});

test('an obsolete play promise cannot launch old lyrics or show an old error', async () => {
  const { context, songs, lyrics, errors } = playbackHarness();
  const play = deferred();
  const playStarted = deferred();
  context.audio.play = () => { playStarted.resolve(); return play.promise; };
  const first = context.loadAndPlaySong('A');
  songs.get('A').resolve(song('A'));
  await playStarted.promise;
  const second = context.loadAndPlaySong('B');
  context.audio.play = async () => {};
  songs.get('B').resolve(song('B'));
  await second;
  play.reject(new Error('Interrupted by new source'));
  await first;
  assert.equal(lyrics.has('A'), false);
  assert.deepEqual(errors, []);
  assert.equal(context.currentPlaybackSong.id, 'B');
});

test('switching songs cancels quality changes and honors explicit queue metadata', async () => {
  const { context, songs } = playbackHarness();
  const qualityController = context.playbackQualityState.controller;
  context.playlist = [{ ...song('A'), cover: 'https://media.example/old.jpg' }];
  const selected = { ...song('A'), cover: 'https://media.example/selected.jpg' };
  const loading = context.loadAndPlaySong('A', selected);
  assert.equal(qualityController.signal.aborted, true);
  assert.equal(context.playbackQualityState.songLoading, true);
  assert.equal(songs.get('A').options.song, selected);
  songs.get('A').resolve(song('A'));
  await loading;
  assert.equal(context.currentPlaybackSong.cover, selected.cover);
  assert.equal(context.playbackQualityState.songLoading, false);
});

test('Bilibili artwork displays without requiring pixel-read CORS permission', async () => {
  const { context, songs } = playbackHarness();
  const selected = { ...song('bili:BV1C9b76cEks:1'), provider: 'bilibili' };
  let extractionCalls = 0;
  context.fluidBg = { extractColorsFromImage() { extractionCalls += 1; } };
  const loading = context.loadAndPlaySong(selected.id, selected);
  songs.get(selected.id).resolve(selected);
  await loading;
  assert.equal(context.dom.albumArt.crossOrigin, null);
  assert.equal(context.dom.albumArt.referrerPolicy, 'no-referrer');
  assert.equal(extractionCalls, 0);
});

function enableQualityChanges(context, replaceAudioSource) {
  Object.assign(context, {
    AbortController, RequestCancelledError, replaceAudioSource,
    supportedQuality: value => value,
    qualityDetails: value => ({ name: value }),
    savePlaybackQuality: value => { context.musicService.config.quality = value; },
    playbackQualitySelector: { setValue() {} },
  });
  context.dom.playbackQualityStatus = element();
  vm.runInContext(inlineFunction('applyPlaybackQuality'), context);
}

test('a quality response cannot replace a song selected while the request was pending', async () => {
  const { context, songs } = playbackHarness();
  let replacements = 0;
  enableQualityChanges(context, () => { replacements += 1; });
  context.currentPlaybackSong = song('A');
  const changingQuality = context.applyPlaybackQuality('lossless');
  const request = songs.get('A');
  const switchingSong = context.loadAndPlaySong('B');
  assert.equal(request.options.signal.aborted, true);
  songs.get('B').resolve(song('B'));
  await switchingSong;
  request.resolve(song('A'));
  await changingQuality;
  assert.equal(replacements, 0);
  assert.equal(context.currentPlaybackSong.id, 'B');
  assert.equal(context.audio.src, song('B').url);
});

test('a late quality playback failure never restores the previous song after switching', async () => {
  const { context, songs } = playbackHarness();
  const replacement = deferred();
  const started = deferred();
  const replacements = [];
  enableQualityChanges(context, url => {
    replacements.push(url);
    started.resolve();
    return replacement.promise;
  });
  context.currentPlaybackSong = song('A');
  context.audio.src = song('A').url;
  const changingQuality = context.applyPlaybackQuality('lossless');
  songs.get('A').resolve({ ...song('A'), url: 'https://media.example/A.flac' });
  await started.promise;
  const switchingSong = context.loadAndPlaySong('B');
  songs.get('B').resolve(song('B'));
  await switchingSong;
  replacement.reject(new Error('Old quality failed'));
  await changingQuality;
  assert.deepEqual(replacements, ['https://media.example/A.flac']);
  assert.equal(context.audio.src, song('B').url);
});

test('quality selections during song loading only update the default', async () => {
  const { context, songs } = playbackHarness();
  enableQualityChanges(context, () => { throw new Error('Unexpected source change'); });
  context.currentPlaybackSong = song('A');
  const loading = context.loadAndPlaySong('B');
  await context.applyPlaybackQuality('standard');
  assert.equal(context.musicService.config.quality, 'standard');
  assert.equal(songs.has('A'), false);
  songs.get('B').resolve(song('B'));
  await loading;
  assert.equal(context.currentPlaybackSong.id, 'B');
});

test('lyric lookup handles sorted timestamps, forward seeks and backward seeks with bounded DOM work', () => {
  let removals = 0;
  const animatedLines = [];
  const lines = Array.from({ length: 1000 }, (_, index) => {
    const line = element();
    const remove = line.classList.remove;
    line.classList.remove = (...names) => { removals += 1; remove(...names); };
    return { ...line, offsetTop: index * 40, clientHeight: 40 };
  });
  const scroller = { clientHeight: 400, getElementsByClassName: () => lines, scrollTo() {} };
  const context = vm.createContext({
    listeningRoom: null,
    lyricEffects: { activateLine: line => animatedLines.push(line) },
    parsedLyrics: lines.map((_, index) => ({ time: index })), activeLyricIndex: -1,
    document: { getElementById: id => id === 'lyricsScroller' ? scroller : null },
    window: { matchMedia: () => ({ matches: true }) },
  });
  vm.runInContext(inlineFunction('parseLrc') + inlineFunction('updateLyrics'), context);
  assert.deepEqual(Array.from(context.parseLrc('[00:10]Ten\n[00:01.2]One'), line => line.time), [1.2, 10]);
  for (const time of [0, 700, 4, 999, 999]) {
    const before = removals;
    context.updateLyrics(time);
    assert.equal(context.activeLyricIndex, time);
    assert.deepEqual(lines.flatMap((line, index) => line.classList.contains('active') ? [index] : []), [time]);
    assert.deepEqual(lines.flatMap((line, index) => line.classList.contains('near') ? [index] : []),
      [time - 1, time + 1].filter(index => index >= 0 && index < lines.length));
    assert.ok(removals - before <= 6);
  }
  assert.deepEqual(animatedLines, [lines[0], lines[700], lines[4], lines[999]], 'effects activate only on changed lines, including backward seeks');
});

function serviceHarness(requestJson, storedSource = null) {
  const service = new MusicService({
    storage: { getItem: key => key === 'cp_source' ? storedSource : null },
    location: { search: '' },
  });
  const fetchImpl = async (url, options) => ({
    ok: true,
    status: 200,
    json: async () => requestJson(url, options),
  });
  const search = service.search.bind(service);
  const getNewSongs = service.getNewSongs.bind(service);
  const getLyric = service.getLyric.bind(service);
  service.search = (query, options = {}) => search(query, { ...options, fetchImpl });
  service.getNewSongs = (options = {}) => getNewSongs({ ...options, fetchImpl });
  service.getLyric = (id, options = {}) => getLyric(id, { ...options, fetchImpl });
  return service;
}

test('search normalization keeps the initiating platform when settings change in flight', async () => {
  const pending = deferred();
  const service = serviceHarness(() => pending.promise);
  service.config.source = 'bilibili';
  const search = service.search('test');
  service.config.source = 'chksz';
  pending.resolve({ code: 200, data: [{ id: 'bili:BV1C9b76cEks:1', name: 'Song', artist: 'UP' }] });
  const results = await search;
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'bilibili');
});

test('quality fallbacks keep their initiating source', async () => {
  const service = serviceHarness(() => {});
  service.config.source = 'bilibili';
  const sources = [];
  service.getSongAtLevel = async (id, level, { song: selected }) => {
    sources.push(service.sourceForSong(selected).provider);
    service.config.source = 'chksz';
    return level === 'standard' ? song(id) : null;
  };
  await service.getSong('123');
  assert.ok(sources.length >= 2);
  assert.ok(sources.every(source => source === 'bilibili'));
});

test('Bilibili discovery and lyrics keep their own source, category and cancellation', async () => {
  const requests = [];
  const service = serviceHarness(async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/lyric')) return { code: 200, data: { status: 'login_required', lrc: '' } };
    return { code: 200, data: Array.from({ length: 30 }, () => ({ id: 'bili:BV1C9b76cEks:1', name: 'Music' })) };
  });
  const controller = new AbortController();
  assert.equal((await service.getNewSongs({ source: 'bilibili', category: 'live', signal: controller.signal })).length, 12);
  const lyrics = await service.getLyric('bili:BV1C9b76cEks:1', { song: { provider: 'bilibili' }, signal: controller.signal });
  assert.equal(lyrics.status, 'login_required');
  assert.equal(requests.length, 2);
  assert.ok(requests[1].options.signal);
  assert.equal(new URL(requests[1].url, 'https://player.example').searchParams.get('source'), 'bilibili');
  assert.ok(requests[0].options.signal);
  assert.equal(new URL(requests[0].url, 'https://player.example').searchParams.get('category'), 'live');
});

test('retired preferences fall back without misrouting old queue entries', () => {
  const service = serviceHarness(() => {}, 'ors-qq');
  assert.equal(service.config.source, 'gd');
  assert.throws(() => service.sourceForSong({ id: '123', provider: 'ors' }), /已移除/);
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} search ignores obsolete results and numeric Bilibili queries remain searches`, async () => {
    const requests = [];
    const results = element();
    const context = vm.createContext({
      AbortController, RequestCancelledError,
      desktopSearchController: null,
      dom: { searchResults: results },
      supportedMusicSource: source => source,
      musicService: {
        config: { source: 'bilibili' },
        search(query, options) {
          const request = { ...deferred(), options };
          requests.push(request);
          return request.promise;
        },
        getSong() { throw new Error('Numeric Bilibili queries must not resolve as NetEase IDs'); },
      },
      setSearchStatus: (container, message) => { container.textContent = message; },
    });
    vm.runInContext(mobile
      ? `this.runSearch = ({ ${block('async handleSearch(query,', 'handleResize()')} }).handleSearch;`
      : inlineFunction('searchSongs') + '\nthis.runSearch = searchSongs;', context);
    const first = context.runSearch('1989');
    context.musicService.config.source = 'chksz';
    const second = context.runSearch('new search');
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(requests[0].options.source, 'bilibili');
    assert.equal(requests[1].options.source, 'chksz');
    requests[1].resolve([]);
    await second;
    const latestMessage = results.textContent;
    requests[0].resolve([song('stale')]);
    await first;
    assert.equal(results.textContent, latestMessage);
  });
}

test('refreshing discovery does not cancel independent editorial collections', async () => {
  const collectionController = new AbortController();
  const requests = [];
  const rendered = [];
  const context = vm.createContext({
    AbortController, RequestCancelledError,
    dom: { desktopDiscoveryList: element(), desktopDiscoveryRefresh: element() },
    desktopDiscoveryController: null, musicCollectionsController: collectionController, bilibiliCategory: 'all',
    supportedMusicSource: source => source,
    musicSourceOption: source => ({ label: source }),
    musicService: {
      config: { source: 'chksz' },
      getNewSongs(options) {
        const request = { ...deferred(), options };
        requests.push(request);
        return request.promise;
      },
    },
    setDiscoveryStatus() {}, setCollectionLoading() {}, renderNewAlbums() {},
    renderDiscoverySongs: songs => rendered.push(songs[0].id),
  });
  vm.runInContext(inlineFunction('loadNewSongDiscovery'), context);
  const first = context.loadNewSongDiscovery();
  context.musicService.config.source = 'bilibili';
  const second = context.loadNewSongDiscovery();
  requests[1].resolve([song('Bilibili')]);
  await second;
  requests[0].resolve([song('NetEase')]);
  await first;
  assert.deepEqual(rendered, ['Bilibili']);
  assert.equal(collectionController.signal.aborted, false);
  assert.equal(context.dom.desktopDiscoveryRefresh.disabled, false);
});

test('Bilibili discovery preserves a dated successful snapshot when refresh fails', async () => {
  const saved = new Map();
  const detail = element();
  const rendered = [];
  const music = { ...song('bili:BV1C9b76cEks:1'), provider: 'bilibili' };
  const context = vm.createContext({
    AbortController, RequestCancelledError, normalizeBilibiliPayload: musicData.normalizeBilibiliPayload,
    dom: { desktopDiscoveryList: element(), desktopDiscoveryRefresh: element(),
      desktopDiscoverySection: { querySelector: () => detail } },
    bilibiliCategory: 'all', desktopDiscoveryController: null,
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    supportedMusicSource: value => value, musicSourceOption: () => ({ label: 'Bilibili' }),
    musicService: { config: { source: 'bilibili' }, getNewSongs: async () => [music] },
    setDiscoveryStatus() {}, setCollectionLoading() {},
    renderDiscoverySongs: songs => rendered.push(songs[0].id),
  });
  vm.runInContext(inlineFunction('loadNewSongDiscovery'), context);
  await context.loadNewSongDiscovery();
  assert.equal(saved.size, 1);
  context.musicService.getNewSongs = async () => { throw new Error('Offline'); };
  await context.loadNewSongDiscovery();
  assert.deepEqual(rendered, [music.id, music.id]);
  assert.match(detail.textContent, /上次更新/);
});

test('editorial collections wait for a visible shelf before loading', () => {
  let onIntersection;
  let loads = 0;
  let disconnected = false;
  const observed = [];
  const shelf = {};
  const context = vm.createContext({
    dom: { editorialPlaylistGrid: { closest: () => shelf } },
    loadMusicCollections: () => { loads += 1; },
    IntersectionObserver: class {
      constructor(callback) { onIntersection = callback; }
      observe(target) { observed.push(target); }
      disconnect() { disconnected = true; }
    },
  });
  vm.runInContext(inlineFunction('scheduleMusicCollections'), context);
  context.scheduleMusicCollections();
  assert.equal(loads, 0);
  assert.deepEqual(observed, [shelf]);
  onIntersection([{ isIntersecting: false }]);
  assert.equal(loads, 0);
  onIntersection([{ isIntersecting: true }]);
  assert.equal(loads, 1);
  assert.equal(disconnected, true);
});

test('GD discovery uses ChKSz and survives a playback API change while loading', async () => {
  const pending = deferred();
  const rendered = [];
  const albums = [];
  const context = vm.createContext({
    AbortController, RequestCancelledError,
    dom: { desktopDiscoveryList: element(), desktopDiscoveryRefresh: element() },
    desktopDiscoveryController: null, bilibiliCategory: 'all',
    supportedMusicSource: source => source,
    musicSourceOption: source => ({ label: source }),
    musicService: {
      config: { source: 'gd' },
      getNewSongs({ source }) {
        assert.equal(source, 'chksz');
        return pending.promise;
      },
    },
    setDiscoveryStatus() {}, setCollectionLoading() {},
    renderDiscoverySongs: songs => rendered.push(...songs),
    renderNewAlbums: songs => albums.push(...songs),
    localStorage: { setItem: () => assert.fail('NetEase songs must not enter Bilibili snapshots') },
  });
  vm.runInContext(inlineFunction('loadNewSongDiscovery'), context);
  const loading = context.loadNewSongDiscovery();
  context.musicService.config.source = 'chksz';
  const track = { ...song('65766'), provider: 'chksz' };
  pending.resolve([track]);
  await loading;
  assert.deepEqual(rendered, [track]);
  assert.deepEqual(albums, [track]);
  assert.equal(context.dom.desktopDiscoveryRefresh.disabled, false);
});

test('saving a ChKSz key refreshes collections while keeping GD playback selected', () => {
  let onEnabled;
  const refreshed = [];
  const context = vm.createContext({
    musicKeySettings: null,
    createMusicKeySettings(options) { onEnabled = options.onEnabled; },
    musicService: { config: { source: 'gd' } },
    loadNewSongDiscovery: () => refreshed.push('discovery'),
    scheduleMusicCollections: () => refreshed.push('collections'),
    contentViewFromHash: () => 'artists',
    artistsController: { refresh: () => refreshed.push('artists') },
  });
  vm.runInContext(inlineFunction('initSettingsUI'), context);
  context.initSettingsUI();
  onEnabled();
  assert.equal(context.musicService.config.source, 'gd');
  assert.deepEqual(refreshed, ['discovery', 'collections', 'artists']);
});

test('album track expansion uses ChKSz with GD playback selected', async () => {
  const track = { ...song('65766'), album: '专辑', provider: 'chksz' };
  const context = vm.createContext({
    musicService: {
      config: { source: 'gd' },
      async search(query, { source }) {
        assert.equal(source, 'chksz');
        return [track];
      },
    },
  });
  vm.runInContext(inlineFunction('resolveAlbumTracks'), context);
  const tracks = await context.resolveAlbumTracks({ name: '专辑', tracks: [] });
  assert.equal(tracks[0], track);
});

test('concurrent image cache reads are coalesced and timed-out entries can retry', async () => {
  const reads = [];
  const timers = new Map();
  let timerId = 0;
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => ({ get() {
      const request = {};
      reads.push(request);
      return request;
    } }) }),
  };
  // The factory keeps the connection private; initialize with a successful request for this coalescing test.
  const connected = createCacheStore({
    getIndexedDB: () => ({ open() { const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request; } }),
    baseUrl: 'https://player.example/',
    setTimer(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimer: id => timers.delete(id),
  });
  await connected.init();
  const url = 'https://media.example/cover.jpg';
  const first = connected.getImage(url);
  const second = connected.getImage(url);
  assert.equal(reads.length, 1);
  reads[0].result = { data: 'cached-image' };
  reads[0].onsuccess();
  assert.equal(await first, 'cached-image');
  assert.equal(await second, 'cached-image');
  assert.equal(timers.size, 0);

  const stalled = connected.getImage(url);
  timers.values().next().value();
  assert.equal(await stalled, url);
  const retry = connected.getImage(url);
  assert.equal(reads.length, 3);
  reads[2].onerror();
  assert.equal(await retry, url);
});
