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
DEFAULT_FETCH_ROWS = 1000
_BLOCKED_SQL = re.compile(
    r"\b(?:DROP|ALTER|CREATE)\s+(?:DATABASE|SCHEMA)\b|"
    r"\bSET\s+(?:LOCAL\s+)?search_path\b",
    re.IGNORECASE,
)
_PROTECTED_SCHEMA_REF = re.compile(
    r'(?:"(?P<q_schema>app|public|sandbox_[A-Za-z0-9_]+|custom_[A-Za-z0-9_]+)"|'
    r'(?P<schema>app|public|sandbox_[A-Za-z0-9_]+|custom_[A-Za-z0-9_]+))\s*\.',
    re.IGNORECASE,
)


class SandboxPermissionError(Exception):
    """Raised when user SQL tries to leave its assigned schema."""


def schema_name(key: str) -> str:
    return f"sandbox_{key}"


def user_schema_name(user_id: int, key: str) -> str:
    return f"sandbox_u{int(user_id)}_{key}"


# --------------------------------------------------------------------------
# Provisioning
# --------------------------------------------------------------------------

async def provision(scenario: Scenario, force: bool = False) -> None:
    if not scenario.seed_sql:
        return
    schema = schema_name(scenario.key)
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            # serialize concurrent provisioning of the same schema (two browser
            # requests can race here and collide on CREATE SCHEMA)
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext($1))", schema)
            exists = await conn.fetchval(
                "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
                schema)
            if exists:
                if not force:
                    return
                await conn.execute(f'DROP SCHEMA "{schema}" CASCADE')
            await conn.execute(f'CREATE SCHEMA "{schema}"')
            await conn.execute(f'SET LOCAL search_path TO "{schema}"')
            await conn.execute(scenario.seed_sql)


async def provision_all(force: bool = False) -> None:
    for scenario in all_scenarios():
        await provision(scenario, force=force)


async def provision_user_snapshot(
    scenario: Scenario, user_id: int, force: bool = False
) -> str:
    """Create a user's private scenario schema from the admin seed schema."""
    admin_schema = schema_name(scenario.key)
    user_schema = user_schema_name(user_id, scenario.key)
    await provision(scenario)
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            # serialize concurrent provisioning of the same user schema — the
            # scenario page fires detail + schema requests in parallel and both
            # land here on first open
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext($1))", user_schema)
            exists = await conn.fetchval(
                "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
                user_schema,
            )
            if exists:
                if not force:
                    return user_schema
                await conn.execute(f'DROP SCHEMA "{user_schema}" CASCADE')
            await conn.execute(f'CREATE SCHEMA "{user_schema}"')
            tables = await conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname = $1 "
                "ORDER BY tablename",
                admin_schema,
            )
            for table in tables:
                name = table["tablename"]
                await conn.execute(
                    f'CREATE TABLE "{user_schema}"."{name}" '
                    f'(LIKE "{admin_schema}"."{name}" INCLUDING ALL)'
                )
                await conn.execute(
                    f'INSERT INTO "{user_schema}"."{name}" '
                    f'SELECT * FROM "{admin_schema}"."{name}"'
                )
                await conn.execute(f'ANALYZE "{user_schema}"."{name}"')
    return user_schema


async def schema_graph(schema: str) -> dict[str, Any]:
    """Return table/column metadata and inferred relations for a sandbox schema."""
    async with db.pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.ordinal_position,
                COALESCE(pk.is_pk, false) AS is_pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT
                    ku.table_schema,
                    ku.table_name,
                    ku.column_name,
                    true AS is_pk
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                  ON ku.constraint_name = tc.constraint_name
                 AND ku.constraint_schema = tc.constraint_schema
                 AND ku.table_schema = tc.table_schema
                 AND ku.table_name = tc.table_name
                WHERE tc.constraint_type = 'PRIMARY KEY'
            ) pk
              ON pk.table_schema = c.table_schema
             AND pk.table_name = c.table_name
             AND pk.column_name = c.column_name
            WHERE c.table_schema = $1
            ORDER BY c.table_name, c.ordinal_position
            """,
            schema,
        )
        counts = {
            r["tablename"]: int(r["n"])
            for r in await conn.fetch(
                """
                SELECT c.relname AS tablename, c.reltuples::bigint AS n
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = $1 AND c.relkind = 'r'
                """,
                schema,
            )
        }

    tables_by_name: dict[str, dict[str, Any]] = {}
    for row in rows:
        table = tables_by_name.setdefault(
            row["table_name"],
            {"name": row["table_name"], "columns": [], "row_count": counts.get(row["table_name"], 0)},
        )
        table["columns"].append(
            {
                "name": row["column_name"],
                "type": _display_type(row["data_type"]),
                "pk": bool(row["is_pk"]),
            }
        )

    tables = list(tables_by_name.values())
    return {"tables": tables, "relations": _infer_relations(tables)}


def _display_type(data_type: str) -> str:
    t = (data_type or "").lower()
    if "timestamp" in t:
        return "TIMESTAMP"
    if t in ("bigint", "integer", "smallint"):
        return "BIGINT" if t == "bigint" else "INT"
    if t in ("numeric", "double precision", "real", "decimal"):
        return "NUMERIC"
    if t in ("character varying", "character", "text"):
        return "TEXT"
    return t.upper()


def _singular(name: str) -> str:
    return name[:-1] if name.endswith("s") else name


def _infer_relations(tables: list[dict[str, Any]]) -> list[dict[str, str]]:
    tmap = {t["name"]: t for t in tables}
    aliases: dict[str, str] = {}
    for name in tmap:
        aliases[name] = name
        aliases[_singular(name)] = name
        aliases[f"{_singular(name)}s"] = name

    relations: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()

    def has_col(table: str, col: str) -> bool:
        return any(c["name"] == col for c in tmap[table]["columns"])

    def add(from_table: str, from_col: str, to_table: str, to_col: str) -> None:
        key = (from_table, from_col, to_table, to_col)
        if from_table != to_table and to_table in tmap and key not in seen:
            seen.add(key)
            relations.append(
                {
                    "from_table": from_table,
                    "from_col": from_col,
                    "to_table": to_table,
                    "to_col": to_col,
                }
            )

    for table in tables:
        for col in table["columns"]:
            name = col["name"]
            if name.endswith("_id") and name != "id":
                base = name[:-3]
                target = aliases.get(base) or aliases.get(f"{base}s")
                if target and has_col(target, "id"):
                    add(table["name"], name, target, "id")
    return relations


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


def _can_wrap_limit(stmt: str) -> bool:
    cleaned = _strip_comments(stmt).lstrip()
    first = re.match(r"[A-Za-z]+", cleaned)
    return bool(first and first.group(0).upper() in {"SELECT", "WITH", "VALUES", "TABLE"})


def _validate_schema_access(stmt: str, schema: str) -> None:
    cleaned = _strip_comments(stmt)
    if _BLOCKED_SQL.search(cleaned):
        raise SandboxPermissionError(
            "Schema and database administration commands are not allowed here."
        )
    for match in _PROTECTED_SCHEMA_REF.finditer(cleaned):
        name = match.group("q_schema") or match.group("schema") or ""
        if name.lower() != schema.lower():
            raise SandboxPermissionError(
                f'Access to schema "{name}" is not allowed in this workspace.'
            )


async def _set_session(conn: asyncpg.Connection, schema: str) -> None:
    await conn.execute(f'SET LOCAL search_path TO "{schema}", pg_temp')
    await conn.execute(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")


async def run(
    scenario: Scenario,
    sql: str,
    schema: str | None = None,
    max_rows: int | None = DEFAULT_FETCH_ROWS,
) -> dict[str, Any]:
    return await run_in_schema(schema or schema_name(scenario.key), sql, max_rows=max_rows)


async def drop_schema(schema: str) -> None:
    async with db.pool().acquire() as conn:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


async def run_in_schema(
    schema: str, sql: str, max_rows: int | None = DEFAULT_FETCH_ROWS
) -> dict[str, Any]:
    """Execute (possibly multi-statement) SQL; return the last statement's result."""
    statements = _split_statements(sql)
    if not statements:
        return {"ok": False, "error": "No SQL statement found.", "columns": [],
                "rows": [], "row_count": 0, "duration_ms": 0.0, "command": None}

    columns: list[str] = []
    rows: list[dict[str, Any]] = []
    command: str | None = None
    truncated = False
    start = time.perf_counter()
    try:
        async with db.pool().acquire() as conn:
            async with conn.transaction():
                await _set_session(conn, schema)
                for stmt in statements:
                    if _is_empty(stmt):
                        continue
                    _validate_schema_access(stmt, schema)
                    if _returns_rows(stmt):
                        if max_rows is None:
                            records = await conn.fetch(stmt)
                            truncated = False
                        elif _can_wrap_limit(stmt):
                            records = await conn.fetch(
                                f"SELECT * FROM ({stmt}) AS sqlforge_limited "
                                f"LIMIT {max_rows + 1}"
                            )
                            truncated = len(records) > max_rows
                            records = records[:max_rows]
                        else:
                            records = await conn.fetch(stmt)
                            truncated = False
                        columns = list(records[0].keys()) if records else []
                        rows = [
                            {k: _jsonable(v) for k, v in r.items()} for r in records
                        ]
                        command = None
                    else:
                        command = await conn.execute(stmt)
                        columns, rows = [], []
                        truncated = False
    except (asyncpg.PostgresError, SandboxPermissionError) as exc:
        return {"ok": False, "error": str(exc), "columns": [], "rows": [],
                "row_count": 0,
                "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                "command": None}
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    return {"ok": True, "error": None, "columns": columns, "rows": rows,
            "row_count": len(rows), "duration_ms": duration_ms, "command": command,
            "truncated": truncated}


async def explain(
    scenario: Scenario, sql: str, analyze: bool = True, schema: str | None = None
) -> dict[str, Any]:
    schema = schema or schema_name(scenario.key)
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
                _validate_schema_access(target, schema)
                plan = await conn.fetchval(f"EXPLAIN ({opts}) {target}")
    except (asyncpg.PostgresError, SandboxPermissionError) as exc:
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
    schema: str | None = None,
) -> list[dict[str, Any]]:
    schema = schema or schema_name(scenario.key)
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
                            _validate_schema_access(target, schema)
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
                            _validate_schema_access(target, schema)
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
                except (asyncpg.PostgresError, SandboxPermissionError) as exc:
                    passed = False
                    detail = f"Check failed to run: {exc}"

                results.append({
                    "label": label, "weight": weight,
                    "passed": passed, "detail": detail,
                })
    return results
