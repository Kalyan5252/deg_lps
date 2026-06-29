# Lightning Studio Postgres — robust setup

The Studio is great for offloading SQL compute, but it has two rough edges this
folder works around:

- **Docker storage is ephemeral** — containers/volumes are wiped when the Studio
  stops, so a naive Postgres loses its data on restart.
- **It sleeps / can be stopped** — the SSH tunnel drops, and SSH is refused
  while the Studio is fully stopped.

## How robustness is achieved

- **Data survives restarts** via a snapshot, not the Docker volume. A compressed
  `pg_dump` is written every few minutes to the Studio's **persistent** home
  (`~/sqlforge/backups/latest.dump`). On every start, if the live DB is empty we
  **auto-restore** from that snapshot. So even a full volume wipe recovers.
- **Connection survives drops** via a **self-healing tunnel** that auto-reconnects.
- **Backend degrades gracefully** — any DB-connection failure returns a clean
  `503` ("run connect.sh") instead of a 500; the pool recycles stale connections
  and auth retries once.

## Daily use

After the Studio (re)starts — **start it from the Lightning web UI first** if it
was fully stopped (SSH is refused while stopped) — run ONE command locally:

```bash
cd infra/lightning-studio
STUDIO_SSH="s_xxxxxxxx@ssh.lightning.ai" bash connect.sh
```

That syncs the scripts up, starts Postgres + restores the snapshot + starts the
snapshot loop, then opens the self-healing tunnel and holds it open. Point the
backend at it:

```
# backend/.env
DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5455/sqlforge
DB_SSLMODE=disable
```

(Use a different local port with `LOCAL_PORT=5456 bash connect.sh` and match the
`DATABASE_URL`.)

Before deliberately stopping the Studio, capture the very latest state:

```bash
STUDIO_SSH="..." bash backup.sh
```

## Scripts
- `connect.sh` — one-command recover: sync → start+restore → self-healing tunnel.
- `setup-postgres.sh` — runs *in* the Studio: start Postgres, restore snapshot if
  empty, start the periodic snapshot loop. Idempotent.
- `tunnel.sh` — self-healing SSH tunnel (auto-reconnect).
- `backup.sh` — take an immediate snapshot to the persistent disk.

## The bulletproof alternative (recommended)

The Studio sleep/ephemerality is inherent. For a learning app, a **managed
Postgres** removes this entire class of problems — always-on, persistent, no
tunnel. Since everything goes through `DATABASE_URL`, switching is one line:

1. Create a free Postgres (e.g. Neon, Supabase, Railway).
2. `DATABASE_URL=postgresql://USER:PASS@HOST/DB` and `DB_SSLMODE=require` in
   `backend/.env`; restart the backend.

Use the Studio later only for heavy compute, not as the app's primary store.
