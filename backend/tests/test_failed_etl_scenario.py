"""Integration test for the Failed ETL Import scenario.

Provisions the scenario's sandbox schema against a real Postgres, then runs the
declarative checks the same way ``/api/workbench/submit`` does:
  * the reference reconciliation query passes every check
  * a wrong query (right shape, wrong rows) fails the `matches` check
  * the seed produces exactly the documented gap (3,100 missing rows, batch 5)

Skips cleanly when the database is unreachable.
"""
from __future__ import annotations

import asyncio

from app import db, sandbox
from app.scenarios import get_scenario

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


GOOD_SQL = (
    "SELECT s.id FROM staging_orders s "
    "LEFT JOIN orders o ON o.id = s.id WHERE o.id IS NULL ORDER BY s.id"
)
WRONG_SQL = "SELECT id FROM staging_orders WHERE batch_id = 5 ORDER BY id"


async def _run() -> None:
    scenario = get_scenario("failed_etl")
    check(scenario is not None and scenario.available,
          "scenario registered and available")

    await sandbox.provision(scenario, force=True)
    schema = sandbox.schema_name(scenario.key)
    try:
        # seed integrity: the documented gap exists
        gap = await sandbox.run_in_schema(
            schema,
            "SELECT count(*) AS n FROM staging_orders s "
            "LEFT JOIN orders o ON o.id = s.id WHERE o.id IS NULL")
        check(gap["ok"] and gap["rows"][0]["n"] == 3100,
              "seed: exactly 3100 rows missing from target", f"got {gap['rows']}")
        batches = await sandbox.run_in_schema(
            schema,
            "SELECT DISTINCT s.batch_id FROM staging_orders s "
            "LEFT JOIN orders o ON o.id = s.id WHERE o.id IS NULL")
        check(batches["ok"] and [r["batch_id"] for r in batches["rows"]] == [5],
              "seed: all missing rows belong to batch 5")

        # correct answer passes all checks
        res = await sandbox.run_in_schema(schema, GOOD_SQL, max_rows=None)
        checks = await sandbox.run_checks(
            scenario, GOOD_SQL, res["columns"], res["rows"], schema=schema)
        check(all(c["passed"] for c in checks),
              "checks: reference reconciliation passes 100%",
              f"got {[(c['label'], c['passed']) for c in checks]}")

        # wrong answer (whole batch 5, not just the missing slice) fails
        res = await sandbox.run_in_schema(schema, WRONG_SQL, max_rows=None)
        checks = await sandbox.run_checks(
            scenario, WRONG_SQL, res["columns"], res["rows"], schema=schema)
        score = sum(c["weight"] for c in checks if c["passed"])
        check(score < 80, "checks: wrong query does not reach pass threshold",
              f"score {score}")
    finally:
        await sandbox.drop_schema(schema)


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
    print("== failed_etl scenario integration tests ==")
    ran = asyncio.run(_main_async())
    if not ran:
        return 0
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_failed_etl_scenario():
    assert main() == 0, "failed_etl scenario checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
