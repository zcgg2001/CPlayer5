# Desktop App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a content-first desktop web shell for CPlayer5 while preserving its single Vanilla JavaScript playback engine, mobile UI, immersive lyrics player, PWA, and MIT licensing boundary.

**Architecture:** Add a scoped desktop shell around the preserved immersive player. Move the existing unique desktop metadata and playback controls into a persistent bottom bar, keep the queue/search implementation single-instance, and use a small dependency-free shell module only for finite presentation state, history, focus, and immersive visibility.

**Tech Stack:** HTML5, scoped CSS, Vanilla JavaScript ES modules, Python `unittest`, Node.js built-in test runner, Service Worker.

## Global Constraints

- Keep MIT + Vanilla JavaScript + no-build architecture.
- Do not copy SPlayer/HE-Music AGPL source, CSS, icons, branding, or assets.
- Add no runtime dependency and no second `Audio`, queue, search implementation, router, store, or event bus.
- Enable the desktop shell at `min-width: 1024px`; preserve the current mobile/tablet layout below `1024px`.
- Preserve every existing DOM ID and prohibit duplicate IDs.
- Preserve `#progressBar` under `.progress-bar-container > .progress-track`.
- Preserve `#albumArt` inside `#albumArtWrapper`, `#lyricsScroller`, hidden `.lyrics-container`, the queue virtual list, and the first `.upload-container > #playlistFile`.
- Keep `#floatingPlaylistPanel.translate-x-full` as the closed queue state.
- Keep the main content as the only primary vertical scroll region.
- Use a light browsing shell and the existing dark purple bottom/immersive surfaces.
- Apply test-first RED/GREEN cycles for every behavior change.

---

### Task 1: Lock Existing DOM And PWA Contracts

**Files:**
- Create: `tests/test_dom_contract.py`
- Create: `tests/test_pwa_contract.py`

**Interfaces:**
- Consumes: current `index.html`, `manifest.json`, and `sw.js` contracts.
- Produces: regression guards that allow new IDs but prevent removal, duplication, or PWA loss.

- [ ] **Step 1: Add the current DOM contract tests**

```python
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "index.html").read_text(encoding="utf-8")

REQUIRED_IDS = {
    "desktopLayout", "mobileLayout", "settingsBtn", "fullscreenBtn",
    "audioVisualizer", "albumArtWrapper", "albumArt",
    "desktopLoaderOverlay", "songTitle", "artistName", "sourceTag",
    "songIdTag", "qualityBadge", "currentTime", "totalTime",
    "progressBar", "playModeBtn", "prevBtn", "playPauseBtn",
    "nextBtn", "volumeBtn", "volumePopover", "volumeSlider",
    "togglePlaylistBtn", "floatingPlaylistPanel", "desktopTabPlaylist",
    "desktopTabSearch", "playlistCount", "playlistFile",
    "desktopContentPlaylist", "playlistContainer", "playlistContent",
    "playlistLoader", "desktopContentSearch", "searchInput",
    "searchButton", "searchResults", "floatingSearchPanel",
    "toggleSearchBtn", "lyricsScroller",
}


class DomContractTests(unittest.TestCase):
    def test_required_legacy_ids_remain(self):
        actual = set(re.findall(r'\bid="([^"]+)"', SOURCE))
        self.assertEqual(REQUIRED_IDS - actual, set())

    def test_index_has_no_duplicate_ids(self):
        ids = re.findall(r'\bid="([^"]+)"', SOURCE)
        duplicates = sorted({element_id for element_id in ids if ids.count(element_id) > 1})
        self.assertEqual(duplicates, [])

    def test_progress_and_virtual_list_ancestry_remain(self):
        self.assertRegex(
            SOURCE,
            r'(?s)progress-bar-container[^>]*>\s*<div[^>]*progress-track[^>]*>\s*<div id="progressBar"',
        )
        self.assertRegex(
            SOURCE,
            r'(?s)id="playlistContainer"[^>]*>.*id="playlistContent".*id="playlistLoader"',
        )

    def test_hidden_legacy_lyrics_container_remains(self):
        self.assertRegex(SOURCE, r'class="[^"]*lyrics-container[^"]*hidden[^"]*"')
```

- [ ] **Step 2: Add the PWA contract tests**

```python
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PwaContractTests(unittest.TestCase):
    def test_manifest_and_service_worker_contract_remain(self):
        index_source = (ROOT / "index.html").read_text(encoding="utf-8")
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

        self.assertIn('<link rel="manifest" href="manifest.json">', index_source)
        self.assertIn("navigator.serviceWorker.register('./sw.js')", index_source)
        self.assertEqual(manifest.get("start_url"), "./index.html")
        self.assertEqual(manifest.get("scope"), "./")
        self.assertEqual(manifest.get("display"), "standalone")
        for icon in manifest.get("icons", []):
            self.assertTrue((ROOT / icon["src"].removeprefix("./")).is_file())
```

- [ ] **Step 3: Run the characterization tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_dom_contract tests.test_pwa_contract -v
```

Expected: PASS against the unchanged baseline. These are characterization guards, not feature RED tests.

- [ ] **Step 4: Commit the guards**

```bash
git add tests/test_dom_contract.py tests/test_pwa_contract.py
git commit -m "test: lock desktop player contracts"
```

---

### Task 2: Add The Tested Shell State Module

**Files:**
- Create: `tests/app-shell.test.js`
- Create: `js/app-shell.js`

**Interfaces:**
- Produces: `DESKTOP_SHELL_MEDIA`, `initialShellState()`, `createShellHistory()`, `progressPercent()`, `setImmersiveState()`, and `initAppShell()`.
- Consumes: presentation callbacks injected by `index.html`; it never accesses audio or playlist globals.

- [ ] **Step 1: Write failing shell state tests**

```js
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
```

- [ ] **Step 2: Run the focused Node test and verify RED**

Run: `node --test tests/app-shell.test.js`

Expected: FAIL because `js/app-shell.js` does not exist.

- [ ] **Step 3: Implement the minimal dependency-free state module**

```js
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

export function setImmersiveState({ shell, immersive, opener, closeButton }, open) {
  if (!shell || !immersive || !opener) return;
  shell.inert = open;
  immersive.classList.toggle('is-open', open);
  immersive.setAttribute('aria-hidden', String(!open));
  opener.setAttribute('aria-expanded', String(open));
  if (open) closeButton?.focus();
  else opener.focus();
}
```

Add `initAppShell()` in the same file with this explicit, testable interface:

```js
export function initAppShell({ elements, actions = {}, onImmersiveChange = () => {} }) {
  const history = createShellHistory('library');
  const cleanups = [];

  const listen = (element, type, handler) => {
    if (!element) return;
    element.addEventListener(type, handler);
    cleanups.push(() => element.removeEventListener(type, handler));
  };

  const updateHistoryButtons = () => {
    if (elements.backButton) elements.backButton.disabled = !history.canBack();
    if (elements.forwardButton) elements.forwardButton.disabled = !history.canForward();
  };

  const applyDestination = (destination, { record = true } = {}) => {
    if (record) history.push(destination);
    const immersiveOpen = destination === 'now-playing';
    setImmersiveState(elements, immersiveOpen);
    elements.documentElement?.classList.toggle('desktop-immersive-open', immersiveOpen);
    elements.destinationButtons?.forEach(button => {
      const active = button.dataset.shellDestination === destination;
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (!immersiveOpen) actions[destination]?.();
    onImmersiveChange(immersiveOpen);
    updateHistoryButtons();
    return destination;
  };

  elements.destinationButtons?.forEach(button => {
    listen(button, 'click', () => applyDestination(button.dataset.shellDestination));
  });
  listen(elements.opener, 'click', () => applyDestination('now-playing'));
  listen(elements.closeButton, 'click', () => applyDestination('library'));
  listen(elements.backButton, 'click', () => applyDestination(history.back(), { record: false }));
  listen(elements.forwardButton, 'click', () => applyDestination(history.forward(), { record: false }));
  listen(elements.eventTarget, 'keydown', event => {
    if (event.key === 'Escape' && elements.immersive?.getAttribute('aria-hidden') === 'false') {
      event.preventDefault();
      applyDestination('library');
    }
  });
  updateHistoryButtons();

  return {
    navigate: applyDestination,
    back: () => applyDestination(history.back(), { record: false }),
    forward: () => applyDestination(history.forward(), { record: false }),
    setImmersive: open => applyDestination(open ? 'now-playing' : 'library'),
    destroy: () => cleanups.splice(0).forEach(cleanup => cleanup()),
  };
}
```

- [ ] **Step 4: Verify GREEN and the full Node suite**

Run:

```bash
node --test tests/app-shell.test.js
node --test tests/*.test.js
```

Expected: focused tests pass; all existing Node tests remain green.

- [ ] **Step 5: Commit the module**

```bash
git add js/app-shell.js tests/app-shell.test.js
git commit -m "feat: add desktop shell state controller"
```

---

### Task 3: Build The Content-First Desktop Markup And Scoped Styles

**Files:**
- Create: `tests/test_desktop_shell_markup.py`
- Create: `css/app-shell.css`
- Modify: `index.html:970-1220`

**Interfaces:**
- Consumes: all legacy desktop control IDs and ancestry contracts.
- Produces: `#desktopApp`, `#desktopShell`, `#desktopLibraryView`, `#desktopPlayerBar`, `#desktopMiniPlayer`, and `#desktopImmersiveClose`.

- [ ] **Step 1: Write failing desktop-shell markup tests**

```python
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarkupParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.by_id = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.by_id[values["id"]] = {"tag": tag, **values}


class DesktopShellMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.css = (ROOT / "css/app-shell.css").read_text(encoding="utf-8")
        cls.markup = MarkupParser()
        cls.markup.feed(cls.source)

    def test_shell_assets_and_1024_breakpoint_exist(self):
        self.assertIn('href="./css/app-shell.css"', self.source)
        self.assertIn("@media (min-width: 1024px)", self.css)
        self.assertIn("@media (max-width: 1023.98px)", self.css)
        self.assertIn("grid-template-columns: 240px minmax(0, 1fr)", self.css)
        self.assertIn("grid-template-rows: 70px minmax(0, 1fr) minmax(80px, auto)", self.css)

    def test_real_desktop_shell_surfaces_exist(self):
        for element_id in (
            "desktopApp", "desktopShell", "desktopLibraryView",
            "desktopPlayerBar", "desktopMiniPlayer", "desktopImmersiveClose",
        ):
            self.assertIn(element_id, self.markup.by_id)

        opener = self.markup.by_id["desktopMiniPlayer"]
        self.assertEqual(opener["tag"], "button")
        self.assertEqual(opener.get("aria-controls"), "desktopLayout")
        self.assertEqual(opener.get("aria-expanded"), "false")

    def test_library_is_default_and_navigation_has_no_placeholders(self):
        library = self.markup.by_id["desktopNavLibrary"]
        self.assertEqual(library.get("aria-current"), "page")
        self.assertEqual(library.get("data-shell-destination"), "library")
        self.assertNotRegex(self.source, r'data-shell-destination="(?:ranking|artists|video|radio)"')
        self.assertNotIn('aria-disabled="true"', self.source)

    def test_mobile_layout_no_longer_disappears_at_768(self):
        classes = self.markup.by_id["mobileLayout"].get("class", "")
        self.assertNotIn("md:hidden", classes.split())

    def test_immersive_player_is_preserved_and_initially_closed(self):
        immersive = self.markup.by_id["desktopLayout"]
        self.assertEqual(immersive.get("aria-hidden"), "true")
        self.assertIn("#desktopLayout.is-open", self.css)

    def test_progress_track_and_queue_drawer_contracts_remain(self):
        self.assertRegex(
            self.source,
            r'(?s)progress-bar-container[^>]*>\s*<div[^>]*progress-track[^>]*>\s*<div id="progressBar"',
        )
        drawer_classes = self.markup.by_id["floatingPlaylistPanel"].get("class", "")
        self.assertIn("translate-x-full", drawer_classes.split())
```

- [ ] **Step 2: Run the markup test and verify RED**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_desktop_shell_markup -v`

Expected: FAIL because the new asset, shell IDs, 1024px breakpoint, and semantics do not exist.

- [ ] **Step 3: Add the scoped stylesheet**

Create `css/app-shell.css` with these required boundaries:

```css
#desktopApp {
  --shell-bg: #f6f6f8;
  --shell-surface: #ffffff;
  --shell-text: #202124;
  --shell-muted: #686d76;
  --shell-border: #e2e3e8;
  --shell-active: #eceafa;
  --shell-accent: #6657d9;
  display: none;
}

@media (min-width: 1024px) {
  #desktopApp { display: grid; min-height: 100dvh; }
  #desktopShell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: 70px minmax(0, 1fr) minmax(80px, auto);
    min-height: 100dvh;
    color: var(--shell-text);
    background: var(--shell-bg);
  }
  #mobileLayout { display: none !important; }
}

@media (max-width: 1023.98px) {
  #desktopApp { display: none !important; }
  #mobileLayout { display: flex !important; }
}
```

Add these explicit scoped rules after the breakpoint skeleton:

```css
#desktopShell { grid-template-areas: "sidebar topbar" "sidebar main" "player player"; }
#desktopShell .app-sidebar { grid-area: sidebar; border-right: 1px solid var(--shell-border); background: var(--shell-surface); }
#desktopShell .app-topbar { grid-area: topbar; border-bottom: 1px solid var(--shell-border); background: var(--shell-surface); }
#desktopLibraryView { grid-area: main; min-width: 0; overflow-y: auto; padding: 24px; }
#desktopPlayerBar { grid-area: player; min-height: 80px; padding-bottom: env(safe-area-inset-bottom); color: #fff; background: rgba(40, 24, 59, 0.97); }
#desktopLayout { position: fixed; inset: 0 0 80px; opacity: 0; visibility: hidden; pointer-events: none; }
#desktopLayout.is-open { opacity: 1; visibility: visible; pointer-events: auto; }
#floatingPlaylistPanel { top: 70px; bottom: 80px; height: auto; width: min(400px, 92vw); }
#desktopShell button, #desktopShell a { min-width: 44px; min-height: 44px; }
#desktopShell :focus-visible, #desktopLayout :focus-visible { outline: 3px solid var(--shell-accent); outline-offset: 2px; }
@media (max-height: 650px) and (min-width: 1024px) { #desktopPlayerBar { min-height: 72px; } }
@media (prefers-reduced-motion: reduce) { #desktopApp *, #desktopApp *::before, #desktopApp *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
```

- [ ] **Step 4: Replace the desktop markup without duplicating IDs**

Wrap the new desktop structure in `#desktopApp`. Move the existing unique metadata and control nodes into `#desktopPlayerBar`; keep the exact progress ancestry. Keep the original cover, loader, visualizer, lyrics scroller, and hidden lyrics fallback inside `#desktopLayout` as the immersive layer. Keep the virtual playlist inside `#floatingPlaylistPanel`.

Add these real shell controls:

```html
<button id="desktopNavLibrary" data-shell-destination="library" aria-current="page">音乐库</button>
<button id="desktopImmersiveToggle" data-shell-destination="now-playing"
        aria-controls="desktopLayout" aria-expanded="false">正在播放</button>
<button id="togglePlaylistBtn" data-shell-destination="queue">播放队列</button>
<button id="desktopImportBtn" data-shell-destination="import">本地导入</button>
<a href="./playlist-downloader.html">歌单工具</a>
<button id="settingsBtn" data-shell-destination="settings" aria-label="打开设置">设置</button>
```

The mini-player metadata opener is a separate button so playback controls are not nested inside another button:

```html
<button id="desktopMiniPlayer" aria-controls="desktopLayout" aria-expanded="false">
  <img id="desktopMiniCover" alt="" width="48" height="48">
  <span><span id="songTitle">CPlayer 5</span><span id="artistName">ChKSz</span></span>
</button>
```

- [ ] **Step 5: Verify markup GREEN and all Python tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_desktop_shell_markup -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
python3 scripts/check_static_site.py
```

Expected: shell markup tests and all existing Python tests pass; static assets resolve.

- [ ] **Step 6: Commit the shell markup and styles**

```bash
git add index.html css/app-shell.css tests/test_desktop_shell_markup.py
git commit -m "feat: add content-first desktop shell"
```

---

### Task 4: Integrate Shell Behavior, Focus, Breakpoints, And Rendering Policy

**Files:**
- Modify: `index.html:1580-5248`
- Modify: `js/app-shell.js`
- Modify: `js/oneko-butterfly.js`
- Modify: `tests/app-shell.test.js`
- Modify: `tests/test_accessibility_markup.py`
- Modify: `tests/test_startup_behavior.py`

**Interfaces:**
- Consumes: existing `togglePlaylistPanel`, `switchDesktopTab`, `openSettings`, playback controls, cover restoration, song loading, `MobileUIManager`, and continuous renderers.
- Produces: initialized shell navigation, immersive open/close, 1024px-consistent mobile behavior, explicit mini-cover synchronization, keyboard seek, and paused desktop browsing animation.

- [ ] **Step 1: Extend tests for shell initialization and accessibility**

Extend the fake element helper with event support:

```js
function clickableElement(dataset = {}) {
  const element = fakeElement();
  const listeners = new Map();
  element.dataset = dataset;
  element.disabled = false;
  element.addEventListener = (type, handler) => listeners.set(type, handler);
  element.removeEventListener = (type, handler) => {
    if (listeners.get(type) === handler) listeners.delete(type);
  };
  element.click = () => listeners.get('click')?.({ preventDefault() {} });
  element.keydown = key => listeners.get('keydown')?.({ key, preventDefault() {} });
  element.removeAttribute = name => element.setAttribute(name, '');
  return element;
}
```

Add exact initialization tests:

```js
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
      shell, immersive, opener, closeButton, backButton, forwardButton,
      destinationButtons: [queueButton], eventTarget,
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
```

Add Python assertions that:

- `desktopMiniPlayer`, `desktopImmersiveClose`, `desktopBackBtn`, `desktopForwardBtn`, and `desktopImportBtn` have accessible names;
- `desktopShell` has a skip-link target;
- `.progress-bar-container` has `role="slider"`, `tabindex="0"`, and ARIA value attributes;
- the source uses `DESKTOP_SHELL_MEDIA` instead of new `768px` shell decisions.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/app-shell.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_accessibility_markup tests.test_startup_behavior -v
```

Expected: FAIL because shell initialization, keyboard slider semantics, and unified breakpoint behavior are not wired.

- [ ] **Step 3: Import and initialize the shell module**

At the top of the inline module:

```js
import { DESKTOP_SHELL_MEDIA, initAppShell } from './js/app-shell.js';
```

Inside the main `DOMContentLoaded` initialization, create the controller after `dom` is populated and before event binding completes:

```js
desktopShell = initAppShell({
  documentRef: document,
  actions: {
    queue: () => {
      switchDesktopTab('playlist');
      togglePlaylistPanel(true);
    },
    search: () => {
      togglePlaylistPanel(false);
      document.getElementById('searchInput')?.focus();
    },
    import: () => document.getElementById('playlistFile')?.click(),
    settings: openSettings,
  },
  onImmersiveChange: syncContinuousRendering,
});
```

Use guarded bindings so legacy initialization still degrades safely if an optional shell node is missing.

- [ ] **Step 4: Synchronize the mini cover explicitly**

Keep existing cover assignments and append:

```js
if (dom.desktopMiniCover) dom.desktopMiniCover.src = savedCover;
```

and after the normalized song cover is assigned:

```js
if (dom.desktopMiniCover) dom.desktopMiniCover.src = picUrl;
```

Do not add polling or a MutationObserver.

- [ ] **Step 5: Add keyboard seek without changing progress ancestry**

Add `role="slider"`, `tabindex="0"`, `aria-valuemin="0"`, `aria-valuemax="100"`, and `aria-valuenow="0"` to `.progress-bar-container`. Bind ArrowLeft/ArrowRight to seek by five seconds and Home/End to the start/end. Update `aria-valuenow` from the existing progress update function.

- [ ] **Step 6: Unify the shell breakpoint**

Replace shell/mobile decisions with:

```js
const desktopShellMedia = window.matchMedia(DESKTOP_SHELL_MEDIA);
const isCompactLayout = () => !desktopShellMedia.matches;
```

Use the same `1024px` boundary in `MobileUIManager`, mobile settings visibility, and the oneko layout helper. Preserve smaller `768px` typography-only media queries where they do not decide which application layout is active.

- [ ] **Step 7: Pause continuous desktop rendering outside immersive mode**

Update the continuous-animation predicate so desktop browsing does not run FluidBackground or lyrics canvas loops:

```js
function shouldAnimateContinuously() {
  const desktopBrowsing = desktopShellMedia.matches
    && !document.documentElement.classList.contains('desktop-immersive-open');
  return !document.hidden && !motionPreference.matches && !desktopBrowsing;
}
```

Call `syncContinuousRendering()` whenever immersive state or the media query changes.

- [ ] **Step 8: Verify focused and full tests**

Run:

```bash
node --test tests/app-shell.test.js tests/oneko-butterfly.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_accessibility_markup tests.test_startup_behavior -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
node --test tests/*.test.js
```

Expected: all behavior, accessibility, breakpoint, pet-layout, Python, and Node tests pass.

- [ ] **Step 9: Commit behavior integration**

```bash
git add index.html js/app-shell.js js/oneko-butterfly.js tests/app-shell.test.js tests/test_accessibility_markup.py tests/test_startup_behavior.py
git commit -m "feat: integrate desktop shell behavior"
```

---

### Task 5: Validate Shell Targets And Upgrade Offline Assets

**Files:**
- Modify: `tests/test_check_static_site.py`
- Modify: `scripts/check_static_site.py`
- Modify: `tests/service-worker.test.js`
- Modify: `sw.js`

**Interfaces:**
- Produces: duplicate-ID and shell-target validation, `cplayer5-shell-v8`, and offline shell assets.

- [ ] **Step 1: Write failing static-validator tests**

```python
def test_reports_duplicate_dom_ids(self):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "index.html").write_text(
            '<div id="player"></div><button id="player"></button>',
            encoding="utf-8",
        )
        self.assertEqual(validate_site(root), ["index.html: duplicate id player"])

def test_reports_shell_entry_targeting_missing_content(self):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "index.html").write_text(
            '<button data-shell-destination="library" aria-controls="missing"></button>',
            encoding="utf-8",
        )
        self.assertEqual(
            validate_site(root),
            ["index.html: shell destination library targets missing id missing"],
        )
```

Add a green counterpart with a real `id="library"` target.

- [ ] **Step 2: Write the failing Service Worker tests**

```js
test('precaches the desktop shell assets', () => {
  const context = loadServiceWorker();
  const coreAssets = vm.runInContext('CORE_ASSETS', context);
  assert.ok(coreAssets.includes('./css/app-shell.css'));
  assert.ok(coreAssets.includes('./js/app-shell.js'));
});

test('retires the v7 shell cache after the desktop shell upgrade', () => {
  const { cacheNamesToDelete } = loadServiceWorker();
  assert.deepEqual(
    Array.from(cacheNamesToDelete(['cplayer5-shell-v7', 'cplayer5-shell-v8'])),
    ['cplayer5-shell-v7'],
  );
});
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_check_static_site -v
node --test tests/service-worker.test.js
```

Expected: validator and shell precache assertions fail.

- [ ] **Step 4: Enhance validation and bump the shell cache**

Extend `LocalAssetParser` with exact ID and destination collection:

```python
class LocalAssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []
        self.ids = []
        self.shell_targets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        element_id = attributes.get("id")
        if element_id:
            self.ids.append(element_id)
        destination = attributes.get("data-shell-destination")
        if destination and attributes.get("aria-controls"):
            self.shell_targets.append((destination, attributes["aria-controls"]))
        attribute = {"img": "src", "script": "src", "link": "href"}.get(tag)
        if attribute and attributes.get(attribute):
            self.assets.append(attributes[attribute])
```

After parsing each HTML document, append sorted errors:

```python
for element_id in sorted({value for value in parser.ids if parser.ids.count(value) > 1}):
    errors.append(f"{html_file.name}: duplicate id {element_id}")
known_ids = set(parser.ids)
for destination, target in parser.shell_targets:
    if target not in known_ids:
        errors.append(
            f"{html_file.name}: shell destination {destination} targets missing id {target}"
        )
```

Then update `sw.js`:

```js
const SHELL_CACHE = 'cplayer5-shell-v8';
```

and add:

```js
'./css/app-shell.css',
'./js/app-shell.js',
```

to `CORE_ASSETS`.

- [ ] **Step 5: Verify GREEN and static integrity**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.test_check_static_site -v
node --test tests/service-worker.test.js
python3 scripts/check_static_site.py
git diff --check
```

Expected: focused tests pass, static-site validation succeeds, and the diff has no whitespace errors.

- [ ] **Step 6: Commit offline and validation changes**

```bash
git add scripts/check_static_site.py tests/test_check_static_site.py sw.js tests/service-worker.test.js
git commit -m "feat: validate and precache desktop shell"
```

---

### Task 6: Full Verification And Browser QA

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: Run all automated verification from a clean process**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
node --test tests/*.test.js
python3 scripts/check_static_site.py
git diff --check
git status --short
```

Expected: all Python and Node tests pass, static checks pass, no whitespace errors, and only intentional changes are present.

- [ ] **Step 2: Serve the worktree locally**

Run: `python3 -m http.server 8080`

Verify HTTP 200 for `/`, `/css/app-shell.css`, `/js/app-shell.js`, `/sw.js`, and `/playlist-downloader.html`.

- [ ] **Step 3: Browser-check desktop breakpoints**

Inspect `1024×600`, `1366×768`, `1440×900`, and `1920×1080`:

- sidebar/topbar/player use `240/70/80` geometry;
- the library is the only main scroll surface;
- search, queue, import, tools, settings, fullscreen, playback, volume, and seek work;
- the queue drawer does not cover the bottom player;
- immersive open/close, Escape, focus restoration, cover, and centered lyrics work;
- browsing mode pauses the fluid background;
- console has no new errors.

- [ ] **Step 4: Browser-check the compact boundary**

Inspect `375×812`, `768×1024`, `1023×768`, then cross `1023 ↔ 1024` while playing:

- existing mobile/tablet layout remains usable;
- song, time, queue, and playback continue without reload;
- no blank 768–1023px band exists;
- mobile sheet, settings, pet, and lyrics remain functional.

- [ ] **Step 5: Request code review and address findings**

Dispatch a reviewer against the plan and full branch diff. Fix all Critical and Important findings, add regression tests first for behavioral corrections, and rerun full verification.

- [ ] **Step 6: Commit final verification fixes if needed**

```bash
git add index.html css/app-shell.css js/app-shell.js js/oneko-butterfly.js scripts/check_static_site.py sw.js tests/app-shell.test.js tests/service-worker.test.js tests/test_accessibility_markup.py tests/test_check_static_site.py tests/test_desktop_shell_markup.py tests/test_startup_behavior.py
git commit -m "fix: address desktop shell review"
```

Do not push or merge without explicit user direction.
