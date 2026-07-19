import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_MANIFEST_ICON_SOURCES = {"img/icon.svg", "img/icon.png"}
REQUIRED_CORE_ASSETS = {
    "./",
    "./index.html",
    "./offline.html",
    "./playlist-downloader.html",
    "./css/all.min.css",
    "./css/app-shell.css",
    "./css/noto-sans-sc.css",
    "./css/oneko-butterfly.css",
    "./js/app-shell.js",
    "./js/tailwindcss.js",
    "./js/color-thief.umd.js",
    "./js/security.js",
    "./js/http.js",
    "./js/music-data.js",
    "./js/music-download.js",
    "./js/download-session.js",
    "./js/oneko-butterfly.js",
    "./img/icon.svg",
    "./img/icon.png",
    "./img/oneko-tora.gif",
    "./manifest.json",
}


class PwaContractTests(unittest.TestCase):
    def test_manifest_and_service_worker_registration_contract_remain(self):
        index_source = (ROOT / "index.html").read_text(encoding="utf-8")
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

        self.assertIn('<link rel="manifest" href="manifest.json">', index_source)
        self.assertIn("navigator.serviceWorker.register('./sw.js')", index_source)
        self.assertEqual(manifest.get("start_url"), "./index.html")
        self.assertEqual(manifest.get("scope"), "./")
        self.assertEqual(manifest.get("display"), "standalone")

        icons = manifest.get("icons")
        self.assertIsInstance(icons, list)
        self.assertTrue(icons)
        icon_sources = []
        for icon in icons:
            self.assertIsInstance(icon, dict)
            source = icon.get("src")
            self.assertIsInstance(source, str)
            self.assertTrue(source.strip())
            icon_sources.append(source)
            self.assertTrue((ROOT / source.removeprefix("./")).is_file())
        self.assertEqual(REQUIRED_MANIFEST_ICON_SOURCES - set(icon_sources), set())

    def test_service_worker_cache_and_precache_contract_remain(self):
        worker_source = (ROOT / "sw.js").read_text(encoding="utf-8")

        self.assertTrue(worker_source.strip())
        self.assertIn("const SHELL_CACHE = 'cplayer5-shell-v16';", worker_source)
        self.assertIn("const COVER_CACHE = 'cplayer5-covers-v1';", worker_source)
        self.assertIn(
            "const ACTIVE_CACHES = new Set([SHELL_CACHE, COVER_CACHE]);",
            worker_source,
        )
        self.assertIn("const MAX_COVER_ENTRIES = 100;", worker_source)

        core_assets_match = re.search(
            r"const CORE_ASSETS = \[(.*?)\];",
            worker_source,
            re.DOTALL,
        )
        self.assertIsNotNone(core_assets_match)
        core_assets = re.findall(r"['\"]([^'\"]+)['\"]", core_assets_match.group(1))
        self.assertTrue(core_assets)
        self.assertEqual(len(core_assets), len(set(core_assets)))
        self.assertEqual(REQUIRED_CORE_ASSETS - set(core_assets), set())

        for asset in core_assets:
            if asset == "./":
                self.assertTrue(ROOT.is_dir())
            else:
                self.assertTrue((ROOT / asset.removeprefix("./")).is_file())

        self.assertIn("self.addEventListener('install'", worker_source)
        self.assertIn("const cache = await caches.open(SHELL_CACHE);", worker_source)
        self.assertIn("await cache.addAll(CORE_ASSETS);", worker_source)
        self.assertIn("self.addEventListener('activate'", worker_source)
        self.assertIn("self.addEventListener('fetch'", worker_source)
