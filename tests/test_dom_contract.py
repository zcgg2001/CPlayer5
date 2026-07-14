import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "index.html").read_text(encoding="utf-8")


class _IdCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        self.ids.extend(value for name, value in attrs if name == "id")


ID_COLLECTOR = _IdCollector()
ID_COLLECTOR.feed(SOURCE)
ID_COLLECTOR.close()
IDS = ID_COLLECTOR.ids

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
        actual = set(IDS)
        self.assertEqual(REQUIRED_IDS - actual, set())

    def test_index_has_no_duplicate_ids(self):
        duplicates = sorted({element_id for element_id in IDS if IDS.count(element_id) > 1})
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
