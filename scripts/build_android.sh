#!/usr/bin/env sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$project_dir"
# Existing SDK/JDK configuration wins; isolated local tools are optional.
if test -z "${JAVA_HOME:-}" && test -d .local/android-tools/java/Contents/Home; then
  export JAVA_HOME="$project_dir/.local/android-tools/java/Contents/Home"
fi
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
mkdir -p output/android
cp android/app/build/outputs/apk/debug/app-debug.apk output/android/CPlayer5-android-preview.apk
shasum -a 256 output/android/CPlayer5-android-preview.apk
