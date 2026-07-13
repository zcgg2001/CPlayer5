# Centered Lyrics Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the selected cinema-focus lyric layout on desktop and mobile.

**Architecture:** Extend the existing lyric line state from active/inactive to active/near/distant. CSS owns alignment and focus depth, while `updateLyrics()` owns state assignment and retains the current vertical-centering scroll calculation.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, Python `unittest`.

## Global Constraints

- Preserve existing lyric parsing, click-to-seek, translations, font sizes, and smooth scrolling.
- Apply the selected treatment to both desktop and mobile lyric renderers.
- Add no dependencies and do not begin broader modularization.

---

### Task 1: Centered Cinema-Focus Lyrics

**Files:**
- Create: `tests/test_lyrics_focus.py`
- Modify: `index.html:347-480`
- Modify: `index.html:2865-2887`

**Interfaces:**
- Consumes: existing `.lrc-line`, `#mobileLyricsScroller .lrc-line`, and `updateLyrics(time)` behavior.
- Produces: the `near` lyric line state for `idx - 1` and `idx + 1`.

- [ ] **Step 1: Write failing regression tests**

```python
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source_block(source, start_marker, end_marker):
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    return source[start:end]


class LyricsFocusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_desktop_and_mobile_lyrics_are_centered(self):
        desktop = source_block(self.source, ".lrc-line {", ".lrc-line.active {")
        mobile = source_block(
            self.source,
            "#mobileLyricsScroller .lrc-line {",
            "#mobileLyricsScroller .lrc-line.active {",
        )
        for block in (desktop, mobile):
            self.assertIn("text-align: center;", block)
            self.assertIn("transform-origin: center;", block)

    def test_lyrics_define_active_near_and_distant_focus(self):
        self.assertIn(".lrc-line.near {", self.source)
        self.assertIn("#mobileLyricsScroller .lrc-line.near {", self.source)
        self.assertGreaterEqual(self.source.count("filter: blur(1px);"), 2)
        self.assertGreaterEqual(self.source.count("filter: blur(0.35px);"), 2)
        self.assertGreaterEqual(self.source.count("filter: none;"), 2)

    def test_lyric_updates_assign_near_lines_and_preserve_vertical_centering(self):
        update = source_block(
            self.source,
            "function updateLyrics(time)",
            "// ================= 歌单逻辑",
        )
        self.assertIn("line.classList.remove('active', 'near')", update)
        self.assertIn("lines[idx - 1]?.classList.add('near');", update)
        self.assertIn("lines[idx + 1]?.classList.add('near');", update)
        self.assertIn(
            "lineTop - (containerHeight / 2) + (lineHeight / 2)",
            update,
        )
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `python3 -m unittest tests.test_lyrics_focus -v`

Expected: three failures because the current renderer is left aligned and has no `near` state.

- [ ] **Step 3: Implement the desktop focus styles**

Update `.lrc-line` to use centered text and transform origin, opacity `0.12`, blur `1px`, and filter transitions. Add `.lrc-line.near` with opacity `0.36` and blur `0.35px`. Update `.lrc-line.active` to use opacity `1`, no blur, and zero margin.

- [ ] **Step 4: Implement the mobile focus styles**

Apply the same centered alignment and active/near/distant focus values to `#mobileLyricsScroller .lrc-line`, while preserving its existing mobile font sizing and active glow.

- [ ] **Step 5: Assign lyric focus states**

In `updateScroller()`, clear `active` and `near` from every line, add `active` to `lines[idx]`, and add `near` to `lines[idx - 1]` and `lines[idx + 1]` when present. Keep the existing target scroll formula unchanged.

- [ ] **Step 6: Run focused and full verification**

Run:

```bash
python3 -m unittest tests.test_lyrics_focus -v
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
python3 scripts/check_static_site.py
git diff --check
```

Expected: all tests pass and static checks report no errors.

- [ ] **Step 7: Commit the implementation**

```bash
git add index.html tests/test_lyrics_focus.py
git commit -m "feat: center lyrics with cinema focus"
```

---

### Task 2: Preview And Delivery

**Files:**
- Modify: none unless preview verification reveals a regression.

- [ ] **Step 1: Verify local HTTP endpoints and the updated source**

Confirm `/`, `/sw.js`, and the JavaScript modules return HTTP 200 and the served `index.html` contains the `near` focus rules.

- [ ] **Step 2: Keep the feature branch available for user review**

Do not push or create a Pull Request until the user confirms the combined direct-entry and centered-lyrics preview.

