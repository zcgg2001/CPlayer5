import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MarkupParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.by_id = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.by_id[values["id"]] = {"tag": tag, **values}


class DesktopShellMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.css = (ROOT / "css/app-shell.css").read_text(encoding="utf-8")
        cls.markup = MarkupParser()
        cls.markup.feed(cls.source)

    def test_shell_assets_and_1024_breakpoint_exist(self):
        self.assertIn('href="./css/app-shell.css"', self.source)
        self.assertIn("@media (min-width: 1024px)", self.css)
        self.assertIn("@media (max-width: 1023.98px)", self.css)
        self.assertIn("grid-template-columns: 240px minmax(0, 1fr)", self.css)
        self.assertIn("grid-template-rows: 70px minmax(0, 1fr) minmax(80px, auto)", self.css)

    def test_real_desktop_shell_surfaces_exist(self):
        for element_id in (
            "desktopApp", "desktopShell", "desktopLibraryView",
            "desktopPlayerBar", "desktopMiniPlayer", "desktopImmersiveClose",
        ):
            self.assertIn(element_id, self.markup.by_id)

        opener = self.markup.by_id["desktopMiniPlayer"]
        self.assertEqual(opener["tag"], "button")
        self.assertEqual(opener.get("aria-controls"), "desktopLayout")
        self.assertEqual(opener.get("aria-expanded"), "false")

    def test_library_is_default_and_navigation_has_no_placeholders(self):
        library = self.markup.by_id["desktopNavLibrary"]
        self.assertEqual(library.get("aria-current"), "page")
        self.assertEqual(library.get("data-shell-destination"), "library")
        self.assertNotRegex(self.source, r'data-shell-destination="(?:ranking|artists|video|radio)"')
        self.assertNotIn('aria-disabled="true"', self.source)

    def test_mobile_layout_no_longer_disappears_at_768(self):
        classes = self.markup.by_id["mobileLayout"].get("class", "")
        self.assertNotIn("md:hidden", classes.split())

    def test_immersive_player_is_preserved_and_initially_closed(self):
        immersive = self.markup.by_id["desktopLayout"]
        self.assertEqual(immersive.get("aria-hidden"), "true")
        self.assertIn("#desktopLayout.is-open", self.css)

    def test_progress_track_and_queue_drawer_contracts_remain(self):
        self.assertRegex(
            self.source,
            r'(?s)progress-bar-container[^>]*>\s*<div[^>]*progress-track[^>]*>\s*<div id="progressBar"',
        )
        drawer_classes = self.markup.by_id["floatingPlaylistPanel"].get("class", "")
        self.assertIn("translate-x-full", drawer_classes.split())
