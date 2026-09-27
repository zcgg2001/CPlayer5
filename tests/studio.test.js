import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../js/lucide-bridge.js', import.meta.url), 'utf8');

function loadBridge(globals = {}) {
  const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} }, ...globals });
  vm.runInContext(bridge, context);
  return context;
}

test('every legacy icon maps to the bundled Lucide library', () => {
  const context = loadBridge();
  vm.runInContext(readFileSync(new URL('../js/lucide.min.js', import.meta.url), 'utf8'), context);
  assert.equal(vm.runInContext('Object.values(FA_TO_LUCIDE).every(name => Boolean(lucide.icons[name]))', context), true);
});

test('presentation text removes emoji sequences while preserving copyright and music content', () => {
  const { stripInterfaceEmoji } = loadBridge();
  assert.equal(stripInterfaceEmoji('Song \u{1F3B5} \u{1F469}\u200D\u{1F4BB} \u{1F1E8}\u{1F1F3} 1\uFE0F\u20E3'), 'Song    ');
  assert.equal(stripInterfaceEmoji('2026 \u00a9\uFE0F Artist \u00ae \u2122 100%'), '2026 \u00a9 Artist \u00ae \u2122 100%');
  assert.equal(stripInterfaceEmoji('歌词 / 01:24 <Music>'), '歌词 / 01:24 <Music>');
});

test('mutation batches arriving in the same frame are all retained', () => {
  let callback;
  const frames = [];
  const icons = [];
  const cleaned = [];
  class Element {}
  const body = new Element();
  const context = loadBridge({
    HTMLElement: Element,
    Node: { TEXT_NODE: 3 },
    requestAnimationFrame: fn => frames.push(fn),
    MutationObserver: class { constructor(fn) { callback = fn; } observe() {} },
    window: {},
  });
  context.document.body = body;
  context.refreshLucideIcons = node => icons.push(node);
  context.cleanInterfaceText = node => cleaned.push(node);
  context.startLucideBridge();
  icons.length = 0;
  cleaned.length = 0;
  const first = Object.assign(new Element(), { isConnected: true });
  const second = Object.assign(new Element(), { isConnected: true });
  callback([{ type: 'childList', addedNodes: [first] }]);
  callback([{ type: 'attributes', target: second }]);
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(icons, [first, second]);
  assert.deepEqual(cleaned, [first, second]);
});

test('all pages load the final studio stylesheet and no Font Awesome runtime', () => {
  for (const name of ['index.html', 'playlist-downloader.html', 'offline.html']) {
    const page = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.match(page, /css\/studio\.css\?v=/);
    assert.doesNotMatch(page, /href="css\/all\.min\.css/);
  }
  const css = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /letter-spacing: 0 !important/);
  assert.doesNotMatch(css, /font-size:\s*[^;]*(?:vw|clamp)/);
  assert.doesNotMatch(css, /\.anime-progress-thumb__image\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /\.anime-progress-thumb__motion::before/);
  assert.match(css, /\.app-brand-copy strong\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(css, /\.playback-quality-trigger:disabled > i\s*\{[^}]*display:\s*none;/);
});

test('desktop player actions use the selected Lucide glyphs', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const icon of ['AudioWaveform', 'ChevronUp', 'ListMusic', 'ArrowUpRight', 'ArrowDownToLine']) {
    assert.match(page, new RegExp(`data-lucide="${icon}"`));
  }
  assert.match(page, /actionIcon\.dataset\.lucide = 'Plus';/);
});

test('Bilibili cards and quality controls share the liquid glass material', () => {
  const css = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');
  assert.match(css, /\.bilibili-discovery \.discovery-song-row\s*\{[^}]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(css, /\.discovery-song-secondary-actions\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /#playbackQualityDialog \.liquid-choice-card[^}]*backdrop-filter:\s*blur\(28px\)/);
  assert.match(css, /\.liquid-quality-option\[aria-selected="true"\][^}]*var\(--studio-glass-edge\)/);
});

test('playback quality dialog exposes a visible labeled close button', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(
    page,
    /<button id="playbackQualityCancel"[^>]*aria-label="关闭播放音质窗口"[^>]*>[\s\S]*?<span>关闭<\/span>[\s\S]*?<\/button>/,
  );

  const shellCss = readFileSync(new URL('../css/app-shell.css', import.meta.url), 'utf8');
  assert.match(shellCss, /#playbackQualityCancel\s*\{[\s\S]*?min-width:\s*76px;/);
});
