# D.E.G

D.E.G is a SQL learning app built around real query execution in PostgreSQL.
It has three main learning surfaces:

- incident scenarios backed by seeded sandbox schemas
- custom/global datasets that become private query tracks
- focused course screens for SQL fundamentals, indexing, query optimization, and PL/SQL

The frontend is a Next.js app. The backend is a FastAPI API. PostgreSQL stores
application state and also acts as the query sandbox.

## Architecture

```text
Browser
  |
  | Next.js UI
  v
frontend/
  app/
    paths/                 course cards and full-screen courses
    scenario/[key]/        incident workbench
    tracks/[id]/           custom/global dataset workbench
    datasets/              public dataset catalog and preview drawer
  components/
    SchemaCanvas.tsx       schema graph renderer
    ResultsTable.tsx       query result renderer
    MentorChat*            floating AI mentor UI
  lib/api.ts               typed-ish API wrapper around /api/*

  |
  | HTTP, default NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api
  v
backend/
  app/main.py              FastAPI routes
  app/db.py                asyncpg pool and app schema bootstrap
  app/scenarios.py         scenario registry, seed SQL, checks
  app/sandbox.py           schema provisioning, query execution, EXPLAIN, checks
  app/custom.py            uploaded dataset parsing, schema graph, custom tracks
  app/global_datasets.py   bundled public dataset catalog and CSV loaders
  app/ai.py                mentor/evaluator/question generation
  app/auth.py              email login and JWT handling

  |
  | asyncpg
  v
PostgreSQL
  app.*                    application tables
  sandbox_<scenario>       per-user scenario schemas
  custom_<track_id>        on-demand dataset schemas
```

## Data Storage Model

### Application schema

The backend creates its app tables in the PostgreSQL `app` schema on startup.
The important tables are:

- `app.users`: email-based users
- `app.progress`: per-user scenario progress and skill scores
- `app.attempts`: scenario submissions and evaluation output
- `app.mentor_messages`: stored mentor chat history
- `app.custom_tracks`: uploaded/global dataset tracks
- `app.custom_tables`: parsed CSV table metadata and capped CSV text
- `app.custom_questions`: generated/custom-track learning questions
- `app.hunt_*`: RegHunt sessions and checkpoints

See [backend/app/db.py](backend/app/db.py) for the actual DDL.

### Scenario schemas

Scenario data is not stored in `app.*`. Each scenario is provisioned into a
sandbox schema named from the scenario key, for example:

```text
sandbox_slow_dashboard
sandbox_duplicate_customers
sandbox_missing_indexes
```

The scenario seed SQL lives in [backend/app/scenarios.py](backend/app/scenarios.py).
Provisioning and reset are handled by [backend/app/sandbox.py](backend/app/sandbox.py).

### Custom/global dataset schemas

Uploaded datasets and public global datasets are first stored as CSV text and
metadata in `app.custom_tables`. When a user opens a track, the backend creates
or refreshes a working PostgreSQL schema:

```text
custom_<track_id>
```

That schema is dropped when the user stops the dataset.

## Request and Data Flow

### Login

```text
frontend login page
  -> POST /api/auth/login
  -> backend creates/fetches app.users row
  -> backend returns JWT
  -> frontend stores token in localStorage
  -> lib/api.ts sends Authorization: Bearer <token>
```

Authentication is intentionally simple for local/product iteration. There is no
password flow; any email creates or resumes a user.

### Scenario workbench flow

```text
GET /api/scenarios/{key}
  -> load scenario definition from scenarios.py
  -> ensure per-user sandbox schema exists
  -> return public scenario metadata + progress + mentor messages

POST /api/workbench/run
  -> receive scenario_key + SQL
  -> run SQL inside the user's sandbox schema
  -> cap result rows for the browser
  -> return columns, rows, duration, row_count

POST /api/workbench/submit
  -> execute submitted SQL
  -> run scenario checks from scenarios.py
  -> optionally call AI evaluator
  -> write app.attempts and app.progress
  -> return score, pass/fail, feedback, result preview
```

The sandbox sets a restricted `search_path` and statement timeout before running
user SQL. This is isolation for the learning app, not a general-purpose secure
SQL execution boundary.

### Custom track upload flow

```text
frontend /tracks upload form
  -> POST /api/tracks multipart CSV files
  -> custom.parse_csv() sanitizes table/column names
  -> column types, primary keys, and relation hints are inferred
  -> app.custom_tracks row is created
  -> app.custom_tables rows store table metadata + capped CSV text
```

Opening the track:

```text
GET /api/tracks/{id}
  -> custom.schema_graph(track_id)
  -> frontend renders SchemaCanvas

POST /api/tracks/{id}/question
  -> provision custom_<track_id> if needed
  -> generate deterministic or AI-backed question
  -> validate reference SQL against the actual dataset
  -> store question in app.custom_questions

POST /api/tracks/{id}/run
  -> run SQL in custom_<track_id>
  -> return capped result table
```

### Global dataset flow

Global datasets are bundled CSVs under [backend/app/global_data](backend/app/global_data).
Catalog metadata is defined in [backend/app/global_datasets.py](backend/app/global_datasets.py).

```text
GET /api/global-datasets
  -> parse catalog CSV headers/row counts
  -> return dataset cards with table/column metadata

GET /api/global-datasets/{key}/tables/{table}/preview
  -> read bundled CSV
  -> return first 200 rows for the dataset drawer

POST /api/global-datasets/{key}/use
  -> parse bundled CSVs
  -> create app.custom_tracks row
  -> copy tables into app.custom_tables
  -> user continues in the normal custom track flow
```

The public dataset is never queried directly as a shared database. Clicking
`Use Dataset` creates a private track copy for that user.

### Course flow

The course screens are frontend-only routes:

```text
/paths/fundamentals-sql
/paths/indexing
/paths/query-optimization
/paths/plsql
```

They use local slide data and do not write to the backend. The fundamentals
course includes a small in-memory dataset and Monaco editor checks. The other
courses use a shared full-screen slide component.

## Backend Routes

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

```bash
brew services start postgresql@18
createuser -s sqlforge 2>/dev/null
psql -d postgres -c "ALTER ROLE sqlforge PASSWORD 'sqlforge'"
createdb -O sqlforge sqlforge
```

Docker PostgreSQL:

```bash
docker compose up -d
```

When using Docker, set:

```env
DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5433/sqlforge
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

The backend listens on:

```text
http://127.0.0.1:8000/api
```

Useful checks:

```text
http://127.0.0.1:8000/api/health
http://127.0.0.1:8000/api/global-datasets
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend listens on:

```text
http://localhost:3000
```

If port 3000 is already used:

```bash
npx next dev -p 3001
```

## AI Integration

AI calls are centralized in [backend/app/ai.py](backend/app/ai.py).

Environment variables:

```env
LIGHTNING_API_KEY=sk-...
AI_BASE_URL=https://lightning.ai/api/v1
AI_MODEL=lightning-ai/gemma-4-31B-it
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
