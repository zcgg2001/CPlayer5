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


if __name__ == "__main__":
    unittest.main()
