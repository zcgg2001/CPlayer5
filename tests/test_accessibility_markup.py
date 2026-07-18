import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarkupParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.by_id = {}
        self.viewport = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        element_id = attributes.get("id")
        if element_id:
            self.by_id[element_id] = {"tag": tag, **attributes}
        if tag == "meta" and attributes.get("name") == "viewport":
            self.viewport = attributes.get("content", "")


def parse_markup(filename):
    parser = MarkupParser()
    parser.feed((ROOT / filename).read_text(encoding="utf-8"))
    return parser


class AccessibilityMarkupTests(unittest.TestCase):
    def test_viewports_allow_user_zoom(self):
        for filename in ("index.html", "playlist-downloader.html"):
            viewport = parse_markup(filename).viewport
            self.assertNotIn("user-scalable=no", viewport)
            self.assertNotIn("maximum-scale=1.0", viewport)

    def test_player_inputs_have_accessible_names(self):
        markup = parse_markup("index.html")
        for element_id in (
            "volumeSlider",
            "playlistFile",
            "searchInput",
            "mobileSearchInput",
            "playlistIdInput",
            "settingsFileInput",
            "welcomePlaylistInput",
        ):
            self.assertTrue(markup.by_id[element_id].get("aria-label"), element_id)

    def test_icon_buttons_have_accessible_names(self):
        markup = parse_markup("index.html")
        for element_id in (
            "toggleSearchBtn",
            "settingsBtn",
            "fullscreenBtn",
            "volumeBtn",
            "mobileSettingsBtn",
            "closeSheetBtn",
            "closeSettingsBtn",
        ):
            self.assertTrue(markup.by_id[element_id].get("aria-label"), element_id)

    def test_status_messages_are_announced(self):
        player_toast = parse_markup("index.html").by_id["copyToast"]
        downloader_toast = parse_markup("playlist-downloader.html").by_id["toast"]
        for toast in (player_toast, downloader_toast):
            self.assertEqual(toast.get("role"), "status")
            self.assertEqual(toast.get("aria-live"), "polite")
            self.assertEqual(toast.get("aria-atomic"), "true")

    def test_overlays_have_dialog_semantics(self):
        markup = parse_markup("index.html")
        for element_id in ("settingsModal", "welcomeModal", "mobilePlaylistSheet"):
            dialog = markup.by_id[element_id]
            self.assertEqual(dialog.get("role"), "dialog", element_id)
            self.assertEqual(dialog.get("aria-modal"), "true", element_id)
            self.assertTrue(dialog.get("aria-labelledby"), element_id)

    def test_file_drop_zone_is_keyboard_operable(self):
        drop_zone = parse_markup("index.html").by_id["settingsDropZone"]
        self.assertEqual(drop_zone.get("role"), "button")
        self.assertEqual(drop_zone.get("tabindex"), "0")
        self.assertTrue(drop_zone.get("aria-label"))

    def test_downloader_input_has_accessible_name(self):
        playlist_input = parse_markup("playlist-downloader.html").by_id["playlistInput"]
        self.assertTrue(playlist_input.get("aria-label"))

    def test_mobile_controls_have_minimum_touch_targets(self):
        markup = parse_markup("index.html")
        for element_id in (
            "mobileSettingsBtn",
            "mobilePrevBtn",
            "mobileNextBtn",
            "closeSheetBtn",
            "sheetTabPlaylist",
            "sheetTabSearch",
        ):
            classes = markup.by_id[element_id].get("class", "")
            self.assertIn("min-w-11", classes, element_id)
            self.assertIn("min-h-11", classes, element_id)

    def test_progress_scrubbers_are_keyboard_operable_sliders(self):
        markup = parse_markup("index.html")
        for element_id in ("desktopProgressBarContainer", "mobileProgressBarContainer"):
            scrubber = markup.by_id[element_id]
            self.assertEqual(scrubber.get("role"), "slider", element_id)
            self.assertEqual(scrubber.get("tabindex"), "0", element_id)
            self.assertEqual(scrubber.get("aria-valuemin"), "0", element_id)
            self.assertEqual(scrubber.get("aria-valuemax"), "100", element_id)
            self.assertTrue(scrubber.get("aria-label"), element_id)

    def test_doraemon_progress_has_desktop_and_mobile_feedback(self):
        markup = parse_markup("index.html")
        for element_id in (
            "doraemonThumb",
            "doraemonMood",
            "mobileDoraemonThumb",
            "mobileDoraemonMood",
        ):
            self.assertIn(element_id, markup.by_id)

        source = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("function updateDoraemonExpression", source)
        self.assertIn("bindProgressScrubber", source)
        self.assertIn("doraemon-walking-trippy.gif", source)
        self.assertIn("doraemon-crying-laugh.gif", source)
        self.assertNotIn('class="doraemon-head"', source)

    def test_pages_define_reduced_motion_styles(self):
        for filename in ("index.html", "playlist-downloader.html"):
            source = (ROOT / filename).read_text(encoding="utf-8")
            self.assertIn("@media (prefers-reduced-motion: reduce)", source)

    def test_player_pauses_rendering_when_page_is_hidden(self):
        source = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("document.addEventListener('visibilitychange'", source)
        self.assertIn("window.matchMedia('(prefers-reduced-motion: reduce)')", source)

    def test_cat_stays_above_butterfly_when_they_overlap(self):
        source = (ROOT / "css/oneko-butterfly.css").read_text(encoding="utf-8")
        self.assertRegex(source, r"(?s)\.oneko-cat\s*\{[^}]*z-index:\s*2")
        self.assertRegex(source, r"(?s)\.oneko-butterfly\s*\{[^}]*z-index:\s*1")


if __name__ == "__main__":
    unittest.main()
