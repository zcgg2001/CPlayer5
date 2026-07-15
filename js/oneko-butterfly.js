// Directional sprite coordinates are adapted from oneko.js:
// https://github.com/adryd325/oneko.js (MIT License).
const SPRITE_SETS = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  tired: [[-3, -2]],
  sleeping: [[-2, 0], [-2, -1]],
  N: [[-1, -2], [-1, -3]],
  NE: [[0, -2], [0, -3]],
  E: [[-3, 0], [-3, -1]],
  SE: [[-5, -1], [-5, -2]],
  S: [[-6, -3], [-7, -2]],
  SW: [[-5, -3], [-6, -1]],
  W: [[-4, -2], [-4, -3]],
  NW: [[-1, 0], [-1, -1]],
};


export function clampPoint(point, bounds) {
  return {
    x: Math.min(Math.max(point.x, bounds.left), bounds.right),
    y: Math.min(Math.max(point.y, bounds.top), bounds.bottom),
  };
}


export function chooseButterflyTarget(bounds, random = Math.random) {
  return {
    x: bounds.left + (bounds.right - bounds.left) * (0.15 + random() * 0.7),
    y: bounds.top + (bounds.bottom - bounds.top) * (0.15 + random() * 0.6),
  };
}


export function shouldAnimatePet(mode, documentHidden) {
  return mode === 'chase' && !documentHidden;
}


export function nextPetMode(mode, action, previousMode = 'butterfly', isMobile = false) {
  const fallbackMode = isMobile ? 'rest' : 'butterfly';
  const validModes = new Set(['butterfly', 'cursor', 'rest', 'sleep']);
  const current = validModes.has(mode) ? mode : fallbackMode;
  const previous = validModes.has(previousMode) && previousMode !== 'sleep'
    ? previousMode
    : fallbackMode;

  if (action === 'toggle-sleep') {
    if (current === 'sleep') return { mode: previous, previousMode: previous };
    return { mode: 'sleep', previousMode: current };
  }

  if (action === 'toggle-target') {
    if (current === 'sleep') return { mode: current, previousMode: previous };
    if (isMobile) {
      return {
        mode: current === 'butterfly' ? 'rest' : 'butterfly',
        previousMode: previous,
      };
    }
    return {
      mode: current === 'cursor' ? 'butterfly' : 'cursor',
      previousMode: previous,
    };
  }

  return { mode: current, previousMode: previous };
}


export function hasDragged(start, current, threshold = 8) {
  if (!start || !current) return false;
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}


export function serializePetPosition(point, width, height) {
  if (
    !point
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return { xRatio: point.x / width, yRatio: point.y / height };
}


export function restorePetPosition(saved, bounds, width, height) {
  if (
    !saved
    || !Number.isFinite(saved.xRatio)
    || !Number.isFinite(saved.yRatio)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }
  return clampPoint(
    { x: saved.xRatio * width, y: saved.yRatio * height },
    bounds,
  );
}


export function getSleepAnchorSelector(isMobile) {
  return isMobile ? '#mobileProgressBarContainer' : '.progress-bar-container';
}


export function getSleepAnchorPoint(anchor, width, height, hitSize, gap = 8) {
  if (
    !anchor
    || !Number.isFinite(anchor.right)
    || !Number.isFinite(anchor.top)
    || !Number.isFinite(anchor.width)
    || !Number.isFinite(anchor.height)
    || anchor.width <= 0
    || anchor.height <= 0
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(hitSize)
    || width <= 0
    || height <= 0
    || hitSize <= 0
  ) {
    return null;
  }

  const half = hitSize / 2;
  const left = Math.min(width / 2, half + gap);
  const right = Math.max(left, width - half - gap);
  const top = Math.min(height / 2, half + gap);
  const bottom = Math.max(top, height - half - gap);
  return clampPoint(
    { x: anchor.right - half - gap, y: anchor.top - half - gap },
    { left, right, top, bottom },
  );
}


export function getPetLayout(width, height, reducedMotion = false) {
  const mobile = width < 1024;
  const size = mobile ? 32 : 64;

  if (mobile) {
    const hitHalf = Math.max(size, 44) / 2;
    const bounds = {
      left: hitHalf,
      right: Math.max(hitHalf, width - hitHalf),
      top: Math.max(hitHalf, height - 200),
      bottom: Math.max(hitHalf, height - 80),
    };
    return {
      mode: 'rest',
      size,
      bounds,
      catStart: clampPoint({ x: width - 56, y: height - 112 }, bounds),
      butterflyStart: clampPoint({ x: width - 104, y: height - 158 }, bounds),
    };
  }

  const bounds = {
    left: Math.max(width * 0.56, width - 560),
    right: Math.max(width * 0.56 + size, width - 104),
    top: Math.max(height * 0.56, 280),
    bottom: Math.max(height * 0.56 + size, height - 96),
  };
  return {
    mode: reducedMotion ? 'rest' : 'chase',
    size,
    bounds,
    catStart: clampPoint({ x: width * 0.75, y: height * 0.75 }, bounds),
    butterflyStart: clampPoint({ x: width * 0.85, y: height * 0.58 }, bounds),
  };
}


export function getDirectionSprite(diffX, diffY, distance, frameCount) {
  if (!Number.isFinite(distance) || distance <= 0) {
    const [x, y] = SPRITE_SETS.idle[0];
    return { direction: 'idle', x, y };
  }

  let direction = '';
  direction += diffY / distance > 0.5 ? 'N' : '';
  direction += diffY / distance < -0.5 ? 'S' : '';
  direction += diffX / distance > 0.5 ? 'W' : '';
  direction += diffX / distance < -0.5 ? 'E' : '';
  direction ||= 'idle';

  const sprites = SPRITE_SETS[direction] || SPRITE_SETS.idle;
  const [x, y] = sprites[Math.abs(frameCount) % sprites.length];
  return { direction, x, y };
}


function createPetElements() {
  const layer = document.createElement('div');
  layer.id = 'onekoPetLayer';
  layer.className = 'oneko-pet-layer';

  const cat = document.createElement('button');
  cat.id = 'onekoCat';
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
  butterfly.id = 'onekoButterfly';
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
  document.body.appendChild(layer);
  return { layer, cat, catSprite, butterfly, trails };
}


export function initOnekoButterfly() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const existing = document.getElementById('onekoPetLayer');
  if (existing) return existing;

  const elements = createPetElements();
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'cplayer5:oneko';
  const clickDelay = 240;
  const storedState = (() => {
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey));
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  })();
  let layout;
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

  const isMobile = () => window.innerWidth < 1024;

  const saveState = ({ preservePosition = false } = {}) => {
    if (!preservePosition) {
      savedPosition = serializePetPosition(catPosition, window.innerWidth, window.innerHeight)
        || savedPosition;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({
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
    !motionPreference.matches
    && !dragState
    && !document.hidden
    && (interactionMode === 'butterfly' || interactionMode === 'cursor')
  );

  const getSleepPosition = () => {
    const selector = getSleepAnchorSelector(isMobile());
    const progressRect = document.querySelector(selector)?.getBoundingClientRect();
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

  const updateModePresentation = () => {
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
  };

  const applyLayout = () => {
    const currentPosition = catPosition
      ? serializePetPosition(catPosition, window.innerWidth, window.innerHeight)
      : savedPosition;
    stopAnimation();
    layout = getPetLayout(window.innerWidth, window.innerHeight, motionPreference.matches);
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
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      applyLayout();
    });
  };

  const syncVisibility = () => {
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
    }
    if (elements.cat.hasPointerCapture?.(event.pointerId)) {
      elements.cat.releasePointerCapture(event.pointerId);
    }
    elements.cat.classList.remove('is-dragging');
    dragState = null;
    updateModePresentation();
    if (canAnimate()) {
      startAnimation();
    } else {
      setSprite(interactionMode === 'sleep' || interactionMode === 'rest' ? 'sleeping' : 'idle', 0);
      render(performance.now());
    }
  };

  elements.cat.addEventListener('pointerdown', event => {
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
  });

  elements.cat.addEventListener('pointermove', event => {
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

  elements.cat.addEventListener('pointerup', finishDrag);
  elements.cat.addEventListener('pointercancel', finishDrag);

  elements.cat.addEventListener('click', event => {
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

  elements.cat.addEventListener('dblclick', event => {
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    toggleSleep();
  });

  elements.butterfly.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    relocateButterfly();
  });

  document.addEventListener('pointermove', event => {
    if (interactionMode !== 'cursor' || dragState) return;
    cursorTarget = clampPoint({ x: event.clientX, y: event.clientY }, layout.bounds);
    if (canAnimate()) startAnimation();
  }, { passive: true });

  window.addEventListener('resize', scheduleLayout, { passive: true });
  document.addEventListener('visibilitychange', syncVisibility);
  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', applyLayout);
  } else {
    motionPreference.addListener(applyLayout);
  }

  applyLayout();
  return elements.layer;
}


if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnekoButterfly, { once: true });
  } else {
    initOnekoButterfly();
  }
}
