# Backend tests

Three layers of coverage for the **Data Engineering DEI** pipeline builder
(plus the pre-existing track/studio tests). Every suite doubles as a runnable
script *and* a pytest test, and the integration/E2E suites **skip cleanly** when
their DB/backend isn't reachable — so `pytest` never hard-fails in a bare env.

| File | Layer | Needs | What it covers |
|------|-------|-------|----------------|
| `test_pipelines_unit.py` | **Unit** | nothing | DAG topo-sort, gate predicate safety, type inference/coercion, JSON flattening, CSV parsing, and the Python **subprocess** function runner |
| `test_pipelines_db.py` | **Integration** | a Postgres (`DATABASE_URL`) | drives `app.pipelines` directly: provision → ingest CSV → run a datasource→function→gate→output DAG → assert sandbox tables, gate routing, activity logs, error short-circuit, teardown |
| `test_pipelines_e2e.py` | **E2E (HTTP)** | running backend (`API_BASE`) | the exact calls the frontend makes: login, create, multipart CSV upload, save graph, run, poll runs+logs, node preview, LLM prompt, error path, user isolation |

## Run everything (pytest)

```bash
cd backend
./.venv/bin/python -m pytest
```

## Run a single layer (no pytest needed)

```bash
cd backend
./.venv/bin/python -m tests.test_pipelines_unit          # always runs
./.venv/bin/python -m tests.test_pipelines_db            # uses backend/.env DATABASE_URL
./.venv/bin/python -m tests.test_pipelines_e2e           # against :8000 by default
```

## Point at a specific DB / backend

```bash
# DB integration against a local Postgres
DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5432/sqlforge \
  DB_SSLMODE=disable ./.venv/bin/python -m tests.test_pipelines_db

# E2E against a backend on another port
API_BASE=http://127.0.0.1:8010/api ./.venv/bin/python -m tests.test_pipelines_e2e
```
