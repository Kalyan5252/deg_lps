"""Unit tests for the pipeline engine's pure helpers + the function sandbox.

No database, no HTTP — just the deterministic building blocks in
``app.pipelines`` and the subprocess runner in ``app.func_runner``. These always
run (no external prereqs).

Run directly::

    cd backend
    ./.venv/bin/python -m tests.test_pipelines_unit

Or under pytest::

    ./.venv/bin/python -m pytest tests/test_pipelines_unit.py
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

from app import func_runner, pipelines

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


# --------------------------------------------------------------------------
# _topo_order — DAG ordering
# --------------------------------------------------------------------------

def test_topo_order() -> None:
    nodes = [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}]
    edges = [
        {"source": "a", "target": "b"},
        {"source": "b", "target": "c"},
        {"source": "b", "target": "d"},
    ]
    order = pipelines._topo_order(nodes, edges)
    check(order.index("a") < order.index("b"), "topo: source before child")
    check(order.index("b") < order.index("c")
          and order.index("b") < order.index("d"),
          "topo: parent before both branches")
    check(set(order) == {"a", "b", "c", "d"}, "topo: every node present once",
          f"got {order}")

    # a cycle must not hang and every node still appears
    cyc = pipelines._topo_order(
        [{"id": "x"}, {"id": "y"}],
        [{"source": "x", "target": "y"}, {"source": "y", "target": "x"}])
    check(set(cyc) == {"x", "y"}, "topo: cycle leftovers still returned",
          f"got {cyc}")


# --------------------------------------------------------------------------
# _eval_predicate — safe gate expressions
# --------------------------------------------------------------------------

def test_eval_predicate() -> None:
    check(pipelines._eval_predicate("amount > 100", {"amount": 200}) is True,
          "predicate: true branch")
    check(pipelines._eval_predicate("amount > 100", {"amount": 50}) is False,
          "predicate: false branch")
    check(pipelines._eval_predicate("", {"amount": 1}) is True,
          "predicate: blank passes everything")
    check(pipelines._eval_predicate("nope >", {"amount": 1}) is False,
          "predicate: malformed expression is safe (False)")
    check(pipelines._eval_predicate("len(name) >= 3", {"name": "abc"}) is True,
          "predicate: safe builtin len() available")
    # sandbox: dangerous names are not available -> evaluates to False, no raise
    check(pipelines._eval_predicate("__import__('os')", {}) is False,
          "predicate: __import__ is blocked")


# --------------------------------------------------------------------------
# _pg_type / _coerce — value → Postgres type inference + coercion
# --------------------------------------------------------------------------

def test_pg_type() -> None:
    check(pipelines._pg_type([1, 2, 3]) == "BIGINT", "type: ints → BIGINT")
    check(pipelines._pg_type([1, 2.5, 3]) == "NUMERIC", "type: mixed → NUMERIC")
    check(pipelines._pg_type([True, False]) == "BOOLEAN", "type: bools → BOOLEAN")
    check(pipelines._pg_type(["a", "b"]) == "TEXT", "type: strings → TEXT")
    check(pipelines._pg_type([]) == "TEXT", "type: empty → TEXT")
    check(pipelines._pg_type([1, None, 2]) == "BIGINT",
          "type: NULLs ignored during inference")


def test_coerce() -> None:
    check(pipelines._coerce("BIGINT", "5") == 5, "coerce: BIGINT from str")
    check(pipelines._coerce("NUMERIC", "1.5") == Decimal("1.5"),
          "coerce: NUMERIC → Decimal")
    check(pipelines._coerce("BOOLEAN", "yes") is True, "coerce: BOOLEAN yes→True")
    check(pipelines._coerce("BIGINT", "") is None, "coerce: empty → None")
    check(pipelines._coerce("BIGINT", None) is None, "coerce: None → None")
    check(pipelines._coerce("BIGINT", "notanint") is None,
          "coerce: bad number → None (no crash)")
    check(pipelines._coerce("TEXT", {"a": 1}) == '{"a": 1}',
          "coerce: dict → JSON text")


# --------------------------------------------------------------------------
# _flatten — arbitrary JSON body → rows
# --------------------------------------------------------------------------

def test_flatten() -> None:
    check(pipelines._flatten([{"a": 1}, {"a": 2}]) == [{"a": 1}, {"a": 2}],
          "flatten: list passes through")
    check(pipelines._flatten({"data": [{"x": 1}]}) == [{"x": 1}],
          "flatten: unwraps {data:[...]}")
    check(pipelines._flatten({"results": [{"x": 9}]}) == [{"x": 9}],
          "flatten: unwraps {results:[...]}")
    check(pipelines._flatten({"a": 1}) == [{"a": 1}],
          "flatten: bare object → single row")
    check(pipelines._flatten(42) == [{"value": 42}],
          "flatten: scalar → {value}")
    nested = pipelines._flatten([{"a": {"b": 1}}])
    check(nested == [{"a": '{"b": 1}'}], "flatten: nested value serialised",
          f"got {nested}")


# --------------------------------------------------------------------------
# _csv_rows / _out_table / schema_for
# --------------------------------------------------------------------------

def test_csv_rows() -> None:
    csv_text = "id,name\n1,Ana\n2,Bruno\n"
    cols = [{"name": "id"}, {"name": "name"}]
    rows = pipelines._csv_rows(csv_text, cols, None)
    check(rows == [{"id": "1", "name": "Ana"}, {"id": "2", "name": "Bruno"}],
          "csv_rows: maps header to columns", f"got {rows}")
    check(len(pipelines._csv_rows(csv_text, cols, 1)) == 1,
          "csv_rows: honours row limit")


def test_out_table() -> None:
    check(pipelines._out_table("n1", "n2", False) == "node_n1",
          "out_table: normal node shares one table")
    check(pipelines._out_table("g1", "t2", True) == "node_g1__t2",
          "out_table: gate fans out per target")
    check(pipelines.schema_for(7) == "pipe_7", "schema_for: pipe_<id>")


# --------------------------------------------------------------------------
# func_runner — the Python subprocess sandbox (async)
# --------------------------------------------------------------------------

def test_func_runner() -> None:
    async def run():
        rows = [{"id": 1, "amount": 50}, {"id": 2, "amount": 200}]

        # 1. filter with pandas
        r = await func_runner.run_function(
            "def transform(df):\n    return df[df['amount'] > 100]", rows)
        check(r["ok"] and r["rows"] == [{"id": 2, "amount": 200}],
              "func: pandas filter returns matching rows", f"got {r}")

        # 2. return a plain list[dict]
        r = await func_runner.run_function(
            "def transform(df):\n    return [{'k': 1}, {'k': 2}]", rows)
        check(r["ok"] and r["rows"] == [{"k": 1}, {"k": 2}],
              "func: list[dict] return supported", f"got {r}")

        # 3. return None → empty result set
        r = await func_runner.run_function("def transform(df):\n    return None", rows)
        check(r["ok"] and r["rows"] == [], "func: None → empty rows", f"got {r}")

        # 4. runtime error → structured failure, not a crash
        r = await func_runner.run_function(
            "def transform(df):\n    raise ValueError('boom')", rows)
        check(r["ok"] is False and "boom" in (r["error"] or ""),
              "func: runtime error is captured", f"got {r}")

        # 5. missing transform → helpful error
        r = await func_runner.run_function("x = 1", rows)
        check(r["ok"] is False and "transform" in (r["error"] or "").lower(),
              "func: missing transform() reported", f"got {r}")

    asyncio.run(run())


def main() -> int:
    print("== pipeline unit tests ==")
    for fn in (test_topo_order, test_eval_predicate, test_pg_type, test_coerce,
               test_flatten, test_csv_rows, test_out_table, test_func_runner):
        fn()
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


# pytest entry point
def test_pipeline_units():
    assert main() == 0, "pipeline unit checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
