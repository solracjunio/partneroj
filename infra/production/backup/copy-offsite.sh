#!/bin/bash
# Copies new snapshots from the local restic repository to the home PC
# (docs/operacao.md), through the WireGuard tunnel, when the PC is on.
#   copy-offsite.sh   # hourly, from partneroj-offsite-copy.timer
# Runs in the `backup` service: RESTIC_* and OFFSITE_* come from compose.yml.
set -euo pipefail

# shellcheck source=heartbeat.sh
source "$(dirname "$0")/heartbeat.sh"
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then heartbeat "${OFFSITE_PUSH_URL:-}" down; fi
}
trap on_exit EXIT

if [ -z "${OFFSITE_PASSWORD:-}" ]; then
  echo "OFFSITE_PASSWORD is not set: no off-site copy configured"
  exit 0
fi

# A PC that is off or asleep is normal, not a failure: no push at all.
# Uptime Kuma alerts when no copy succeeds for 3 days (plan section 11).
if ! nc -z -w 5 "${OFFSITE_HOST%:*}" "${OFFSITE_HOST#*:}"; then
  echo "home PC unreachable at $OFFSITE_HOST: nothing copied"
  exit 0
fi

# Source: the local repository. Destination: the rest-server on the PC,
# in append-only mode, with the same password (one secret to keep).
export RESTIC_FROM_REPOSITORY="$RESTIC_REPOSITORY"
export RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD"
export RESTIC_REPOSITORY="rest:http://partneroj:${OFFSITE_PASSWORD}@${OFFSITE_HOST}/partneroj/"

# First run: create the repository, cutting files at the same points as
# the local one, so the copies deduplicate. Exit code 10: no repository.
set +e
restic cat config >/dev/null 2>&1
status=$?
set -e
if [ "$status" -eq 10 ]; then
  restic init --copy-chunker-params
elif [ "$status" -ne 0 ]; then
  restic cat config >/dev/null # fails again, now showing why
fi

# Copies only the snapshots the PC does not have yet. --retry-lock waits
# for the nightly backup's exclusive lock instead of failing.
restic copy --retry-lock 10m
restic check
echo "off-site copy done"
heartbeat "${OFFSITE_PUSH_URL:-}" up
