#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dist_dir="$project_dir/dist"
static_dir="$dist_dir/static"
server_dir="$dist_dir/server"

mkdir -p "$static_dir" "$server_dir"

# Build into a clean, deterministic output tree. The directory is ignored by
# Git and is a generated artifact, so stale files cannot leak into a release.
rm -rf "$static_dir" "$server_dir"
mkdir -p "$static_dir" "$server_dir"

cp "$project_dir/index.html" "$static_dir/index.html"
cp "$project_dir/admin.html" "$static_dir/admin.html"
cp "$project_dir/offline.html" "$static_dir/offline.html"
cp "$project_dir/playlist-downloader.html" "$static_dir/playlist-downloader.html"
cp "$project_dir/manifest.json" "$static_dir/manifest.json"
cp "$project_dir/sw.js" "$static_dir/sw.js"

for asset_dir in css fonts img js webfonts; do
  mkdir -p "$static_dir/$asset_dir"
  cp -R "$project_dir/$asset_dir/." "$static_dir/$asset_dir/"
done

if test -f "$project_dir/playlist.js"; then
  cp "$project_dir/playlist.js" "$static_dir/playlist.js"
fi

cp "$project_dir/sites/worker.js" "$server_dir/index.js"
cp "$project_dir/sites/music-content.js" "$server_dir/music-content.js"
cp "$project_dir/sites/bilibili.js" "$server_dir/bilibili.js"

cp "$project_dir/sites/chksz.js" "$server_dir/chksz.js"
cp "$project_dir/sites/gd.js" "$server_dir/gd.js"

for module in music-channels channel-http channel-providers op-music xinghai-music music-metadata discovery-content; do
  cp "$project_dir/sites/$module.js" "$server_dir/$module.js"
done
mkdir -p "$dist_dir/js"
cp "$project_dir/js/music-channels.js" "$dist_dir/js/music-channels.js"

cp "$project_dir/js/music-catalog.js" "$dist_dir/js/music-catalog.js"
cp "$project_dir/sites/accounts.js" "$server_dir/accounts.js"
cp "$project_dir/sites/account-auth.js" "$server_dir/account-auth.js"
cp "$project_dir/js/account-data.js" "$dist_dir/js/account-data.js"

for module in operations-store reliability operations-api cover-cache public-pages response-cache admin-bootstrap personal-library playlist-import; do
  cp "$project_dir/sites/$module.js" "$server_dir/$module.js"
done

cp "$project_dir/js/library-data.js" "$dist_dir/js/library-data.js"
cp "$project_dir/js/library-transfer.js" "$dist_dir/js/library-transfer.js"
