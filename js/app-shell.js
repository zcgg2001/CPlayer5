export const DESKTOP_SHELL_MEDIA = '(min-width: 1024px)';

export function initialShellState() {
  return { destination: 'library', immersiveOpen: false };
}

export function createShellHistory(initialDestination = 'library') {
  const entries = [initialDestination];
  let index = 0;
  return {
    current: () => entries[index],
    canBack: () => index > 0,
    canForward: () => index < entries.length - 1,
    push(destination) {
      if (!destination || destination === entries[index]) return entries[index];
      entries.splice(index + 1);
      entries.push(destination);
      index = entries.length - 1;
      return entries[index];
    },
    back() {
      if (index > 0) index -= 1;
      return entries[index];
    },
    forward() {
      if (index < entries.length - 1) index += 1;
      return entries[index];
    },
  };
}

export function progressPercent(currentTime, duration) {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (currentTime / duration) * 100));
}

const pendingImmersiveFocus = new WeakMap();

function deferElementFocus(callback) {
  let frameId = null;
  let timerId = null;
  let cancelled = false;

  const scheduleTask = () => {
    frameId = null;
    if (cancelled) return;
    timerId = globalThis.setTimeout(() => {
      timerId = null;
      if (!cancelled) callback();
    }, 0);
  };

  if (typeof globalThis.requestAnimationFrame === 'function') {
    frameId = globalThis.requestAnimationFrame(scheduleTask);
  } else {
    scheduleTask();
  }

  return () => {
    cancelled = true;
    if (frameId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(frameId);
    }
    if (timerId !== null && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(timerId);
    }
    frameId = null;
    timerId = null;
  };
}

export function setImmersiveState({
  shell,
  inertTargets,
  immersive,
  opener,
  closeButton,
  deferFocus = deferElementFocus,
}, open) {
  if (!immersive || !opener) return;
  pendingImmersiveFocus.get(immersive)?.();
  pendingImmersiveFocus.delete(immersive);
  const wasOpen = immersive.getAttribute('aria-hidden') === 'false';
  const targets = Array.isArray(inertTargets) ? inertTargets : [shell];
  targets.filter(Boolean).forEach(target => { target.inert = open; });
  immersive.classList.toggle('is-open', open);
  immersive.setAttribute('aria-hidden', String(!open));
  opener.setAttribute('aria-expanded', String(open));
  if (open) {
    let focusPending = true;
    const cancelScheduledFocus = deferFocus(() => {
      if (!focusPending) return;
      focusPending = false;
      pendingImmersiveFocus.delete(immersive);
      if (immersive.getAttribute('aria-hidden') === 'false') closeButton?.focus();
    });
    const cancelFocus = () => {
      if (!focusPending) return;
      focusPending = false;
      if (typeof cancelScheduledFocus === 'function') cancelScheduledFocus();
    };
    if (focusPending) {
      pendingImmersiveFocus.set(immersive, cancelFocus);
    }
  }
  else if (wasOpen) opener.focus();
}

export function initAppShell({ elements, actions = {}, onImmersiveChange = () => {} }) {
  const history = createShellHistory('library');
  const cleanups = [];
  let immersiveOpener = elements.opener;

  const listen = (element, type, handler) => {
    if (!element) return;
    element.addEventListener(type, handler);
    cleanups.push(() => element.removeEventListener(type, handler));
  };

  const updateHistoryButtons = () => {
    if (elements.backButton) elements.backButton.disabled = !history.canBack();
    if (elements.forwardButton) elements.forwardButton.disabled = !history.canForward();
  };

  const applyDestination = (
    destination,
    { record = true, trigger = null, runAction = true } = {},
  ) => {
    if (record) history.push(destination);
    const immersiveOpen = destination === 'now-playing';
    if (immersiveOpen && trigger && trigger !== immersiveOpener) {
      immersiveOpener?.setAttribute('aria-expanded', 'false');
      immersiveOpener = trigger;
    }
    setImmersiveState({ ...elements, opener: immersiveOpener }, immersiveOpen);
    elements.documentElement?.classList.toggle('desktop-immersive-open', immersiveOpen);
    (elements.navigationButtons ?? elements.destinationButtons)?.forEach(button => {
      const active = button.dataset.shellDestination === destination;
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (!immersiveOpen && runAction) actions[destination]?.();
    onImmersiveChange(immersiveOpen);
    updateHistoryButtons();
    return destination;
  };

  elements.destinationButtons?.forEach(button => {
    listen(button, 'click', () => applyDestination(
      button.dataset.shellDestination,
      { trigger: button },
    ));
  });
  listen(elements.opener, 'click', () => applyDestination(
    'now-playing',
    { trigger: elements.opener },
  ));
  listen(elements.closeButton, 'click', () => applyDestination(
    'library',
    { runAction: false },
  ));
  listen(elements.backButton, 'click', () => applyDestination(history.back(), { record: false }));
  listen(elements.forwardButton, 'click', () => applyDestination(history.forward(), { record: false }));
  listen(elements.eventTarget, 'keydown', event => {
    if (event.key === 'Escape' && elements.immersive?.getAttribute('aria-hidden') === 'false') {
      event.preventDefault();
      applyDestination('library', { runAction: false });
    }
  });
  updateHistoryButtons();

  return {
    navigate: applyDestination,
    back: () => applyDestination(history.back(), { record: false }),
    forward: () => applyDestination(history.forward(), { record: false }),
    setImmersive: open => applyDestination(
      open ? 'now-playing' : 'library',
      { runAction: open },
    ),
    destroy: () => cleanups.splice(0).forEach(cleanup => cleanup()),
  };
}
