"""Studio DB connection-stability test.

Reproduces the "works for one query, then everything 503s" symptom by doing
several SEPARATE round-trips to the Studio Postgres (over the SSH tunnel), with
idle gaps in between. With the current pool config
(``db_pool_max_queries=1`` + ``db_pool_max_inactive_connection_lifetime=5.0``)
asyncpg drops the underlying connection after almost every query, so each step
below forces a *fresh* connection through the tunnel — which is exactly where a
flaky/half-open tunnel falls over.

Run it directly (no pytest needed)::

    cd backend
    ./.venv/bin/python -m tests.test_studio_db

It exercises the real app code paths:
    1. list tracks            (app.custom_tracks)
    2. inspect a track        (app.custom_tables / schema_graph)
    3. generate-question deps (recent questions + provisioned-table count)
    4. preview 2-3 rows from each live table in custom_<id>

Each step prints latency + PASS/FAIL. Connection-layer failures
(OSError / InterfaceError / PostgresConnectionError) are reported as the tunnel
being down rather than crashing the run, so you can see *which* round-trip dies.
"""
from __future__ import annotations

import asyncio
import sys
import time
import traceback

import asyncpg

# allow `python tests/test_studio_db.py` as well as `-m tests.test_studio_db`
sys.path.insert(0, ".")

from app import custom, db  # noqa: E402

# A short idle gap so a connection can cross the 5s inactive lifetime and get
# recycled between steps — this is what surfaces the "second call dies" bug.
IDLE_GAP_SECONDS = 6.0
PREVIEW_LIMIT = 3

_DB_DOWN = (
    OSError,
    ConnectionError,
    TimeoutError,
    asyncpg.exceptions.InterfaceError,
    asyncpg.exceptions.PostgresConnectionError,
)


class StepResult:
    def __init__(self, name: str):
        self.name = name
        self.ok = False
        self.ms = 0.0
        self.detail = ""


async def _timed(name: str, coro_factory) -> StepResult:
    """Run one DB round-trip, timing it and classifying any failure."""
    res = StepResult(name)
    t0 = time.perf_counter()
    try:
        res.detail = await coro_factory()
        res.ok = True
    except _DB_DOWN as exc:
        res.detail = f"TUNNEL/DB DOWN: {type(exc).__name__}: {exc}"
    except Exception as exc:  # noqa: BLE001 - surface anything else too
        res.detail = f"{type(exc).__name__}: {exc}"
    res.ms = (time.perf_counter() - t0) * 1000
    return res


async def _step_list_tracks() -> str:
    rows = await db.pool().fetch(
        "SELECT id, name, status, level FROM app.custom_tracks ORDER BY id DESC")
    if not rows:
        return "0 tracks found (DB reachable, but nothing to inspect further)"
    listing = ", ".join(f"#{r['id']}:{r['name']}" for r in rows[:5])
    return f"{len(rows)} track(s): {listing}"


async def _pick_track_id() -> int | None:
    return await db.pool().fetchval(
        "SELECT id FROM app.custom_tracks ORDER BY id DESC LIMIT 1")


async def _step_inspect_track(track_id: int) -> str:
    graph = await custom.schema_graph(track_id)
    tables = graph.get("tables", [])
    names = ", ".join(t["name"] for t in tables) or "(none)"
    return f"track #{track_id}: {len(tables)} table(s): {names}"


async def _step_question_deps(track_id: int) -> str:
    # mirrors track_question(): recent prompts + provisioned-row sanity
    recent = await db.pool().fetch(
        "SELECT prompt FROM app.custom_questions WHERE track_id=$1 "
        "ORDER BY id DESC LIMIT 8", track_id)
    expected = await db.pool().fetchval(
        "SELECT count(*) FROM app.custom_tables WHERE track_id=$1", track_id)
    return f"{len(recent)} recent question(s); {expected} registered table(s)"


async def _step_preview_rows(track_id: int) -> str:
    schema = custom.schema_for(track_id)  # custom_<id>
    tables = await db.pool().fetch(
        "SELECT table_name FROM app.custom_tables WHERE track_id=$1 "
        "ORDER BY table_name LIMIT 3", track_id)
    if not tables:
        return f"no registered tables for track #{track_id}"
    parts = []
    for t in tables:
        tname = t["table_name"]
        # asyncpg has no identifier params; schema/table come from our own
        # registry (already sanitized at import), so this is safe to interpolate.
        rows = await db.pool().fetch(
            f'SELECT * FROM "{schema}"."{tname}" LIMIT {PREVIEW_LIMIT}')
        parts.append(f"{tname}={len(rows)} row(s)")
    return "previewed " + ", ".join(parts)


async def run() -> int:
    print("== Studio DB connection-stability test ==")
    from app.config import get_settings
    cfg = get_settings()
    print(f"DSN target : {cfg.database_url}")
    print(f"pool       : min={cfg.db_pool_min} max={cfg.db_pool_max} "
          f"max_queries={cfg.db_pool_max_queries} "
          f"inactive_lifetime={cfg.db_pool_max_inactive_connection_lifetime}s")
    print(f"idle gap   : {IDLE_GAP_SECONDS}s between steps "
          f"(forces fresh tunnel connections)\n")

    try:
        await db.init_pool()
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: could not init pool — Studio tunnel almost certainly down.\n"
              f"       {type(exc).__name__}: {exc}")
        return 1

    results: list[StepResult] = []

    results.append(await _timed("1. list tracks", _step_list_tracks))
    print(_fmt(results[-1]))

    track_id = None
    if results[-1].ok:
        try:
            track_id = await _pick_track_id()
        except _DB_DOWN as exc:
            print(f"   (could not pick a track: {exc})")

    if track_id is not None:
        for label, factory in (
            ("2. inspect track", lambda: _step_inspect_track(track_id)),
            ("3. question deps", lambda: _step_question_deps(track_id)),
            ("4. preview rows", lambda: _step_preview_rows(track_id)),
        ):
            await asyncio.sleep(IDLE_GAP_SECONDS)  # let the connection idle out
            results.append(await _timed(label, factory))
            print(_fmt(results[-1]))
    else:
        print("   (no track available — skipping steps 2-4)")

    await db.close_pool()

    failed = [r for r in results if not r.ok]
    print("\n== summary ==")
    for r in results:
        print(_fmt(r))
    if failed:
        print(f"\nRESULT: {len(failed)}/{len(results)} step(s) FAILED — "
              f"connection is not surviving multiple round-trips.")
        return 1
    print(f"\nRESULT: all {len(results)} steps passed — connection is stable "
          f"across multiple round-trips.")
    return 0


def _fmt(r: StepResult) -> str:
    tag = "PASS" if r.ok else "FAIL"
    return f"[{tag}] {r.name:<18} {r.ms:7.0f}ms  {r.detail}"


# pytest entry point (skips cleanly if the tunnel is down)
def test_studio_db_multi_roundtrip():
    rc = asyncio.run(run())
    assert rc == 0, "Studio DB did not survive multiple round-trips (see output)"


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
