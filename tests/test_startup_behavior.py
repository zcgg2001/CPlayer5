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

    def test_desktop_shell_initializes_with_injected_elements_and_actions(self):
        self.assertIn(
            "import { DESKTOP_SHELL_MEDIA, initAppShell } from './js/app-shell.js';",
            self.source,
        )
        startup = function_block(
            self.source,
            "document.addEventListener('DOMContentLoaded', async () => {",
            "function initEventListeners()",
        )
        for fragment in (
            "desktopShell = initAppShell({",
            "shell: dom.desktopShell",
            "immersive: dom.desktopLayout",
            "opener: dom.desktopMiniPlayer",
            "closeButton: dom.desktopImmersiveClose",
            "backButton: dom.desktopBackBtn",
            "forwardButton: dom.desktopForwardBtn",
            "destinationButtons: Array.from(document.querySelectorAll('[data-shell-destination]'))",
            "eventTarget: document",
            "documentElement: document.documentElement",
            "switchDesktopTab('playlist');",
            "togglePlaylistPanel(true);",
            "togglePlaylistPanel(false);",
            "document.getElementById('searchInput')?.focus();",
            "document.getElementById('playlistFile')?.click()",
            "settings: openSettings",
            "onImmersiveChange: syncContinuousRendering",
        ):
            self.assertIn(fragment, startup)

    def test_desktop_shell_scopes_inertness_navigation_state_and_library_focus(self):
        startup = function_block(
            self.source,
            "document.addEventListener('DOMContentLoaded', async () => {",
            "function initEventListeners()",
        )
        shell_init = function_block(
            startup,
            "desktopShell = initAppShell({",
            "restoreLastCover();",
        )
        for fragment in (
            "inertTargets: [",
            "document.querySelector('.app-skip-link')",
            "dom.desktopShell.querySelector('.app-sidebar')",
            "dom.desktopShell.querySelector('.app-topbar')",
            "dom.desktopLibraryView",
            "dom.floatingPlaylistPanel",
            "navigationButtons: Array.from(document.querySelectorAll('.app-navigation [data-shell-destination]'))",
            "library: () => dom.desktopLibraryView?.focus()",
        ):
            self.assertIn(fragment, shell_init)
        self.assertNotIn("dom.desktopPlayerBar", shell_init)

    def test_shell_owned_destinations_do_not_keep_legacy_desktop_bindings(self):
        listeners = function_block(
            self.source,
            "function initEventListeners()",
            "function toggleSearchPanel(forceState)",
        )
        self.assertNotIn(
            "document.getElementById('togglePlaylistBtn').addEventListener",
            listeners,
        )
        self.assertNotIn("safeSettingsBtn", listeners)
        self.assertIn("closest?.('[data-shell-destination=\"queue\"]')", listeners)
        self.assertIn("closest?.('#desktopBackBtn, #desktopForwardBtn')", listeners)
        self.assertIn("queueHistoryDestination", listeners)
        self.assertIn("e.target === dom.playlistFile", listeners)
        self.assertIn("closest?.('[data-shell-destination=\"import\"]')", listeners)

    def test_desktop_mini_cover_tracks_restored_and_loaded_artwork(self):
        restore = function_block(
            self.source,
            "function restoreLastCover()",
            "let nativeIntegrationInitialized",
        )
        load_song = function_block(
            self.source,
            "async function loadAndPlaySong(id)",
            "function updatePlayerState()",
        )
        self.assertIn("dom.desktopMiniCover.src = savedCover", restore)
        self.assertIn("dom.desktopMiniCover.src = picUrl", load_song)
        self.assertNotIn("MutationObserver", self.source)

    def test_discovery_loads_new_song_chart_and_reuses_the_queue(self):
        self.assertIn("const NEW_SONGS_PLAYLIST_ID = '3779629';", self.source)
        service = function_block(
            self.source,
            "class MusicService",
            "class LyricService",
        )
        self.assertIn("async getNewSongs", service)
        self.assertIn("/163_playlist?id=${NEW_SONGS_PLAYLIST_ID}", service)
        self.assertIn("normalizePlaylistPayload(json).slice(0, 12)", service)

        startup = function_block(
            self.source,
            "document.addEventListener('DOMContentLoaded', async () => {",
            "function initEventListeners()",
        )
        self.assertIn("loadNewSongDiscovery();", startup)

        listeners = function_block(
            self.source,
            "function initEventListeners()",
            "function toggleSearchPanel(forceState)",
        )
        self.assertIn(
            "dom.desktopDiscoveryRefresh?.addEventListener('click', loadNewSongDiscovery);",
            listeners,
        )

        discovery = function_block(
            self.source,
            "async function loadNewSongDiscovery()",
            "// ★ Helper for MediaSession",
        )
        for fragment in (
            "musicService.getNewSongs",
            "window.insertSongToPlaylist(newSong)",
            "window.playSongAtIndex(targetIndex)",
            "existingIndex",
            "document.createElement('button')",
            "replaceChildren",
        ):
            self.assertIn(fragment, discovery)

    def test_song_resolution_falls_back_across_supported_quality_levels(self):
        self.assertIn(
            "const SONG_QUALITY_FALLBACKS = ['jymaster', 'lossless', 'exhigh', 'standard'];",
            self.source,
        )
        service = function_block(
            self.source,
            "class MusicService",
            "class LyricService",
        )
        self.assertIn("for (const level of SONG_QUALITY_FALLBACKS)", service)
        self.assertIn("normalizeSongPayload(json, level)", service)
        self.assertIn("if (song) return song;", service)

    def test_desktop_progress_supports_keyboard_seek_and_aria_updates(self):
        listeners = function_block(
            self.source,
            "function initEventListeners()",
            "function toggleSearchPanel(forceState)",
        )
        player_state = function_block(
            self.source,
            "function updatePlayerState()",
            "// ================= 歌词逻辑",
        )
        self.assertIn(
            "dom.progressBarContainer.addEventListener('keydown', seekAudioByKeyboard);",
            listeners,
        )
        for key in ("ArrowLeft", "ArrowRight", "Home", "End"):
            self.assertIn(key, player_state)
        self.assertIn("event.preventDefault();", player_state)
        self.assertIn("aria-valuenow", player_state)

    def test_application_layout_decisions_use_the_shell_media_query(self):
        self.assertIn(
            "const desktopShellMedia = window.matchMedia(DESKTOP_SHELL_MEDIA);",
            self.source,
        )
        self.assertIn(
            "const isCompactLayout = () => !desktopShellMedia.matches;",
            self.source,
        )
        self.assertNotRegex(self.source, r"window\.innerWidth\s*(?:<|<=)\s*768")
        self.assertGreaterEqual(self.source.count("isCompactLayout()"), 3)
        self.assertRegex(
            self.source,
            r"(?s)@media \(max-width: 1023\.98px\)\s*\{\s*body\s*\{\s*overscroll-behavior:\s*none;",
        )
        self.assertRegex(
            self.source,
            r"(?s)@media \(max-width: 1023\.98px\)\s*\{\s*#fullscreenBtn\.mobile-hide\s*\{\s*display:\s*none !important;",
        )

    def test_fullscreen_button_tracks_actual_document_state(self):
        sync_marker = "function syncFullscreenButton()"
        self.assertIn(sync_marker, self.source)
        sync = function_block(
            self.source,
            sync_marker,
            "function toggleFullScreen()",
        )
        self.assertIn("Boolean(document.fullscreenElement)", sync)
        self.assertIn("icon.classList.toggle('fa-expand', !isFullscreen);", sync)
        self.assertIn("icon.classList.toggle('fa-compress', isFullscreen);", sync)
        self.assertEqual(
            self.source.count(
                "document.addEventListener('fullscreenchange', syncFullscreenButton);"
            ),
            1,
        )
        toggle = function_block(
            self.source,
            "function toggleFullScreen()",
            "// 沉浸模式状态",
        )
        self.assertIn("await document.documentElement.requestFullscreen();", toggle)
        self.assertIn("await document.exitFullscreen();", toggle)
        self.assertNotIn("classList.replace", toggle)

    def test_desktop_browsing_pauses_continuous_renderers(self):
        predicate = function_block(
            self.source,
            "function shouldAnimateContinuously()",
            "// ================= ★ FluidBackground",
        )
        self.assertIn("desktopShellMedia.matches", predicate)
        self.assertIn("desktop-immersive-open", predicate)
        self.assertIn("!desktopBrowsing", predicate)
        self.assertIn(
            "desktopShellMedia.addEventListener('change', syncContinuousRendering)",
            self.source,
        )

    def test_visualizer_uses_an_idempotent_continuous_render_controller(self):
        visualizer = function_block(
            self.source,
            "function initVisualizer()",
            "// rgbToHsl - 保留供流体背景使用",
        )
        sync = function_block(
            self.source,
            "function syncContinuousRendering()",
            "document.addEventListener('visibilitychange'",
        )
        for fragment in (
            "let animationFrame = null;",
            "if (animationFrame !== null) return;",
            "animationFrame = requestAnimationFrame(draw);",
            "if (animationFrame === null) return;",
            "cancelAnimationFrame(animationFrame);",
            "return { start, stop };",
        ):
            self.assertIn(fragment, visualizer)
        self.assertNotRegex(visualizer, r"\n\s*draw\(\);\s*\n")
        self.assertIn("visualizer = initVisualizer();", self.source)
        self.assertIn("visualizer?.start();", sync)
        self.assertIn("visualizer?.stop();", sync)
        for fragment in (
            "const continuousRendering = shouldAnimateContinuously();",
            "const desktopVisualizerActive = continuousRendering",
            "&& desktopShellMedia.matches",
            "&& document.documentElement.classList.contains('desktop-immersive-open');",
            "if (desktopVisualizerActive)",
        ):
            self.assertIn(fragment, sync)
        self.assertLess(
            sync.index("if (desktopVisualizerActive)"),
            sync.index("visualizer?.start();"),
        )
        self.assertLess(
            sync.index("visualizer?.stop();"),
            sync.index("if (continuousRendering)"),
        )


if __name__ == "__main__":
    unittest.main()
