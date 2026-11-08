#!/bin/bash
# Restores a snapshot into a clean, throwaway Postgres and checks it
# against production (docs/operacao.md). Production is only read.
#   restore-check.sh             # the latest snapshot
#   restore-check.sh <snapshot>  # a given one, from `restic snapshots`
# Runs in the `backup` service, whose image is the Postgres server itself.
set -euo pipefail

snapshot="${1:-latest}"
work=/tmp/restore
rm -rf "$work"
mkdir -p "$work"

cleanup() {
  pg_ctl --pgdata="$work/pgdata" --mode=immediate stop >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

restic dump "$snapshot" /tmp/backup/roles.sql >"$work/roles.sql"
restic dump "$snapshot" /tmp/backup/partneroj.dump >"$work/partneroj.dump"

# The clean Postgres: a new cluster in /tmp, reachable only through a
# Unix socket in $work, gone when the container exits.
# UTF8 like production; the C locale only changes how text sorts.
initdb --pgdata="$work/pgdata" --username=partneroj --auth=trust \
  --encoding=UTF8 --locale=C >"$work/initdb.log" 2>&1 || {
  cat "$work/initdb.log" >&2
  exit 1
}
pg_ctl --pgdata="$work/pgdata" --wait --log="$work/postgres.log" \
  --options="-c listen_addresses='' -c unix_socket_directories=$work" start >/dev/null

psql_on() { psql --host="$1" --dbname="$2" -X -At -v ON_ERROR_STOP=1 "${@:3}"; }
restored() { psql_on "$work" partneroj "$@"; }
live() { psql_on "$PGHOST" partneroj "$@"; }

# initdb already made the superuser partneroj; every other role comes back.
grep -v '^CREATE ROLE partneroj;$' "$work/roles.sql" | psql_on "$work" postgres -q >/dev/null
psql_on "$work" postgres -c "CREATE DATABASE partneroj OWNER partneroj" >/dev/null
pg_restore --host="$work" --dbname=partneroj --exit-on-error "$work/partneroj.dump"
echo "restored snapshot $snapshot"

failed=0

# Every table reads back. Counts are informational: production may have
# changed since the snapshot.
# Each query is assigned to a variable first: `set -e` stops on a failed
# assignment, but not on a failure inside `for x in $(...)` or "$(...)".
tables=$(restored -c "select tablename from pg_tables where schemaname = 'public' order by 1")
echo "table rows: restored / production"
for table in $tables; do
  in_backup=$(restored -c "select count(*) from public.\"$table\"")
  in_production=$(live -c "select count(*) from public.\"$table\"")
  echo "  $table: $in_backup / $in_production"
done

# Insert-only tables (migrations 0002 and 0005) with time-ordered uuidv7
# ids: the restored rows must be exactly the production rows up to the
# newest restored id. A row changed or removed later breaks the hash.
for table in entries audit_log; do
  # uuid has no max(); the newest is the last one in id order.
  newest=$(restored -c "select id from $table order by id desc limit 1")
  query="select coalesce(md5(string_agg(t::text, ',' order by id)), 'empty') from $table t"
  if [ -n "$newest" ]; then query="$query where id <= '$newest'"; fi
  hash_backup=$(restored -c "$query")
  hash_production=$(live -c "$query")
  if [ "$hash_backup" = "$hash_production" ]; then
    echo "  $table: same rows as production"
  else
    echo "  $table: DIFFERENT from production" >&2
    failed=1
  fi
done

# The golden rule (partners' balances = accounts' balances) joins this
# check when the balances report exists (block 4).

if [ "$failed" -ne 0 ]; then
  echo "restore check FAILED" >&2
  exit 1
fi
echo "restore check passed"
