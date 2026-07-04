"""Database pools and application-table bootstrap.

Two logical areas live in the same Postgres instance:
  * the ``app`` schema  -> users, sessions, skills, attempts, history, mentor logs
  * ``sandbox_<key>`` schemas -> the practice data each scenario runs against

We use asyncpg directly (no ORM) so we keep full control over query timing,
EXPLAIN output, and per-statement timeouts in the sandbox.
"""
from __future__ import annotations

import asyncio
import json
import logging
import ssl as ssl_module

import asyncpg

from .config import get_settings

logger = logging.getLogger("sqlforge.db")

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    for typename in ("jsonb", "json"):
        await conn.set_type_codec(
            typename, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


def _ssl_arg(sslmode: str):
    """Map a libpq-style sslmode to an asyncpg ssl argument."""
    mode = (sslmode or "disable").strip().lower()
    if mode in ("disable", "allow", "prefer", ""):
        return False
    if mode in ("require",):
        # encrypt but don't verify the cert (fine for a self-managed Studio DB)
        ctx = ssl_module.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl_module.CERT_NONE
        return ctx
    # verify-ca / verify-full -> full verification against system CAs
    return ssl_module.create_default_context()


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        ssl_arg = _ssl_arg(settings.db_sslmode)
        last_err: Exception | None = None
        for attempt in range(1, settings.db_connect_retries + 1):
            try:
                _pool = await asyncpg.create_pool(
                    dsn=settings.database_url,
                    min_size=settings.db_pool_min,
                    max_size=settings.db_pool_max,
                    max_queries=settings.db_pool_max_queries,
                    max_inactive_connection_lifetime=(
                        settings.db_pool_max_inactive_connection_lifetime
                    ),
                    command_timeout=60,
                    timeout=settings.db_connect_timeout,
                    ssl=ssl_arg,
                    init=_init_conn,
                )
                break
            except (TimeoutError, OSError, asyncpg.PostgresError) as exc:
                last_err = exc
                wait = min(2 * attempt, 10)
                logger.warning(
                    "DB connect attempt %d/%d failed (%s); retrying in %ds",
                    attempt, settings.db_connect_retries, exc, wait,
                )
                await asyncio.sleep(wait)
        if _pool is None:
            raise RuntimeError(
                f"Could not connect to the database after "
                f"{settings.db_connect_retries} attempts: {last_err}"
            )
        await _bootstrap(_pool)
    return _pool


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised; call init_pool() first")
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


APP_DDL = """
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
    id           BIGSERIAL PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.skills (
    user_id    BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    skill      TEXT NOT NULL,
    confidence INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill)
);

CREATE TABLE IF NOT EXISTS app.progress (
    user_id        BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    scenario_key   TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | solved
    best_score     INT NOT NULL DEFAULT 0,
    difficulty     INT NOT NULL DEFAULT 1,
    attempts       INT NOT NULL DEFAULT 0,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scenario_key)
);

CREATE TABLE IF NOT EXISTS app.query_history (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    scenario_key  TEXT NOT NULL,
    sql           TEXT NOT NULL,
    success       BOOLEAN NOT NULL,
    error         TEXT,
    duration_ms   DOUBLE PRECISION,
    row_count     INT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.attempts (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    scenario_key  TEXT NOT NULL,
    sql           TEXT NOT NULL,
    score         INT NOT NULL,
    passed        BOOLEAN NOT NULL,
    feedback      JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.mentor_messages (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    scenario_key  TEXT NOT NULL,
    role          TEXT NOT NULL,   -- user | assistant
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.ai_settings (
    user_id      BIGINT PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL DEFAULT 'ollama_cloud',
    base_url     TEXT NOT NULL DEFAULT 'https://ollama.com',
    model        TEXT NOT NULL DEFAULT 'gemma4:31b-cloud',
    api_key_enc  TEXT,
    enabled      BOOLEAN NOT NULL DEFAULT false,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Custom Tracks (user-imported datasets + AI interactive learning) ----

CREATE TABLE IF NOT EXISTS app.custom_tracks (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'ready',   -- ready | active
    level       INT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- raw imported tables (data kept here so the live schema can be spun up on demand)
CREATE TABLE IF NOT EXISTS app.custom_tables (
    id          BIGSERIAL PRIMARY KEY,
    track_id    BIGINT NOT NULL REFERENCES app.custom_tracks(id) ON DELETE CASCADE,
    table_name  TEXT NOT NULL,
    columns     JSONB NOT NULL,        -- [{name, type, pk}]
    row_count   INT NOT NULL DEFAULT 0,
    csv_text    TEXT NOT NULL          -- original CSV, re-parsed on provision
);

CREATE TABLE IF NOT EXISTS app.custom_questions (
    id            BIGSERIAL PRIMARY KEY,
    track_id      BIGINT NOT NULL REFERENCES app.custom_tracks(id) ON DELETE CASCADE,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    level         INT NOT NULL,
    prompt        TEXT NOT NULL,
    reference_sql TEXT NOT NULL,       -- server-side answer key
    skills        JSONB NOT NULL DEFAULT '[]',
    source        TEXT NOT NULL DEFAULT 'template',  -- template | ai
    status        TEXT NOT NULL DEFAULT 'open',      -- open | passed | failed
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.custom_attempts (
    id            BIGSERIAL PRIMARY KEY,
    question_id   BIGINT NOT NULL REFERENCES app.custom_questions(id) ON DELETE CASCADE,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    sql           TEXT NOT NULL,
    score         INT NOT NULL,
    passed        BOOLEAN NOT NULL,
    feedback      JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Free-form mentor chat per track (the "real-time mentor" conversation).
CREATE TABLE IF NOT EXISTS app.custom_chat_messages (
    id            BIGSERIAL PRIMARY KEY,
    track_id      BIGINT NOT NULL REFERENCES app.custom_tracks(id) ON DELETE CASCADE,
    user_id       BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,   -- user | assistant
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_chat_track_idx
    ON app.custom_chat_messages (track_id, id);

-- ---- Data Engineering DEI (visual pipeline builder) ----

-- A pipeline is a DAG stored as JSONB ({nodes, edges}). Live node-output data
-- lives only in an on-demand ``pipe_<id>`` schema (spun up on activate, dropped
-- on stop) — mirroring the Custom Tracks ``custom_<id>`` pattern.
CREATE TABLE IF NOT EXISTS app.pipelines (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    graph       JSONB NOT NULL DEFAULT '{"nodes": [], "edges": []}',
    status      TEXT NOT NULL DEFAULT 'idle',   -- idle | active
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable storage for uploaded datasource data (CSV), so a pipeline can be
-- re-run after its ephemeral ``pipe_<id>`` schema has been torn down.
CREATE TABLE IF NOT EXISTS app.pipeline_sources (
    id           BIGSERIAL PRIMARY KEY,
    pipeline_id  BIGINT NOT NULL REFERENCES app.pipelines(id) ON DELETE CASCADE,
    node_id      TEXT NOT NULL,
    table_name   TEXT NOT NULL,
    columns      JSONB NOT NULL,       -- [{name, type, pk}]
    row_count    INT NOT NULL DEFAULT 0,
    csv_text     TEXT NOT NULL,
    UNIQUE (pipeline_id, node_id)
);

-- One row per pipeline execution.
CREATE TABLE IF NOT EXISTS app.pipeline_runs (
    id           BIGSERIAL PRIMARY KEY,
    pipeline_id  BIGINT NOT NULL REFERENCES app.pipelines(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'running',  -- running | success | error
    stats        JSONB NOT NULL DEFAULT '{}',
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

-- The activity feed: one row per node execution within a run, each carrying a
-- list of subtasks (with their own status) so the Activity panel can render a
-- log-style tree.
CREATE TABLE IF NOT EXISTS app.pipeline_logs (
    id           BIGSERIAL PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES app.pipeline_runs(id) ON DELETE CASCADE,
    node_id      TEXT NOT NULL,
    node_type    TEXT NOT NULL,
    task         TEXT NOT NULL,
    subtasks     JSONB NOT NULL DEFAULT '[]',  -- [{label, status}]
    status       TEXT NOT NULL DEFAULT 'success',  -- running | success | error | skipped
    rows_in      INT,
    rows_out     INT,
    duration_ms  NUMERIC,
    message      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_runs_pipeline_idx
    ON app.pipeline_runs (pipeline_id, id DESC);
CREATE INDEX IF NOT EXISTS pipeline_logs_run_idx
    ON app.pipeline_logs (run_id, id);
"""


async def _bootstrap(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(APP_DDL)
        # Pointer to the question currently shown in the workbench (the agentic
        # mentor + curriculum progression set this). Idempotent for existing DBs.
        await conn.execute(
            "ALTER TABLE app.custom_tracks "
            "ADD COLUMN IF NOT EXISTS active_question_id BIGINT")
        await conn.execute(HUNT_DDL)


# RegHunt — endless adaptive AI challenge mode. A session runs against a private
# dataset replica; each question is a "checkpoint" with server-side timing so we
# can analyse performance later (the timer is server-authoritative).
HUNT_DDL = """
CREATE TABLE IF NOT EXISTS app.hunt_sessions (
    id           BIGSERIAL PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    track_id     BIGINT NOT NULL REFERENCES app.custom_tracks(id) ON DELETE CASCADE,
    dataset_key  TEXT,
    dataset_name TEXT,
    creativity   INT NOT NULL DEFAULT 2,   -- 1 low | 2 medium | 3 high | 4 great
    difficulty   INT NOT NULL DEFAULT 3,   -- current adaptive difficulty (starts medium)
    status       TEXT NOT NULL DEFAULT 'active',  -- active | finished
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app.hunt_checkpoints (
    id            BIGSERIAL PRIMARY KEY,
    session_id    BIGINT NOT NULL REFERENCES app.hunt_sessions(id) ON DELETE CASCADE,
    seq           INT NOT NULL,
    prompt        TEXT NOT NULL,
    reference_sql TEXT NOT NULL,
    skills        JSONB NOT NULL DEFAULT '[]',
    difficulty    INT NOT NULL,
    multi_solution BOOLEAN NOT NULL DEFAULT false,
    served_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at  TIMESTAMPTZ,
    duration_ms   DOUBLE PRECISION,
    user_sql      TEXT,
    passed        BOOLEAN,
    score         INT,
    attempts      INT NOT NULL DEFAULT 0,
    hint_used     BOOLEAN NOT NULL DEFAULT false,
    optimized     BOOLEAN NOT NULL DEFAULT false,
    reasoning     TEXT,
    reasoning_skipped BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS hunt_checkpoints_session_idx
    ON app.hunt_checkpoints (session_id, seq);
"""
