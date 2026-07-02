#!/usr/bin/env bash
# Runs ON the DigitalOcean droplet. Idempotent: installs PostgreSQL 16, enables
# it to auto-start on boot/crash, and ensures the `sqlforge` role + database
# exist. Postgres listens on localhost only — reach it via the SSH tunnel
# (see tunnel.sh), never over the public internet.
#
# Usage (from the droplet, or via: ssh root@droplet 'bash -s' < setup-postgres.sh):
#   DB_PASSWORD=sqlforge bash setup-postgres.sh
set -euo pipefail

DB_NAME="${DB_NAME:-sqlforge}"
DB_USER="${DB_USER:-sqlforge}"
DB_PASSWORD="${DB_PASSWORD:-sqlforge}"

export DEBIAN_FRONTEND=noninteractive

if ! command -v psql >/dev/null 2>&1; then
  echo "==> Installing PostgreSQL…"
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib >/dev/null
fi
echo "==> $(psql --version)"

# Auto-start on boot and after a crash (systemd restarts the service).
systemctl enable postgresql >/dev/null 2>&1 || true
systemctl start postgresql

echo "==> Ensuring role + database exist…"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL
sudo -u postgres psql -c "GRANT ALL ON DATABASE ${DB_NAME} TO ${DB_USER};"

echo "==> Done. listen_addresses=$(sudo -u postgres psql -tAc 'SHOW listen_addresses;')"
echo "    DB: ${DB_NAME}  role: ${DB_USER}  (localhost:5432, tunnel-only)"
