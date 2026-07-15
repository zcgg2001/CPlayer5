import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def contrast_ratio(foreground, background):
    def luminance(color):
        channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
        linear = [
            channel / 12.92
            if channel <= 0.04045
            else ((channel + 0.055) / 1.055) ** 2.4
            for channel in channels
        ]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

    foreground_luminance = luminance(foreground)
    background_luminance = luminance(background)
    lighter = max(foreground_luminance, background_luminance)
    darker = min(foreground_luminance, background_luminance)
    return (lighter + 0.05) / (darker + 0.05)


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

    def css_rule(self, selector):
        match = re.search(rf"{re.escape(selector)}\s*\{{([^}}]*)\}}", self.css)
        self.assertIsNotNone(match, f"missing CSS rule for {selector}")
        return match.group(1)

    def css_property(self, selector, property_name):
        declarations = self.css_rule(selector)
        match = re.search(rf"{re.escape(property_name)}\s*:\s*([^;]+);", declarations)
        self.assertIsNotNone(match, f"missing {property_name} in {selector}")
        return match.group(1).strip()

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

    def test_topbar_search_shortcut_keeps_an_accessible_name(self):
        shortcut = self.markup.by_id["desktopSearchShortcut"]
        self.assertEqual(shortcut.get("aria-label"), "搜索音乐")

    def test_topbar_search_shortcut_overrides_legacy_anchor_colors(self):
        normal_color = self.css_property(
            "#desktopShell #desktopSearchShortcut",
            "color",
        )
        hover_color = self.css_property(
            "#desktopShell #desktopSearchShortcut:hover",
            "color",
        )
        self.assertEqual(normal_color, "var(--shell-text) !important")
        self.assertEqual(hover_color, "var(--shell-accent-strong) !important")

    def test_player_and_volume_popover_stack_above_desktop_overlays(self):
        player_z = int(self.css_property("#desktopPlayerBar", "z-index"))
        immersive_z = int(self.css_property("#desktopLayout", "z-index"))
        queue_z = int(self.css_property("#floatingPlaylistPanel", "z-index"))
        self.assertGreater(player_z, immersive_z)
        self.assertGreater(player_z, queue_z)

    def test_default_player_height_keeps_queue_drawer_clear(self):
        self.assertEqual(self.css_property("#desktopPlayerBar", "min-height"), "80px")
        self.assertEqual(self.css_property("#floatingPlaylistPanel", "bottom"), "80px")
        self.assertEqual(
            self.css_property("#desktopPlayerBar", "padding"),
            "6px 20px calc(6px + env(safe-area-inset-bottom))",
        )

    def test_closed_queue_drawer_is_hidden_and_non_interactive(self):
        selector = "#floatingPlaylistPanel.translate-x-full"
        self.assertEqual(self.css_property(selector, "visibility"), "hidden")
        self.assertEqual(self.css_property(selector, "pointer-events"), "none")

    def test_open_queue_drawer_restores_visibility_and_interaction(self):
        selector = "#floatingPlaylistPanel"
        self.assertEqual(self.css_property(selector, "visibility"), "visible")
        self.assertEqual(self.css_property(selector, "pointer-events"), "auto")

    def test_search_skeleton_blocks_are_visible_on_the_light_surface(self):
        color = self.css_property(
            r"#desktopContentSearch .bg-white\/10",
            "background-color",
        )
        self.assertEqual(color, "rgba(102, 87, 217, 0.14) !important")

    def test_search_skeleton_shimmer_is_visible_on_the_light_surface(self):
        image = self.css_property(
            "#desktopContentSearch .bg-gradient-to-r",
            "background-image",
        )
        self.assertIn("rgba(102, 87, 217, 0.16)", image)
        self.assertTrue(image.endswith("!important"))

    def test_short_desktop_sidebar_can_scroll_to_tools(self):
        selector = "#desktopShell .app-sidebar"
        self.assertEqual(self.css_property(selector, "min-height"), "0")
        self.assertEqual(self.css_property(selector, "overflow-y"), "auto")

    def test_muted_navigation_and_placeholder_text_meet_aa_contrast(self):
        muted = self.css_property("#desktopApp", "--shell-muted")
        surface = self.css_property("#desktopApp", "--shell-surface")
        input_background = self.css_property(
            "#desktopContentSearch #searchInput",
            "background",
        )

        self.assertEqual(
            self.css_property("#desktopShell .app-nav-label", "color"),
            "var(--shell-muted)",
        )
        self.assertEqual(
            self.css_property(
                "#desktopContentSearch #searchInput::placeholder",
                "color",
            ),
            "var(--shell-muted)",
        )
        self.assertGreaterEqual(contrast_ratio(muted, surface), 4.5)
        self.assertGreaterEqual(contrast_ratio(muted, input_background), 4.5)
