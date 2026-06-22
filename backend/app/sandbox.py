"""Per-scenario SQL sandbox.

Each scenario gets its own ``sandbox_<key>`` schema seeded with data that
contains the scenario's problems. User SQL runs inside that schema with a
restricted ``search_path`` and a statement timeout. We capture wall-clock
timing, errors, and (separately) EXPLAIN output so the evaluator can reason
about query plans.

This is a single-user local learning tool, not a multi-tenant sandbox: the
isolation here is search_path + statement_timeout, not a security boundary.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import asyncpg

from . import db
from .scenarios import Scenario, all_scenarios

STATEMENT_TIMEOUT_MS = 15000
_ROW_KEYWORDS = ("SELECT", "WITH", "EXPLAIN", "SHOW", "TABLE", "VALUES")


def schema_name(key: str) -> str:
    return f"sandbox_{key}"


# --------------------------------------------------------------------------
# Provisioning
# --------------------------------------------------------------------------

async def provision(scenario: Scenario, force: bool = False) -> None:
    if not scenario.seed_sql:
        return
    schema = schema_name(scenario.key)
    async with db.pool().acquire() as conn:
        if force:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        exists = await conn.fetchval(
            "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", schema
        )
        if exists and not force:
            return
        await conn.execute(f'CREATE SCHEMA "{schema}"')
        async with conn.transaction():
            await conn.execute(f'SET LOCAL search_path TO "{schema}"')
            await conn.execute(scenario.seed_sql)


async def provision_all(force: bool = False) -> None:
    for scenario in all_scenarios():
        await provision(scenario, force=force)


# --------------------------------------------------------------------------
# Execution
# --------------------------------------------------------------------------

def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _split_statements(sql: str) -> list[str]:
    """Naive-but-safe split on ; ignoring quotes, dollar quotes and comments."""
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    in_single = in_double = in_line_comment = in_block_comment = False
    dollar_tag: str | None = None
    while i < n:
        ch = sql[i]
        two = sql[i:i + 2]
        if in_line_comment:
            buf.append(ch)
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            buf.append(ch)
            if two == "*/":
                buf.append(sql[i + 1])
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(ch)
            i += 1
            continue
        if in_single:
            buf.append(ch)
            if ch == "'":
                in_single = False
            i += 1
            continue
        if in_double:
            buf.append(ch)
            if ch == '"':
                in_double = False
            i += 1
            continue
        if two == "--":
            in_line_comment = True
            buf.append(two)
            i += 2
            continue
        if two == "/*":
            in_block_comment = True
            buf.append(two)
            i += 2
            continue
        if ch == "'":
            in_single = True
            buf.append(ch)
            i += 1
            continue
        if ch == '"':
            in_double = True
            buf.append(ch)
            i += 1
            continue
        m = re.match(r"\$[A-Za-z_]*\$", sql[i:])
        if m:
            dollar_tag = m.group(0)
            buf.append(dollar_tag)
            i += len(dollar_tag)
            continue
        if ch == ";":
            statements.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return [s.strip() for s in statements if s.strip()]


def _strip_comments(stmt: str) -> str:
    no_block = re.sub(r"/\*.*?\*/", "", stmt, flags=re.DOTALL)
    no_line = re.sub(r"--[^\n]*", "", no_block)
    return no_line


def _is_empty(stmt: str) -> bool:
    """A statement with no executable SQL (only comments / whitespace)."""
    return _strip_comments(stmt).strip() == ""


def _returns_rows(stmt: str) -> bool:
    cleaned = _strip_comments(stmt).lstrip()
    first = re.match(r"[A-Za-z]+", cleaned)
    return bool(first and first.group(0).upper() in _ROW_KEYWORDS)


async def _set_session(conn: asyncpg.Connection, schema: str) -> None:
    await conn.execute(f'SET LOCAL search_path TO "{schema}"')
    await conn.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")


async def run(scenario: Scenario, sql: str) -> dict[str, Any]:
    """Execute (possibly multi-statement) SQL; return the last statement's result."""
    schema = schema_name(scenario.key)
    statements = _split_statements(sql)
    if not statements:
        return {"ok": False, "error": "No SQL statement found.", "columns": [],
                "rows": [], "row_count": 0, "duration_ms": 0.0, "command": None}

    columns: list[str] = []
    rows: list[dict[str, Any]] = []
    command: str | None = None
    start = time.perf_counter()
    try:
        async with db.pool().acquire() as conn:
            async with conn.transaction():
                await _set_session(conn, schema)
                for stmt in statements:
                    if _is_empty(stmt):
                        continue
                    if _returns_rows(stmt):
                        records = await conn.fetch(stmt)
                        columns = list(records[0].keys()) if records else []
                        rows = [
                            {k: _jsonable(v) for k, v in r.items()} for r in records
                        ]
                        command = None
                    else:
                        command = await conn.execute(stmt)
                        columns, rows = [], []
    except asyncpg.PostgresError as exc:
        return {"ok": False, "error": str(exc), "columns": [], "rows": [],
                "row_count": 0,
                "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                "command": None}
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    return {"ok": True, "error": None, "columns": columns, "rows": rows,
            "row_count": len(rows), "duration_ms": duration_ms, "command": command}


async def explain(scenario: Scenario, sql: str, analyze: bool = True) -> dict[str, Any]:
    schema = schema_name(scenario.key)
    statements = _split_statements(sql)
    target = next((s for s in statements if _returns_rows(s)), None)
    if not target:
        return {"ok": False, "error": "EXPLAIN needs a query that returns rows.",
                "plan": None}
    # strip an existing EXPLAIN prefix so we control the options
    target = re.sub(r"^\s*EXPLAIN\s*(\([^)]*\))?\s*", "", target, flags=re.IGNORECASE)
    opts = "ANALYZE, BUFFERS, FORMAT JSON" if analyze else "FORMAT JSON"
    try:
        async with db.pool().acquire() as conn:
            async with conn.transaction():
                await _set_session(conn, schema)
                plan = await conn.fetchval(f"EXPLAIN ({opts}) {target}")
    except asyncpg.PostgresError as exc:
        return {"ok": False, "error": str(exc), "plan": None}
    return {"ok": True, "error": None, "plan": plan}


# --------------------------------------------------------------------------
# Evaluation checks
# --------------------------------------------------------------------------

def _norm(value: Any) -> Any:
    if isinstance(value, Decimal):
        return round(float(value), 4)
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _multiset(rows: list[Any]) -> list[tuple]:
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append(tuple(_norm(v) for v in r.values()))
        else:
            out.append(tuple(_norm(v) for v in r))
    out.sort(key=lambda t: tuple(str(x) for x in t))
    return out


def _walk_plan(node: dict[str, Any]):
    yield node
    for child in node.get("Plans", []) or []:
        yield from _walk_plan(child)


async def _explain_nodes(conn: asyncpg.Connection, target: str):
    target = re.sub(r"^\s*EXPLAIN\s*(\([^)]*\))?\s*", "", target, flags=re.IGNORECASE)
    raw = await conn.fetchval(f"EXPLAIN (FORMAT JSON) {target}")
    plan = raw[0]["Plan"] if isinstance(raw, list) else raw["Plan"]
    return list(_walk_plan(plan))


async def run_checks(
    scenario: Scenario, user_sql: str,
    user_columns: list[str], user_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    schema = schema_name(scenario.key)
    statements = _split_statements(user_sql)
    user_query = next((s for s in statements if _returns_rows(s)), None)
    results: list[dict[str, Any]] = []

    async with db.pool().acquire() as conn:
        async with conn.transaction():
            await _set_session(conn, schema)
            for chk in scenario.checks:
                ctype = chk["type"]
                weight = int(chk.get("weight", 0))
                label = chk.get("label", ctype)
                passed = False
                detail = ""
                try:
                    if ctype == "matches":
                        expected = await conn.fetch(scenario.expected_sql)
                        exp = _multiset([dict(r) for r in expected])
                        got = _multiset(user_rows)
                        passed = exp == got
                        if not passed:
                            detail = (f"Expected {len(exp)} rows, your query returned "
                                      f"{len(got)}.")
                        else:
                            detail = f"{len(got)} rows match the reference result."

                    elif ctype == "row_count":
                        passed = len(user_rows) == int(chk["count"])
                        detail = f"Returned {len(user_rows)} rows."

                    elif ctype in ("explain_no_seqscan", "uses_index_scan"):
                        target = scenario.target_sql or user_query
                        if not target:
                            detail = "No query to analyze."
                        else:
                            nodes = await _explain_nodes(conn, target)
                            table = chk.get("table")
                            if ctype == "explain_no_seqscan":
                                offenders = [
                                    n for n in nodes
                                    if n.get("Node Type") == "Seq Scan"
                                    and (table is None or n.get("Relation Name") == table)
                                ]
                                passed = not offenders
                                detail = ("No sequential scan on "
                                          f"{table}." if passed
                                          else f"Still sequentially scanning {table}.")
                            else:
                                scans = [
                                    n for n in nodes
                                    if "Index" in (n.get("Node Type") or "")
                                    and (table is None or n.get("Relation Name") == table)
                                ]
                                passed = bool(scans)
                                detail = ("Uses an index scan."
                                          if passed else "No index scan found.")

                    elif ctype == "runs_under_ms":
                        target = scenario.target_sql or user_query
                        if not target:
                            detail = "No query to time."
                        else:
                            t0 = time.perf_counter()
                            await conn.fetch(re.sub(
                                r"^\s*EXPLAIN\s*(\([^)]*\))?\s*", "", target,
                                flags=re.IGNORECASE))
                            ms = (time.perf_counter() - t0) * 1000
                            passed = ms <= float(chk["ms"])
                            detail = f"Ran in {ms:.1f}ms (target ≤ {chk['ms']}ms)."

                    elif ctype == "index_exists":
                        table = chk["table"]
                        cols = chk["columns"]
                        defs = await conn.fetch(
                            "SELECT indexdef FROM pg_indexes "
                            "WHERE schemaname = $1 AND tablename = $2",
                            schema, table)
                        passed = any(
                            all(c in d["indexdef"] for c in cols) for d in defs
                        )
                        detail = ("Index covering "
                                  f"{', '.join(cols)} exists." if passed
                                  else f"No index on {table}({', '.join(cols)}).")
                    else:
                        detail = f"Unknown check type: {ctype}"
                except asyncpg.PostgresError as exc:
                    passed = False
                    detail = f"Check failed to run: {exc}"

                results.append({
                    "label": label, "weight": weight,
                    "passed": passed, "detail": detail,
                })
    return results
