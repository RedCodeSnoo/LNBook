#!/usr/bin/env bash
# Runs a Maestro flow; on failure prints what the app logged, to diagnose from the CI log.
#
# Usage: scripts/ci-maestro.sh <flow.yaml>
set -uo pipefail

if maestro test "$1"; then
  exit 0
fi
echo "::group::App log"
adb logcat -d -t 3000 -s ReactNativeJS:V ReactNative:W AndroidRuntime:E || true
echo "::endgroup::"
exit 1
