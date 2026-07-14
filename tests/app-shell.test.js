import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_SHELL_MEDIA,
  createShellHistory,
  initialShellState,
  progressPercent,
  setImmersiveState,
} from '../js/app-shell.js';

function fakeElement() {
  const attributes = new Map();
  return {
    hidden: false,
    inert: false,
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) { return this.values.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focusCalled: false,
    focus() { this.focusCalled = true; },
  };
}

test('desktop shell begins at 1024px with library active', () => {
  assert.equal(DESKTOP_SHELL_MEDIA, '(min-width: 1024px)');
  assert.deepEqual(initialShellState(), {
    destination: 'library',
    immersiveOpen: false,
  });
});

test('shell history supports back and forward without duplicate pushes', () => {
  const history = createShellHistory('library');
  history.push('queue');
  history.push('queue');
  history.push('now-playing');

  assert.equal(history.current(), 'now-playing');
  assert.equal(history.back(), 'queue');
  assert.equal(history.back(), 'library');
  assert.equal(history.forward(), 'queue');
});

test('progress percent clamps invalid and out-of-range values', () => {
  assert.equal(progressPercent(15, 60), 25);
  assert.equal(progressPercent(-1, 60), 0);
  assert.equal(progressPercent(90, 60), 100);
  assert.equal(progressPercent(1, 0), 0);
});

test('immersive state updates visibility, inertness and accessibility', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();

  setImmersiveState({ shell, immersive, opener, closeButton }, true);
  assert.equal(shell.inert, true);
  assert.equal(immersive.getAttribute('aria-hidden'), 'false');
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  assert.equal(closeButton.focusCalled, true);

  setImmersiveState({ shell, immersive, opener, closeButton }, false);
  assert.equal(shell.inert, false);
  assert.equal(immersive.getAttribute('aria-hidden'), 'true');
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
  assert.equal(opener.focusCalled, true);
});
