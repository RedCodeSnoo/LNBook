#!/usr/bin/env bash
# Emulator test helper: gives a book file to the installed app through "Open with".
# The file is first placed in the cache of the app (owned by the app), because a
# release build cannot read the folders the adb shell can write to.
#
# Usage: scripts/ci-open-sample.sh <file.epub>
set -euo pipefail

FILE="$1"
PKG=com.redcodesnoo.lnbook
NAME=$(basename "$FILE")

adb push "$FILE" "/data/local/tmp/$NAME"
adb shell chmod 644 "/data/local/tmp/$NAME"
APP_UID=$(adb shell su 0 stat -c %u "/data/data/$PKG" | tr -d '\r')
adb shell "su $APP_UID sh -c 'mkdir -p /data/data/$PKG/cache/test && cat /data/local/tmp/$NAME > /data/data/$PKG/cache/test/$NAME'"
adb shell su 0 ls -la "/data/data/$PKG/cache/test"
adb shell am start -a android.intent.action.VIEW -t application/epub+zip \
  -d "file:///data/data/$PKG/cache/test/$NAME" "$PKG"
