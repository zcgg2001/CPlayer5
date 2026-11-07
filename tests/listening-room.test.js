import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricFollower } from '../js/listening-room.js';

function harness() {
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const button = { hidden: true, addEventListener(type, fn) { listeners.set(`button:${type}`, fn); }, removeEventListener() {} };
  const active = { offsetTop: 600, clientHeight: 80 };
  const scroller = {
    scrollTop: 0, clientHeight: 400, scrollHeight: 2000,
    querySelector: () => active,
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
  };
  let id = 0;
  let time = 0;
  let visible = true;
  let reduced = false;
  const follower = createLyricFollower(scroller, button, {
    visible: () => visible, reducedMotion: () => reduced,
    requestFrame(fn) { frames.set(++id, fn); return id; }, cancelFrame: id => frames.delete(id),
    setTimer(fn) { timers.set(++id, fn); return id; }, clearTimer: id => timers.delete(id),
  });
  function step(count = 1) {
    for (let i = 0; i < count; i++) {
      time += 16;
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time));
    }
  }
  return { follower, scroller, button, frames, timers, listeners, step, setVisible: value => { visible = value; }, setReduced: value => { reduced = value; } };
}

test('spring scrolling converges after rapid forward and backward seeks and stops scheduling frames', () => {
  const h = harness();
  h.follower.follow(1400); h.step(12);
  assert.ok(h.scroller.scrollTop > 0 && h.scroller.scrollTop < 1400);
  h.follower.follow(200); h.step(180);
  assert.equal(h.scroller.scrollTop, 200);
  assert.equal(h.frames.size, 0);
  h.follower.follow(10000); h.step(180);
  assert.equal(h.scroller.scrollTop, 1600);
});

test('manual browsing holds position while playback updates, then resumes the current line', () => {
  const h = harness();
  h.follower.follow(600); h.step(5);
  h.listeners.get('wheel')();
  h.scroller.scrollTop = 120;
  h.follower.follow(900); h.step(100);
  assert.equal(h.scroller.scrollTop, 120);
  assert.equal(h.button.hidden, false);
  assert.equal(h.frames.size, 0);
  h.listeners.get('button:click')(); h.step(180);
  assert.equal(h.scroller.scrollTop, 440);
  assert.equal(h.button.hidden, true);
  assert.equal(h.timers.size, 0);
});

test('hidden lyrics and reduced motion do not keep animation loops running', () => {
  const h = harness();
  h.follower.follow(900); h.step(3); h.setVisible(false); h.step();
  assert.equal(h.frames.size, 0);
  h.setVisible(true); h.setReduced(true); h.follower.recenter();
  assert.equal(h.scroller.scrollTop, 440);
  assert.equal(h.frames.size, 0);
});

test('scroll position rounding cannot leave an endless animation near the target', () => {
  const h = harness();
  let scroll = 0;
  Object.defineProperty(h.scroller, 'scrollTop', { get: () => scroll, set: value => { scroll = Math.round(value); } });
  h.follower.follow(800.5); h.step(240);
  assert.ok(Math.abs(scroll - 800.5) <= 0.5);
  assert.equal(h.frames.size, 0);
});

test('new lyrics cancel a pending manual-browse timer and resume following', () => {
  const h = harness();
  h.listeners.get('touchmove')();
  assert.equal(h.timers.size, 1);
  h.follower.reset(); h.follower.follow(300); h.step(180);
  assert.equal(h.button.hidden, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.scroller.scrollTop, 300);
  h.follower.destroy();
  assert.equal(h.listeners.has('wheel'), false);
});
