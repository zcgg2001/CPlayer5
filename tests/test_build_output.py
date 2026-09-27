import tempfile
import unittest
from pathlib import Path

from scripts.check_build_output import validate_build


class BuildOutputTests(unittest.TestCase):
    def test_requires_static_and_server_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dist/static").mkdir(parents=True)
            (root / "dist/server").mkdir(parents=True)
            errors = validate_build(root / "dist")
            self.assertIn("missing dist/static/index.html", errors)
            self.assertIn("missing dist/server/index.js", errors)

    def test_rejects_environment_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "dist/static"
            path.mkdir(parents=True)
            (path / ".env.production").write_text("SECRET=bad", encoding="utf-8")
            errors = validate_build(root / "dist")
            self.assertIn("forbidden build artifact static/.env.production", errors)


if __name__ == "__main__":
    unittest.main()
