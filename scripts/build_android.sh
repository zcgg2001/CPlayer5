#!/usr/bin/env sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$project_dir"
# Existing SDK/JDK configuration wins; isolated local tools are optional.
if test -z "${JAVA_HOME:-}" && test -d .local/android-tools/java/Contents/Home; then
  export JAVA_HOME="$project_dir/.local/android-tools/java/Contents/Home"
fi
./android/gradlew -p android assemblePreview testPreviewUnitTest lintPreview
mkdir -p output/android
preview_dir=android/app/build/outputs/apk/preview
version_code=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["elements"][0]["versionCode"])' "$preview_dir/output-metadata.json")
release_apk="CPlayer5-android-preview-$version_code.apk"
cp "$preview_dir/app-preview.apk" "output/android/$release_apk"
cd output/android
cp "$release_apk" CPlayer5-android-preview.apk
shasum -a 256 "$release_apk" > SHA256SUMS.txt
cat SHA256SUMS.txt
