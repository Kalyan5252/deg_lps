#!/usr/bin/env bash
# Self-healing SSH tunnel to the Studio's Postgres. Auto-reconnects if the
# Studio sleeps or the connection drops, so the backend keeps working once the
# Studio is back. Keep this terminal open; Ctrl-C to stop.
#
#   STUDIO_SSH="s_xxx@ssh.lightning.ai" bash tunnel.sh
#
# Defaults to local port 5455 (avoids clashing with a local Postgres on 5432).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STUDIO_SSH="${STUDIO_SSH:-$(cat "$HERE/.studio" 2>/dev/null || true)}"
: "${STUDIO_SSH:?Set STUDIO_SSH (or write it to infra/lightning-studio/.studio)}"
LOCAL_PORT="${LOCAL_PORT:-5455}"
REMOTE_PORT="${REMOTE_PORT:-5432}"

echo "Tunnel localhost:${LOCAL_PORT} -> (studio) localhost:${REMOTE_PORT}  [self-healing]"
trap 'echo; echo "tunnel stopped."; exit 0' INT
while true; do
  ssh -N \
    -o StrictHostKeyChecking=accept-new \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
    "${STUDIO_SSH}"
  echo "  tunnel dropped — reconnecting in 3s (Ctrl-C to stop)…"
  sleep 3
done
