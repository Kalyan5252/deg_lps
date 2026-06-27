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
"""


async def _bootstrap(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(APP_DDL)
