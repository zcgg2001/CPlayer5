import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


OPTIONAL_ASSETS = {"playlist.js"}


class LocalAssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        attribute = {"img": "src", "script": "src", "link": "href"}.get(tag)
        if attribute and attributes.get(attribute):
            self.assets.append(attributes[attribute])


def _local_path(reference):
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or reference.startswith(("#", "//")):
        return None
    return parsed.path.removeprefix("./")


def validate_site(root):
    root = Path(root)
    errors = []

    for html_file in sorted(root.glob("*.html")):
        parser = LocalAssetParser()
        parser.feed(html_file.read_text(encoding="utf-8"))
        for reference in parser.assets:
            local_path = _local_path(reference)
            if (
                local_path
                and local_path not in OPTIONAL_ASSETS
                and not (root / local_path).is_file()
            ):
                errors.append(
                    f"{html_file.name}: missing local asset {local_path}"
                )

    manifest_file = root / "manifest.json"
    if manifest_file.is_file():
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        for icon in manifest.get("icons", []):
            local_path = _local_path(icon.get("src", ""))
            if local_path and not (root / local_path).is_file():
                errors.append(
                    f"manifest.json: missing local asset {local_path}"
                )

    return errors


if __name__ == "__main__":
    validation_errors = validate_site(Path.cwd())
    if validation_errors:
        print("\n".join(validation_errors), file=sys.stderr)
        raise SystemExit(1)
    print("Static site checks passed.")
