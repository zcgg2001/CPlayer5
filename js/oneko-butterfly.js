// CPlayer adapter: player selectors and settings belong here, not in the pet engine.
import { createDesktopPet, getPetLayout, clampPoint } from './desktop-pet/index.js';
import { bindDesktopPetSettings } from './desktop-pet/settings.js';
export * from './desktop-pet/index.js';

export function getSleepAnchorSelector(isMobile) {
  return isMobile ? '#mobileProgressBarContainer' : '.progress-bar-container';
}

function resolveSleepAnchor({ mobile }) {
  const progress = document.querySelector(getSleepAnchorSelector(mobile))?.getBoundingClientRect();
  const player = document.querySelector(mobile
    ? '.mobile-control-deck' : '#desktopPlayerBar')?.getBoundingClientRect();
  if (player?.width && player?.height) {
    // The whole transport bar is above the pet layer. Sleep above its top edge.
    return { ...(progress?.width ? progress.toJSON() : player.toJSON()), top: player.top };
  }
  return progress;
}

function resolveLayout(width, height, reducedMotion) {
  const layout = getPetLayout(width, height, reducedMotion);
  const controls = document.querySelector(width < 768
    ? '.mobile-control-deck' : '#desktopPlayerBar')?.getBoundingClientRect();
  if (controls?.width && controls?.height) {
    const half = Math.max(layout.size, 44) / 2;
    layout.bounds.bottom = Math.max(half, Math.min(layout.bounds.bottom, controls.top - half - 8));
    layout.bounds.top = Math.max(half, Math.min(layout.bounds.top, layout.bounds.bottom - 72));
    layout.catStart = clampPoint(layout.catStart, layout.bounds);
    layout.butterflyStart = clampPoint(layout.butterflyStart, layout.bounds);
  }
  return layout;
}

export function initOnekoButterfly() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (window.desktopPet) return window.desktopPet;
  const pet = createDesktopPet({
    id: 'onekoPetLayer',
    storageKey: 'cplayer5:oneko',
    resolveLayout,
    resolveSleepAnchor,
  });
  pet.element.querySelector('.oneko-cat').id = 'onekoCat';
  pet.element.querySelector('.oneko-butterfly').id = 'onekoButterfly';
  const unbindSettings = bindDesktopPetSettings(document.getElementById('desktopPetSettings'), pet);
  const syncView = () => {
    pet.setSuspended(Boolean(document.querySelector('[role="dialog"][aria-hidden="false"]:not(#desktopLayout), dialog[open]')));
    pet.refresh();
  };
  const observer = new MutationObserver(syncView);
  const targets = [document.documentElement, document.getElementById('mobileLyricsPage'),
    ...document.querySelectorAll('[role="dialog"], dialog')];
  targets.filter(Boolean).forEach(target => {
    observer.observe(target, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'open'] });
  });
  const resizeObserver = new ResizeObserver(() => pet.refresh());
  document.querySelectorAll('.mobile-control-deck, #desktopPlayerBar').forEach(target => resizeObserver.observe(target));
  const destroy = pet.destroy;
  pet.destroy = () => {
    observer.disconnect();
    resizeObserver.disconnect();
    unbindSettings();
    destroy();
    if (window.desktopPet === pet) window.desktopPet = null;
  };
  window.desktopPet = pet;
  syncView();
  return pet;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnekoButterfly, { once: true });
  } else initOnekoButterfly();
}
