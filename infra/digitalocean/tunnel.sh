#!/usr/bin/env bash
# Self-healing SSH tunnel to the droplet's Postgres. Auto-reconnects if the
# connection drops. Keep this terminal open; Ctrl-C to stop.
#
#   bash tunnel.sh                     # reads target from .droplet
#   DROPLET_SSH=root@1.2.3.4 bash tunnel.sh
#
# Local port 5455 -> droplet localhost:5432 (avoids clashing with any local PG).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DROPLET_SSH="${DROPLET_SSH:-$(cat "$HERE/.droplet" 2>/dev/null || true)}"
: "${DROPLET_SSH:?Set DROPLET_SSH (or write it to infra/digitalocean/.droplet)}"
DROPLET_KEY="${DROPLET_KEY:-$HOME/.ssh/id_dbs}"
LOCAL_PORT="${LOCAL_PORT:-5455}"
REMOTE_PORT="${REMOTE_PORT:-5432}"

echo "Tunnel localhost:${LOCAL_PORT} -> (droplet) localhost:${REMOTE_PORT}  [self-healing]"
trap 'echo; echo "tunnel stopped."; exit 0' INT
while true; do
  ssh -N -i "${DROPLET_KEY}" \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
    "${DROPLET_SSH}"
  echo "  tunnel dropped — reconnecting in 3s (Ctrl-C to stop)…"
  sleep 3
done
