#!/usr/bin/env bash
# Emulator upgrade test. Installs the published APK, builds a real library (a sample book
# with reading time and a quote, four large illustrated books, ~300 MB), tries a backup
# with the published version, installs the new APK over it and checks that every table
# and every file is unchanged, then makes a backup with the new version and checks it on
# the computer.
#
# Usage: scripts/ci-upgrade.sh <published.apk> <new.apk> <results dir> [published version built for x86_64]
set -uo pipefail

OLD_APK="$1"
NEW_APK="$2"
OUT="$3"
OLD_FALLBACK="${4:-}"
PKG=com.redcodesnoo.lnbook
mkdir -p "$OUT"
failed=()

launch() {
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null
  sleep "${1:-15}"
}

# What the app logged about a backup (the published version only says "The backup failed").
backup_log() {
  adb logcat -d -s ReactNativeJS:V AndroidRuntime:E ActivityManager:I \
    | grep -iE -A4 "backup|OutOfMemory|lowmemory|Process $PKG.*(died|killed)" | tail -n 60 > "$1" || true
  cat "$1"
}

echo "::group::Published version: install and build the library"
if ! adb install "$OLD_APK"; then
  echo "::warning::The emulator cannot install the published ARM APK: using the same version built from its tag for x86_64"
  adb install "$OLD_FALLBACK" || { echo "::error::Cannot install the published version"; exit 1; }
fi
launch 30
if [ -z "$(adb shell pidof "$PKG" | tr -d '\r')" ]; then
  echo "::warning::The published ARM APK does not start on the emulator: using the same version built from its tag for x86_64"
  adb uninstall "$PKG"
  adb install "$OLD_FALLBACK" || { echo "::error::Cannot install the published version"; exit 1; }
  launch 20
fi
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode|primaryCpuAbi" | tee "$OUT/old-version.txt"
node scripts/make-sample-epub.js "$OUT/sample.epub"
scripts/ci-open-sample.sh "$OUT/sample.epub"
maestro test -e TITLE='Sample Saga' .maestro/upgrade/wait-book.yaml || failed+=("import sample")
for i in 1 2 3 4; do
  node scripts/make-big-epub.js "$OUT/big$i.epub" "Tome $i" 75 150
  scripts/ci-open-sample.sh "$OUT/big$i.epub"
  maestro test -e TITLE="Tome $i" .maestro/upgrade/wait-book.yaml || failed+=("import Tome $i")
  rm -f "$OUT/big$i.epub"
done
# Reading time, history, a quote in a folder.
scripts/ci-flows.sh reader quotes || echo "::warning::Activity flows failed (data partly created)"
echo "::endgroup::"

echo "::group::Published version: backup of the large library"
adb logcat -c
if maestro test .maestro/upgrade/old-backup.yaml; then
  echo "Published version: the backup of the large library FAILED (reproduced)"
else
  echo "Published version: no failure message shown for the large library"
fi
adb shell input keyevent BACK
backup_log "$OUT/old-backup-large.log"
echo "::endgroup::"

echo "::group::Published version: backup after the last custom font was deleted"
# Deleting the last custom font, the last source or every download of a novel leaves an
# empty folder behind; the published version reads it as a file.
APP_UID=$(adb shell su 0 stat -c %u "/data/data/$PKG" | tr -d '\r')
adb shell "su $APP_UID sh -c 'mkdir -p /data/data/$PKG/files/fonts'"
adb shell am force-stop "$PKG"
adb logcat -c
if maestro test .maestro/upgrade/old-backup.yaml; then
  echo "Published version: the backup FAILED with an empty folder (reproduced)"
else
  echo "Published version: no failure message with an empty folder"
fi
adb shell input keyevent BACK
backup_log "$OUT/old-backup-empty-folder.log"
echo "::endgroup::"

echo "::group::Snapshot before the update"
scripts/ci-snapshot.sh "$OUT/before"
echo "::endgroup::"

echo "::group::Install the new version over the published one"
adb install -r "$NEW_APK" || { echo "::error::The new APK does not install over the published one"; exit 1; }
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode|primaryCpuAbi" | tee "$OUT/new-version.txt"
launch 25
scripts/ci-snapshot.sh "$OUT/after"
if ! python3 scripts/ci_backup_check.py compare "$OUT/before" "$OUT/after"; then
  echo "::error::Data changed or lost during the update"
  failed+=("update keeps the data")
fi
echo "::endgroup::"

echo "::group::New version: complete backup, read back on the computer"
adb logcat -c
if ! scripts/ci-maestro.sh .maestro/upgrade/new-backup.yaml; then
  failed+=("new backup")
fi
backup_log "$OUT/new-backup.log"
scripts/ci-snapshot.sh "$OUT/at-backup"
adb shell su 0 "sh -c 'cp /data/data/$PKG/cache/backups/*.zip /data/local/tmp/backup.zip && chmod 644 /data/local/tmp/backup.zip'" \
  && adb pull /data/local/tmp/backup.zip "$OUT/backup.zip" > /dev/null
if [ -f "$OUT/backup.zip" ]; then
  python3 scripts/ci_backup_check.py verify-zip "$OUT/backup.zip" "$OUT/at-backup" || failed+=("backup content")
  rm -f "$OUT/backup.zip"
else
  failed+=("backup file")
fi
echo "::endgroup::"

rm -f "$OUT"/*.epub
if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::Upgrade test failed: ${failed[*]}"
  exit 1
fi
echo "Upgrade test passed."
