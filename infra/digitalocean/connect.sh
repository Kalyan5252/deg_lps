#!/usr/bin/env bash
# ONE command to get a working connection to the droplet Postgres:
#   1. syncs setup-postgres.sh to the droplet and (re)ensures PG + role + db
#   2. opens a self-healing SSH tunnel and holds it open
#
#   bash connect.sh          # reads target from .droplet, key ~/.ssh/id_dbs
#
# Then point backend/.env at:
#   DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5455/sqlforge
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DROPLET_SSH="${DROPLET_SSH:-$(cat "$HERE/.droplet" 2>/dev/null || true)}"
: "${DROPLET_SSH:?Set DROPLET_SSH (or write it to infra/digitalocean/.droplet)}"
DROPLET_KEY="${DROPLET_KEY:-$HOME/.ssh/id_dbs}"
LOCAL_PORT="${LOCAL_PORT:-5455}"
SSHOPTS=(-i "${DROPLET_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30)

echo "==> 1/2  Ensuring Postgres is up on the droplet…"
ssh "${SSHOPTS[@]}" "${DROPLET_SSH}" 'bash -s' < "${HERE}/setup-postgres.sh" || {
  echo "   ✗ SSH failed. Check the droplet is running and ~/.ssh/id_dbs is authorized."
  exit 1
}

echo "==> 2/2  Opening self-healing tunnel."
echo "    backend/.env:  DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:${LOCAL_PORT}/sqlforge"
echo "    (keep this terminal open)"
exec env LOCAL_PORT="${LOCAL_PORT}" DROPLET_SSH="${DROPLET_SSH}" DROPLET_KEY="${DROPLET_KEY}" \
  bash "${HERE}/tunnel.sh"
