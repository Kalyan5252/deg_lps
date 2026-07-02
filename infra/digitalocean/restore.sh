#!/usr/bin/env bash
# Disaster recovery. Rebuild the droplet Postgres from the off-site copy.
#
# Two sources, in order of preference:
#   A) latest local dump in /var/backups/sqlforge  (fast, same box)
#   B) the DigitalOcean Managed DB                  (use after a droplet rebuild)
#
# Usage (on a freshly set-up droplet):
#   sudo bash /opt/sqlforge/restore.sh              # newest local dump
#   sudo bash /opt/sqlforge/restore.sh --from-managed
#   sudo bash /opt/sqlforge/restore.sh /path/to/file.dump
set -euo pipefail

DB_NAME="${DB_NAME:-sqlforge}"
LOCAL_DIR="${LOCAL_DIR:-/var/backups/sqlforge}"
CONF="${CONF:-/etc/sqlforge/managed.env}"

restore_from_dump() {  # $1 = dump file
  echo "==> restoring $1 into local $DB_NAME…"
  # Restore as the postgres superuser but PRESERVE the ownership recorded in the
  # dump (the objects belong to `sqlforge`). Do NOT pass --no-owner here, or the
  # schemas end up owned by postgres and the app (sqlforge) is locked out.
  # After restore, defensively hand everything back to sqlforge in case the dump
  # source had different owners (e.g. a dump pulled from the managed cluster).
  sudo -u postgres pg_restore --clean --if-exists \
    --exit-on-error -d "$DB_NAME" "$1"
  # Hand the app's schemas + their objects to the app role. (Can't use
  # REASSIGN OWNED BY postgres — postgres also owns system objects and PG
  # refuses.) Only touches the app + sandbox_* schemas.
  local own="${DB_USER:-sqlforge}"
  sudo -u postgres psql -d "$DB_NAME" >/dev/null <<PLSQL
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT nspname FROM pg_namespace
           WHERE nspname='app' OR nspname LIKE 'sandbox_%' LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO ${own}', r.nspname);
  END LOOP;
  FOR r IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname='app' OR schemaname LIKE 'sandbox_%' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO ${own}', r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences
           WHERE sequence_schema='app' OR sequence_schema LIKE 'sandbox_%' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO ${own}', r.sequence_schema, r.sequence_name);
  END LOOP;
  FOR r IN SELECT schemaname, viewname FROM pg_views
           WHERE schemaname='app' OR schemaname LIKE 'sandbox_%' LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO ${own}', r.schemaname, r.viewname);
  END LOOP;
END \$\$;
PLSQL
  echo "==> done."
}

if [[ "${1:-}" == "--from-managed" ]]; then
  [[ -f "$CONF" ]] && { set -a; source "$CONF"; set +a; }
  : "${MANAGED_DATABASE_URL:?Set MANAGED_DATABASE_URL in $CONF}"
  TMP="$(mktemp --suffix=.dump)"
  echo "==> dumping managed DB -> $TMP…"
  pg_dump -Fc --no-owner --no-privileges -d "$MANAGED_DATABASE_URL" -f "$TMP"
  restore_from_dump "$TMP"
  rm -f "$TMP"
elif [[ -n "${1:-}" ]]; then
  restore_from_dump "$1"
else
  LATEST="$(ls -1t "$LOCAL_DIR"/${DB_NAME}-*.dump 2>/dev/null | head -1 || true)"
  [[ -n "$LATEST" ]] || { echo "No local dumps in $LOCAL_DIR; try --from-managed"; exit 1; }
  restore_from_dump "$LATEST"
fi
