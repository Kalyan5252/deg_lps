#!/usr/bin/env bash
# Run INSIDE a Lightning Studio. Brings up Postgres and — crucially — makes the
# data survive Studio restarts even though Docker volumes are ephemeral here.
#
# Strategy (robust): the source of truth is a compressed pg_dump kept on the
# Studio's PERSISTENT home. On every start we restore from it if the live DB is
# empty, and a background loop snapshots back to it every few minutes. So even
# if the container/volume is wiped on restart, the data comes back.
#
#   bash setup-postgres.sh
#
# Idempotent — safe to re-run on every wake.
set -euo pipefail

PG_USER="${PG_USER:-sqlforge}"; PG_PASS="${PG_PASS:-sqlforge}"; PG_DB="${PG_DB:-sqlforge}"
PG_PORT="${PG_PORT:-5432}"; CONTAINER="sqlforge_pg"
PERSIST="${PERSIST_DIR:-$HOME/sqlforge}"          # persistent home (survives restart)
PGDATA_DIR="$PERSIST/pgdata"
BACKUP="$PERSIST/backups/latest.dump"
BACKUP_EVERY="${BACKUP_EVERY:-300}"               # seconds between snapshots
mkdir -p "$PGDATA_DIR" "$PERSIST/backups"

command -v docker >/dev/null || { echo "docker required"; exit 1; }

echo "==> Starting Postgres 16 (data: $PGDATA_DIR)"
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  sudo chown -R 999:999 "$PGDATA_DIR" 2>/dev/null || true
  docker run -d --name "${CONTAINER}" --restart unless-stopped \
    -e POSTGRES_USER="${PG_USER}" -e POSTGRES_PASSWORD="${PG_PASS}" -e POSTGRES_DB="${PG_DB}" \
    -p "${PG_PORT}:5432" -v "${PGDATA_DIR}:/var/lib/postgresql/data" \
    postgres:16 -c shared_buffers=4GB -c effective_cache_size=12GB \
    -c work_mem=64MB -c max_connections=50 -c max_parallel_workers=4 >/dev/null
fi

echo -n "    waiting for Postgres"
for _ in $(seq 1 60); do
  docker exec "${CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1 && break
  echo -n "."; sleep 1
done
echo " ready"

# ---- restore from the persistent snapshot if the live DB has no app schema ----
HAS_APP=$(docker exec "${CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" -tAc \
  "SELECT to_regclass('app.users') IS NOT NULL" 2>/dev/null || echo f)
if [ "$HAS_APP" != "t" ] && [ -s "$BACKUP" ]; then
  echo "==> Live DB is empty — restoring from $BACKUP"
  docker exec -i "${CONTAINER}" pg_restore -U "${PG_USER}" -d "${PG_DB}" \
    --no-owner --clean --if-exists < "$BACKUP" 2>/dev/null || true
  echo "    restore complete"
elif [ "$HAS_APP" = "t" ]; then
  echo "==> Live DB already has data (no restore needed)"
else
  echo "==> Fresh DB and no snapshot yet (the backend will seed scenarios)"
fi

# ---- background snapshot loop -> persistent disk (the safety net) ----
PIDFILE="$PERSIST/backups/loop.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "==> Snapshot loop already running (pid $(cat "$PIDFILE"))"
else
  echo "==> Starting snapshot loop (every ${BACKUP_EVERY}s -> $BACKUP)"
  PERSIST="$PERSIST" CONTAINER="$CONTAINER" PG_USER="$PG_USER" PG_DB="$PG_DB" \
  BACKUP_EVERY="$BACKUP_EVERY" nohup bash -c '
    while true; do
      sleep "$BACKUP_EVERY"
      docker exec "$CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" \
        > "$PERSIST/backups/latest.dump.tmp" 2>/dev/null \
        && mv -f "$PERSIST/backups/latest.dump.tmp" "$PERSIST/backups/latest.dump"
    done
  ' >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  disown 2>/dev/null || true
fi

echo ""
echo "============================================================"
echo "Postgres up on :${PG_PORT}.  Data persists via $BACKUP"
echo "From your laptop:  bash connect.sh   (opens a self-healing tunnel)"
echo "============================================================"
