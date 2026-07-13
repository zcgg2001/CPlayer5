import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source_block(source, start_marker, end_marker):
    start = source.find(start_marker)
    if start == -1:
        return ""
    end = source.find(end_marker, start)
    if end == -1:
        return ""
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


if __name__ == "__main__":
    unittest.main()
