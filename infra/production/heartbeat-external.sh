#!/bin/bash
# Tells Healthchecks.io, outside the VPS, that the server and its Uptime
# Kuma are alive (docs/operacao.md). Run on the host every 5 minutes by
# partneroj-heartbeat.timer, with .env as its EnvironmentFile.
#
# If the VPS goes down, Kuma goes down with it and cannot alert; this
# ping stops, and Healthchecks.io alerts instead. It pings only while Kuma
# is healthy, so a dead Kuma (the watcher) raises the alert too.
set -euo pipefail

if [ -z "${HEALTHCHECKS_PING_URL:-}" ]; then
  echo "HEALTHCHECKS_PING_URL is not set: no external heartbeat"
  exit 0
fi

kuma=$(docker inspect --format '{{.State.Health.Status}}' partneroj-uptime-kuma-1 2>/dev/null || echo missing)
if [ "$kuma" != healthy ]; then
  # /fail alerts at once, instead of waiting for the grace time.
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "uptime-kuma is $kuma" "$HEALTHCHECKS_PING_URL/fail"
  echo "uptime-kuma is $kuma: reported a failure" >&2
  exit 1
fi

curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECKS_PING_URL"
