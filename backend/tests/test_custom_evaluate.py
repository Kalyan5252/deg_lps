"""Integration tests for Custom Track evaluation edge cases.

Covers two regressions:
  * a broken reference_sql must fail the submission loudly instead of letting
    any 0-row user query pass vacuously
  * ``sandbox.run_in_schema`` must not leak the ``truncated`` flag from an
    earlier row-returning statement into a later command statement

Uses the DB from ``backend/.env`` (``DATABASE_URL``); skips cleanly when the
database is unreachable.
"""
from __future__ import annotations

import asyncio
import time

from app import custom, db, sandbox

_failures: list[str] = []
_passes = 0


def check(cond: bool, label: str, extra: str = "") -> None:
    global _passes
    if cond:
        _passes += 1
        print(f"  [PASS] {label}")
    else:
        _failures.append(label)
        print(f"  [FAIL] {label}  {extra}")


CSV = "id,name,amount\n1,a,10\n2,b,20\n3,c,30\n"


async def _run() -> None:
    user_id = await db.pool().fetchval(
        "INSERT INTO app.users (email, display_name) VALUES ($1,$2) "
        "ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name "
        "RETURNING id", f"custom-eval-test-{int(time.time())}@t.com", "eval-test")
    track_id = await db.pool().fetchval(
        "INSERT INTO app.custom_tracks (user_id, name) VALUES ($1,$2) RETURNING id",
        user_id, "eval-itest")
    parsed = custom.parse_csv("sales.csv", CSV)
    await db.pool().execute(
        "INSERT INTO app.custom_tables (track_id, table_name, columns, row_count, csv_text) "
        "VALUES ($1,$2,$3,$4,$5)", track_id, parsed["table_name"],
        parsed["columns"], parsed["row_count"], parsed["csv_text"])
    await custom.provision(track_id)
    schema = custom.schema_for(track_id)

    try:
        # 1. sanity: a correct answer passes
        res = await custom.evaluate(
            track_id, "SELECT count(*) AS n FROM sales",
            "SELECT count(*) AS n FROM sales")
        check(res["ok"] and res["passed"], "matching query passes")

        # 2. broken reference_sql must NOT pass a 0-row user query
        res = await custom.evaluate(
            track_id, "SELECT * FROM table_that_is_gone",
            "SELECT * FROM sales WHERE amount > 999")
        check(not res["ok"] and not res["passed"],
              "broken reference fails loudly", f"got {res}")
        check(bool(res.get("error")), "broken reference returns an error message")

        # 3. truncated flag resets when the last statement is a command
        big = await sandbox.run_in_schema(
            schema, "SELECT * FROM sales", max_rows=2)
        check(big["ok"] and big["truncated"] is True,
              "row-capped select reports truncated")
        mixed = await sandbox.run_in_schema(
            schema,
            "SELECT * FROM sales; CREATE TABLE t2 (id INT)",
            max_rows=2)
        check(mixed["ok"] and mixed["truncated"] is False,
              "trailing command does not inherit truncated", f"got {mixed}")
    finally:
        await db.pool().execute("DELETE FROM app.custom_tracks WHERE id=$1", track_id)
        await db.pool().execute("DELETE FROM app.users WHERE id=$1", user_id)
        await custom.teardown(track_id)


async def _reachable() -> bool:
    import asyncpg
    from app.config import get_settings
    s = get_settings()
    try:
        conn = await asyncpg.connect(
            s.database_url, timeout=3, ssl=db._ssl_arg(s.db_sslmode))
        await conn.close()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _main_async() -> bool:
    if not await _reachable():
        print("SKIP: database not reachable (pre-flight probe failed).")
        return False
    await db.init_pool()
    try:
        await _run()
    finally:
        await db.close_pool()
    return True


def main() -> int:
    print("== custom evaluate integration tests ==")
    ran = asyncio.run(_main_async())
    if not ran:
        return 0
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_custom_evaluate_integration():
    assert main() == 0, "custom evaluate integration checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
