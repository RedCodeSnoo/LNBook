#!/usr/bin/env bash
# Runs the emulator flows one after the other. A failing flow does not stop the next
# ones: every result is useful, and the job fails at the end if any flow failed.
#
# Usage: scripts/ci-flows.sh <flow name>...
set -uo pipefail

failed=()
for flow in "$@"; do
  if ! scripts/ci-maestro.sh ".maestro/$flow.yaml"; then
    echo "::error::Flow $flow failed"
    failed+=("$flow")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed flows: ${failed[*]}"
  exit 1
fi
