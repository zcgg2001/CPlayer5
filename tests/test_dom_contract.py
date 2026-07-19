import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "index.html").read_text(encoding="utf-8")


class _MarkupNode:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attributes = dict(attrs)
        self.parent = parent

    @property
    def element_id(self):
        return self.attributes.get("id")

    @property
    def classes(self):
        return set((self.attributes.get("class") or "").split())


class _MarkupParser(HTMLParser):
    VOID_ELEMENTS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }

    def __init__(self):
        super().__init__()
        self.elements = []
        self.ids = []
        self.stack = []

    def _record_element(self, tag, attrs, push):
        parent = self.stack[-1] if self.stack else None
        element = _MarkupNode(tag, attrs, parent)
        self.elements.append(element)
        self.ids.extend(value for name, value in attrs if name == "id" and value)
        if push:
            self.stack.append(element)

    def handle_starttag(self, tag, attrs):
        self._record_element(tag, attrs, tag not in self.VOID_ELEMENTS)

    def handle_startendtag(self, tag, attrs):
        self._record_element(tag, attrs, False)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break


MARKUP = _MarkupParser()
MARKUP.feed(SOURCE)
MARKUP.close()
IDS = MARKUP.ids
ELEMENTS_BY_ID = {
    element.element_id: element
    for element in MARKUP.elements
    if element.element_id
}

REQUIRED_IDS = {
    "albumArt",
    "albumArtWrapper",
    "artistName",
    "audioVisualizer",
    "closeSettingsBtn",
    "closeSheetBtn",
    "copyToast",
    "currentTime",
    "desktopContentPlaylist",
    "desktopContentSearch",
    "desktopLayout",
    "desktopLoaderOverlay",
    "editorialPlaylistGrid",
    "desktopTabPlaylist",
    "desktopTabSearch",
    "fileImportSection",
    "floatingPlaylistPanel",
    "floatingSearchPanel",
    "fluidBg",
    "fluidNoise",
    "fullscreenBtn",
    "loadPlaylistBtn",
    "lyricsScroller",
    "mobileAlbumArtWrapper",
    "mobileArtist",
    "mobileCoverContainer",
    "mobileCoverImg",
    "mobileCurrentTime",
    "mobileDuration",
    "mobileLayout",
    "mobileLoaderOverlay",
    "mobileLyricsPage",
    "mobileLyricsScroller",
    "mobileMainView",
    "mobileMetaContainer",
    "mobileModeBtn",
    "mobileNextBtn",
    "mobilePlayBtn",
    "mobilePlaylistContainer",
    "mobilePlaylistSheet",
    "mobilePlaylistSheetTitle",
    "mobilePlaylistToggleBtn",
    "mobilePrevBtn",
    "mobileProgressBar",
    "mobileProgressBarContainer",
    "mobileQualityBadge",
    "mobileSearchInput",
    "mobileSearchResults",
    "mobileSettingsBtn",
    "mobileSongIdTag",
    "mobileTitle",
    "mobileVinylContainer",
    "newAlbumGrid",
    "nextBtn",
    "playModeBtn",
    "playPauseBtn",
    "playlistContainer",
    "playlistContent",
    "playlistCount",
    "playlistFile",
    "playlistIdInput",
    "playlistLoader",
    "playlistSourceCard",
    "prevBtn",
    "progressBar",
    "qualityBadge",
    "searchButton",
    "searchInput",
    "searchResults",
    "scenePlaylistGrid",
    "settingsBtn",
    "settingsCard",
    "settingsDropZone",
    "settingsFileInput",
    "settingsModal",
    "settingsTitle",
    "sheetContentPlaylist",
    "sheetContentSearch",
    "sheetDragHandle",
    "sheetTabPlaylist",
    "sheetTabSearch",
    "songIdTag",
    "songTitle",
    "sourceCount",
    "sourceDetail",
    "sourceIconI",
    "sourceLabel",
    "sourceTag",
    "togglePlaylistBtn",
    "toggleSearchBtn",
    "totalTime",
    "volumeBtn",
    "volumeIcon",
    "volumePopover",
    "volumeSlider",
    "welcomeCard",
    "welcomeContent",
    "welcomeError",
    "welcomeErrorText",
    "welcomeLoadBtn",
    "welcomeLoading",
    "welcomeLoadingSubtext",
    "welcomeLoadingText",
    "welcomeModal",
    "welcomePlaylistInput",
    "welcomeTitle",
}


def _is_descendant(element, ancestor):
    current = element.parent
    while current is not None:
        if current is ancestor:
            return True
        current = current.parent
    return False


class DomContractTests(unittest.TestCase):
    def test_required_legacy_ids_remain(self):
        actual = set(IDS)
        self.assertEqual(len(REQUIRED_IDS), 106)
        self.assertEqual(REQUIRED_IDS - actual, set())

    def test_discovery_replaces_duplicate_tool_cards_with_music_shelves(self):
        classes = [element.classes for element in MARKUP.elements]
        self.assertFalse(any("capability-grid" in element_classes for element_classes in classes))
        for class_name in ("editorial-shelf", "album-shelf", "scene-shelf"):
            self.assertTrue(
                any(class_name in element_classes for element_classes in classes),
                f"missing {class_name}",
            )

    def test_index_has_no_duplicate_ids(self):
        duplicates = sorted({element_id for element_id in IDS if IDS.count(element_id) > 1})
        self.assertEqual(duplicates, [])

    def test_progress_and_virtual_list_ancestry_remain(self):
        progress_track = ELEMENTS_BY_ID["progressBar"].parent
        self.assertIsNotNone(progress_track)
        self.assertIn("progress-track", progress_track.classes)
        progress_container = progress_track.parent
        self.assertIsNotNone(progress_container)
        self.assertIn("progress-bar-container", progress_container.classes)

        playlist_container = ELEMENTS_BY_ID["playlistContainer"]
        for element_id in ("playlistContent", "playlistLoader"):
            self.assertTrue(
                _is_descendant(ELEMENTS_BY_ID[element_id], playlist_container),
                f"#{element_id} must remain inside #playlistContainer",
            )

    def test_album_art_remains_inside_wrapper(self):
        self.assertTrue(
            _is_descendant(
                ELEMENTS_BY_ID["albumArt"],
                ELEMENTS_BY_ID["albumArtWrapper"],
            )
        )

    def test_first_upload_container_directly_contains_playlist_file(self):
        upload_container = next(
            (
                element
                for element in MARKUP.elements
                if "upload-container" in element.classes
            ),
            None,
        )
        self.assertIsNotNone(upload_container)
        self.assertIs(ELEMENTS_BY_ID["playlistFile"].parent, upload_container)

    def test_floating_playlist_panel_starts_off_canvas(self):
        self.assertIn(
            "translate-x-full",
            ELEMENTS_BY_ID["floatingPlaylistPanel"].classes,
        )

    def test_hidden_legacy_lyrics_container_remains(self):
        self.assertTrue(
            any(
                {"lyrics-container", "hidden"} <= element.classes
                for element in MARKUP.elements
            )
        )
