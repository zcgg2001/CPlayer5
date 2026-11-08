import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackController } from '../js/playback-controller.js';
import { createQueueStore } from '../js/queue-store.js';

const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const song = id => ({ id, name: id, artist: 'artist', url: `https://media.example/${id}.mp3`, cover: `https://img.example/${id}.jpg` });

test('a new selection pauses old audio even when resolving the new song fails', async () => {
    let paused = false;
    const audio = { pause() { paused = true; } };
    const controller = createPlaybackController({ audio, musicService: { async getSong() { throw Error('offline'); } }, queueStore: createQueueStore() });
    let failed = false;
    await controller.load('new', null, { onLoading() { assert.equal(paused, true); }, onError() { failed = true; } });
    assert.equal(failed, true);
    assert.equal(controller.state.quality.songLoading, false);
});

test('stale song resolution cannot replace the current audio session', async () => {
    const requests = new Map();
    const audio = { src: '', paused: true, ended: false, play: async () => {}, load() {}, addEventListener() {}, removeEventListener() {} };
    const service = { getSong(id) { const request = deferred(); requests.set(id, request); return request.promise; }, getLyric: async () => ({}) };
    const queue = createQueueStore();
    const controller = createPlaybackController({ audio, musicService: service, queueStore: queue });
    const first = controller.load('a');
    const second = controller.load('b');
    requests.get('a').resolve(song('a'));
    await first;
    assert.equal(audio.src, '');
    requests.get('b').resolve(song('b'));
    await second;
    assert.equal(audio.src, song('b').url);
    assert.equal(controller.state.currentSong.id, 'b');
});

test('empty queue end handling never replays stale audio', async () => {
    const audio = { currentTime: 4, play: async () => { throw new Error('should not play'); } };
    const queue = createQueueStore();
    const controller = createPlaybackController({ audio, musicService: {}, queueStore: queue });
    let empty = 0;
    await controller.ended({ onEmpty: () => { empty += 1; } });
    assert.equal(empty, 1);
    assert.equal(audio.currentTime, 4);
});
