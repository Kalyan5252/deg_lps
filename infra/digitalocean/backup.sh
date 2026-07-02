#!/usr/bin/env bash
# Runs ON the droplet (via cron). Crash-proof backup of the droplet Postgres:
#   1. pg_dump the local `sqlforge` DB (custom format) to /var/backups/sqlforge
#   2. load that dump into the DigitalOcean Managed Postgres (OFF the droplet, so
#      the data survives a droplet crash/loss). The managed cluster additionally
#      keeps its own daily backups + PITR -> double protection.
#   3. prune local dumps older than $KEEP_DAYS.
#
# Config lives in /etc/sqlforge/managed.env (chmod 600), which must define:
#   MANAGED_DATABASE_URL="postgresql://doadmin:PASS@db-host:25060/sqlforge?sslmode=require"
#
# Manual run:  sudo bash /opt/sqlforge/backup.sh
set -euo pipefail

DB_NAME="${DB_NAME:-sqlforge}"
DB_USER="${DB_USER:-sqlforge}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/sqlforge}"
KEEP_DAYS="${KEEP_DAYS:-7}"
CONF="${CONF:-/etc/sqlforge/managed.env}"
LOG="${LOG:-/var/log/sqlforge-backup.log}"

log() { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*" | tee -a "$LOG"; }

mkdir -p "$LOCAL_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP="$LOCAL_DIR/${DB_NAME}-${STAMP}.dump"

log "== backup start =="

# 1. Local dump (custom format = compressed + restorable with pg_restore).
# Stream to stdout so the file is created by the (root) caller — the postgres
# user can't write into the root-owned backup dir.
sudo -u postgres pg_dump -Fc -d "$DB_NAME" > "$DUMP"
log "local dump written: $DUMP ($(du -h "$DUMP" | cut -f1))"

# 2. Ship to the managed DB (off-droplet). Skip cleanly if not configured yet.
if [[ -f "$CONF" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONF"; set +a
fi
if [[ -n "${MANAGED_DATABASE_URL:-}" ]]; then
  log "restoring into managed DB (off-site)…"
  # --clean --if-exists makes it a full overwrite of the target schema each run.
  # --no-owner/--no-privileges: managed roles differ from the droplet's.
  if pg_restore --clean --if-exists --no-owner --no-privileges \
       --exit-on-error -d "$MANAGED_DATABASE_URL" "$DUMP" 2>>"$LOG"; then
    log "managed DB updated OK (off-site copy is current)"
  else
    log "WARNING: managed DB restore failed — local dump kept, will retry next run"
  fi
else
  log "MANAGED_DATABASE_URL not set ($CONF) — local dump only, NO off-site copy yet"
fi

# 3. Prune old local dumps.
find "$LOCAL_DIR" -name "${DB_NAME}-*.dump" -type f -mtime "+${KEEP_DAYS}" -delete
log "pruned local dumps older than ${KEEP_DAYS}d"
log "== backup done =="
