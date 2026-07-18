import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseButterflyTarget,
  clampPoint,
  getDirectionSprite,
  getPetLayout,
  getSleepAnchorPoint,
  getSleepAnchorSelector,
  hasDragged,
  nextPetMode,
  restorePetPosition,
  serializePetPosition,
  shouldAnimatePet,
} from '../js/oneko-butterfly.js';


test('uses the right-side safe region for desktop chase mode', () => {
  const layout = getPetLayout(1280, 720, false);

  assert.equal(layout.mode, 'chase');
  assert.equal(layout.size, 64);
  assert.ok(layout.bounds.left >= 1280 * 0.56);
  assert.ok(layout.bounds.right <= 1280 - 72);
  assert.ok(layout.bounds.top >= 720 * 0.45);
  assert.ok(layout.bounds.bottom <= 720 - 72);
  assert.ok(layout.catStart.x >= layout.bounds.left);
  assert.ok(layout.catStart.y <= layout.bounds.bottom);
  assert.ok(layout.butterflyStart.x <= layout.bounds.right);
  assert.ok(layout.butterflyStart.y >= layout.bounds.top);
});

test('uses a compact resting layout on mobile and reduced motion', () => {
  const mobile = getPetLayout(390, 844, false);
  const reduced = getPetLayout(1280, 720, true);

  assert.equal(mobile.mode, 'rest');
  assert.equal(mobile.size, 32);
  assert.equal(mobile.bounds.left, 22);
  assert.equal(mobile.bounds.right, 368);
  assert.ok(mobile.catStart.x <= 390 - 16);
  assert.ok(mobile.catStart.y <= 844 - 80);
  assert.equal(reduced.mode, 'rest');
  assert.equal(reduced.size, 64);
});

test('clamps targets to the configured safe rectangle', () => {
  assert.deepEqual(
    clampPoint(
      { x: 10, y: 999 },
      { left: 100, right: 400, top: 200, bottom: 500 },
    ),
    { x: 100, y: 500 },
  );
});

test('maps pursuit vectors to the original oneko east and north-east sprites', () => {
  assert.deepEqual(
    getDirectionSprite(-100, 0, 100, 0),
    { direction: 'E', x: -3, y: 0 },
  );
  assert.deepEqual(
    getDirectionSprite(-100, 100, Math.sqrt(20000), 1),
    { direction: 'NE', x: 0, y: -3 },
  );
});

test('chooses butterfly targets inside the safe region with breathing room', () => {
  const values = [0, 1];
  const random = () => values.shift();
  const target = chooseButterflyTarget(
    { left: 100, right: 500, top: 200, bottom: 600 },
    random,
  );

  assert.deepEqual(target, { x: 160, y: 500 });
});

test('animates only chase mode while the page is visible', () => {
  assert.equal(shouldAnimatePet('chase', false), true);
  assert.equal(shouldAnimatePet('rest', false), false);
  assert.equal(shouldAnimatePet('chase', true), false);
});

test('switches desktop and mobile target modes without waking a sleeping cat', () => {
  assert.deepEqual(
    nextPetMode('butterfly', 'toggle-target', 'butterfly', false),
    { mode: 'cursor', previousMode: 'butterfly' },
  );
  assert.deepEqual(
    nextPetMode('cursor', 'toggle-target', 'butterfly', false),
    { mode: 'butterfly', previousMode: 'butterfly' },
  );
  assert.deepEqual(
    nextPetMode('rest', 'toggle-target', 'rest', true),
    { mode: 'butterfly', previousMode: 'rest' },
  );
  assert.deepEqual(
    nextPetMode('butterfly', 'toggle-target', 'rest', true),
    { mode: 'rest', previousMode: 'rest' },
  );
  assert.deepEqual(
    nextPetMode('sleep', 'toggle-target', 'butterfly', false),
    { mode: 'sleep', previousMode: 'butterfly' },
  );
});

test('sleeps and restores the mode that was active before sleep', () => {
  assert.deepEqual(
    nextPetMode('cursor', 'toggle-sleep', 'butterfly', false),
    { mode: 'sleep', previousMode: 'cursor' },
  );
  assert.deepEqual(
    nextPetMode('sleep', 'toggle-sleep', 'cursor', false),
    { mode: 'cursor', previousMode: 'cursor' },
  );
});

test('starts dragging only after the pointer reaches the 8px threshold', () => {
  assert.equal(hasDragged({ x: 10, y: 10 }, { x: 15, y: 15 }), false);
  assert.equal(hasDragged({ x: 10, y: 10 }, { x: 18, y: 10 }), true);
});

test('serializes and restores a normalized pet position inside safe bounds', () => {
  assert.deepEqual(
    serializePetPosition({ x: 640, y: 360 }, 1280, 720),
    { xRatio: 0.5, yRatio: 0.5 },
  );
  assert.deepEqual(
    restorePetPosition(
      { xRatio: 0.9, yRatio: 0.9 },
      { left: 720, right: 1176, top: 403, bottom: 624 },
      1280,
      720,
    ),
    { x: 1152, y: 624 },
  );
});

test('rejects invalid persisted positions', () => {
  assert.equal(serializePetPosition({ x: 10, y: 10 }, 0, 720), null);
  assert.equal(
    restorePetPosition(
      { xRatio: 'bad', yRatio: 0.5 },
      { left: 0, right: 100, top: 0, bottom: 100 },
      100,
      100,
    ),
    null,
  );
});

test('anchors sleep mode to the visible desktop and mobile progress tracks', () => {
  assert.equal(getSleepAnchorSelector(false), '.progress-bar-container');
  assert.equal(getSleepAnchorSelector(true), '#mobileProgressBarContainer');
});

test('places a sleeping cat above the progress track without covering it', () => {
  assert.deepEqual(
    getSleepAnchorPoint(
      { right: 500, top: 559, width: 450, height: 24 },
      1280,
      720,
      64,
    ),
    { x: 460, y: 519 },
  );
  assert.equal(
    getSleepAnchorPoint({ right: 0, top: 0, width: 0, height: 0 }, 1280, 720, 64),
    null,
  );
});
