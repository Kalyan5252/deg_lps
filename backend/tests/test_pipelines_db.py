"""Integration tests for the pipeline engine against a real Postgres.

Drives ``app.pipelines`` at the module level (not over HTTP): it provisions a
per-pipeline ``pipe_<id>`` schema, ingests a CSV, executes a full
datasource → function → gate → output DAG, and asserts on the resulting sandbox
tables and ``app.pipeline_logs`` rows. Cleans up after itself.

Uses the DB from ``backend/.env`` (``DATABASE_URL``). Skips cleanly if the DB is
unreachable, so it never hard-fails in an environment without a database.

Run directly::

    cd backend
    ./.venv/bin/python -m tests.test_pipelines_db
    # or against another DB:
    DATABASE_URL=postgresql://sqlforge:sqlforge@localhost:5432/sqlforge \
        DB_SSLMODE=disable ./.venv/bin/python -m tests.test_pipelines_db
"""
from __future__ import annotations

import asyncio
import json
import time

from app import db, pipelines

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


ORDERS_CSV = (
    "order_id,customer_id,amount\n"
    "1,10,50\n"
    "2,10,150\n"
    "3,20,250\n"
    "4,30,80\n"
    "5,30,300\n"
)
# amount > 100 → rows 2,3,5 (three rows); <= 100 → rows 1,4 (two rows)


def _graph(pid_nodes: bool = True) -> dict:
    """datasource(csv) → function(keep amount>0) → gate(split by amount) → 2 outputs."""
    return {
        "nodes": [
            {"id": "ds", "type": "datasource", "position": {"x": 0, "y": 0},
             "data": {"label": "Orders", "kind": "csv", "table_name": "orders"}},
            {"id": "fn", "type": "function", "position": {"x": 1, "y": 0},
             "data": {"label": "Cast", "code":
                      "def transform(df):\n"
                      "    df = df.copy()\n"
                      "    df['amount'] = df['amount'].astype(int)\n"
                      "    return df\n"}},
            {"id": "gate", "type": "gate", "position": {"x": 2, "y": 0},
             "data": {"label": "Split", "conditions": [
                 {"target": "big", "expr": "amount > 100"},
                 {"target": "small", "expr": "amount <= 100"}]}},
            {"id": "big", "type": "output", "position": {"x": 3, "y": -1},
             "data": {"label": "Big", "kind": "api"}},
            {"id": "small", "type": "output", "position": {"x": 3, "y": 1},
             "data": {"label": "Small", "kind": "sheets"}},
        ],
        "edges": [
            {"id": "e1", "source": "ds", "target": "fn"},
            {"id": "e2", "source": "fn", "target": "gate"},
            {"id": "e3", "source": "gate", "target": "big"},
            {"id": "e4", "source": "gate", "target": "small"},
        ],
    }


_MERGE_CODE = (
    "out = [{**x, 'src': 'a'} for x in input_1] + "
    "[{**x, 'src': 'b'} for x in input_2]\nreturn out")


def _merge_graph() -> dict:
    """ds1(3 rows) + ds2(2 rows) → gate(2 inputs, conditional_function) → output."""
    return {
        "nodes": [
            {"id": "ds1", "type": "datasource", "position": {"x": 0, "y": 0},
             "data": {"kind": "csv", "table_name": "a"}},
            {"id": "ds2", "type": "datasource", "position": {"x": 0, "y": 1},
             "data": {"kind": "csv", "table_name": "b"}},
            {"id": "gate", "type": "gate", "position": {"x": 1, "y": 0},
             "data": {"label": "Merge", "inputs": 2, "code": _MERGE_CODE,
                      "conditions": []}},
            {"id": "out", "type": "output", "position": {"x": 2, "y": 0},
             "data": {"kind": "api"}},
        ],
        "edges": [
            {"id": "m1", "source": "ds1", "target": "gate", "targetHandle": "input_1"},
            {"id": "m2", "source": "ds2", "target": "gate", "targetHandle": "input_2"},
            {"id": "m3", "source": "gate", "target": "out"},
        ],
    }


async def _run() -> None:
    # seed a throwaway user + pipeline
    user_id = await db.pool().fetchval(
        "INSERT INTO app.users (email, display_name) VALUES ($1,$2) "
        "ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name "
        "RETURNING id", f"pipe-db-test-{int(time.time())}@t.com", "pipe-db-test")
    pid = await db.pool().fetchval(
        "INSERT INTO app.pipelines (user_id, name) VALUES ($1,$2) RETURNING id",
        user_id, "db-itest")
    schema = pipelines.schema_for(pid)

    try:
        # 1. CSV ingestion (durable source storage + inference)
        ing = await pipelines.ingest_csv(pid, "ds", "orders.csv", ORDERS_CSV)
        check(ing["table_name"] == "orders", "ingest: table name inferred")
        check(ing["row_count"] == 5, "ingest: 5 rows stored", f"got {ing['row_count']}")
        check(len(ing["preview"]) == 5, "ingest: preview returned")

        # 2. execute the DAG
        run_id = await pipelines.run(pid, user_id, _graph())
        check(isinstance(run_id, int), "run: returns a run id")

        # 3. run status is success and stats add up
        row = await db.pool().fetchrow(
            "SELECT status, stats FROM app.pipeline_runs WHERE id=$1", run_id)
        stats = row["stats"] if isinstance(row["stats"], dict) else json.loads(row["stats"])
        check(row["status"] == "success", "run: status success", f"got {row['status']}")
        check(stats.get("ok") == 5 and stats.get("failed") == 0,
              "run: all 5 nodes ok", f"got {stats}")

        # 4. datasource + function output tables materialised
        ds_rows = await pipelines._read_table(schema, "node_ds")
        check(len(ds_rows) == 5, "engine: datasource wrote 5 rows")
        fn_rows = await pipelines._read_table(schema, "node_fn")
        check(len(fn_rows) == 5, "engine: function output has 5 rows")
        check(isinstance(fn_rows[0]["amount"], int),
              "engine: function cast amount to int (typed table)",
              f"got {type(fn_rows[0]['amount'])}")

        # 5. gate routed rows into the two branch tables correctly
        big = await pipelines._read_table(schema, "node_gate__big")
        small = await pipelines._read_table(schema, "node_gate__small")
        check(len(big) == 3, "gate: 3 rows routed to amount>100", f"got {len(big)}")
        check(len(small) == 2, "gate: 2 rows routed to amount<=100", f"got {len(small)}")
        check(all(r["amount"] > 100 for r in big), "gate: big branch predicate holds")
        check(all(r["amount"] <= 100 for r in small),
              "gate: small branch predicate holds")

        # 6. activity log has one row per node with subtasks + status
        logs = await db.pool().fetch(
            "SELECT node_id, node_type, status, subtasks, rows_out "
            "FROM app.pipeline_logs WHERE run_id=$1 ORDER BY id", run_id)
        by_node = {r["node_id"]: r for r in logs}
        check(set(by_node) == {"ds", "fn", "gate", "big", "small"},
              "logs: one entry per node", f"got {set(by_node)}")
        check(all(r["status"] == "success" for r in logs), "logs: all succeeded")
        subs = by_node["ds"]["subtasks"]
        subs = subs if isinstance(subs, list) else json.loads(subs)
        check(len(subs) >= 1, "logs: datasource records subtasks")

        # 7. node_preview API-shape helper
        prev = await pipelines.node_preview(pid, "big")
        check(prev["ok"] and prev["row_count"] == 3,
              "preview: node_preview returns branch rows", f"got {prev['row_count']}")

        # 8. ERROR PATH — a broken function fails and skips downstream
        bad = _graph()
        bad["nodes"][1]["data"]["code"] = (
            "def transform(df):\n    raise RuntimeError('kaboom')")
        err_run = await pipelines.run(pid, user_id, bad)
        erow = await db.pool().fetchrow(
            "SELECT status, stats FROM app.pipeline_runs WHERE id=$1", err_run)
        estats = erow["stats"] if isinstance(erow["stats"], dict) else json.loads(erow["stats"])
        check(erow["status"] == "error", "error: run marked error")
        elogs = {r["node_id"]: r["status"] for r in await db.pool().fetch(
            "SELECT node_id, status FROM app.pipeline_logs WHERE run_id=$1", err_run)}
        check(elogs.get("fn") == "error", "error: function node logged error")
        check(elogs.get("gate") == "skipped"
              and elogs.get("big") == "skipped"
              and elogs.get("small") == "skipped",
              "error: downstream nodes skipped", f"got {elogs}")
        check(estats.get("failed", 0) >= 3, "error: stats count failures")

        # 9. LIVE PREVIEW — preview a mid-DAG node without a full run
        prev = await pipelines.preview_node(pid, _graph(), "fn")
        check(prev["ok"] and prev["row_count"] == 5,
              "preview_node: function output live (no full run)",
              f"got {prev.get('row_count')}")
        prev_ds = await pipelines.preview_node(pid, _graph(), "ds")
        check(prev_ds["row_count"] == 5, "preview_node: datasource live")

        # 10. TWO-INPUT GATE + conditional_function
        await pipelines.ingest_csv(pid, "ds1", "a.csv", "id\n1\n2\n3\n")
        await pipelines.ingest_csv(pid, "ds2", "b.csv", "id\n4\n5\n")
        run2 = await pipelines.run(pid, user_id, _merge_graph())
        r2 = await db.pool().fetchrow(
            "SELECT status FROM app.pipeline_runs WHERE id=$1", run2)
        check(r2["status"] == "success", "merge: run succeeds", f"got {r2['status']}")
        gate_rows = await pipelines._read_table(schema, "node_gate")
        check(len(gate_rows) == 5, "merge: conditional_function combined 3+2 → 5",
              f"got {len(gate_rows)}")
        srcs = {r.get("src") for r in gate_rows}
        check(srcs == {"a", "b"}, "merge: both inputs tagged in output", f"got {srcs}")

        # 11. multi-input gate WITHOUT a function fails cleanly
        nofn = _merge_graph()
        for n in nofn["nodes"]:
            if n["id"] == "gate":
                n["data"]["code"] = ""
        run3 = await pipelines.run(pid, user_id, nofn)
        gstat = await db.pool().fetchval(
            "SELECT status FROM app.pipeline_logs WHERE run_id=$1 AND node_id='gate'",
            run3)
        check(gstat == "error", "merge: multi-input without function errors",
              f"got {gstat}")

        # 12. teardown drops the sandbox schema
        await pipelines.teardown(pid)
        exists = await db.pool().fetchval(
            "SELECT 1 FROM information_schema.schemata WHERE schema_name=$1", schema)
        check(exists is None, "teardown: pipe_<id> schema dropped")

    finally:
        # cascades remove pipeline_sources / runs / logs
        await db.pool().execute("DELETE FROM app.pipelines WHERE id=$1", pid)
        await db.pool().execute("DELETE FROM app.users WHERE id=$1", user_id)
        await pipelines.teardown(pid)


async def _reachable() -> bool:
    """Fast pre-flight so an unreachable DB skips in ~3s instead of retrying."""
    import asyncpg
    from app.config import get_settings
    s = get_settings()
    try:
        conn = await asyncpg.connect(
            s.database_url, timeout=3,
            ssl=db._ssl_arg(s.db_sslmode))
        await conn.close()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _main_async() -> bool:
    """Returns True if the DB was reachable and tests ran; False to skip."""
    if not await _reachable():
        print("SKIP: database not reachable (pre-flight probe failed).")
        print("      Start Postgres / the tunnel, then re-run.")
        return False
    await db.init_pool()
    try:
        await _run()
    finally:
        await db.close_pool()
    return True


def main() -> int:
    print("== pipeline DB integration tests ==")
    # a single event loop: the asyncpg pool is bound to the loop that created it
    ran = asyncio.run(_main_async())
    if not ran:
        return 0
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_pipelines_db_integration():
    assert main() == 0, "pipeline DB integration checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
