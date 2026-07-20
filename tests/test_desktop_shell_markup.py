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
        self.assertIn("grid-template-rows: 70px minmax(0, 1fr) 108px", self.css)

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
        for nav_id in ("desktopNavLibrary", "desktopNavSearch"):
            self.assertNotEqual(self.markup.by_id[nav_id].get("aria-disabled"), "true")

    def test_search_is_a_standalone_theme_below_discovery(self):
        search_nav = self.markup.by_id["desktopNavSearch"]
        discovery_view = self.markup.by_id["desktopDiscoveryView"]
        search_view = self.markup.by_id["desktopSearchView"]

        self.assertEqual(search_nav["tag"], "button")
        self.assertEqual(search_nav.get("data-shell-destination"), "search")
        self.assertEqual(search_nav.get("aria-controls"), "desktopSearchView")
        self.assertEqual(discovery_view.get("aria-hidden"), "false")
        self.assertEqual(search_view.get("aria-hidden"), "true")
        self.assertIn("hidden", search_view)
        self.assertRegex(
            self.source,
            r'(?s)id="desktopNavLibrary".*?</button>\s*<button id="desktopNavSearch"',
        )
        self.assertIn("desktopSearchPageTitle", self.markup.by_id)

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
            r'(?s)progress-bar-container[^>]*>\s*<div[^>]*progress-track[^>]*>'
            r'\s*<div id="progressBuffer"[^>]*></div>\s*<div id="progressBar"',
        )
        drawer_classes = self.markup.by_id["floatingPlaylistPanel"].get("class", "")
        self.assertIn("translate-x-full", drawer_classes.split())

    def test_topbar_search_shortcut_keeps_an_accessible_name(self):
        shortcut = self.markup.by_id["desktopSearchShortcut"]
        self.assertEqual(shortcut.get("aria-label"), "搜索音乐")

    def test_desktop_brand_uses_505_music_home_name(self):
        self.assertRegex(
            self.source,
            r'(?s)<span class="app-brand-copy">\s*<strong>505音乐之家</strong>',
        )
        self.assertNotIn("Music workspace", self.source)

    def test_collection_dialog_exposes_a_selectable_music_library(self):
        dialog = self.markup.by_id["collectionDialog"]
        self.assertEqual(dialog["tag"], "dialog")
        self.assertEqual(dialog.get("aria-labelledby"), "collectionDialogTitle")
        self.assertEqual(dialog.get("aria-describedby"), "collectionDialogMeta")
        self.assertEqual(self.markup.by_id["collectionTrackList"].get("role"), "list")
        self.assertEqual(self.markup.by_id["collectionTrackList"].get("aria-live"), "polite")
        self.assertIn("disabled", self.markup.by_id["collectionPlayAll"])
        self.assertIn("disabled", self.markup.by_id["collectionAddAll"])

    def test_topbar_search_shortcut_has_a_distinct_visible_surface(self):
        normal_color = self.css_property(
            "#desktopShell #desktopSearchShortcut",
            "color",
        )
        background = self.css_property(
            "#desktopShell #desktopSearchShortcut",
            "background",
        )
        border_color = self.css_property(
            "#desktopShell #desktopSearchShortcut",
            "border-color",
        )
        hover_color = self.css_property(
            "#desktopShell #desktopSearchShortcut:hover",
            "color",
        )
        hover_background = self.css_property(
            "#desktopShell #desktopSearchShortcut:hover",
            "background",
        )
        self.assertEqual(normal_color, "var(--shell-accent-strong) !important")
        self.assertEqual(background, "var(--shell-active)")
        self.assertEqual(border_color, "#d9d4f4")
        self.assertEqual(hover_color, "#fff !important")
        self.assertEqual(hover_background, "var(--shell-accent-strong)")

    def test_discovery_section_supports_browsing_real_new_songs(self):
        for element_id in (
            "desktopDiscoverySection",
            "desktopDiscoveryTitle",
            "desktopDiscoveryList",
            "desktopDiscoveryRefresh",
        ):
            self.assertIn(element_id, self.markup.by_id)

        section = self.markup.by_id["desktopDiscoverySection"]
        refresh = self.markup.by_id["desktopDiscoveryRefresh"]
        self.assertEqual(section["tag"], "section")
        self.assertEqual(section.get("aria-labelledby"), "desktopDiscoveryTitle")
        self.assertEqual(refresh["tag"], "button")
        self.assertEqual(refresh.get("type"), "button")
        self.assertEqual(refresh.get("aria-label"), "刷新新歌速递")
        self.assertIn("网易云新歌榜", self.source)

    def test_discovery_rows_use_a_dense_table_like_layout(self):
        selector = "#desktopLibraryView .discovery-song-row"
        self.assertEqual(
            self.css_property(selector, "grid-template-columns"),
            "48px minmax(240px, 1.5fr) minmax(160px, 0.8fr) 112px",
        )
        self.assertEqual(self.css_property(selector, "min-height"), "72px")

    def test_hidden_desktop_theme_is_removed_from_layout(self):
        self.assertEqual(
            self.css_property("#desktopLibraryView .desktop-main-view[hidden]", "display"),
            "none !important",
        )

    def test_player_and_volume_popover_stack_above_desktop_overlays(self):
        player_z = int(self.css_property("#desktopPlayerBar", "z-index"))
        immersive_z = int(self.css_property("#desktopLayout", "z-index"))
        queue_z = int(self.css_property("#floatingPlaylistPanel", "z-index"))
        self.assertGreater(player_z, immersive_z)
        self.assertGreater(player_z, queue_z)

    def test_default_player_height_keeps_queue_drawer_clear(self):
        self.assertEqual(self.css_property("#desktopPlayerBar", "min-height"), "108px")
        self.assertEqual(self.css_property("#floatingPlaylistPanel", "bottom"), "108px")
        self.assertEqual(
            self.css_property("#desktopPlayerBar", "padding"),
            "14px 24px calc(14px + env(safe-area-inset-bottom))",
        )

    def test_player_starts_in_a_clear_non_interactive_empty_state(self):
        player = self.markup.by_id["desktopPlayerBar"]
        progress = self.markup.by_id["desktopProgressBarContainer"]

        self.assertIn("is-empty", player.get("class", "").split())
        for control_id in ("desktopMiniPlayer", "prevBtn", "nextBtn", "desktopDownloadBtn"):
            self.assertIn("disabled", self.markup.by_id[control_id])
        self.assertEqual(progress.get("aria-disabled"), "true")
        self.assertEqual(progress.get("tabindex"), "-1")
        self.assertRegex(self.source, r'id="currentTime">--:--</span>')
        self.assertRegex(self.source, r'id="totalTime">--:--</span>')

    def test_desktop_progress_uses_the_anime_thumb_component(self):
        thumb = self.markup.by_id["doraemonThumb"]
        self.assertIn("anime-progress-thumb", thumb.get("class", "").split())
        self.assertNotRegex(
            self.source,
            r'(?s)id="doraemonThumb"[^>]*>\s*<img',
        )
        anime_css = (ROOT / "css/anime-progress-thumb.css").read_text(encoding="utf-8")
        self.assertIn("--anime-progress-thumb-size: 34px", anime_css)
        self.assertIn("translate3d(var(--anime-progress-x)", anime_css)
        self.assertIn('src="./js/anime-progress-thumb.js"', self.source)
        self.assertTrue((ROOT / "img/doraemon-progress-thumb.png").is_file())

    def test_desktop_download_controls_and_dialog_are_exposed(self):
        for element_id in (
            "desktopDownloadBtn", "downloadDialog", "downloadDialogTitle",
            "downloadSongName", "downloadQuality", "downloadQualityTrigger",
            "downloadQualityList", "downloadConfirm", "downloadStatus",
            "desktopPlaybackQualityBtn", "playbackQualityDialog", "playbackQualityList",
        ):
            self.assertIn(element_id, self.markup.by_id)
        self.assertEqual(self.markup.by_id["desktopDownloadBtn"].get("aria-label"), "下载当前歌曲")
        self.assertEqual(self.markup.by_id["downloadDialog"]["tag"], "dialog")
        self.assertEqual(self.markup.by_id["downloadDialog"].get("aria-labelledby"), "downloadDialogTitle")
        self.assertEqual(self.markup.by_id["downloadQualityList"].get("role"), "listbox")
        self.assertEqual(self.markup.by_id["playbackQualityList"].get("role"), "listbox")
        self.assertEqual(self.markup.by_id["downloadQualityTrigger"].get("aria-haspopup"), "listbox")
        self.assertEqual(self.markup.by_id["downloadStatus"].get("role"), "status")
        self.assertEqual(self.markup.by_id["downloadStatus"].get("aria-live"), "polite")

    def test_discovery_row_uses_sibling_operable_play_and_download_controls(self):
        factory = re.search(
            r"(?s)function createDiscoverySongRow\(song, index\) \{(.*?)\n        \}\n\n        function addDiscoverySong",
            self.source,
        )
        self.assertIsNotNone(factory)
        source = factory.group(1)
        self.assertIn("const action = document.createElement('button');", source)
        self.assertIn("action.className = 'discovery-song-action';", source)
        self.assertIn("action.addEventListener('click', () => addDiscoverySong(song));", source)
        self.assertIn("actions.append(action, downloadButton);", source)
        self.assertIn("row.append(playButton, actions);", source)
        self.assertNotIn("playButton.append(number, main, album, action);", source)

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
