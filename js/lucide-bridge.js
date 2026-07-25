const FA_TO_LUCIDE = Object.freeze({
  'fa-arrow-right': 'ArrowRight',
  'fa-backward': 'Rewind',
  'fa-bolt': 'Zap',
  'fa-broadcast-tower': 'RadioTower',
  'fa-caret-down': 'ChevronDown',
  'fa-caret-up': 'ChevronUp',
  'fa-chart-line': 'ChartNoAxesCombined',
  'fa-check': 'Check',
  'fa-check-circle': 'CircleCheck',
  'fa-chevron-down': 'ChevronDown',
  'fa-chevron-left': 'ChevronLeft',
  'fa-chevron-right': 'ChevronRight',
  'fa-chevron-up': 'ChevronUp',
  'fa-circle-notch': 'LoaderCircle',
  'fa-clock': 'Clock3',
  'fa-cloud': 'Cloud',
  'fa-cloud-download-alt': 'CloudDownload',
  'fa-cog': 'Settings',
  'fa-compact-disc': 'Disc3',
  'fa-compass': 'Compass',
  'fa-compress': 'Minimize',
  'fa-database': 'Database',
  'fa-download': 'Download',
  'fa-exclamation-circle': 'CircleAlert',
  'fa-expand': 'Expand',
  'fa-external-link-alt': 'ExternalLink',
  'fa-eye': 'Eye',
  'fa-eye-slash': 'EyeOff',
  'fa-feather-alt': 'Feather',
  'fa-file-alt': 'FileText',
  'fa-file-code': 'FileCode2',
  'fa-file-download': 'FileDown',
  'fa-file-import': 'FileInput',
  'fa-film': 'Film',
  'fa-fire': 'Flame',
  'fa-forward': 'FastForward',
  'fa-hdd': 'HardDrive',
  'fa-headphones': 'Headphones',
  'fa-info-circle': 'Info',
  'fa-list-ol': 'ListOrdered',
  'fa-list-ul': 'ListMusic',
  'fa-microphone-alt': 'Mic2',
  'fa-moon': 'Moon',
  'fa-music': 'Music2',
  'fa-paper-plane': 'Send',
  'fa-pause': 'Pause',
  'fa-pen-nib': 'PenTool',
  'fa-play': 'Play',
  'fa-plus': 'Plus',
  'fa-random': 'Shuffle',
  'fa-repeat': 'Repeat2',
  'fa-search': 'Search',
  'fa-seedling': 'Sprout',
  'fa-signal': 'Signal',
  'fa-sliders-h': 'SlidersHorizontal',
  'fa-spinner': 'LoaderCircle',
  'fa-star': 'Star',
  'fa-step-backward': 'SkipBack',
  'fa-step-forward': 'SkipForward',
  'fa-sun': 'Sun',
  'fa-sync-alt': 'RefreshCw',
  'fa-th-large': 'Grid2X2',
  'fa-times': 'X',
  'fa-times-circle': 'CircleX',
  'fa-user': 'UserRound',
  'fa-user-friends': 'UsersRound',
  'fa-user-slash': 'UserRoundX',
  'fa-video': 'Video',
  'fa-video-slash': 'VideoOff',
  'fa-volume-down': 'Volume1',
  'fa-volume-mute': 'VolumeX',
  'fa-volume-up': 'Volume2',
});

function findMappedIcon(element) {
  for (const className of element.classList) {
    if (FA_TO_LUCIDE[className]) {
      return FA_TO_LUCIDE[className];
    }
  }
  return '';
}

function renderLucideIcon(element) {
  if (!(element instanceof HTMLElement) || element.tagName !== 'I') return;

  const iconName = findMappedIcon(element);
  const iconNode = window.lucide?.icons?.[iconName];
  if (!iconName || !iconNode) return;
  if (element.dataset.lucideRendered === iconName && element.firstElementChild?.tagName === 'svg') return;

  const svg = window.lucide.createElement(iconNode, {
    class: 'lucide-glyph',
    'aria-hidden': 'true',
    focusable: 'false',
    'stroke-width': '1.8',
  });

  element.replaceChildren(svg);
  element.dataset.lucideRendered = iconName;
}

function refreshLucideIcons(root = document) {
  if (!window.lucide?.createElement) return;

  if (root instanceof HTMLElement && root.matches('i[class*="fa-"]')) {
    renderLucideIcon(root);
  }

  root.querySelectorAll?.('i[class*="fa-"]').forEach(renderLucideIcon);
}

function startLucideBridge() {
  refreshLucideIcons();

  let queued = false;
  const observer = new MutationObserver((mutations) => {
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
      queued = false;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          renderLucideIcon(mutation.target);
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) refreshLucideIcons(node);
        });
      }
    });
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  window.CPlayerLucide = Object.freeze({ refresh: refreshLucideIcons });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLucideBridge, { once: true });
} else {
  startLucideBridge();
}
