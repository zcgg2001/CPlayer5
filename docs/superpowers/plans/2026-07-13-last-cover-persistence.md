# Last Cover Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the last successfully loaded album cover on future player visits.

**Architecture:** Add small inline helpers around the existing media URL validator and `localStorage`. Save the normalized cover in the existing song load path, then restore it to desktop and mobile artwork during DOM initialization.

**Tech Stack:** Vanilla JavaScript, `localStorage`, Python `unittest`.

## Global Constraints

- Do not change search request or playback behavior.
- Prefer the selected queue item's cover over the audio endpoint cover.
- Persist only normalized HTTP and HTTPS cover URLs.
- Restore both desktop and mobile artwork.
- Add no dependencies or unrelated refactoring.

---

### Task 1: Persist And Restore The Last Cover

**Files:**
- Create: `tests/test_cover_persistence.py`
- Modify: `index.html:1575-1940`
- Modify: `index.html:2665-2695`

**Interfaces:**
- Produces: `persistentCoverUrl(value)`, `saveLastCover(value)`, and `restoreLastCover()`.
- Consumes: existing `normalizeMediaUrl()`, `dom.albumArt`, and `dom.mobileCoverImg`.

- [ ] **Step 1: Write failing regression tests**

```python
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source_block(source, start_marker, end_marker):
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]


class CoverPersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_cover_persistence_accepts_only_http_urls(self):
        helpers = source_block(
            self.source,
            "const LAST_COVER_KEY",
            "class ChKSzAPI",
        )
        self.assertIn("const LAST_COVER_KEY = 'cp_lastCover';", helpers)
        self.assertIn("function persistentCoverUrl(value)", helpers)
        self.assertIn("url.protocol === 'http:' || url.protocol === 'https:'", helpers)

    def test_startup_restores_desktop_and_mobile_artwork(self):
        helpers = source_block(
            self.source,
            "function restoreLastCover()",
            "class ChKSzAPI",
        )
        self.assertIn("dom.albumArt.src = savedCover;", helpers)
        self.assertIn("dom.mobileCoverImg.src = savedCover;", helpers)

        startup = source_block(
            self.source,
            "document.addEventListener('DOMContentLoaded', async () =>",
            "// ★ 初始化 IndexedDB 缓存",
        )
        self.assertIn("restoreLastCover();", startup)

    def test_song_loading_saves_the_normalized_cover(self):
        song_loading = source_block(
            self.source,
            "// 封面 - 直接使用 URL",
            "if (playlist.some",
        )
        self.assertIn("saveLastCover(picUrl);", song_loading)

    def test_playback_prefers_the_selected_queue_cover(self):
        song_loading = source_block(
            self.source,
            "async function loadAndPlaySong(id)",
            "function parseLyrics(lrc, tlrc)",
        )
        self.assertIn("const queuedSong = playlist.find", song_loading)
        self.assertIn("const coverCandidate = queuedSong?.cover || data.cover;", song_loading)
        self.assertIn("const playbackData = { ...data, cover: picUrl", song_loading)
        self.assertIn("updateMediaSessionMetadata(playbackData);", song_loading)
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `python3 -m unittest tests.test_cover_persistence -v`

Expected: three failures because the persistence helpers do not exist.

- [ ] **Step 3: Implement persistent URL validation and storage helpers**

Use `normalizeMediaUrl(value, { baseUrl: window.location.href })`, parse it with `new URL()`, and return the URL only for `http:` or `https:`. Wrap storage reads, writes, and removal in `try/catch`.

- [ ] **Step 4: Restore the saved cover during DOM initialization**

After populating the `dom` map, call `restoreLastCover()` before IndexedDB and playlist initialization. Set both `dom.albumArt.src` and `dom.mobileCoverImg.src` when a valid cover exists.

- [ ] **Step 5: Prefer and save the selected song cover**

Find the queue item whose ID matches the song being loaded. Normalize `queuedSong.cover || data.cover`, use that result for the vinyl and Media Session metadata, and call `saveLastCover(picUrl)` before assigning the desktop artwork source.

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
python3 -m unittest tests.test_cover_persistence -v
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 scripts/check_static_site.py
git diff --check
```

Expected: all tests pass and static checks report no errors.

- [ ] **Step 7: Commit the implementation**

```bash
git add index.html tests/test_cover_persistence.py
git commit -m "feat: remember the last album cover"
```

---

### Task 2: Preview And Delivery

- [ ] **Step 1: Confirm the local server returns the updated page and modules**

Verify HTTP 200 responses and confirm served `index.html` contains `cp_lastCover`.

- [ ] **Step 2: Keep the branch for user review**

Do not push or create the Pull Request until the user confirms the restored-cover behavior.
