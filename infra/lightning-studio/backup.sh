#!/usr/bin/env bash
# Take an immediate snapshot of the Studio DB to its persistent disk.
# (The setup script also snapshots every few minutes automatically; run this
#  before deliberately stopping the Studio to capture the very latest state.)
#
#   STUDIO_SSH="s_xxx@ssh.lightning.ai" bash backup.sh
set -uo pipefail
: "${STUDIO_SSH:?Set STUDIO_SSH, e.g. s_xxx@ssh.lightning.ai}"
ssh -o StrictHostKeyChecking=accept-new "${STUDIO_SSH}" '
  mkdir -p ~/sqlforge/backups
  docker exec sqlforge_pg pg_dump -U sqlforge -Fc sqlforge > ~/sqlforge/backups/latest.dump.tmp \
    && mv -f ~/sqlforge/backups/latest.dump.tmp ~/sqlforge/backups/latest.dump \
    && echo "snapshot saved:" && ls -lh ~/sqlforge/backups/latest.dump
'
