#!/bin/bash
# Backs up the database into the local restic repository (docs/operacao.md).
#   backup.sh              # daily, from the systemd timer
#   backup.sh pre-deploy   # from deploy.sh, right before the migrations
# Runs in the `backup` service: PG* and RESTIC_* come from compose.yml.
set -euo pipefail

tag="${1:-daily}"
# A fixed path, because restic stores absolute paths and restore-check.sh
# reads the files back by name.
work=/tmp/backup
rm -rf "$work"
mkdir -p "$work"
# shellcheck source=heartbeat.sh
source "$(dirname "$0")/heartbeat.sh"
on_exit() {
  local code=$?
  rm -rf "$work"
  if [ "$code" -ne 0 ]; then heartbeat "${BACKUP_PUSH_URL:-}" down; fi
}
trap on_exit EXIT

# First run: create the repository. Checked by file, not by opening it,
# so a wrong password fails below as a wrong password.
if [ ! -f "$RESTIC_REPOSITORY/config" ]; then
  restic init
fi

# Roles live in the cluster, not in the database, and pg_dump leaves them
# out. Restoring needs partneroj_app (owner of pgboss, target of the
# grants). Passwords stay out: a restore sets new ones.
pg_dumpall --roles-only --no-role-passwords >"$work/roles.sql"
pg_dump --format=custom --file="$work/partneroj.dump"

restic backup --host partneroj --tag "$tag" "$work/roles.sql" "$work/partneroj.dump"

# Plan section 11: 7 daily, 4 weekly and 12 monthly. --keep-daily keeps
# only the last snapshot of each day, so on a day with two deploys the
# first pre-deploy snapshot, the one taken before the first migration,
# would go; --keep-within keeps every snapshot of the last 7 days.
restic forget --host partneroj --group-by host --keep-within 7d \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check
echo "backup done ($tag)"
heartbeat "${BACKUP_PUSH_URL:-}" up
