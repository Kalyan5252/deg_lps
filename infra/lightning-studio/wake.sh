#!/usr/bin/env bash
# Wake a sleeping Lightning Studio and bring its Postgres back up, then open the
# tunnel — a full "cold start to ready" for the Studio-DB topology.
#
#   STUDIO_SSH="s_xxx@ssh.lightning.ai" bash wake.sh
#
# Optional, for a true cold start from a fully *stopped* Studio (SSH alone may
# not resume it): install the Lightning SDK and set creds, then this script will
# call Studio.start() first:
#   pip install lightning-sdk
#   export LIGHTNING_USER_ID=...  LIGHTNING_API_KEY=...   # from lightning.ai settings
#   export STUDIO_NAME=...  STUDIO_TEAMSPACE=...          # the studio + teamspace names
#
# NOTE: a Studio's Docker storage is ephemeral, so the container is recreated on
# each wake. Data survives because setup-postgres.sh bind-mounts it to
# $HOME/sqlforge_pgdata (persistent). Expect ~30-90s.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${STUDIO_SSH:?Set STUDIO_SSH to your Studio's ssh target, e.g. s_xxx@ssh.lightning.ai}"
LOCAL_PORT="${LOCAL_PORT:-5455}"

# 1) Boot the compute via the SDK if creds are present (most reliable).
if [[ -n "${STUDIO_NAME:-}" && -n "${LIGHTNING_API_KEY:-}" ]] && command -v python3 >/dev/null; then
  echo "==> Starting Studio '${STUDIO_NAME}' via Lightning SDK…"
  STUDIO_NAME="${STUDIO_NAME}" STUDIO_TEAMSPACE="${STUDIO_TEAMSPACE:-}" python3 - <<'PY' || echo "    (SDK start skipped/failed — falling back to SSH resume)"
import os
from lightning_sdk import Studio
kwargs = {"name": os.environ["STUDIO_NAME"]}
if os.environ.get("STUDIO_TEAMSPACE"):
    kwargs["teamspace"] = os.environ["STUDIO_TEAMSPACE"]
s = Studio(**kwargs)
s.start()
print("    status:", s.status)
PY
fi

# 2) SSH in (this also resumes a lightly-idled Studio) and (re)create Postgres.
echo "==> Ensuring Postgres is up in the Studio (persistent data dir)…"
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=90 "$STUDIO_SSH" '
  set -e
  if docker ps --format "{{.Names}}" | grep -q "^sqlforge_pg$"; then
    echo "    container already running"
  else
    PGDATA_DIR="$HOME/sqlforge_pgdata"; mkdir -p "$PGDATA_DIR"
    docker rm -f sqlforge_pg >/dev/null 2>&1 || true
    docker run -d --name sqlforge_pg \
      -e POSTGRES_USER=sqlforge -e POSTGRES_PASSWORD=sqlforge -e POSTGRES_DB=sqlforge \
      -p 5432:5432 -v "$PGDATA_DIR":/var/lib/postgresql/data \
      postgres:16 -c shared_buffers=4GB -c effective_cache_size=12GB \
      -c work_mem=64MB -c max_connections=50 -c max_parallel_workers=4 >/dev/null
  fi
  for _ in $(seq 1 60); do docker exec sqlforge_pg pg_isready -U sqlforge >/dev/null 2>&1 && break; sleep 1; done
  docker exec sqlforge_pg pg_isready -U sqlforge
'

# 3) (Re)open the tunnel.
echo "==> Opening tunnel localhost:${LOCAL_PORT} -> Studio:5432 …"
lsof -ti:"${LOCAL_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
LOCAL_PORT="${LOCAL_PORT}" STUDIO_SSH="${STUDIO_SSH}" bash "${HERE}/tunnel.sh"
