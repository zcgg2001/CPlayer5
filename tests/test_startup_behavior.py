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

    def test_mobile_initialization_accepts_an_empty_playlist(self):
        preload = function_block(
            self.source,
            "// Preload Playlist (Wait for global playlist to be ready)",
            "// Initial scroll to current song if playing",
        )
        self.assertIn("Array.isArray(window.playlist)", preload)
        self.assertNotIn("window.playlist.length > 0", preload)


if __name__ == "__main__":
    unittest.main()
