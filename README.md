## D.E.G

D.E.G is a data engineering practice app built around real query execution in PostgreSQL.
It has three main learning surfaces:

SQLForge is not a course, a quiz, or a chatbot. It drops you into the on-call
seat: a dashboard is timing out, a CSV import double-fired, an audit lookup
crawls. You investigate against a **real Postgres sandbox**, write SQL, and an
AI senior engineer reviews your work, tracks your skills, and escalates the
difficulty as you improve.

---

## What's inside

| Capability              | How it works                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scenario engine**     | Each incident has a story, a seeded dataset with _real_ problems (duplicates, missing indexes, seq scans), objectives, constraints, hidden problems, and success criteria. |
| **SQL Workbench**       | Monaco editor, query execution against a per-scenario sandbox schema, execution time, result tables, error display, EXPLAIN ANALYZE, and query history.                    |
| **AI Mentor**           | A Socratic senior engineer. Asks questions, challenges assumptions, points at the execution plan — **never pastes the answer**.                                            |
| **AI Evaluation**       | Deterministic, weighted checks (correctness, plan shape, index presence, timing) produce a score; the AI adds a verdict, strengths, and recommendations.                   |
| **Skill tracking**      | Confidence per skill (SELECT, JOINS, GROUP BY, WINDOW FUNCTIONS, INDEXES, CTEs, QUERY OPTIMIZATION), updated every submission.                                             |
| **Adaptive difficulty** | Solve an incident → difficulty climbs and the next incident is recommended.                                                                                                |

### Pages

Dashboard · Learning Paths · Custom Tracks · Scenario View (with SQL Editor + Mentor Panel) · Progress · Scenario History

### Custom Tracks (learn on your own data)

Import your own dataset and the platform builds an adaptive SQL course around it:

- **Import:** upload one or more CSVs (one table per file). Column types,
  primary keys, and inter-table relations are inferred automatically and the
  raw data is kept in your personal storage (`app.custom_tables`).
- **On-demand database:** the dataset's Postgres schema (`custom_<id>`) is only
  provisioned when you open the track and is dropped on **Stop dataset** — it
  isn't kept running.
- **AI interactive learning:** questions are generated from your real schema
  (AI when credits are available, with a deterministic template generator as the
  always-on backbone that also guarantees a runnable reference solution).
  Difficulty starts where you choose and adapts — solve a question and it gets
  harder, miss it and it eases off.
- **Evaluation:** your query runs against the dataset and is compared to the
  reference (result-set match); the AI reviewer comments on correctness,
  readability, and optimization.
- **Schema whiteboard:** a FigJam-style pannable/zoomable canvas (a tab next to
  the question) showing draggable table cards and their relations.

### Scenarios shipped

Fully playable: **Slow Dashboard** (missing FK index → seq scan), **Duplicate Customers** (dedup investigation), **Missing Indexes** (point-lookup seq scan). Five more (Failed ETL, Revenue Reporting, Data Quality, Inventory Mismatch, Customer Segmentation) are registered as "coming soon" stubs and easy to author — see `backend/app/scenarios.py`.

---

## Tech stack

- **Frontend:** Next.js 15 (App Router), Tailwind, Monaco Editor — minimal-flat UI
- **Backend:** FastAPI + asyncpg
- **Database:** PostgreSQL (app tables in the `app` schema; each scenario gets its own `sandbox_<key>` schema)
- **AI:** any OpenAI-compatible endpoint. Defaults to **Lightning.ai** (`lightning-ai/gemma-4-31B-it`). With no API key it falls back to a built-in rule-based mentor/evaluator, so the app runs fully offline.

---

## Quick start

### 1. Database

**Option A — local Postgres (what this repo is configured for):**

```bash
# macOS / Homebrew
brew services start postgresql@18
createuser -s sqlforge 2>/dev/null; psql -d postgres -c "ALTER ROLE sqlforge PASSWORD 'sqlforge'"
createdb -O sqlforge sqlforge
```

`backend/.env` points at `postgresql://sqlforge:sqlforge@localhost:5432/sqlforge`.

**Option B — Docker:**

```bash
docker compose up -d   # Postgres on host port 5433
```

Then set `DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5433/sqlforge` in `backend/.env`.

**Option C — Postgres in a Lightning Studio (offload SQL to the cloud).**
Move all SQL execution off the local machine onto a cloud box so query
performance doesn't depend on an unpredictable laptop. Everything (scenario
sandboxes, Custom Tracks provisioning, query execution) runs on the Studio
because it all goes through `DATABASE_URL`.

1. Create a Studio (the free 4 vCPU / 16 GB instance is enough to start), open a
   terminal in it, and run the bring-up script (Docker-first, apt fallback,
   tuned for that box):
   ```bash
   bash infra/lightning-studio/setup-postgres.sh
   ```
2. On your laptop, open an SSH tunnel to the Studio's Postgres (the wire
   protocol needs raw TCP, so use SSH rather than Lightning's HTTP port share):
   ```bash
   STUDIO_SSH="s_xxxxx@ssh.lightning.ai" bash infra/lightning-studio/tunnel.sh
   ```
3. Point the backend at the tunnel and restart it:

   ```env
   DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5432/sqlforge
   DB_SSLMODE=disable
   ```

   `GET /api/health` reports the DB `host`, round-trip `latency_ms`, and
   `sslmode` so you can confirm you're hitting the Studio. The backend retries
   the connection on startup (`DB_CONNECT_RETRIES`) in case the tunnel/DB is
   still coming up, and pool size / SSL are configurable (`DB_POOL_*`,
   `DB_SSLMODE`). To scale later, move the backend into the Studio too (then
   `DATABASE_URL` just points at `localhost` with no tunnel) or swap in a larger
   instance — no code changes.

   > Note: the first connect to a fresh cloud DB seeds the scenario datasets
   > (run server-side via `generate_series`, so almost no data crosses the
   > network). Importing a Custom Track sends its CSV to the cloud once.

### 2. Backend

```bash
cd backend
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env          # edit if needed; paste LIGHTNING_API_KEY to enable the live AI
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

On first boot the backend creates the `app` tables and seeds every scenario's
sandbox schema (the 500k-row events table takes a couple of seconds).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Sign in with any email (an account is created on first sign-in), pick an
incident, and start investigating.

---

## Enabling the live AI

Paste your key into `backend/.env`:

```
LIGHTNING_API_KEY=sk-...
AI_BASE_URL=https://lightning.ai/api/v1
AI_MODEL=lightning-ai/gemma-4-31B-it
```

The same abstraction (`backend/app/ai.py`) works against any OpenAI-compatible
endpoint — point `AI_BASE_URL`/`AI_MODEL` at OpenAI, a local Ollama server, etc.

---

## How evaluation works (and why it's honest)

Submitting a solution **executes** your SQL in the sandbox (so an optimization
fix like `CREATE INDEX` actually persists), then runs declarative checks:

- `matches` — your result set must equal a reference query's result (order-independent)
- `explain_no_seqscan` / `uses_index_scan` — the plan is inspected via `EXPLAIN (FORMAT JSON)`
- `runs_under_ms` — the target query is timed
- `index_exists` — `pg_indexes` is checked for the right index

Scores are weighted; ≥80 passes. Because checks read the _actual plan and data_,
you can't bluff them — you have to genuinely fix the system. Use **Reset
sandbox** on any scenario to restore the original broken state.

---

## Project layout

```
backend/app/
  main.py        FastAPI routes (auth, scenarios, workbench, mentor, progress, history)
  scenarios.py   Scenario registry: stories, seed SQL, declarative checks
  sandbox.py     Schema provisioning, query execution, EXPLAIN, check runner
  ai.py          Mentor + evaluator (Lightning.ai / OpenAI-compatible + offline fallback)
  db.py          asyncpg pool, app-table bootstrap
  auth.py        JWT sign-in
frontend/app/    Dashboard, login, paths, scenario/[key], progress, history
frontend/components/  Shell, MentorPanel, ResultsTable, UI primitives
```
