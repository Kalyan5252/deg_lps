#!/usr/bin/env bash
# Open an SSH tunnel from your laptop to the Postgres running in your Lightning
# Studio, so the backend can reach it at localhost:5432 over raw TCP (the
# Postgres wire protocol doesn't go through Lightning's HTTP port-sharing).
#
# 1. In the Studio, click the SSH button and copy the connection target — the
#    part after `ssh `, e.g.  s_01hxxxxxxxx@ssh.lightning.ai
# 2. Run:
#       STUDIO_SSH="s_01hxxxxxxxx@ssh.lightning.ai" bash tunnel.sh
# 3. Leave this running, and point the backend at:
#       DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5432/sqlforge
#
# Requires your Lightning SSH key to be configured locally (Studio → SSH shows
# the `ssh-keygen`/key steps the first time).
set -euo pipefail

: "${STUDIO_SSH:?Set STUDIO_SSH to your Studio's ssh target, e.g. s_xxx@ssh.lightning.ai}"
LOCAL_PORT="${LOCAL_PORT:-5432}"
REMOTE_PORT="${REMOTE_PORT:-5432}"

echo "Tunnelling localhost:${LOCAL_PORT} -> (studio) localhost:${REMOTE_PORT} via ${STUDIO_SSH}"
echo "Keep this terminal open. Ctrl-C to close the tunnel."
exec ssh -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
  "${STUDIO_SSH}"
