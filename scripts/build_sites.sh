#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dist_dir="$project_dir/dist"
static_dir="$dist_dir/static"
server_dir="$dist_dir/server"

mkdir -p "$static_dir" "$server_dir"

cp "$project_dir/index.html" "$static_dir/index.html"
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
