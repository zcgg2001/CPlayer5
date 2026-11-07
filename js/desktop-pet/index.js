import {
  SPRITE_SETS, clampPoint, chooseButterflyTarget, nextPetMode, hasDragged,
  serializePetPosition, restorePetPosition, getSleepAnchorPoint, getPetLayout, getDirectionSprite,
} from './model.js';
export * from './model.js';

function createPetElements(document, mount, id) {
  const layer = document.createElement('div');
  if (id) layer.id = id;
  layer.className = 'oneko-pet-layer';

  const cat = document.createElement('button');
  cat.className = 'oneko-cat';
  cat.type = 'button';
  cat.setAttribute('aria-label', '桌宠小猫：单击切换模式，双击睡觉，可拖动');
  cat.title = '单击切换模式 · 双击睡觉 · 拖动小猫';

  const catSprite = document.createElement('span');
  catSprite.className = 'oneko-cat__sprite';
  catSprite.setAttribute('aria-hidden', 'true');
  cat.appendChild(catSprite);

  const trails = Array.from({ length: 3 }, (_, index) => {
    const trail = document.createElement('span');
    trail.className = `oneko-trail oneko-trail-${index + 1}`;
    trail.setAttribute('aria-hidden', 'true');
    return trail;
  });

  const butterfly = document.createElement('button');
  butterfly.className = 'oneko-butterfly';
  butterfly.type = 'button';
  butterfly.setAttribute('aria-label', '让蝴蝶飞到新的位置');
  butterfly.title = '点击让蝴蝶飞到新位置';

  const leftWing = document.createElement('span');
  leftWing.className = 'oneko-butterfly__wing oneko-butterfly__wing--left';
  const rightWing = document.createElement('span');
  rightWing.className = 'oneko-butterfly__wing oneko-butterfly__wing--right';
  const butterflyBody = document.createElement('span');
  butterflyBody.className = 'oneko-butterfly__body';
  butterfly.append(leftWing, rightWing, butterflyBody);

  layer.append(cat, ...trails, butterfly);
  mount.appendChild(layer);
  return { layer, cat, catSprite, butterfly, trails };
}


/** Create a viewport pet. Importing this module never mounts or starts anything. */
export function createDesktopPet({
  mount = globalThis.document?.body,
  id,
  storageKey = 'desktop-pet',
  storage,
  resolveLayout = getPetLayout,
  resolveSleepAnchor = () => null,
} = {}) {
  if (!mount) return null;
  const document = mount.ownerDocument;
  const window = document.defaultView;
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const performance = window.performance;
  const clearTimeout = window.clearTimeout.bind(window);
  try { storage ??= window.localStorage; } catch { /* Storage is optional. */ }
  const elements = createPetElements(document, mount, id);
  const cleanups = [];
  const subscribers = new Set();
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clickDelay = 240;
  const storedState = (() => {
    try {
      const value = JSON.parse(storage?.getItem(storageKey));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  })();
  let enabled = storedState.enabled !== false;
  let suspended = false;
  let destroyed = false;
  let layout;
  let viewport;
  let catPosition;
  let butterflyPosition;
  let butterflyTarget;
  let butterflyHistory = [];
  let cursorTarget = null;
  let interactionMode = typeof storedState.mode === 'string' ? storedState.mode : null;
  let previousMode = typeof storedState.previousMode === 'string'
    ? storedState.previousMode
    : 'butterfly';
  let savedPosition = storedState.position || null;
  let targetExpiresAt = 0;
  let animationFrame = null;
  let resizeFrame = null;
  let clickTimer = null;
  let lastTimestamp = 0;
  let lastCatStep = 0;
  let spriteFrame = 0;
  let running = false;
  let catHitSize = 64;
  let dragState = null;
  let suppressClickUntil = 0;

  const isMobile = () => window.innerWidth < 768;

  const saveState = ({ preservePosition = false } = {}) => {
    if (!preservePosition) {
      savedPosition = serializePetPosition(catPosition, window.innerWidth, window.innerHeight)
        || savedPosition;
    }
    try {
      storage?.setItem(storageKey, JSON.stringify({
        enabled,
        mode: interactionMode,
        previousMode,
        position: savedPosition,
      }));
    } catch {
      // Storage can be unavailable in private browsing; keep state in memory.
    }
  };

  const setSprite = (name, frame = 0) => {
    const sprites = SPRITE_SETS[name] || SPRITE_SETS.idle;
    const [x, y] = sprites[Math.abs(frame) % sprites.length];
    elements.catSprite.style.backgroundPosition = `${x * layout.size}px ${y * layout.size}px`;
  };

  const render = timestamp => {
    const catX = catPosition.x - catHitSize / 2;
    const catY = catPosition.y - catHitSize / 2;
    elements.cat.style.transform = `translate3d(${catX}px, ${catY}px, 0)`;

    const butterflyY = butterflyPosition.y + Math.sin(timestamp / 220) * 3;
    elements.butterfly.style.transform = `translate3d(${butterflyPosition.x - 22}px, ${butterflyY - 22}px, 0)`;

    const trailIndexes = [5, 10, 15];
    elements.trails.forEach((trail, index) => {
      const point = butterflyHistory[trailIndexes[index]] || butterflyPosition;
      trail.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    });
  };

  const chooseNewTarget = timestamp => {
    butterflyTarget = chooseButterflyTarget(layout.bounds);
    targetExpiresAt = timestamp + 2600 + Math.random() * 1800;
  };

  const stopAnimation = () => {
    running = false;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };

  const canAnimate = () => (
    !destroyed
    && enabled
    && !suspended
    && !motionPreference.matches
    && !dragState
    && !document.hidden
    && (interactionMode === 'butterfly' || interactionMode === 'cursor')
  );

  const getSleepPosition = () => {
    const anchor = resolveSleepAnchor({ mobile: isMobile() });
    const progressRect = anchor?.getBoundingClientRect?.() || anchor;
    const anchoredPoint = getSleepAnchorPoint(
      progressRect,
      window.innerWidth,
      window.innerHeight,
      catHitSize,
    );
    if (!anchoredPoint) {
      return clampPoint({
        x: layout.bounds.right - layout.size * 0.5,
        y: layout.bounds.bottom,
      }, layout.bounds);
    }
    return anchoredPoint;
  };

  const getState = () => ({
    enabled,
    mode: interactionMode,
    previousMode,
    position: savedPosition ? { ...savedPosition } : null,
    suspended,
    reducedMotion: motionPreference.matches,
    mobile: isMobile(),
  });
  const notify = () => subscribers.forEach(callback => callback(getState()));

  const updateModePresentation = () => {
    elements.layer.hidden = !enabled || suspended;
    elements.layer.dataset.paused = String(!canAnimate());
    elements.layer.dataset.interactionMode = interactionMode;
    elements.layer.dataset.mode = canAnimate() ? 'chase' : 'rest';
    const modeLabels = {
      butterfly: '追逐蝴蝶',
      cursor: '跟随鼠标',
      rest: '休息',
      sleep: '睡眠',
    };
    elements.cat.setAttribute(
      'aria-label',
      `桌宠小猫，当前${modeLabels[interactionMode] || '休息'}；单击切换模式，双击睡觉或醒来，可拖动`,
    );
  };

  const animate = timestamp => {
    if (!canAnimate()) {
      stopAnimation();
      return;
    }

    const delta = lastTimestamp ? Math.min(timestamp - lastTimestamp, 50) : 16;
    lastTimestamp = timestamp;

    const catTarget = interactionMode === 'cursor' && cursorTarget
      ? cursorTarget
      : butterflyPosition;
    const catToTarget = Math.hypot(
      catPosition.x - catTarget.x,
      catPosition.y - catTarget.y,
    );
    if (timestamp >= targetExpiresAt || (
      interactionMode === 'butterfly' && catToTarget < layout.size * 1.15
    )) {
      chooseNewTarget(timestamp);
    }

    const butterflyDiffX = butterflyTarget.x - butterflyPosition.x;
    const butterflyDiffY = butterflyTarget.y - butterflyPosition.y;
    const butterflyDistance = Math.hypot(butterflyDiffX, butterflyDiffY);
    if (butterflyDistance > 0.5) {
      const butterflyStep = Math.min(butterflyDistance, delta * 0.05);
      butterflyPosition.x += (butterflyDiffX / butterflyDistance) * butterflyStep;
      butterflyPosition.y += (butterflyDiffY / butterflyDistance) * butterflyStep;
    }
    butterflyPosition = clampPoint(butterflyPosition, layout.bounds);
    butterflyHistory.unshift({ ...butterflyPosition });
    butterflyHistory.length = Math.min(butterflyHistory.length, 20);

    if (timestamp - lastCatStep >= 100) {
      const target = interactionMode === 'cursor' && cursorTarget
        ? cursorTarget
        : butterflyPosition;
      const diffX = catPosition.x - target.x;
      const diffY = catPosition.y - target.y;
      const distance = Math.hypot(diffX, diffY);

      if (distance < layout.size * 0.9) {
        setSprite('idle', 0);
      } else {
        const sprite = getDirectionSprite(diffX, diffY, distance, spriteFrame);
        elements.catSprite.style.backgroundPosition = `${sprite.x * layout.size}px ${sprite.y * layout.size}px`;
        const catStep = Math.min(distance - layout.size * 0.55, layout.size === 64 ? 10 : 6);
        catPosition.x -= (diffX / distance) * catStep;
        catPosition.y -= (diffY / distance) * catStep;
        catPosition = clampPoint(catPosition, layout.bounds);
        spriteFrame += 1;
      }
      lastCatStep = timestamp;
    }

    render(timestamp);
    animationFrame = requestAnimationFrame(animate);
  };

  const startAnimation = () => {
    if (running || !canAnimate()) return;
    running = true;
    lastTimestamp = 0;
    lastCatStep = 0;
    if (!butterflyTarget) chooseNewTarget(performance.now());
    animationFrame = requestAnimationFrame(animate);
  };

  const applyInteractionMode = ({ persist = true, moveToSleepPoint = true } = {}) => {
    stopAnimation();
    updateModePresentation();

    if (interactionMode === 'sleep') {
      if (moveToSleepPoint) catPosition = getSleepPosition();
      setSprite('sleeping', 0);
      render(0);
    } else if (interactionMode === 'rest' || motionPreference.matches) {
      setSprite(interactionMode === 'rest' ? 'sleeping' : 'idle', 0);
      render(0);
    } else {
      setSprite('alert', 0);
      render(0);
      startAnimation();
    }

    if (persist) saveState({ preservePosition: interactionMode === 'sleep' });
    notify();
  };

  const applyLayout = () => {
    if (destroyed) return;
    const currentPosition = catPosition && viewport && interactionMode !== 'sleep'
      ? serializePetPosition(catPosition, viewport.width, viewport.height)
      : savedPosition;
    stopAnimation();
    viewport = { width: window.innerWidth, height: window.innerHeight };
    layout = resolveLayout(viewport.width, viewport.height, motionPreference.matches);
    catHitSize = Math.max(layout.size, 44);
    elements.cat.style.width = `${catHitSize}px`;
    elements.cat.style.height = `${catHitSize}px`;
    elements.catSprite.style.width = `${layout.size}px`;
    elements.catSprite.style.height = `${layout.size}px`;
    elements.catSprite.style.backgroundSize = `${layout.size * 8}px ${layout.size * 4}px`;
    catPosition = restorePetPosition(
      currentPosition || savedPosition,
      layout.bounds,
      window.innerWidth,
      window.innerHeight,
    ) || { ...layout.catStart };
    savedPosition = serializePetPosition(catPosition, window.innerWidth, window.innerHeight);
    butterflyPosition = butterflyPosition
      ? clampPoint(butterflyPosition, layout.bounds)
      : { ...layout.butterflyStart };
    butterflyHistory = Array.from({ length: 18 }, () => ({ ...butterflyPosition }));
    butterflyTarget = { ...butterflyPosition };
    cursorTarget = cursorTarget ? clampPoint(cursorTarget, layout.bounds) : { ...butterflyPosition };

    const normalized = nextPetMode(interactionMode, 'noop', previousMode, isMobile());
    interactionMode = normalized.mode;
    previousMode = normalized.previousMode;
    if (isMobile() && interactionMode === 'cursor') interactionMode = 'rest';
    applyInteractionMode({ persist: false });
  };

  const scheduleLayout = () => {
    if (destroyed) return;
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      applyLayout();
    });
  };

  const syncVisibility = () => {
    updateModePresentation();
    if (document.hidden) {
      stopAnimation();
    } else if (canAnimate()) {
      startAnimation();
    }
  };

  const relocateButterfly = () => {
    const timestamp = performance.now();
    chooseNewTarget(timestamp);
    if (!canAnimate()) {
      butterflyPosition = { ...butterflyTarget };
      butterflyHistory = Array.from({ length: 18 }, () => ({ ...butterflyPosition }));
      render(timestamp);
    } else {
      startAnimation();
    }
  };

  const toggleTargetMode = () => {
    const next = nextPetMode(interactionMode, 'toggle-target', previousMode, isMobile());
    interactionMode = next.mode;
    previousMode = next.previousMode;
    applyInteractionMode();
  };

  const toggleSleep = () => {
    const waking = interactionMode === 'sleep';
    if (!waking) {
      savedPosition = serializePetPosition(catPosition, window.innerWidth, window.innerHeight)
        || savedPosition;
    }
    const next = nextPetMode(interactionMode, 'toggle-sleep', previousMode, isMobile());
    interactionMode = next.mode;
    previousMode = next.previousMode;
    if (waking) {
      catPosition = restorePetPosition(
        savedPosition,
        layout.bounds,
        window.innerWidth,
        window.innerHeight,
      ) || catPosition;
    }
    applyInteractionMode();
  };

  const finishDrag = event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.stopPropagation();
    if (dragState.dragged) {
      suppressClickUntil = performance.now() + 400;
      savedPosition = serializePetPosition(catPosition, window.innerWidth, window.innerHeight);
      saveState();
      notify();
    }
    dragState = null;
    if (elements.cat.hasPointerCapture?.(event.pointerId)) {
      elements.cat.releasePointerCapture(event.pointerId);
    }
    elements.cat.classList.remove('is-dragging');
    updateModePresentation();
    if (canAnimate()) {
      startAnimation();
    } else {
      setSprite(interactionMode === 'sleep' || interactionMode === 'rest' ? 'sleeping' : 'idle', 0);
      render(performance.now());
    }
  };

  listen(elements.cat, 'pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.stopPropagation();
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    dragState = {
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startCat: { ...catPosition },
      dragged: false,
    };
    elements.cat.setPointerCapture?.(event.pointerId);
    stopAnimation();
    updateModePresentation();
  });

  listen(elements.cat, 'pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    event.stopPropagation();
    const current = { x: event.clientX, y: event.clientY };
    if (!dragState.dragged && hasDragged(dragState.startPointer, current)) {
      dragState.dragged = true;
      elements.cat.classList.add('is-dragging');
    }
    if (!dragState.dragged) return;
    catPosition = clampPoint({
      x: dragState.startCat.x + current.x - dragState.startPointer.x,
      y: dragState.startCat.y + current.y - dragState.startPointer.y,
    }, layout.bounds);
    render(performance.now());
  });

  listen(elements.cat, 'pointerup', finishDrag);
  listen(elements.cat, 'pointercancel', finishDrag);
  listen(elements.cat, 'lostpointercapture', finishDrag);

  listen(elements.cat, 'click', event => {
    event.stopPropagation();
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      toggleTargetMode();
    }, clickDelay);
  });

  listen(elements.cat, 'dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    toggleSleep();
  });

  listen(elements.butterfly, 'click', event => {
    event.preventDefault();
    event.stopPropagation();
    relocateButterfly();
  });

  listen(document, 'pointermove', event => {
    if (!enabled || suspended || interactionMode !== 'cursor' || dragState) return;
    cursorTarget = clampPoint({ x: event.clientX, y: event.clientY }, layout.bounds);
    if (canAnimate()) startAnimation();
  }, { passive: true });

  listen(window, 'resize', scheduleLayout, { passive: true });
  listen(document, 'visibilitychange', syncVisibility);
  if (typeof motionPreference.addEventListener === 'function') {
    listen(motionPreference, 'change', applyLayout);
  } else {
    motionPreference.addListener(applyLayout);
    cleanups.push(() => motionPreference.removeListener(applyLayout));
  }

  const cancelInteraction = () => {
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = null;
    const pointerId = dragState?.pointerId;
    dragState = null;
    if (pointerId !== undefined && elements.cat.hasPointerCapture?.(pointerId)) {
      elements.cat.releasePointerCapture(pointerId);
    }
    elements.cat.classList.remove('is-dragging');
  };

  applyLayout();
  return {
    element: elements.layer,
    getState,
    subscribe(callback) {
      if (destroyed) return () => {};
      subscribers.add(callback);
      callback(getState());
      return () => subscribers.delete(callback);
    },
    setEnabled(value) {
      if (destroyed) return;
      cancelInteraction();
      enabled = Boolean(value);
      applyInteractionMode({ moveToSleepPoint: false });
    },
    setMode(mode) {
      if (destroyed || !['butterfly', 'cursor', 'rest', 'sleep'].includes(mode)) return;
      cancelInteraction();
      if (mode === 'sleep' && interactionMode !== 'sleep') {
        previousMode = interactionMode;
        savedPosition = serializePetPosition(catPosition, viewport.width, viewport.height);
      } else if (interactionMode === 'sleep' && mode !== 'sleep') {
        catPosition = restorePetPosition(savedPosition, layout.bounds, viewport.width, viewport.height)
          || { ...layout.catStart };
      }
      interactionMode = isMobile() && mode === 'cursor' ? 'rest' : mode;
      applyInteractionMode();
    },
    recall() {
      if (destroyed) return;
      cancelInteraction();
      enabled = true;
      interactionMode = 'rest';
      previousMode = 'rest';
      catPosition = { ...layout.catStart };
      butterflyPosition = { ...layout.butterflyStart };
      butterflyHistory = [];
      applyInteractionMode();
    },
    setSuspended(value) {
      if (destroyed || suspended === Boolean(value)) return;
      cancelInteraction();
      suspended = Boolean(value);
      applyInteractionMode({ persist: false, moveToSleepPoint: false });
    },
    refresh: scheduleLayout,
    destroy() {
      if (destroyed) return;
      saveState({ preservePosition: interactionMode === 'sleep' });
      destroyed = true;
      cancelInteraction();
      stopAnimation();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
      cleanups.splice(0).forEach(cleanup => cleanup());
      subscribers.clear();
      elements.layer.remove();
    },
  };
}
