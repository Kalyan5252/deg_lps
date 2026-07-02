#!/usr/bin/env bash
# Run from your laptop. Deploys backup.sh + restore.sh to the droplet and
# installs an hourly backup cron. Optionally writes the managed-DB connection
# string so backups start shipping off-site immediately.
#
#   bash install-backups.sh
#   MANAGED_DATABASE_URL="postgresql://doadmin:PASS@host:25060/sqlforge?sslmode=require" \
#     bash install-backups.sh
#
# Schedule: hourly by default. Override with CRON_SCHEDULE.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DROPLET_SSH="${DROPLET_SSH:-$(cat "$HERE/.droplet" 2>/dev/null || true)}"
: "${DROPLET_SSH:?Set DROPLET_SSH (or write it to infra/digitalocean/.droplet)}"
DROPLET_KEY="${DROPLET_KEY:-$HOME/.ssh/id_dbs}"
CRON_SCHEDULE="${CRON_SCHEDULE:-0 * * * *}"   # hourly, on the hour
SSHOPTS=(-i "${DROPLET_KEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30)

echo "==> Copying scripts to droplet…"
ssh "${SSHOPTS[@]}" "$DROPLET_SSH" 'mkdir -p /opt/sqlforge /etc/sqlforge /var/backups/sqlforge'
scp "${SSHOPTS[@]}" "$HERE/backup.sh" "$HERE/restore.sh" "$DROPLET_SSH:/opt/sqlforge/"
ssh "${SSHOPTS[@]}" "$DROPLET_SSH" 'chmod +x /opt/sqlforge/*.sh'

if [[ -n "${MANAGED_DATABASE_URL:-}" ]]; then
  echo "==> Writing managed-DB config (/etc/sqlforge/managed.env, chmod 600)…"
  ssh "${SSHOPTS[@]}" "$DROPLET_SSH" \
    "umask 077; printf 'MANAGED_DATABASE_URL=%s\n' '$MANAGED_DATABASE_URL' > /etc/sqlforge/managed.env; chmod 600 /etc/sqlforge/managed.env"
else
  echo "==> (no MANAGED_DATABASE_URL provided — off-site shipping stays disabled"
  echo "     until you create /etc/sqlforge/managed.env on the droplet.)"
fi

echo "==> Installing cron ('$CRON_SCHEDULE')…"
ssh "${SSHOPTS[@]}" "$DROPLET_SSH" bash -s <<CRON
set -e
LINE="$CRON_SCHEDULE root /opt/sqlforge/backup.sh >/dev/null 2>&1"
echo "\$LINE" > /etc/cron.d/sqlforge-backup
chmod 644 /etc/cron.d/sqlforge-backup
systemctl restart cron || service cron restart || true
echo "cron installed:"; cat /etc/cron.d/sqlforge-backup
CRON

echo "==> Running one backup now to verify…"
ssh "${SSHOPTS[@]}" "$DROPLET_SSH" 'bash /opt/sqlforge/backup.sh'
echo "==> Done."
