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
  if (element.dataset.lucide) return element.dataset.lucide;
  for (const className of element.classList) {
    if (FA_TO_LUCIDE[className]) {
      return FA_TO_LUCIDE[className];
    }
  }
  return element.matches('i[class*="fa-"]') ? 'Circle' : '';
}

function renderLucideIcon(element) {
  if (!(element instanceof HTMLElement) || element.tagName !== 'I') return;

  const iconName = findMappedIcon(element);
  const iconNode = window.lucide?.icons?.[iconName];
  if (!iconName || !iconNode) return;
  const control = element.closest('button, a');
  if (control?.getAttribute('aria-label') && (!control.title || control.dataset.lucideTooltip === 'true') && !control.textContent.trim()) {
    const title = stripInterfaceEmoji(control.getAttribute('aria-label'));
    if (control.title !== title) control.title = title;
    control.dataset.lucideTooltip = 'true';
  }
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

  if (root instanceof HTMLElement && root.matches('i[class*="fa-"], i[data-lucide]')) {
    renderLucideIcon(root);
  }

  root.querySelectorAll?.('i[class*="fa-"], i[data-lucide]').forEach(renderLucideIcon);
  refreshPlaceholderArt(root);
}

let placeholderArt = '';
function refreshPlaceholderArt(root) {
  const images = root instanceof HTMLImageElement ? [root] : Array.from(root.querySelectorAll?.('img') || []);
  for (const image of images) {
    const src = image.getAttribute('src') || '';
    if (src === placeholderArt) continue;
    const localIcon = /^(?:\.\/)?img\/icon\.(?:png|svg)$/.test(src);
    const defaultRecord = ['albumArt', 'mobileCoverImg'].includes(image.id) && src.startsWith('data:image/svg+xml,');
    if (!localIcon && !defaultRecord) continue;
    if (!placeholderArt) {
      const svg = window.lucide.createElement(window.lucide.icons.Disc3, {
        xmlns: 'http://www.w3.org/2000/svg',
        width: '120', height: '120', stroke: '#bdc6ca', 'stroke-width': '1.2',
        style: 'background:#202426;padding:24px;box-sizing:border-box',
      });
      placeholderArt = `data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}`;
    }
    image.src = placeholderArt;
  }
}

function stripInterfaceEmoji(value) {
  return value.replace(/(?:[0-9#*]\uFE0F?\u20E3|\p{Regional_Indicator}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu,
    match => /^[\u00A9\u00AE\u2122]/u.test(match) ? match[0] : '');
}

function cleanInterfaceText(root) {
  const cleanNode = node => {
    if (node.parentElement?.closest('script, style, textarea, input, pre, code, [contenteditable]')) return;
    const clean = stripInterfaceEmoji(node.nodeValue);
    if (clean !== node.nodeValue) node.nodeValue = clean;
  };
  if (root.nodeType === Node.TEXT_NODE) return cleanNode(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) cleanNode(walker.currentNode);
  const elements = root instanceof HTMLElement ? [root, ...root.querySelectorAll('[aria-label], [title], [placeholder]')] : [];
  elements.forEach(element => {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = element.getAttribute(name);
      if (value && stripInterfaceEmoji(value) !== value) element.setAttribute(name, stripInterfaceEmoji(value));
    }
  });
}

function startLucideBridge() {
  refreshLucideIcons();
  cleanInterfaceText(document.body);

  let queued = false;
  const pendingRoots = new Set();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' || mutation.type === 'characterData') pendingRoots.add(mutation.target);
      else mutation.addedNodes.forEach(node => pendingRoots.add(node));
    }
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
      queued = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      for (const root of roots) {
        if (!root.isConnected) continue;
        if (root instanceof HTMLElement) refreshLucideIcons(root);
        if (root.nodeType === Node.TEXT_NODE || root instanceof HTMLElement) cleanInterfaceText(root);
      }
    });
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'data-lucide', 'aria-label', 'title', 'placeholder', 'src'],
  });

  window.CPlayerLucide = Object.freeze({ refresh: refreshLucideIcons });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startLucideBridge, { once: true });
} else {
  startLucideBridge();
}
