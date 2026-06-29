#!/usr/bin/env bash
# ONE command to get a robust connection to the Studio Postgres after any
# Studio (re)start:
#   1. syncs the infra scripts to the Studio
#   2. starts Postgres there + auto-restores the latest snapshot (data survives
#      restarts) + starts the periodic snapshot loop
#   3. opens a self-healing SSH tunnel and holds it open
#
#   STUDIO_SSH="s_xxx@ssh.lightning.ai" bash connect.sh
#
# Then point backend/.env at:
#   DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5455/sqlforge
set -uo pipefail
: "${STUDIO_SSH:?Set STUDIO_SSH, e.g. s_xxx@ssh.lightning.ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PORT="${LOCAL_PORT:-5455}"
SSHOPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=90)

echo "==> 1/3  Syncing infra to the Studio (also wakes it)…"
scp "${SSHOPTS[@]}" "${HERE}/setup-postgres.sh" "${STUDIO_SSH}:~/setup-postgres.sh" || {
  echo "   ✗ SSH/scp failed. If the Studio is fully stopped, START it from the"
  echo "     Lightning web UI first (SSH is refused while stopped), then re-run."
  exit 1
}

echo "==> 2/3  Starting Postgres + restoring snapshot on the Studio…"
ssh "${SSHOPTS[@]}" "${STUDIO_SSH}" 'bash ~/setup-postgres.sh'

echo "==> 3/3  Opening self-healing tunnel."
echo "    Set backend/.env:  DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:${LOCAL_PORT}/sqlforge"
echo "    (keep this terminal open)"
exec env LOCAL_PORT="${LOCAL_PORT}" STUDIO_SSH="${STUDIO_SSH}" bash "${HERE}/tunnel.sh"
