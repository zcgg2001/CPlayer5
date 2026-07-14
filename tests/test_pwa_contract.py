import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PwaContractTests(unittest.TestCase):
    def test_manifest_and_service_worker_contract_remain(self):
        index_source = (ROOT / "index.html").read_text(encoding="utf-8")
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

        self.assertIn('<link rel="manifest" href="manifest.json">', index_source)
        self.assertIn("navigator.serviceWorker.register('./sw.js')", index_source)
        self.assertEqual(manifest.get("start_url"), "./index.html")
        self.assertEqual(manifest.get("scope"), "./")
        self.assertEqual(manifest.get("display"), "standalone")
        for icon in manifest.get("icons", []):
            self.assertTrue((ROOT / icon["src"].removeprefix("./")).is_file())
