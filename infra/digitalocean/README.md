# SQLForge DB on a DigitalOcean droplet

Replaces the old Lightning Studio setup (`infra/lightning-studio/`). Postgres now
runs on a dedicated, always-on droplet, reached from the local backend over a
stable SSH tunnel. Crash-proof backups are shipped off-droplet into a
DigitalOcean **Managed Postgres** cluster (which itself keeps daily backups +
point-in-time recovery — so two independent copies).

```
 laptop backend ──SSH tunnel──▶ droplet Postgres (primary, all data)
   localhost:5455                168.144.21.78:5432 (localhost-only)
                                        │  hourly pg_dump
                                        ▼
                               DO Managed Postgres  ← off-site copy (+ DO's own backups)
```

## Facts
- **Droplet:** `root@168.144.21.78` (Ubuntu 24.04, PG 16). SSH key `~/.ssh/id_dbs`.
  Target lives in `.droplet`.
- **Postgres:** listens on the droplet's **localhost only** (never public); systemd
  auto-starts it on boot and restarts on crash. DB `sqlforge`, role `sqlforge`.
- **Backend DSN:** `postgresql://sqlforge:sqlforge@localhost:5455/sqlforge`
  (already in `backend/.env`).

## Daily use
```bash
cd infra/digitalocean
bash connect.sh          # ensures PG is up on the droplet + opens the tunnel
                         # keep this terminal open
# then, elsewhere:
cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000
```
The app bootstraps its schema and seeds scenarios automatically on boot.

## Backups (crash-proof, off-droplet)
1. Create a **Managed Postgres** cluster in the DO control panel (same region/VPC
   as the droplet; version 16 to match). Create a database named `sqlforge`.
   Under *Trusted Sources*, add the droplet. Copy the connection string.
2. Install the backup job from your laptop:
   ```bash
   cd infra/digitalocean
   MANAGED_DATABASE_URL="postgresql://doadmin:PASS@host:25060/sqlforge?sslmode=require" \
     bash install-backups.sh
   ```
   This deploys `backup.sh`/`restore.sh` to `/opt/sqlforge/`, writes the managed
   connection string to `/etc/sqlforge/managed.env` (chmod 600), installs an
   **hourly** cron, and runs one backup immediately to verify.
- Local dumps: `/var/backups/sqlforge/*.dump` (7-day retention). Log:
  `/var/log/sqlforge-backup.log`.
- Off-site: each run overwrites the managed DB with the latest dump.

## Disaster recovery (droplet crashed / rebuilt)
```bash
# on a fresh droplet:
bash setup-postgres.sh                       # reinstall PG + role + db
sudo bash /opt/sqlforge/restore.sh --from-managed   # pull data back from managed DB
```
Or restore the newest local dump: `sudo bash /opt/sqlforge/restore.sh`.

## Scripts
| Script | Where | What |
|---|---|---|
| `connect.sh` | laptop | Ensure PG up on droplet + open self-healing tunnel |
| `tunnel.sh` | laptop | Just the self-healing tunnel |
| `setup-postgres.sh` | droplet | Idempotent PG install + role/db |
| `install-backups.sh` | laptop | Deploy backup scripts + cron + managed config |
| `backup.sh` | droplet | pg_dump → local + managed DB (cron'd hourly) |
| `restore.sh` | droplet | Restore from local dump or managed DB |
