#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
port=${CPLAYER_SMOKE_PORT:-18787}
log_file=$(mktemp "${TMPDIR:-/tmp}/cplayer-smoke.XXXXXX.log")
headers_file=$(mktemp "${TMPDIR:-/tmp}/cplayer-smoke-headers.XXXXXX")

cleanup() {
  if test -n "${server_pid:-}"; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$log_file" "$headers_file"
}
trap cleanup EXIT INT TERM

CPLAYER_STATIC_DIR="$project_dir/dist/static" PORT="$port" node "$project_dir/server.js" >"$log_file" 2>&1 &
server_pid=$!

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --silent --fail "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done
if test "$ready" -ne 1; then
  cat "$log_file" >&2
  echo "server did not become ready" >&2
  exit 1
fi

curl --silent --fail "http://127.0.0.1:$port/playlist-downloader" >/dev/null
curl --silent --fail "http://127.0.0.1:$port/offline" >/dev/null
curl --silent --fail --head "http://127.0.0.1:$port/fonts/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf" \
  | grep -qi '^content-type: font/ttf'

api_status=$(curl --silent --show-error --output /dev/null --dump-header "$headers_file" \
  --write-out '%{http_code}' "http://127.0.0.1:$port/api/v1/music/search?keyword=smoke")
test "$api_status" = 503
grep -qi 'application/json' "$headers_file"

echo "Server smoke checks passed on port $port."
