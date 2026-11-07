// Directional sprite coordinates are adapted from oneko.js:
// https://github.com/adryd325/oneko.js (MIT License).
export const SPRITE_SETS = {
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
  const mobile = width < 768;
  const size = mobile ? 32 : 64;

  if (mobile) {
    const hitHalf = Math.max(size, 44) / 2;
    const bounds = {
      left: hitHalf,
      right: Math.max(hitHalf, width - hitHalf),
      top: Math.max(hitHalf, height - 228),
      bottom: Math.max(hitHalf, height - 112),
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
    top: Math.min(Math.max(height * 0.56, 280), Math.max(size / 2, height - 144)),
    bottom: Math.max(size / 2, height - 144),
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


