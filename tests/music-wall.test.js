import test from 'node:test';
import assert from 'node:assert/strict';
import { musicWallSongs } from '../js/music-wall.js';
import { wallBlock, wallWindow, wallSongPosition, wallMetrics, zoomWallCamera, advanceWallMotion } from '../js/music-wall-field.js';

const songs = Array.from({ length: 85 }, (_, i) => ({ id: String(i + 1), provider: 'netease', name: `歌曲${i}`, artist: '艺人' }));

test('wall sources retain queue order and ignore invalid or duplicate recordings', () => {
  const snapshot = { queue: [songs[2], songs[1], songs[2], null, {}, songs[0]], favorites: [songs[4]] };
  assert.deepEqual(musicWallSongs(snapshot, 'queue'), [songs[2], songs[1], songs[0]]);
  assert.deepEqual(musicWallSongs(snapshot, 'favorites'), [songs[4]]);
  assert.deepEqual(musicWallSongs(snapshot, 'recommendations'), []);
});

test('mixed large and small covers tile every block without holes or overlaps, including negative coordinates', () => {
  for (const [bx, by] of [[0, 0], [-1, -1], [-17, 32], [9127, -8315]]) {
    const cells = wallBlock(bx, by, 85), occupied = new Set();
    assert.equal(cells.length, 10); assert.equal(cells.filter(c => c.span === 2).length, 2);
    for (const cell of cells) {
      assert.ok(cell.index >= 0 && cell.index < 85);
      for (let y = cell.y; y < cell.y + cell.span; y++) for (let x = cell.x; x < cell.x + cell.span; x++) {
        assert.ok(x >= bx * 4 && x < (bx + 1) * 4 && y >= by * 4 && y < (by + 1) * 4);
        assert.equal(occupied.has(`${x}:${y}`), false); occupied.add(`${x}:${y}`);
      }
    }
    assert.equal(occupied.size, 16);
  }
});

test('camera can move far in all directions with a complete bounded viewport, regardless of library size', () => {
  for (const [width, height] of [[375, 590], [844, 230], [1280, 700]]) for (const zoom of [.7, 1, 1.45]) {
    for (const camera of [{ x: 2.2, y: 2.15 }, { x: -10000.2, y: -9000.6 }, { x: 10000.5, y: 9000.4 }]) {
      const cells = wallWindow({ width, height, zoom, camera, count: 85 });
      assert.ok(cells.length > 10 && cells.length < 240, `Unbounded DOM: ${cells.length}`);
      assert.equal(cells.length, wallWindow({ width, height, zoom, camera, count: 1 }).length);
      assert.equal(cells.length, wallWindow({ width, height, zoom, camera, count: 100000 }).length);
      const { gap } = wallMetrics(width, height, zoom);
      // Even screen corners and a regular sample of the whole viewport remain covered,
      // allowing only the intentionally narrow seams between covers.
      for (let y = 0; y <= height; y += height / 8) for (let x = 0; x <= width; x += width / 8)
        assert.ok(cells.some(c => x >= c.x - gap && x <= c.x + c.size + gap && y >= c.y - gap && y <= c.y + c.size + gap), `Hole at ${x},${y}`);
    }
  }
});

test('returning to a camera position restores the same covers and positions', () => {
  const options = { width: 390, height: 600, camera: { x: -2.8, y: 8.7 }, count: 85 };
  const initial = wallWindow(options);
  wallWindow({ ...options, camera: { x: 345, y: -901 } });
  assert.deepEqual(wallWindow(options), initial);
  assert.deepEqual(wallWindow({ ...options, count: 0 }), []);
});

test('every queue song is reachable and locate-current centers its exact tile', () => {
  for (let index = 0; index < 85; index++) {
    const camera = wallSongPosition(index, 85), cells = wallWindow({ width: 390, height: 600, camera, count: 85 });
    assert.ok(cells.some(cell => cell.index === index && cell.center.x === camera.x && cell.center.y === camera.y));
  }
});

test('pinch zoom keeps the cover under the fingers fixed', () => {
  const width = 390, height = 600, camera = { x: -19.2, y: 67 }, anchor = { x: 89, y: 240 };
  const next = zoomWallCamera({ width, height, camera, zoom: 1, nextZoom: .7, anchor });
  for (const [axis, size] of [['x', width], ['y', height]]) {
    const before = camera[axis] + (anchor[axis] - size / 2) / wallMetrics(width, height, 1).pitch;
    const after = next[axis] + (anchor[axis] - size / 2) / wallMetrics(width, height, .7).pitch;
    assert.ok(Math.abs(before - after) < 1e-10);
  }
});

test('inertia decays and settles without reversing or jumping after a long pause', () => {
  let camera = { x: 0, y: 0 }, velocity = { x: 2, y: -1 }, moving = true, steps = 0;
  while (moving && steps++ < 300) {
    const previous = camera;
    const result = advanceWallMotion(camera, velocity, 16, 90);
    ({ camera, velocity, moving } = result);
    assert.ok(camera.x >= previous.x && camera.y <= previous.y);
  }
  assert.equal(moving, false); assert.ok(camera.x > 4 && camera.x < 6);
  assert.deepEqual(advanceWallMotion({ x: 0, y: 0 }, { x: 2, y: 1 }, 5000, 90), advanceWallMotion({ x: 0, y: 0 }, { x: 2, y: 1 }, 32, 90));
});
