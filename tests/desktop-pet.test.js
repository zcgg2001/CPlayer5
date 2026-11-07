import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopPet, getPetLayout } from '../js/desktop-pet/index.js';

// A deterministic DOM/clock isolates lifecycle and input behavior from browser timing.
function environment({ saved, width = 1280, height = 720, reducedMotion = false, blockedStorage = false } = {}) {
  const targets = [];
  class Target extends EventTarget {
    listeners = new Map();
    constructor() { super(); targets.push(this); }
    addEventListener(type, fn, options) {
      super.addEventListener(type, fn, options);
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn, options) {
      super.removeEventListener(type, fn, options);
      this.listeners.get(type)?.delete(fn);
    }
  }
  const document = new Target();
  class Element extends Target {
    ownerDocument = document;
    style = {};
    dataset = {};
    children = [];
    classList = new Set();
    captures = new Set();
    constructor() { super(); this.classList.remove = this.classList.delete.bind(this.classList); }
    setAttribute(key, value) { this[key] = value; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
  }
  const window = new Target();
  const media = new Target();
  media.matches = reducedMotion;
  const frames = new Map();
  const timers = new Map();
  let seq = 0;
  let value = saved === undefined ? null : JSON.stringify(saved);
  const storage = {
    getItem() { if (blockedStorage) throw new Error('blocked'); return value; },
    setItem(key, next) { if (blockedStorage) throw new Error('blocked'); value = next; },
  };
  Object.assign(window, {
    innerWidth: width, innerHeight: height, localStorage: storage,
    matchMedia: () => media, performance: { now: () => 1000 },
    requestAnimationFrame: fn => { frames.set(++seq, fn); return seq; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { timers.set(++seq, fn); return seq; },
    clearTimeout: id => timers.delete(id),
  });
  Object.assign(document, { hidden: false, defaultView: window, createElement: () => new Element() });
  const mount = new Element();
  const fire = (target, type, props = {}) => target.dispatchEvent(Object.assign(new Event(type), props));
  const flushFrames = () => {
    const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(1000));
  };
  return { mount, window, document, media, frames, timers, targets, fire, flushFrames,
    saved: () => JSON.parse(value) };
}

const catOf = pet => pet.element.children[0];

test('migrates old pet preferences, persists the independent switch and recalls a hidden pet', () => {
  const env = environment({ saved: { mode: 'rest', previousMode: 'cursor', position: { xRatio: .8, yRatio: .7 } } });
  let pet = createDesktopPet({ mount: env.mount });
  assert.equal(pet.getState().enabled, true);
  assert.equal(pet.getState().mode, 'rest');
  assert.deepEqual(pet.getState().position, { xRatio: .8, yRatio: .7 });
  pet.setEnabled(false);
  assert.equal(pet.element.hidden, true);
  assert.equal(env.saved().enabled, false);
  pet.destroy();
  pet = createDesktopPet({ mount: env.mount });
  assert.equal(pet.element.hidden, true);
  pet.recall();
  assert.equal(pet.element.hidden, false);
  assert.equal(pet.getState().mode, 'rest');
  assert.equal(env.saved().enabled, true);
  assert.deepEqual(pet.getState().position, { xRatio: .75, yRatio: .75 });
  pet.destroy();
});

test('pauses background and suspended pets, resumes once, and respects reduced motion', () => {
  const env = environment();
  const pet = createDesktopPet({ mount: env.mount });
  assert.equal(env.frames.size, 1);
  env.document.hidden = true;
  env.fire(env.document, 'visibilitychange');
  assert.equal(env.frames.size, 0);
  env.document.hidden = false;
  env.fire(env.document, 'visibilitychange');
  assert.equal(env.frames.size, 1);
  pet.setSuspended(true);
  assert.equal(pet.element.hidden, true);
  assert.equal(env.frames.size, 0);
  assert.equal(pet.getState().enabled, true);
  pet.setSuspended(false);
  pet.setSuspended(false);
  assert.equal(env.frames.size, 1);
  env.media.matches = true;
  env.fire(env.media, 'change');
  assert.equal(env.frames.size, 0);
  assert.equal(pet.element.dataset.paused, 'true');
  pet.destroy();
});

test('destroy cancels click timers, layout and animation work, pointer capture and all listeners', () => {
  const env = environment();
  const pet = createDesktopPet({ mount: env.mount });
  const cat = catOf(pet);
  env.fire(cat, 'pointerdown', { pointerId: 7, clientX: 960, clientY: 540 });
  env.fire(cat, 'click');
  pet.refresh();
  assert.equal(env.timers.size, 1);
  assert.equal(cat.hasPointerCapture(7), true);
  pet.destroy();
  pet.destroy();
  pet.refresh();
  pet.setEnabled(true);
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.mount.children.length, 0);
  assert.equal(cat.hasPointerCapture(7), false);
  assert.equal(env.targets.flatMap(target => [...target.listeners.values()]).some(set => set.size), false);
});

test('drag stays within safe bounds, saves its position and does not toggle mode', () => {
  const env = environment({ saved: { mode: 'rest' } });
  const pet = createDesktopPet({ mount: env.mount });
  const cat = catOf(pet);
  env.fire(cat, 'pointerdown', { pointerId: 1, clientX: 960, clientY: 540 });
  env.fire(cat, 'pointermove', { pointerId: 1, clientX: 9000, clientY: 9000 });
  env.fire(cat, 'pointerup', { pointerId: 1 });
  env.fire(cat, 'click');
  const bounds = getPetLayout(1280, 720).bounds;
  assert.deepEqual(env.saved().position, { xRatio: bounds.right / 1280, yRatio: bounds.bottom / 720 });
  assert.equal(env.timers.size, 0);
  assert.equal(pet.getState().mode, 'rest');
  pet.destroy();
});

test('supports injected sleep anchors and restores the prior position when waking', () => {
  const env = environment({ saved: { mode: 'rest', position: { xRatio: .8, yRatio: .7 } } });
  const pet = createDesktopPet({ mount: env.mount,
    resolveSleepAnchor: () => ({ right: 500, top: 559, width: 450, height: 24 }) });
  const original = catOf(pet).style.transform;
  pet.setMode('sleep');
  assert.equal(catOf(pet).style.transform, 'translate3d(428px, 487px, 0)');
  assert.deepEqual(env.saved().position, { xRatio: .8, yRatio: .7 });
  pet.setMode('rest');
  assert.equal(catOf(pet).style.transform, original);
  pet.destroy();
});

test('resizes using the previous viewport, fits short windows and maps cursor mode on touch layouts', () => {
  const env = environment({ saved: { mode: 'rest', position: { xRatio: .8, yRatio: .7 } } });
  const pet = createDesktopPet({ mount: env.mount });
  env.window.innerWidth = 1600;
  env.fire(env.window, 'resize'); env.flushFrames();
  assert.equal(pet.getState().position.xRatio, .8);
  env.window.innerWidth = 390;
  env.fire(env.window, 'resize'); env.flushFrames();
  pet.setMode('cursor');
  assert.equal(pet.getState().mode, 'rest');
  assert.equal(catOf(pet).style.width, '44px');
  const short = getPetLayout(1280, 260);
  assert.ok(short.bounds.top <= short.bounds.bottom);
  assert.ok(short.bounds.bottom + short.size / 2 < 260);
  pet.destroy();
});

test('works without storage and unsubscribes observers', () => {
  const env = environment({ blockedStorage: true });
  const pet = createDesktopPet({ mount: env.mount });
  let changes = 0;
  const unsubscribe = pet.subscribe(() => changes++);
  pet.setEnabled(false);
  assert.equal(changes, 2);
  unsubscribe();
  pet.setEnabled(true);
  assert.equal(changes, 2);
  pet.destroy();
});
