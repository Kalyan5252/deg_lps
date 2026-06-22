# SQLForge

**Learn SQL by resolving realistic production incidents — with a senior engineer mentoring you.**

SQLForge is not a course, a quiz, or a chatbot. It drops you into the on-call
seat: a dashboard is timing out, a CSV import double-fired, an audit lookup
crawls. You investigate against a **real Postgres sandbox**, write SQL, and an
AI senior engineer reviews your work, tracks your skills, and escalates the
difficulty as you improve.

---

## What's inside

| Capability | How it works |
|---|---|
| **Scenario engine** | Each incident has a story, a seeded dataset with *real* problems (duplicates, missing indexes, seq scans), objectives, constraints, hidden problems, and success criteria. |
| **SQL Workbench** | Monaco editor, query execution against a per-scenario sandbox schema, execution time, result tables, error display, EXPLAIN ANALYZE, and query history. |
| **AI Mentor** | A Socratic senior engineer. Asks questions, challenges assumptions, points at the execution plan — **never pastes the answer**. |
| **AI Evaluation** | Deterministic, weighted checks (correctness, plan shape, index presence, timing) produce a score; the AI adds a verdict, strengths, and recommendations. |
| **Skill tracking** | Confidence per skill (SELECT, JOINS, GROUP BY, WINDOW FUNCTIONS, INDEXES, CTEs, QUERY OPTIMIZATION), updated every submission. |
| **Adaptive difficulty** | Solve an incident → difficulty climbs and the next incident is recommended. |

### Pages
Dashboard · Learning Paths · Scenario View (with SQL Editor + Mentor Panel) · Progress · Scenario History

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

Scores are weighted; ≥80 passes. Because checks read the *actual plan and data*,
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
