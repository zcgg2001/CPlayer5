import test from 'node:test';
import assert from 'node:assert/strict';
import { coverQueueWindow, coverSwipeDirection } from '../js/cover-carousel.js';
import { createQueueStore } from '../js/queue-store.js';

const song = id => ({ id, name: `Track ${id}`, provider: 'netease', cover: `https://example.com/${id}.jpg` });
const selected = window => window.entries.find(entry => entry.slot === 0);

test('cover previews follow manual navigation in sequence, shuffle and repeat-one', () => {
  const store = createQueueStore({ random: () => .2 });
  store.state.playlist = ['a', 'b', 'c', 'd'].map(song);
  for (const mode of ['sequence', 'random', 'single']) {
    store.state.playMode = mode; store.resetOrder();
    const originalOrder = store.state.shuffledOrder.slice();
    for (let i = 0; i < 4; i++) {
      store.state.currentIndex = i;
      const window = coverQueueWindow(store.state, store.state.playlist[i]);
      assert.equal(window.entries[0].song.id, store.state.playlist[store.previous({ manual: true })].id);
      assert.equal(window.entries[2].song.id, store.state.playlist[store.next({ manual: true })].id);
      assert.equal(selected(window).song.id, store.state.playlist[i].id);
      assert.equal(window.position, store.displayOrder().indexOf(i) + 1);
      assert.deepEqual(store.state.shuffledOrder, originalOrder, 'rendering must not reshuffle');
    }
  }
});

test('one, two, empty and detached queues do not advertise nonexistent neighbors', () => {
  const store = createQueueStore(); store.state.playMode = 'sequence';
  assert.deepEqual(coverQueueWindow(store.state, null).entries, []);
  store.state.playlist = [song('a')]; store.state.currentIndex = 0;
  assert.deepEqual(coverQueueWindow(store.state, song('a')).entries.map(e => e.slot), [0]);
  store.state.playlist.push(song('b'));
  const pair = coverQueueWindow(store.state, song('a'));
  assert.deepEqual(pair.entries.map(e => e.song.id), ['b', 'a', 'b']);
  store.remove(0, 'a');
  const removed = coverQueueWindow(store.state, song('a'));
  assert.equal(removed.total, 0); assert.equal(removed.entries.length, 1);
  assert.equal(selected(removed).song.id, 'a');
  store.clear('a');
  assert.equal(coverQueueWindow(store.state, song('a')).entries.length, 1);
});

test('source fallback and duplicate provider IDs keep the selected artwork identity', () => {
  const store = createQueueStore(); store.state.playMode = 'sequence';
  const qq = { ...song('a'), provider: 'qq', cover: 'https://example.com/qq.jpg' };
  store.state.playlist = [song('a'), qq, song('b')]; store.state.currentIndex = 1;
  const switched = { ...qq, provider: 'gd', artworkSource: qq };
  const window = coverQueueWindow(store.state, switched);
  assert.equal(window.position, 2); assert.equal(selected(window).song.cover, qq.cover);
  store.state.currentIndex = 0;
  assert.equal(coverQueueWindow(store.state, switched).position, 2);
});

test('swipe commits intentional horizontal travel or flicks, ignores taps and vertical drags', () => {
  const gesture = { dx: 0, dy: 0, elapsed: 500, size: 300 };
  assert.equal(coverSwipeDirection(gesture), 0);
  assert.equal(coverSwipeDirection({ ...gesture, dx: -80 }), 1);
  assert.equal(coverSwipeDirection({ ...gesture, dx: 80 }), -1);
  assert.equal(coverSwipeDirection({ ...gesture, dx: -35, elapsed: 50 }), 1);
  assert.equal(coverSwipeDirection({ ...gesture, dx: -35 }), 0);
  assert.equal(coverSwipeDirection({ ...gesture, dx: -80, dy: 100 }), 0);
  assert.equal(coverSwipeDirection({ ...gesture, dx: -8, elapsed: 1 }), 0);
});
