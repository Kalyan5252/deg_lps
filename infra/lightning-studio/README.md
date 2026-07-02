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

## Run everything from scratch

Set your Studio target once (already done if `.studio` exists):

```bash
echo "s_xxxxxxxx@ssh.lightning.ai" > infra/lightning-studio/.studio   # Studio → SSH
```

Then, in four terminals from the repo root:

```bash
# 1) AI — Ollama (model used by the backend)
ollama serve            # then once:  ollama run gemma4:31b-cloud

# 2) Database — connect to the Studio (starts Postgres + restores snapshot,
#    then holds a self-healing tunnel on :5455). Keep this terminal open.
cd infra/lightning-studio && bash connect.sh

# 3) Backend  (reads backend/.env: DATABASE_URL=...localhost:5455, AI=Ollama)
cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000
#    sanity check:  curl localhost:8000/api/health   ->  db.host localhost:5455

# 4) Frontend
cd frontend && npm run dev        # http://localhost:3000
```

Order matters only in that the tunnel (step 2) should be up before the backend
(step 3). If the Studio was fully stopped, START it from the Lightning web UI
first (SSH is refused while stopped).

## Switch to a different Studio (replace the current one)

The **only** thing tied to a Studio is the SSH target — the backend always talks
to `localhost:5455`, so nothing in `.env` changes.

```bash
# 1) (optional) capture the old Studio's latest data
STUDIO_SSH="s_OLD@ssh.lightning.ai" bash infra/lightning-studio/backup.sh

# 2) register SSH for the new Studio (run its setup link once, from the new
#    Studio's "SSH" panel), then point everything at it:
echo "s_NEW@ssh.lightning.ai" > infra/lightning-studio/.studio

# 3) (optional) migrate data old -> new (copy the snapshot across)
ssh s_OLD@ssh.lightning.ai 'cat ~/sqlforge/backups/latest.dump' \
  | ssh s_NEW@ssh.lightning.ai 'mkdir -p ~/sqlforge/backups && cat > ~/sqlforge/backups/latest.dump'

# 4) connect — setup auto-restores from the snapshot on the new Studio
cd infra/lightning-studio && bash connect.sh
#    then restart the backend (Ctrl-C, re-run uvicorn)
```

If you skip step 3, the new Studio starts empty (scenarios re-seed on backend
boot; re-import any Custom Tracks).

## The bulletproof alternative (recommended)

The Studio sleep/ephemerality is inherent. For a learning app, a **managed
Postgres** removes this entire class of problems — always-on, persistent, no
tunnel. Since everything goes through `DATABASE_URL`, switching is one line:

1. Create a free Postgres (e.g. Neon, Supabase, Railway).
2. `DATABASE_URL=postgresql://USER:PASS@HOST/DB` and `DB_SSLMODE=require` in
   `backend/.env`; restart the backend.

Use the Studio later only for heavy compute, not as the app's primary store.
