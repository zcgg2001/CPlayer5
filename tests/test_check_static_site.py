import tempfile
import unittest
from pathlib import Path

from scripts.check_static_site import validate_site


class ValidateSiteTests(unittest.TestCase):
    def test_reports_mjs_files_that_nginx_may_serve_as_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "js").mkdir()
            (root / "js/app.mjs").write_text("export const ready = true;", encoding="utf-8")

            self.assertEqual(
                validate_site(root),
                ["js/app.mjs: unsupported .mjs extension; use .js"],
            )

    def test_reports_missing_local_html_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                '<script src="js/app.js"></script>', encoding="utf-8"
            )

            self.assertEqual(
                validate_site(root),
                ["index.html: missing local asset js/app.js"],
            )

    def test_reports_duplicate_dom_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                '<div id="player"></div><button id="player"></button>',
                encoding="utf-8",
            )

            self.assertEqual(validate_site(root), ["index.html: duplicate id player"])

    def test_reports_shell_entry_targeting_missing_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                '<button data-shell-destination="library" '
                'aria-controls="missing"></button>',
                encoding="utf-8",
            )

            self.assertEqual(
                validate_site(root),
                ["index.html: shell destination library targets missing id missing"],
            )

    def test_allows_shell_entry_targeting_existing_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                '<button data-shell-destination="library" '
                'aria-controls="library"></button><section id="library"></section>',
                encoding="utf-8",
            )

            self.assertEqual(validate_site(root), [])

    def test_allows_optional_local_playlist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                '<script src="playlist.js"></script>', encoding="utf-8"
            )

            self.assertEqual(validate_site(root), [])

    def test_reports_missing_manifest_icon(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "manifest.json").write_text(
                '{"icons": [{"src": "img/icon.png"}]}', encoding="utf-8"
            )

            self.assertEqual(
                validate_site(root),
                ["manifest.json: missing local asset img/icon.png"],
            )

    def test_reports_song_data_interpolated_into_inner_html(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text(
                "element.innerHTML = `<b>${song.name}</b>`;",
                encoding="utf-8",
            )

            self.assertEqual(
                validate_site(root),
                ["index.html: unsafe dynamic innerHTML uses song data"],
            )


if __name__ == "__main__":
    unittest.main()
