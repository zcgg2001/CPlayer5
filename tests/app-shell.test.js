import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_SHELL_MEDIA,
  createShellHistory,
  initAppShell,
  initialShellState,
  progressPercent,
  setImmersiveState,
} from '../js/app-shell.js';

function fakeElement() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    hidden: false,
    inert: false,
    disabled: false,
    dataset: {},
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
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      const dispatchedEvent = {
        type,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...event,
      };
      listeners.get(type)?.forEach(handler => handler(dispatchedEvent));
      return dispatchedEvent;
    },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    focusCalled: false,
    focusCalls: 0,
    focus() {
      this.focusCalled = true;
      this.focusCalls += 1;
    },
  };
}

function clickableElement(dataset = {}) {
  const element = fakeElement();
  element.dataset = dataset;
  element.click = () => element.dispatch('click');
  element.keydown = key => element.dispatch('keydown', { key });
  return element;
}

function fakeShellSetup() {
  const libraryButton = fakeElement();
  const queueButton = fakeElement();
  libraryButton.dataset.shellDestination = 'library';
  queueButton.dataset.shellDestination = 'queue';

  const elements = {
    shell: fakeElement(),
    immersive: fakeElement(),
    opener: fakeElement(),
    closeButton: fakeElement(),
    backButton: fakeElement(),
    forwardButton: fakeElement(),
    eventTarget: fakeElement(),
    documentElement: fakeElement(),
    destinationButtons: [libraryButton, queueButton],
    navigationButtons: [libraryButton, queueButton],
  };
  elements.immersive.setAttribute('aria-hidden', 'true');
  elements.opener.setAttribute('aria-expanded', 'false');

  return { elements, libraryButton, queueButton };
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

test('immersive state defers focus until inert visibility updates settle', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();
  const deferredFocus = [];

  setImmersiveState({
    shell,
    immersive,
    opener,
    closeButton,
    deferFocus: callback => deferredFocus.push(callback),
  }, true);
  assert.equal(shell.inert, true);
  assert.equal(immersive.classList.contains('is-open'), true);
  assert.equal(immersive.getAttribute('aria-hidden'), 'false');
  assert.equal(opener.getAttribute('aria-expanded'), 'true');
  assert.equal(closeButton.focusCalled, false);
  assert.equal(deferredFocus.length, 1);

  deferredFocus.shift()();
  assert.equal(closeButton.focusCalled, true);

  setImmersiveState({
    shell,
    immersive,
    opener,
    closeButton,
    deferFocus: callback => deferredFocus.push(callback),
  }, false);
  assert.equal(shell.inert, false);
  assert.equal(immersive.classList.contains('is-open'), false);
  assert.equal(immersive.getAttribute('aria-hidden'), 'true');
  assert.equal(opener.getAttribute('aria-expanded'), 'false');
  assert.equal(opener.focusCalled, true);
});

test('immersive state inerts only the injected browsing surfaces', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();
  const inertTargets = [fakeElement(), fakeElement(), fakeElement()];

  setImmersiveState({ shell, inertTargets, immersive, opener, closeButton }, true);

  assert.equal(shell.inert, false);
  inertTargets.forEach(target => assert.equal(target.inert, true));

  setImmersiveState({ shell, inertTargets, immersive, opener, closeButton }, false);

  assert.equal(shell.inert, false);
  inertTargets.forEach(target => assert.equal(target.inert, false));
});

test('browser focus waits for a later task after the animation frame', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();
  const frames = [];
  const timers = [];
  const originals = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  globalThis.requestAnimationFrame = callback => {
    frames.push(callback);
    return frames.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.setTimeout = callback => {
    timers.push(callback);
    return timers.length;
  };
  globalThis.clearTimeout = () => {};

  try {
    setImmersiveState({ shell, immersive, opener, closeButton }, true);
    assert.equal(closeButton.focusCalls, 0);
    assert.equal(frames.length, 1);

    frames.shift()();
    assert.equal(closeButton.focusCalls, 0);
    assert.equal(timers.length, 1);

    timers.shift()();
    assert.equal(closeButton.focusCalls, 1);
  } finally {
    Object.entries(originals).forEach(([name, value]) => {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    });
  }
});

test('rapid immersive close cancels scheduled focus and ignores stale callbacks', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();
  let scheduledFocus = null;
  let cancelCalls = 0;
  const deferFocus = callback => {
    scheduledFocus = callback;
    return () => { cancelCalls += 1; };
  };

  setImmersiveState({ shell, immersive, opener, closeButton, deferFocus }, true);
  setImmersiveState({ shell, immersive, opener, closeButton, deferFocus }, false);

  assert.equal(cancelCalls, 1);
  scheduledFocus();
  assert.equal(closeButton.focusCalls, 0);
  assert.equal(opener.focusCalls, 1);
});

test('stale focus from a closed session cannot affect a reopened immersive view', () => {
  const shell = fakeElement();
  const immersive = fakeElement();
  const opener = fakeElement();
  const closeButton = fakeElement();
  const scheduledFocus = [];
  const deferFocus = callback => {
    scheduledFocus.push(callback);
    return () => {};
  };

  setImmersiveState({ shell, immersive, opener, closeButton, deferFocus }, true);
  setImmersiveState({ shell, immersive, opener, closeButton, deferFocus }, false);
  setImmersiveState({ shell, immersive, opener, closeButton, deferFocus }, true);

  scheduledFocus[0]();
  assert.equal(closeButton.focusCalls, 0);

  scheduledFocus[1]();
  assert.equal(closeButton.focusCalls, 1);
});

test('app shell runs destination actions and updates local history controls', () => {
  const { elements, libraryButton, queueButton } = fakeShellSetup();
  const actionCalls = [];
  const controller = initAppShell({
    elements,
    actions: {
      library: () => actionCalls.push('library'),
      queue: () => actionCalls.push('queue'),
    },
  });

  assert.equal(elements.backButton.disabled, true);
  assert.equal(elements.forwardButton.disabled, true);

  queueButton.dispatch('click');
  assert.deepEqual(actionCalls, ['queue']);
  assert.equal(queueButton.getAttribute('aria-current'), 'page');
  assert.equal(libraryButton.getAttribute('aria-current'), null);
  assert.equal(elements.backButton.disabled, false);
  assert.equal(elements.forwardButton.disabled, true);

  elements.backButton.dispatch('click');
  assert.deepEqual(actionCalls, ['queue', 'library']);
  assert.equal(elements.backButton.disabled, true);
  assert.equal(elements.forwardButton.disabled, false);

  elements.forwardButton.dispatch('click');
  assert.deepEqual(actionCalls, ['queue', 'library', 'queue']);
  assert.equal(elements.backButton.disabled, false);
  assert.equal(elements.forwardButton.disabled, true);

  controller.destroy();
});

test('aria-current is limited to injected navigation buttons', () => {
  const { elements, libraryButton, queueButton } = fakeShellSetup();
  const queueCardButton = fakeElement();
  const actionCalls = [];
  queueCardButton.dataset.shellDestination = 'queue';
  elements.destinationButtons.push(queueCardButton);

  const controller = initAppShell({
    elements,
    actions: { queue: () => actionCalls.push('queue') },
  });

  queueCardButton.dispatch('click');

  assert.deepEqual(actionCalls, ['queue']);
  assert.equal(queueCardButton.getAttribute('aria-current'), null);
  assert.equal(queueButton.getAttribute('aria-current'), 'page');
  assert.equal(libraryButton.getAttribute('aria-current'), null);

  controller.destroy();
});

test('library navigation focuses its view while immersive close paths restore the opener', () => {
  const { elements, libraryButton, queueButton } = fakeShellSetup();
  const libraryView = fakeElement();
  let focusedElement = null;
  elements.opener.focus = () => {
    elements.opener.focusCalled = true;
    elements.opener.focusCalls += 1;
    focusedElement = 'opener';
  };
  libraryView.focus = () => {
    libraryView.focusCalled = true;
    libraryView.focusCalls += 1;
    focusedElement = 'library';
  };
  const controller = initAppShell({
    elements,
    actions: { library: () => libraryView.focus() },
  });

  queueButton.dispatch('click');
  libraryButton.dispatch('click');
  assert.equal(libraryView.focusCalls, 1);

  controller.back();
  controller.forward();
  assert.equal(libraryView.focusCalls, 2);
  assert.equal(focusedElement, 'library');

  controller.setImmersive(true);
  controller.back();
  assert.equal(libraryView.focusCalls, 3);
  assert.equal(focusedElement, 'library');

  controller.setImmersive(true);
  controller.setImmersive(false);
  assert.equal(elements.opener.focusCalls, 2);
  assert.equal(libraryView.focusCalls, 3);
  assert.equal(focusedElement, 'opener');

  controller.setImmersive(true);
  elements.eventTarget.dispatch('keydown', { key: 'Escape' });
  assert.equal(elements.opener.focusCalls, 3);
  assert.equal(libraryView.focusCalls, 3);
  assert.equal(focusedElement, 'opener');

  controller.setImmersive(true);
  elements.closeButton.dispatch('click');
  assert.equal(elements.opener.focusCalls, 4);
  assert.equal(libraryView.focusCalls, 3);
  assert.equal(focusedElement, 'opener');

  controller.destroy();
});

test('app shell closes immersive on Escape and reports immersive changes', async () => {
  const { elements } = fakeShellSetup();
  const immersiveChanges = [];
  elements.deferFocus = queueMicrotask;
  const controller = initAppShell({
    elements,
    onImmersiveChange: open => immersiveChanges.push(open),
  });

  elements.opener.dispatch('click');
  assert.equal(elements.immersive.getAttribute('aria-hidden'), 'false');
  assert.equal(elements.documentElement.classList.contains('desktop-immersive-open'), true);
  assert.equal(elements.closeButton.focusCalls, 0);
  await Promise.resolve();
  assert.equal(elements.closeButton.focusCalls, 1);

  const escapeEvent = elements.eventTarget.dispatch('keydown', { key: 'Escape' });
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(elements.immersive.getAttribute('aria-hidden'), 'true');
  assert.equal(elements.documentElement.classList.contains('desktop-immersive-open'), false);
  assert.equal(elements.opener.focusCalls, 1);
  assert.deepEqual(immersiveChanges, [true, false]);

  controller.destroy();
});

test('app shell close button restores focus after immersive opens', async () => {
  const { elements } = fakeShellSetup();
  elements.deferFocus = queueMicrotask;
  const controller = initAppShell({ elements });

  elements.opener.dispatch('click');
  elements.closeButton.dispatch('click');
  await Promise.resolve();

  assert.equal(elements.immersive.getAttribute('aria-hidden'), 'true');
  assert.equal(elements.closeButton.focusCalls, 0);
  assert.equal(elements.opener.focusCalls, 1);

  controller.destroy();
});

test('app shell destroy removes every registered listener', () => {
  const { elements, libraryButton, queueButton } = fakeShellSetup();
  const actionCalls = [];
  const controller = initAppShell({
    elements,
    actions: { queue: () => actionCalls.push('queue') },
  });
  const bindings = [
    [libraryButton, 'click'],
    [queueButton, 'click'],
    [elements.opener, 'click'],
    [elements.closeButton, 'click'],
    [elements.backButton, 'click'],
    [elements.forwardButton, 'click'],
    [elements.eventTarget, 'keydown'],
  ];

  bindings.forEach(([element, type]) => assert.equal(element.listenerCount(type), 1));
  controller.destroy();
  bindings.forEach(([element, type]) => assert.equal(element.listenerCount(type), 0));

  queueButton.dispatch('click');
  assert.deepEqual(actionCalls, []);
});

test('shell destinations call injected actions and update history buttons', () => {
  const shell = clickableElement();
  const immersive = clickableElement();
  immersive.setAttribute('aria-hidden', 'true');
  const opener = clickableElement({ shellDestination: 'now-playing' });
  const closeButton = clickableElement();
  const backButton = clickableElement();
  const forwardButton = clickableElement();
  const queueButton = clickableElement({ shellDestination: 'queue' });
  const eventTarget = clickableElement();
  const calls = [];

  const controller = initAppShell({
    elements: {
      shell,
      immersive,
      opener,
      closeButton,
      backButton,
      forwardButton,
      destinationButtons: [queueButton],
      eventTarget,
      documentElement: clickableElement(),
    },
    actions: { queue: () => calls.push('queue') },
  });

  queueButton.click();
  assert.deepEqual(calls, ['queue']);
  assert.equal(backButton.disabled, false);
  controller.back();
  assert.equal(forwardButton.disabled, false);
});

test('destroy removes shell listeners', () => {
  const queueButton = clickableElement({ shellDestination: 'queue' });
  const calls = [];
  const controller = initAppShell({
    elements: { destinationButtons: [queueButton] },
    actions: { queue: () => calls.push('queue') },
  });

  controller.destroy();
  queueButton.click();
  assert.deepEqual(calls, []);
});

test('ordinary destinations do not restore focus reserved for immersive close', async () => {
  const { elements } = fakeShellSetup();
  elements.deferFocus = queueMicrotask;
  const controller = initAppShell({ elements });

  controller.navigate('queue');
  controller.navigate('library');
  controller.back();
  assert.equal(elements.opener.focusCalls, 0);

  controller.setImmersive(true);
  assert.equal(elements.closeButton.focusCalls, 0);
  await Promise.resolve();
  assert.equal(elements.closeButton.focusCalls, 1);
  controller.setImmersive(false);
  assert.equal(elements.opener.focusCalls, 1);

  controller.navigate('queue');
  controller.setImmersive(false);
  assert.equal(elements.opener.focusCalls, 1);

  controller.destroy();
});

test('immersive mode restores focus to the destination button that opened it', async () => {
  const { elements } = fakeShellSetup();
  const sidebarOpener = fakeElement();
  sidebarOpener.dataset.shellDestination = 'now-playing';
  sidebarOpener.setAttribute('aria-expanded', 'false');
  elements.destinationButtons.push(sidebarOpener);
  elements.deferFocus = queueMicrotask;
  const controller = initAppShell({ elements });

  sidebarOpener.dispatch('click');
  assert.equal(sidebarOpener.getAttribute('aria-expanded'), 'true');
  assert.equal(elements.opener.getAttribute('aria-expanded'), 'false');
  assert.equal(elements.closeButton.focusCalls, 0);

  await Promise.resolve();
  assert.equal(elements.closeButton.focusCalls, 1);

  elements.eventTarget.dispatch('keydown', { key: 'Escape' });
  assert.equal(sidebarOpener.getAttribute('aria-expanded'), 'false');
  assert.equal(sidebarOpener.focusCalls, 1);
  assert.equal(elements.opener.focusCalls, 0);

  sidebarOpener.dispatch('click');
  await Promise.resolve();
  controller.back();
  assert.equal(sidebarOpener.getAttribute('aria-expanded'), 'false');
  assert.equal(sidebarOpener.focusCalls, 2);
  assert.equal(elements.opener.focusCalls, 0);

  controller.destroy();
});
