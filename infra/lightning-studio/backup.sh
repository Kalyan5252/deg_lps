#!/usr/bin/env bash
# Take an immediate snapshot of the Studio DB to its persistent disk.
# (The setup script also snapshots every few minutes automatically; run this
#  before deliberately stopping the Studio to capture the very latest state.)
#
#   STUDIO_SSH="s_xxx@ssh.lightning.ai" bash backup.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STUDIO_SSH="${STUDIO_SSH:-$(cat "$HERE/.studio" 2>/dev/null || true)}"
: "${STUDIO_SSH:?Set STUDIO_SSH (or write it to infra/lightning-studio/.studio)}"
ssh -o StrictHostKeyChecking=accept-new "${STUDIO_SSH}" '
  mkdir -p ~/sqlforge/backups
  docker exec sqlforge_pg pg_dump -U sqlforge -Fc sqlforge > ~/sqlforge/backups/latest.dump.tmp \
    && mv -f ~/sqlforge/backups/latest.dump.tmp ~/sqlforge/backups/latest.dump \
    && echo "snapshot saved:" && ls -lh ~/sqlforge/backups/latest.dump
'
