#!/usr/bin/env bash
# Run this INSIDE a Lightning Studio to bring up the SQLForge Postgres.
# Free Studio target: 4 vCPU / 16 GB. Postgres is tuned for that box.
#
#   bash setup-postgres.sh
#
# Then connect from your laptop with an SSH tunnel (see tunnel.sh) and point the
# backend's DATABASE_URL at localhost:5432.
set -euo pipefail

PG_USER="${PG_USER:-sqlforge}"
PG_PASS="${PG_PASS:-sqlforge}"
PG_DB="${PG_DB:-sqlforge}"
PG_PORT="${PG_PORT:-5432}"
CONTAINER="sqlforge_pg"

# Tuned for 4 vCPU / 16 GB
PG_TUNING=(
  -c shared_buffers=4GB
  -c effective_cache_size=12GB
  -c work_mem=64MB
  -c maintenance_work_mem=512MB
  -c max_connections=50
  -c max_parallel_workers=4
  -c max_parallel_workers_per_gather=2
  -c random_page_cost=1.1
)

if command -v docker >/dev/null 2>&1; then
  echo "==> Using Docker to run Postgres 16"
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "    Container '${CONTAINER}' already exists — starting it"
    docker start "${CONTAINER}" >/dev/null
  else
    docker run -d --name "${CONTAINER}" \
      -e POSTGRES_USER="${PG_USER}" \
      -e POSTGRES_PASSWORD="${PG_PASS}" \
      -e POSTGRES_DB="${PG_DB}" \
      -p "${PG_PORT}:5432" \
      -v sqlforge_pgdata:/var/lib/postgresql/data \
      postgres:16 "${PG_TUNING[@]}" >/dev/null
  fi
  echo -n "    waiting for Postgres"
  for _ in $(seq 1 30); do
    if docker exec "${CONTAINER}" pg_isready -U "${PG_USER}" >/dev/null 2>&1; then break; fi
    echo -n "."; sleep 1
  done
  echo " ready"
else
  echo "==> Docker not found; installing Postgres via apt"
  sudo apt-get update -y
  sudo apt-get install -y postgresql
  sudo service postgresql start
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASS}'"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1 || \
    sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"
fi

echo ""
echo "============================================================"
echo "Postgres is up in this Studio on port ${PG_PORT}."
echo "  user/pass/db: ${PG_USER}/${PG_PASS}/${PG_DB}"
echo ""
echo "From your laptop, open an SSH tunnel to this Studio, then set:"
echo "  DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}"
echo "  DB_SSLMODE=disable"
echo "============================================================"
