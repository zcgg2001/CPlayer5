# Direct Player Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter the player without requiring a NetEase playlist ID while preserving optional playlist loading and desktop/mobile search.

**Architecture:** Keep the existing startup priority for local and saved playlists. Replace the final welcome-dialog branch with explicit empty-queue initialization, and reuse one static empty-state message in both desktop and mobile playlist renderers.

**Tech Stack:** HTML5, vanilla JavaScript ES modules, Python `unittest`, Node.js built-in test runner.

## Global Constraints

- Do not change desktop or mobile search request behavior.
- Keep saved playlist IDs, manual playlist ID loading, and file import available.
- Do not automatically open another panel or dialog on first visit.
- Add no dependencies and do not begin the broader modularization work.

---

### Task 1: Direct Entry And Search-Oriented Empty State

**Files:**
- Create: `tests/test_startup_behavior.py`
- Modify: `index.html:2896-3430`

**Interfaces:**
- Consumes: existing `loadDefaultPlaylist()`, `initPlaylistView()`, `setupVirtualScroll()`, and `MobileUIManager.loadPlaylist()` functions.
- Produces: `EMPTY_PLAYLIST_MESSAGE`, a static string shared by desktop and mobile empty playlist renderers.

- [ ] **Step 1: Write the failing startup behavior tests**

```python
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def function_block(source, start_marker, end_marker):
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]


class StartupBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_first_visit_enters_player_without_welcome_dialog(self):
        startup = function_block(
            self.source,
            "async function loadDefaultPlaylist()",
            "// 从输入值中提取歌单 ID",
        )
        self.assertNotIn("openWelcomeModal();", startup)
        self.assertIn("initPlaylistView();", startup)

    def test_empty_playlist_directs_desktop_and_mobile_users_to_search(self):
        self.assertIn(
            "const EMPTY_PLAYLIST_MESSAGE = '当前没有歌曲，请使用搜索添加';",
            self.source,
        )
        self.assertGreaterEqual(self.source.count("EMPTY_PLAYLIST_MESSAGE"), 3)
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `python3 -m unittest tests.test_startup_behavior -v`

Expected: FAIL because `loadDefaultPlaylist()` still contains `openWelcomeModal();` and `EMPTY_PLAYLIST_MESSAGE` does not exist.

- [ ] **Step 3: Initialize an empty queue instead of opening the welcome dialog**

Add near the playlist state declarations:

```javascript
const EMPTY_PLAYLIST_MESSAGE = '当前没有歌曲，请使用搜索添加';
```

Replace the final branch of `loadDefaultPlaylist()` with:

```javascript
console.log('🎵 未配置歌单，直接进入播放器');
playlist = [];
window.playlist = playlist;
playlistTotalCount = 0;
allSongsLoaded = true;
playlistSource = '';
playlistSourceName = '';
initPlaylistView();
```

- [ ] **Step 4: Render the shared empty state on desktop and mobile**

In `setupVirtualScroll()`, replace the old desktop message with a static DOM node whose `textContent` is `EMPTY_PLAYLIST_MESSAGE`.

In `MobileUIManager.loadPlaylist()`, return early for an empty display order after rendering the same static message in the mobile playlist container.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `python3 -m unittest tests.test_startup_behavior -v`

Expected: 2 tests pass.

- [ ] **Step 6: Run the complete project verification**

Run:

```bash
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 scripts/check_static_site.py
git diff --check
```

Expected: all Python and Node tests pass, static site checks pass, and `git diff --check` produces no output.

- [ ] **Step 7: Commit the implementation**

```bash
git add index.html tests/test_startup_behavior.py
git commit -m "feat: enter player without playlist prompt"
```

---

### Task 2: Preview And Delivery

**Files:**
- Modify: none unless preview verification finds a regression.

**Interfaces:**
- Consumes: the static site already served from the repository root.
- Produces: a verified feature branch ready for Pull Request review.

- [ ] **Step 1: Probe the preview endpoints**

Run the existing local static server and request `/`, `/sw.js`, and the three JavaScript modules. Expected: HTTP 200 for every endpoint.

- [ ] **Step 2: Verify the final repository state**

Run: `git status --short --branch`

Expected: clean `codex/direct-search-entry` working tree.

- [ ] **Step 3: Push and create a Pull Request after user preview approval**

Push `codex/direct-search-entry` to `origin` and create a Pull Request targeting `main`. Do not merge before the user has reviewed the initial version.

