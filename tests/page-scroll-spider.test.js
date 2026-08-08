import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getHandlePosition,
  getScrollProgress,
  getWebCurve,
} from '../js/page-scroll-spider.js';

test('maps scroll position to a clamped page progress', () => {
  assert.equal(getScrollProgress({ scrollTop: 0, scrollHeight: 2000, clientHeight: 1000 }), 0);
  assert.equal(getScrollProgress({ scrollTop: 500, scrollHeight: 2000, clientHeight: 1000 }), 0.5);
  assert.equal(getScrollProgress({ scrollTop: 1800, scrollHeight: 2000, clientHeight: 1000 }), 1);
});

test('keeps the spider inside its visible track', () => {
  assert.equal(getHandlePosition({ progress: 0, trackHeight: 600, handleHeight: 90 }), 0);
  assert.equal(getHandlePosition({ progress: 0.5, trackHeight: 600, handleHeight: 90 }), 255);
  assert.equal(getHandlePosition({ progress: 1, trackHeight: 600, handleHeight: 90 }), 510);
});

test('web curve terminates above the sprite and reacts to sway', () => {
  const still = getWebCurve({ width: 96, height: 600, handleY: 200, sway: 0 });
  const moving = getWebCurve({ width: 96, height: 600, handleY: 200, sway: 8 });

  assert.equal(still.start.x, 48);
  assert.equal(still.end.y, 213);
  assert.ok(moving.end.x > still.end.x);
  assert.ok(moving.control2.x > still.control2.x);
});
