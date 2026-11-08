import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricClock } from '../js/lyrics/clock.js';
function harness() {
  const audio = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false, readyState: 4 });
  const page = Object.assign(new EventTarget(), { hidden: false }); const frames = new Map(), samples = []; let id = 0, visible = true;
  const clock = createLyricClock(audio, time => samples.push(time), { document: page, visible: () => visible, requestFrame: fn => { frames.set(++id, fn); return id; }, cancelFrame: id => frames.delete(id) });
  const fire = (target, event) => target.dispatchEvent(new Event(event));
  const frame = () => { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); };
  return { audio, page, frames, samples, clock, fire, frame, hide: () => { visible = false; clock.sync(); } };
}
test('clock follows media time through pause, seeking and playback rate without integration', () => {
  const h = harness(); h.audio.paused = false; h.fire(h.audio, 'playing'); assert.equal(h.frames.size, 1);
  h.audio.currentTime = 12.345; h.frame(); assert.equal(h.samples.at(-1), 12345);
  h.audio.currentTime = 2; h.fire(h.audio, 'seeked'); assert.equal(h.samples.at(-1), 2000); assert.equal(h.frames.size, 1);
  h.audio.playbackRate = 2; h.fire(h.audio, 'ratechange'); h.audio.currentTime = 2.2; h.frame(); assert.equal(h.samples.at(-1), 2200);
  h.audio.paused = true; h.fire(h.audio, 'pause'); assert.equal(h.frames.size, 0);
  h.clock.destroy();
});
test('hidden, invisible and destroyed players release their frame loop', () => {
  const h = harness(); h.audio.paused = false; h.clock.sync();
  h.page.hidden = true; h.fire(h.page, 'visibilitychange'); assert.equal(h.frames.size, 0);
  h.audio.currentTime = 40; h.page.hidden = false; h.fire(h.page, 'visibilitychange'); assert.equal(h.samples.at(-1), 40000);
  h.hide(); assert.equal(h.frames.size, 0); h.clock.destroy(); const count = h.samples.length;
  h.fire(h.audio, 'playing'); h.fire(h.page, 'visibilitychange'); assert.equal(h.samples.length, count);
});
test('buffering stops frames even when a decoded frame remains available', () => {
  const h = harness(); h.audio.paused = false; h.fire(h.audio, 'playing');
  h.audio.readyState = 2; h.fire(h.audio, 'waiting'); assert.equal(h.frames.size, 0);
  h.fire(h.audio, 'timeupdate'); h.clock.sync(); assert.equal(h.frames.size, 0);
  h.audio.currentTime = 3.5; h.audio.readyState = 4; h.fire(h.audio, 'playing');
  assert.equal(h.samples.at(-1), 3500); assert.equal(h.frames.size, 1);
  h.clock.destroy();
});
