## D.E.G

D.E.G is a data engineering practice app built around real query execution in PostgreSQL.
It has three main learning surfaces:

Global datasets are bundled CSVs under [backend/app/global_data](backend/app/global_data).
Catalog metadata is defined in [backend/app/global_datasets.py](backend/app/global_datasets.py).

```text
GET /api/global-datasets
  -> parse catalog CSV headers/row counts
  -> return dataset cards with table/column metadata

GET /api/global-datasets/{key}/tables/{table}/preview
  -> read bundled CSV
  -> return first 200 rows for the dataset drawer

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

They use local slide data and do not write to the backend. The fundamentals
course includes a small in-memory dataset and Monaco editor checks. The other
courses use a shared full-screen slide component.

### Scenarios shipped

Fully playable: **Slow Dashboard** (missing FK index → seq scan), **Duplicate Customers** (dedup investigation), **Missing Indexes** (point-lookup seq scan). Five more (Failed ETL, Revenue Reporting, Data Quality, Inventory Mismatch, Customer Segmentation) are registered as "coming soon" stubs and easy to author — see `backend/app/scenarios.py`.

Main route groups in [backend/app/main.py](backend/app/main.py):

- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/paths`
- `GET /api/scenarios`
- `GET /api/scenarios/{key}`
- `POST /api/workbench/run`
- `POST /api/workbench/explain`
- `POST /api/workbench/submit`
- `GET /api/progress`
- `GET /api/history`
- `GET /api/global-datasets`
- `POST /api/global-datasets/{key}/use`
- `GET /api/tracks`
- `POST /api/tracks`
- `GET /api/tracks/{id}`
- `POST /api/tracks/{id}/activate`
- `POST /api/tracks/{id}/run`
- `POST /api/tracks/{id}/question`
- `POST /api/tracks/{id}/submit`
- `POST /api/mentor/*`
- `POST /api/hunt/*`

The frontend API wrapper is [frontend/lib/api.ts](frontend/lib/api.ts).

## Running Locally

### 1. PostgreSQL

Local PostgreSQL:

**Option A — local Postgres (what this repo is configured for):**

```bash
brew services start postgresql@18
createuser -s sqlforge 2>/dev/null
psql -d postgres -c "ALTER ROLE sqlforge PASSWORD 'sqlforge'"
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
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

On first boot the backend creates the `app` tables and seeds every scenario's
sandbox schema (the 500k-row events table takes a couple of seconds).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Sign in with any email (an account is created on first sign-in), pick an
incident, and start investigating.

---

The frontend listens on:

Paste your key into `backend/.env`:

```
LIGHTNING_API_KEY=sk-...
AI_BASE_URL=https://lightning.ai/api/v1
AI_MODEL=lightning-ai/gemma-4-31B-it
```

The same abstraction (`backend/app/ai.py`) works against any OpenAI-compatible
endpoint — point `AI_BASE_URL`/`AI_MODEL` at OpenAI, a local Ollama server, etc.

If port 3000 is already used:

```bash
npx next dev -p 3001
```

## AI Integration

Scores are weighted; ≥80 passes. Because checks read the _actual plan and data_,
you can't bluff them — you have to genuinely fix the system. Use **Reset
sandbox** on any scenario to restore the original broken state.

Environment variables:

## Project layout

```

The API client is OpenAI-compatible. If no key is configured, the app falls back
to deterministic/offline mentor and evaluation behavior where possible.

AI is used for:

- mentor chat replies
- scenario evaluation wording
- custom dataset question generation
- RegHunt hints and optimization advice

The deterministic checks still run in PostgreSQL and are not replaced by AI.

## Evaluation Checks

Scenario checks are declared in [backend/app/scenarios.py](backend/app/scenarios.py)
and executed by [backend/app/sandbox.py](backend/app/sandbox.py).

Supported check types include:

- `matches`: compare submitted query result with expected SQL
- `row_count`: require a specific number of rows
- `explain_no_seqscan`: inspect `EXPLAIN` output for sequential scans
- `uses_index_scan`: require an index scan in the plan
- `runs_under_ms`: time a query
- `index_exists`: verify an index exists on specific columns

Submissions are stored in `app.attempts`; progress is stored in `app.progress`.

## Project Layout

```text
backend/
  app/
    main.py              FastAPI route definitions
    db.py                app schema bootstrap and asyncpg pool
    auth.py              JWT login helpers
    scenarios.py         scenario registry and seed SQL
    sandbox.py           schema creation, SQL execution, EXPLAIN, checks
    custom.py            CSV parsing, custom tracks, schema graph
    global_datasets.py   public dataset catalog and preview helpers
    ai.py                OpenAI-compatible AI integration and fallbacks
    global_data/         bundled CSV datasets
  scripts/
    build_global_data.py dataset staging helper
  tests/
    test_track_integration.py
    test_studio_db.py

frontend/
  app/
    page.tsx                         dashboard
    paths/page.tsx                   course cards and scenario paths
    paths/fundamentals-sql/page.tsx  interactive SQL fundamentals course
    paths/indexing/page.tsx          indexing course
    paths/query-optimization/page.tsx
    paths/plsql/page.tsx
    scenario/[key]/page.tsx          scenario workbench
    tracks/page.tsx                  custom/global track entry
    tracks/[id]/page.tsx             dataset workbench
    datasets/page.tsx                global dataset catalog
  components/
    ResultsTable.tsx
    SchemaCanvas.tsx
    Shell.tsx
    MentorChatProvider.tsx
  lib/
    api.ts
    sqlCompletion.ts
```

## Common Development Notes

- Restart the backend after changing FastAPI routes or backend helpers.
- Restart the frontend dev server if a new route folder is not picked up.
- `npm run build` verifies the frontend route tree and TypeScript.
- `python -m py_compile backend/app/*.py` is a quick syntax check for backend edits.
- If `http://localhost:3000` returns a 404 from an API-looking server, the
  backend is probably being opened instead of the Next.js app.
