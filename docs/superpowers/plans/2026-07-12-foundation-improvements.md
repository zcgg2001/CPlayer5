# CPlayer5 Foundation Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 CPlayer5 的不可信 HTML 注入、网络与 PWA 可靠性缺陷，并补齐关键无障碍和移动端体验。

**Architecture:** 保持纯静态部署和现有 DOM，不引入框架或打包器。新增可被浏览器直接导入的 `.mjs` 纯函数模块，使用 Node 内置测试验证；Service Worker 保持经典脚本，通过 Node `vm` 测试其纯策略函数。

**Tech Stack:** HTML5、CSS、Vanilla JavaScript ES Modules、Service Worker、Node `node:test`、Python `unittest`、GitHub Actions。

## Global Constraints

- 运行时继续使用 HTML、CSS 和原生 JavaScript。
- 不引入 React、Vue、npm 运行时依赖或构建步骤。
- 保持静态 HTTP 服务器直接运行。
- 不缓存 API 和音频流。
- 不进行完整模块化、字体替换或视觉重设计。
- 每个阶段先测试后实现，并单独提交。

---

### Task 1: Security Regression Guardrails

**Files:**
- Create: `js/security.mjs`
- Create: `tests/security.test.mjs`
- Modify: `tests/test_check_static_site.py`
- Modify: `scripts/check_static_site.py`
- Modify: `.github/workflows/static-site-checks.yml`

**Interfaces:**
- Produces: `normalizeMediaUrl(value, options): string | null`
- Produces: static validation error `index.html: unsafe dynamic innerHTML uses song data`

- [ ] **Step 1: Add failing Python test for dynamic song data in `innerHTML`**

Create a temporary `index.html` containing ``element.innerHTML = `<b>${song.name}</b>` `` and assert `validate_site()` reports it.

- [ ] **Step 2: Run Python test and verify failure**

Run: `python3 -m unittest tests/test_check_static_site.py -v`

Expected: FAIL because unsafe dynamic HTML is not detected.

- [ ] **Step 3: Add static unsafe HTML detection**

Scan HTML source for `innerHTML` template literals containing `${song.name}`, `${song.artist}` or `${song.album}` and append the defined validation error.

- [ ] **Step 4: Add failing Node tests for media URL validation**

Test HTTPS, HTTP-to-HTTPS upgrade, Blob URL, optional `data:image`, rejection of `javascript:`, `data:text/html`, credentials and malformed values.

- [ ] **Step 5: Run Node test and verify module-missing failure**

Run: `node --test tests/security.test.mjs`

Expected: FAIL because `js/security.mjs` does not exist.

- [ ] **Step 6: Implement `normalizeMediaUrl`**

Use `URL`, permit only `https:`, upgraded `http:`, `blob:` and explicitly enabled `data:image/*`; reject URLs containing username or password.

- [ ] **Step 7: Update CI and run tests**

Add `node --test tests/*.test.mjs` to GitHub Actions.

Run:

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 scripts/check_static_site.py
```

- [ ] **Step 8: Commit**

```bash
git add js/security.mjs tests/security.test.mjs tests/test_check_static_site.py scripts/check_static_site.py .github/workflows/static-site-checks.yml
git commit -m "test: add security regression guardrails"
```

### Task 2: Safe Rendering And Native Initialization

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `normalizeMediaUrl` from `js/security.mjs`
- Produces: `createSongTextBlock(song, titleClass, artistClass): HTMLDivElement`
- Produces: guarded `initNativeIntegration(): void`

- [ ] **Step 1: Import `normalizeMediaUrl` in the existing module script**

- [ ] **Step 2: Replace untrusted dynamic HTML**

Use `textContent` for desktop search titles. Build mobile playlist and mobile search rows with DOM nodes so song name and artist are never parsed as HTML.

- [ ] **Step 3: Validate media URLs at every direct sink**

Validate thumbnail cache input, `audio.src`, album art, Media Session artwork and preloaded audio. Use the existing local placeholder when a cover is rejected; throw a user-visible playback error when audio is rejected.

- [ ] **Step 4: Consolidate H5+ initialization**

Replace both `plusready` listeners with one guarded `initNativeIntegration()` listener registered with `{ once: true }`.

- [ ] **Step 5: Remove confirmed dead functions**

Remove `setupAudioNormalization`, `springScrollTo`, `renderPlaylistChunk` and `updateBackgroundFromCover`, which have no call sites.

- [ ] **Step 6: Verify security regression passes**

Run the full Python and Node suites. Expected: all PASS and static site checks pass.

- [ ] **Step 7: Browser verification**

Verify desktop and 390 x 844 mobile welcome screens, search result rendering, imported malicious song text displayed literally, and no new console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "fix: secure song rendering and media URLs"
```

### Task 3: Reliable HTTP And API Data

**Files:**
- Create: `js/http.mjs`
- Create: `js/music-data.mjs`
- Create: `tests/http.test.mjs`
- Create: `tests/music-data.test.mjs`
- Modify: `index.html`
- Modify: `playlist-downloader.html`

**Interfaces:**
- Produces: `requestJson(url, options): Promise<unknown>`
- Produces: `RequestTimeoutError`, `RequestCancelledError`, `HttpStatusError`, `ResponseFormatError`, `NetworkRequestError`
- Produces: `requestErrorMessage(error): string`
- Produces: `normalizeSearchPayload`, `normalizeSongPayload`, `normalizeLyricsPayload`, `normalizePlaylistPayload`

- [ ] **Step 1: Write failing request tests**

Cover success, non-2xx response, invalid JSON, timeout, external cancellation and network failure using injected `fetchImpl` functions.

- [ ] **Step 2: Implement `js/http.mjs` and pass tests**

Default timeout is 10 seconds. Link external abort signals to an internal controller and always clear timers and listeners.

- [ ] **Step 3: Write failing API normalization tests**

Cover every response shape currently supported by search, song, lyrics and playlist endpoints; reject entries without an ID and normalize strings.

- [ ] **Step 4: Implement `js/music-data.mjs` and pass tests**

- [ ] **Step 5: Integrate modules into the player**

Replace direct JSON fetches in `MusicService` and `PlaylistService`. Pass AbortSignals through search calls, cancel stale desktop and mobile searches, and show `requestErrorMessage()` output to users.

- [ ] **Step 6: Integrate modules into playlist downloader**

Convert its inline script to `type="module"`, import the shared helpers, validate the playlist payload and keep the existing download format.

- [ ] **Step 7: Run tests and browser error scenarios**

Run full suites. In the browser verify normal requests, invalid ID, simulated offline mode and repeated searches.

- [ ] **Step 8: Commit**

```bash
git add js/http.mjs js/music-data.mjs tests/http.test.mjs tests/music-data.test.mjs index.html playlist-downloader.html
git commit -m "fix: make API requests resilient"
```

### Task 4: PWA Cache Reliability

**Files:**
- Create: `offline.html`
- Create: `tests/service-worker.test.mjs`
- Modify: `sw.js`

**Interfaces:**
- Produces: `classifyRequest(request): "api" | "audio" | "cover" | "navigate" | "asset" | "ignore"`
- Produces: `cacheNamesToDelete(keys): string[]`
- Produces: cache names `cplayer5-shell-v2` and `cplayer5-covers-v1`

- [ ] **Step 1: Write failing Service Worker policy tests**

Load `sw.js` in Node `vm` with mocked `self`. Assert cover requests classify before the generic NetEase audio rule, non-GET requests are ignored, API/audio are network-only, and obsolete cache names are deleted.

- [ ] **Step 2: Implement pure policy functions and cache strategies**

Precache the shell plus `offline.html`; use network-only for API/audio, cache-first with 100-entry pruning for covers, network-first for navigation with offline fallback, and stale-while-revalidate for local assets.

- [ ] **Step 3: Remove stale font cache declarations**

- [ ] **Step 4: Run tests and offline browser verification**

Verify Service Worker activation, cover cache entries, absence of API/audio cache entries, offline navigation and old-cache deletion.

- [ ] **Step 5: Commit**

```bash
git add sw.js offline.html tests/service-worker.test.mjs
git commit -m "fix: make PWA caching deterministic"
```

### Task 5: Accessible Markup And Focus Management

**Files:**
- Create: `tests/test_accessibility_markup.py`
- Modify: `index.html`
- Modify: `playlist-downloader.html`

**Interfaces:**
- Produces: accessible names for all form inputs and icon-only buttons
- Produces: `openDialog(dialog, focusTarget, trigger)` and `closeDialog(dialog)` behavior

- [ ] **Step 1: Write failing markup tests**

Assert viewport zoom is allowed; known inputs have labels; Toast has live-region semantics; welcome, settings and mobile sheet have dialog attributes; known icon buttons have `aria-label`.

- [ ] **Step 2: Update markup**

Remove zoom restrictions, add labels/names, set `role`, `aria-modal`, `aria-labelledby`, `aria-live`, `aria-atomic`, `role="alert"`, tab roles and selected state.

- [ ] **Step 3: Implement focus management**

Remember the trigger, move focus into dialogs, trap Tab inside the active dialog, close non-blocking dialogs with Escape and restore focus.

- [ ] **Step 4: Make file drop zones keyboard operable**

Add `role="button"`, `tabindex="0"`, accessible instructions and Enter/Space activation.

- [ ] **Step 5: Run unit and markup tests**

- [ ] **Step 6: Commit**

```bash
git add tests/test_accessibility_markup.py index.html playlist-downloader.html
git commit -m "fix: improve keyboard and screen reader access"
```

### Task 6: Touch Targets And Reduced Motion

**Files:**
- Modify: `index.html`
- Modify: `playlist-downloader.html`

**Interfaces:**
- Produces: minimum 44 x 44 pixel primary mobile targets
- Produces: animation pause/resume based on visibility and reduced-motion preference

- [ ] **Step 1: Add reduced-motion CSS**

Disable decorative animation, smooth scrolling and long transitions when `prefers-reduced-motion: reduce` is active.

- [ ] **Step 2: Increase mobile hit areas**

Adjust settings, previous, next, close-sheet and sheet-tab controls without increasing icon size.

- [ ] **Step 3: Pause continuous rendering**

Add `start`, `stop` and visibility/motion listeners to FluidBackground and LyricsCanvasRenderer. Do not queue animation frames while hidden or reduced motion is active.

- [ ] **Step 4: Browser verification**

Check 390 x 844, 768 x 1024 and 1440 x 900. Confirm no horizontal overflow, target sizes, zoom, keyboard flow and motion reduction.

- [ ] **Step 5: Commit**

```bash
git add index.html playlist-downloader.html
git commit -m "fix: improve touch and motion accessibility"
```

### Task 7: Final Integration And Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT.md`

**Interfaces:**
- Consumes: all previous stage behavior
- Produces: updated verification and accessibility notes

- [ ] **Step 1: Run complete verification**

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 scripts/check_static_site.py
```

- [ ] **Step 2: Run browser smoke tests**

Verify desktop/mobile player, settings, welcome flow, downloader, malicious imported names, network failures, offline navigation and reduced motion. Confirm console has no errors.

- [ ] **Step 3: Update documentation**

Document Node test command, supported accessibility behavior and Service Worker cache policy.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DEVELOPMENT.md
git commit -m "docs: document foundation checks"
```

- [ ] **Step 5: Verify branch state**

Expected: clean worktree, all tests passing, and commits grouped by stage.
