"""Integration test for the Consumer Lag Pileup streaming scenario.

Provisions the scenario sandbox and runs the declarative checks the same way
``/api/workbench/submit`` does. Skips cleanly when the DB is unreachable.
"""
from __future__ import annotations

import asyncio

from app import db, sandbox
from app.scenarios import PATHS, get_scenario

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
    "SELECT co.group_id, co.topic, co.partition, "
    "p.log_end_offset - co.committed_offset AS lag "
    "FROM consumer_offsets co "
    "JOIN partitions p ON p.topic = co.topic AND p.partition = co.partition "
    "WHERE p.log_end_offset - co.committed_offset > 100000 ORDER BY lag DESC"
)
# plausible wrong answer: every fraud-detector partition, not just the stuck one
WRONG_SQL = (
    "SELECT co.group_id, co.topic, co.partition, "
    "p.log_end_offset - co.committed_offset AS lag "
    "FROM consumer_offsets co "
    "JOIN partitions p ON p.topic = co.topic AND p.partition = co.partition "
    "WHERE co.group_id = 'fraud-detector' ORDER BY lag DESC"
)


async def _run() -> None:
    check("streaming" in PATHS, "streaming learning path registered")
    scenario = get_scenario("consumer_lag")
    check(scenario is not None and scenario.available,
          "scenario registered and available")

    await sandbox.provision(scenario, force=True)
    schema = sandbox.schema_name(scenario.key)
    try:
        # seed integrity: exactly one pathological partition, and it's p7
        res = await sandbox.run_in_schema(schema, GOOD_SQL, max_rows=None)
        check(res["ok"] and len(res["rows"]) == 1,
              "seed: exactly one stuck partition", f"got {res['rows']}")
        row = res["rows"][0]
        check(row["group_id"] == "fraud-detector" and row["partition"] == 7
              and row["lag"] > 2_000_000,
              "seed: fraud-detector p7 with ~2M lag", f"got {row}")
        healthy = await sandbox.run_in_schema(
            schema,
            "SELECT max(p.log_end_offset - co.committed_offset) AS m "
            "FROM consumer_offsets co JOIN partitions p "
            "ON p.topic = co.topic AND p.partition = co.partition "
            "WHERE NOT (co.group_id = 'fraud-detector' AND co.partition = 7)")
        check(healthy["ok"] and healthy["rows"][0]["m"] < 2000,
              "seed: everyone else's lag is healthy (<2000)")

        # correct answer passes all checks
        checks = await sandbox.run_checks(
            scenario, GOOD_SQL, res["columns"], res["rows"], schema=schema)
        check(all(c["passed"] for c in checks),
              "checks: reference lag query passes 100%",
              f"got {[(c['label'], c['passed']) for c in checks]}")

        # wrong answer (all 12 fraud-detector partitions) fails
        res = await sandbox.run_in_schema(schema, WRONG_SQL, max_rows=None)
        checks = await sandbox.run_checks(
            scenario, WRONG_SQL, res["columns"], res["rows"], schema=schema)
        score = sum(c["weight"] for c in checks if c["passed"])
        check(score < 80, "checks: whole-group answer does not pass",
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
    print("== consumer_lag scenario integration tests ==")
    ran = asyncio.run(_main_async())
    if not ran:
        return 0
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_consumer_lag_scenario():
    assert main() == 0, "consumer_lag scenario checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
