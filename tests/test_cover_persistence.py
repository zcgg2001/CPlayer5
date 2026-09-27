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
        cls.service = (ROOT / "js/music-service.js").read_text(encoding="utf-8")
        cls.playback = (ROOT / "js/playback-controller.js").read_text(encoding="utf-8")

    def test_cover_persistence_accepts_only_http_urls(self):
        helpers = source_block(
            self.source,
            "const LAST_COVER_KEY",
            "let nativeIntegrationInitialized",
        )
        self.assertIn("const LAST_COVER_KEY = 'cp_lastCover';", helpers)
        self.assertIn("function persistentCoverUrl(value)", helpers)
        self.assertIn("url.protocol === 'http:' || url.protocol === 'https:'", helpers)

    def test_startup_restores_desktop_and_mobile_artwork(self):
        helpers = source_block(
            self.source,
            "function restoreLastCover()",
            "let nativeIntegrationInitialized",
        )
        self.assertIn("dom.albumArt.src = savedCover;", helpers)
        self.assertIn("dom.mobileCoverImg.src = savedCover;", helpers)
        self.assertIn("image.referrerPolicy = 'no-referrer';", helpers)

        startup = source_block(
            self.source,
            "document.addEventListener('DOMContentLoaded', async () =>",
            "// ★ 初始化 IndexedDB 缓存",
        )
        self.assertIn("restoreLastCover();", startup)

    def test_song_loading_saves_the_normalized_cover(self):
        self.assertIn("saveLastCover(picUrl);", self.source)

    def test_playback_prefers_the_selected_queue_cover(self):
        self.assertIn("const queuedSong = songOverride || queueStore.state.playlist.find", self.playback)
        self.assertIn("const cover = normalizeMediaUrl(queuedSong?.cover || data.cover", self.playback)
        self.assertIn("const playbackData = {", self.playback)
        self.assertIn("updateMediaSessionMetadata(playbackData);", self.source)


if __name__ == "__main__":
    unittest.main()
