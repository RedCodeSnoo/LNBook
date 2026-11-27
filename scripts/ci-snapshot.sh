#!/usr/bin/env bash
# Emulator upgrade test: copies the database of the app and the checksum of every file of
# its storage to <dir>, with the app stopped (the database and its WAL are consistent).
#
# Usage: scripts/ci-snapshot.sh <dir>
set -euo pipefail

DIR="$1"
PKG=com.redcodesnoo.lnbook
mkdir -p "$DIR"
adb shell am force-stop "$PKG"
sleep 2
adb shell su 0 "rm -rf /data/local/tmp/snap && mkdir -p /data/local/tmp/snap"
adb shell su 0 "sh -c 'cp /data/data/$PKG/files/SQLite/lnbook.db* /data/local/tmp/snap/ && chmod 644 /data/local/tmp/snap/*'"
for name in $(adb shell su 0 ls /data/local/tmp/snap | tr -d '\r'); do
  adb pull "/data/local/tmp/snap/$name" "$DIR/$name" > /dev/null
done
adb shell su 0 "sh -c 'cd /data/data/$PKG/files && find . -type f ! -path \"./SQLite/*\" -exec sha256sum {} +'" \
  | tr -d '\r' > "$DIR/files.sha256"
adb shell su 0 "sh -c 'cd /data/data/$PKG/files && find . -type d'" | tr -d '\r' | sort > "$DIR/dirs.txt"
echo "Snapshot $DIR: $(wc -l < "$DIR/files.sha256") files"
ls -la "$DIR"
