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


def test_run_conditional() -> None:
    async def run():
        a = [{"x": 1}]
        b = [{"x": 2}, {"x": 3}]
        r = await func_runner.run_conditional("return input_1 + input_2",
                                              {"input_1": a, "input_2": b})
        check(r["ok"] and r["rows"] == [{"x": 1}, {"x": 2}, {"x": 3}],
              "conditional: input_1 + input_2 concatenates rows", f"got {r}")
        r = await func_runner.run_conditional(
            "out = [{**x, 's': 'a'} for x in input_1] + "
            "[{**x, 's': 'b'} for x in input_2]\nreturn out",
            {"input_1": [{"v": 1}], "input_2": [{"v": 2}]})
        check(r["ok"] and r["rows"] == [{"v": 1, "s": "a"}, {"v": 2, "s": "b"}],
              "conditional: format + combine", f"got {r}")
        r = await func_runner.run_conditional("", {"input_1": a, "input_2": b})
        check(r["ok"] and r["rows"] == a, "conditional: empty body → input_1")
        r = await func_runner.run_conditional("raise ValueError('nope')", {"input_1": a})
        check(r["ok"] is False and "nope" in (r["error"] or ""),
              "conditional: runtime error captured", f"got {r}")

    asyncio.run(run())


def test_ancestors() -> None:
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "c"},
             {"source": "x", "target": "c"}]
    check(pipelines._ancestors("c", edges) == {"a", "b", "x"},
          "ancestors: full upstream set")
    check(pipelines._ancestors("a", edges) == set(), "ancestors: a source has none")


def test_ws_and_api_helpers() -> None:
    payload = {"channel": "market_trades",
               "events": [{"type": "update", "price": "60000"}]}
    check(pipelines._ws_rows(payload, None) == [{"type": "update", "price": "60000"}],
          "ws: events unwrapped by _flatten")
    nested = {"events": [{"trades": [{"p": 1}, {"p": 2}]}]}
    check(pipelines._dig(nested, "events.0.trades") == [{"p": 1}, {"p": 2}],
          "ws: _dig resolves list index + key")
    check(pipelines._fields_dict(
        {"body_fields": [{"key": "a", "value": "1"}, {"key": "", "value": "x"}]})
        == {"a": "1"}, "api: _fields_dict drops blank keys")


def test_run_llm(monkeypatch=None) -> None:
    async def run():
        calls = {"n": 0}

        async def fake_complete(messages, **kw):
            calls["n"] += 1
            return "ANSWER"

        orig = pipelines._llm_complete
        pipelines._llm_complete = fake_complete
        try:
            rows = [{"id": 1}, {"id": 2}]
            subs, out = await pipelines._run_llm(
                {"mode": "per_row", "output_field": "ai"}, rows)
            check(out == [{"id": 1, "ai": "ANSWER"}, {"id": 2, "ai": "ANSWER"}],
                  "llm: per-row adds output column", f"got {out}")
            subs, out = await pipelines._run_llm({"mode": "aggregate"}, rows)
            check(out == [{"llm_output": "ANSWER"}], "llm: aggregate → one row",
                  f"got {out}")

            async def boom(messages, **kw):
                raise RuntimeError("no key")
            pipelines._llm_complete = boom
            try:
                await pipelines._run_llm({"mode": "per_row"}, rows)
                check(False, "llm: all-errors raises")
            except ValueError:
                check(True, "llm: all-errors raises")
        finally:
            pipelines._llm_complete = orig

    asyncio.run(run())


def test_run_output_validation() -> None:
    async def run():
        subs, out = await pipelines._run_output({"kind": "api", "target": ""}, [{"a": 1}])
        check(out == [{"a": 1}] and any(s["status"] == "skipped" for s in subs),
              "output: no target → pass-through (skipped)", f"got {subs}")
        subs, out = await pipelines._run_output({"kind": "sse"}, [{"a": 1}])
        check(out == [{"a": 1}] and any(s["status"] == "skipped" for s in subs),
              "output: sse passes through + skipped subtask", f"got {subs}")

    asyncio.run(run())


def main() -> int:
    print("== pipeline unit tests ==")
    for fn in (test_topo_order, test_eval_predicate, test_pg_type, test_coerce,
               test_flatten, test_csv_rows, test_out_table, test_func_runner,
               test_run_conditional, test_ancestors, test_ws_and_api_helpers,
               test_run_llm, test_run_output_validation):
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
