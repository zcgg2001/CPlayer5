import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.check_static_site import validate_site


REQUIRED_STATIC = {
    "index.html",
    "offline.html",
    "playlist-downloader.html",
    "manifest.json",
    "sw.js",
    "css/studio.css",
    "js/playback-session.js",
    "js/playback-controller.js",
    "js/queue-store.js",
    "js/cache-store.js",
    "img/icon.svg",
}
REQUIRED_SERVER = {"index.js", "music-content.js", "bilibili.js", "chksz.js", "gd.js"}
FORBIDDEN_NAMES = {".env", ".dev.vars", "node_modules"}


def validate_build(dist_root):
    dist_root = Path(dist_root)
    static_root = dist_root / "static"
    server_root = dist_root / "server"
    errors = []

    if not static_root.is_dir():
        errors.append("missing dist/static")
    else:
        errors.extend(f"static/{error}" for error in validate_site(static_root))
        for relative_path in sorted(REQUIRED_STATIC):
            if not (static_root / relative_path).is_file():
                errors.append(f"missing dist/static/{relative_path}")

    if not server_root.is_dir():
        errors.append("missing dist/server")
    else:
        for relative_path in sorted(REQUIRED_SERVER):
            if not (server_root / relative_path).is_file():
                errors.append(f"missing dist/server/{relative_path}")

    for path in dist_root.rglob("*"):
        if path.name in FORBIDDEN_NAMES or path.name.startswith(".env"):
            errors.append(f"forbidden build artifact {path.relative_to(dist_root)}")

    return errors


if __name__ == "__main__":
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dist")
    errors = validate_build(root)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print(f"Build output checks passed: {root}")
