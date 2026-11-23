import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueStore } from '../js/queue-store.js';

const song = id => ({ id, name: id });

test('queue store owns navigation order and preserves single mode', () => {
    const queue = createQueueStore({ random: () => 0 });
    queue.state.playlist = [song('a'), song('b'), song('c')];
    queue.state.playMode = 'sequence';
    queue.state.currentIndex = 1;
    assert.equal(queue.next(), 2);
    assert.equal(queue.previous(), 0);
    queue.state.playMode = 'single';
    assert.equal(queue.next(), 1);
    assert.equal(queue.next({ manual: true }), 2);
    assert.equal(queue.previous({ manual: true }), 0);
});

test('queue mutations support insert, remove, clear and undo snapshots', () => {
    const queue = createQueueStore({ random: () => 0.99 });
    queue.state.playlist = [song('a'), song('b')];
    queue.state.playMode = 'sequence';
    queue.state.currentIndex = 0;
    assert.equal(queue.insert(song('x')), 1);
    assert.deepEqual(queue.state.playlist.map(item => item.id), ['a', 'x', 'b']);
    const removed = queue.remove(1, 'a');
    assert.equal(removed.removed.id, 'x');
    assert.deepEqual(queue.state.playlist.map(item => item.id), ['a', 'b']);
    assert.equal(queue.restore(removed.snapshot, 'a'), true);
    assert.deepEqual(queue.state.playlist.map(item => item.id), ['a', 'x', 'b']);
    const cleared = queue.clear('a');
    assert.equal(cleared.songs.length, 3);
    assert.equal(queue.state.playlist.length, 0);
    assert.equal(queue.restore(cleared, 'a'), true);
    assert.equal(queue.state.currentIndex, 0);
});

test('selection keeps the queued provider and repeated occurrence through audio source changes', () => {
    const queue = createQueueStore();
    const qq = { id: 'a', provider: 'qq' }, netease = { id: 'a', provider: 'netease' };
    queue.state.playlist = [netease, qq, netease, song('b')];
    queue.state.playMode = 'sequence';
    queue.state.currentIndex = 2;
    assert.equal(queue.select(netease), 2);
    assert.equal(queue.next({ manual: true }), 3);
    assert.equal(queue.select({ ...qq, provider: 'gd', artworkSource: qq }), 1);
    assert.equal(queue.select({ id: 'missing' }), -1);
});
