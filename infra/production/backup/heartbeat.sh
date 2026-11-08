# shellcheck shell=bash
# Sourced by backup.sh and restore-check.sh: tells Uptime Kuma how a run
# ended, through a push monitor (docs/operacao.md). Kuma also alerts when
# no push arrives in time, which covers a run that never started.
# With no URL there is no push, so local runs work without Kuma.
heartbeat() {
  local url="$1" status="$2"
  [ -n "$url" ] || return 0
  # A Kuma that is down must not fail the backup itself.
  wget -q -T 10 -O /dev/null "$url?status=$status&msg=$status" ||
    echo "warning: could not reach Uptime Kuma" >&2
}
