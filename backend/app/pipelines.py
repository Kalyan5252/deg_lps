"""Data Engineering DEI — pipeline provisioning, ingestion, and DAG execution.

A pipeline is a DAG of typed nodes stored as JSONB on ``app.pipelines``:

    nodes: [{ id, type, data, position }]        type ∈ datasource|function|gate|llm|output
    edges: [{ id, source, target, ... }]

Running a pipeline provisions a fresh on-demand ``pipe_<id>`` schema, then walks
the DAG in topological order. Each node reads its upstream rows, does its work,
and writes its output to a table in that schema. Every node execution appends a
row to ``app.pipeline_logs`` (the Activity feed) with per-node subtasks + status.

This mirrors the Custom Tracks pattern in ``custom.py`` (``custom_<id>`` schema,
on-demand provision/teardown, CSV parsing/inference reuse).
"""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import httpx

from . import ai, custom, db, func_runner, global_datasets, sandbox

MAX_ROWS = 50_000


def schema_for(pipeline_id: int) -> str:
    return f"pipe_{pipeline_id}"


def _out_table(source_id: str, target_id: str, is_gate: bool) -> str:
    """Name of the table holding a source node's output for a given target.

    Gates fan out — each outgoing branch gets its own table so downstream nodes
    read only the rows routed to them. Everything else shares one output table.
    """
    base = f"node_{source_id}"
    return f"{base}__{target_id}" if is_gate else base


# --------------------------------------------------------------------------
# Provisioning
# --------------------------------------------------------------------------

async def provision(pipeline_id: int) -> None:
    schema = schema_for(pipeline_id)
    async with db.pool().acquire() as conn:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await conn.execute(f'CREATE SCHEMA "{schema}"')


async def teardown(pipeline_id: int) -> None:
    await sandbox.drop_schema(schema_for(pipeline_id))


# --------------------------------------------------------------------------
# Generic row → table writer (type inference on Python values)
# --------------------------------------------------------------------------

def _pg_type(values: list[Any]) -> str:
    vals = [v for v in values if v is not None and v != ""]
    if not vals:
        return "TEXT"
    def _all(pred):
        return all(pred(v) for v in vals[:500])
    if _all(lambda v: isinstance(v, bool)):
        return "BOOLEAN"
    if _all(lambda v: isinstance(v, int) and not isinstance(v, bool)):
        return "BIGINT"
    if _all(lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)):
        return "NUMERIC"
    return "TEXT"


def _coerce(pgtype: str, v: Any) -> Any:
    if v is None or v == "":
        return None
    try:
        if pgtype == "BIGINT":
            return int(v)
        if pgtype == "NUMERIC":
            return Decimal(str(v))
        if pgtype == "BOOLEAN":
            if isinstance(v, bool):
                return v
            return str(v).strip().lower() in ("true", "t", "yes", "y", "1")
    except (ValueError, TypeError):
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)


async def _write_table(conn, schema: str, table: str,
                       rows: list[dict], columns: list[str] | None = None) -> int:
    """(Re)create `schema.table` from a list of dict rows. Returns row count."""
    if columns is None:
        columns = list(rows[0].keys()) if rows else []
    columns = columns or ["value"]
    # sanitise column names, keep a mapping to original keys
    safe: list[str] = []
    seen: set[str] = set()
    for i, c in enumerate(columns):
        s = custom._sanitize(str(c), f"col_{i + 1}")
        base, n = s, 1
        while s in seen:
            n += 1
            s = f"{base}_{n}"
        seen.add(s)
        safe.append(s)

    types = [_pg_type([r.get(orig) for r in rows])
             for orig in columns]
    coldefs = ", ".join(f'"{s}" {t}' for s, t in zip(safe, types))
    await conn.execute(f'DROP TABLE IF EXISTS "{schema}"."{table}"')
    await conn.execute(f'CREATE TABLE "{schema}"."{table}" ({coldefs})')
    if rows:
        recs = [
            tuple(_coerce(t, r.get(orig)) for orig, t in zip(columns, types))
            for r in rows
        ]
        await conn.copy_records_to_table(
            table, records=recs, columns=safe, schema_name=schema)
    return len(rows)


async def _read_table(schema: str, table: str) -> list[dict]:
    async with db.pool().acquire() as conn:
        try:
            recs = await conn.fetch(f'SELECT * FROM "{schema}"."{table}"')
        except Exception:
            return []
    return [{k: sandbox._jsonable(v) for k, v in r.items()} for r in recs]


# --------------------------------------------------------------------------
# CSV datasource ingestion (durable) — reuses custom.parse_csv
# --------------------------------------------------------------------------

async def ingest_csv(pipeline_id: int, node_id: str,
                     filename: str, text: str) -> dict[str, Any]:
    parsed = custom.parse_csv(filename, text)
    await db.pool().execute(
        "INSERT INTO app.pipeline_sources "
        "(pipeline_id, node_id, table_name, columns, row_count, csv_text) "
        "VALUES ($1,$2,$3,$4,$5,$6) "
        "ON CONFLICT (pipeline_id, node_id) DO UPDATE SET "
        "table_name=EXCLUDED.table_name, columns=EXCLUDED.columns, "
        "row_count=EXCLUDED.row_count, csv_text=EXCLUDED.csv_text",
        pipeline_id, node_id, parsed["table_name"],
        json.dumps(parsed["columns"]), parsed["row_count"], parsed["csv_text"])
    return {
        "table_name": parsed["table_name"],
        "columns": parsed["columns"],
        "row_count": parsed["row_count"],
        "preview": _csv_rows(parsed["csv_text"], parsed["columns"], 50),
    }


def _csv_rows(csv_text: str, columns: list[dict], limit: int | None) -> list[dict]:
    reader = csv.reader(io.StringIO(csv_text))
    all_rows = [r for r in reader if any(c.strip() for c in r)]
    data = all_rows[1:]
    if limit is not None:
        data = data[:limit]
    names = [c["name"] for c in columns]
    out = []
    for r in data:
        out.append({names[i]: (r[i] if i < len(r) else None)
                    for i in range(len(names))})
    return out


async def _rows_from_csv_source(pipeline_id: int, node_id: str) -> list[dict]:
    row = await db.pool().fetchrow(
        "SELECT columns, csv_text FROM app.pipeline_sources "
        "WHERE pipeline_id=$1 AND node_id=$2", pipeline_id, node_id)
    if not row:
        return []
    cols = row["columns"]
    if isinstance(cols, str):
        cols = json.loads(cols)
    return _csv_rows(row["csv_text"], cols, None)


# --------------------------------------------------------------------------
# Live datasource fetchers
# --------------------------------------------------------------------------

def _flatten(obj: Any) -> list[dict]:
    """Turn an arbitrary JSON body into a list of flat-ish dict rows."""
    if isinstance(obj, list):
        rows = obj
    elif isinstance(obj, dict):
        # common shapes: {data: [...]}, {results: [...]}, {items: [...]}
        for key in ("data", "results", "items", "records", "rows"):
            if isinstance(obj.get(key), list):
                rows = obj[key]
                break
        else:
            rows = [obj]
    else:
        rows = [{"value": obj}]
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append({k: (json.dumps(v) if isinstance(v, (dict, list)) else v)
                        for k, v in r.items()})
        else:
            out.append({"value": r})
    return out


async def _rows_from_api(data: dict) -> list[dict]:
    url = (data.get("url") or "").strip()
    if not url:
        raise ValueError("API datasource needs a URL.")
    method = (data.get("method") or "GET").upper()
    headers = data.get("headers") or {}
    body = data.get("body")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(
            method, url, headers=headers,
            json=body if body and method != "GET" else None)
        resp.raise_for_status()
        payload = resp.json()
    return _flatten(payload)[:MAX_ROWS]


async def _rows_from_postgres(data: dict) -> list[dict]:
    import asyncpg
    dsn = (data.get("dsn") or "").strip()
    query = (data.get("query") or "").strip()
    if not dsn or not query:
        raise ValueError("Postgres datasource needs a DSN and a SELECT query.")
    if not query.lower().lstrip().startswith("select"):
        raise ValueError("Only SELECT queries are allowed for a Postgres source.")
    conn = await asyncpg.connect(dsn, timeout=15)
    try:
        recs = await conn.fetch(f"SELECT * FROM ({query.rstrip(';')}) _src LIMIT {MAX_ROWS}")
    finally:
        await conn.close()
    return [{k: sandbox._jsonable(v) for k, v in r.items()} for r in recs]


async def _rows_from_public(data: dict) -> list[dict]:
    key = (data.get("dataset_key") or "").strip()
    table = (data.get("table") or "").strip()
    tables = global_datasets.load_tables(key)  # [(name, csv_text)]
    if not tables:
        raise ValueError(f"Unknown public dataset: {key!r}")
    name, csv_text = next((t for t in tables if t[0] == table), tables[0])
    reader = csv.reader(io.StringIO(csv_text))
    all_rows = [r for r in reader if any(c.strip() for c in r)]
    if not all_rows:
        return []
    header, *rows = all_rows
    return [{header[i]: (r[i] if i < len(r) else None)
             for i in range(len(header))} for r in rows[:MAX_ROWS]]


# --------------------------------------------------------------------------
# Conditional gate — safe predicate evaluation
# --------------------------------------------------------------------------

_SAFE_BUILTINS = {"len": len, "abs": abs, "min": min, "max": max,
                  "round": round, "str": str, "int": int, "float": float,
                  "bool": bool, "True": True, "False": False, "None": None}


def _eval_predicate(expr: str, row: dict) -> bool:
    if not expr or not expr.strip():
        return True
    try:
        return bool(eval(expr, {"__builtins__": {}}, {**_SAFE_BUILTINS, **row}))  # noqa: S307
    except Exception:
        return False


# --------------------------------------------------------------------------
# DAG execution
# --------------------------------------------------------------------------

def _topo_order(nodes: list[dict], edges: list[dict]) -> list[str]:
    ids = [n["id"] for n in nodes]
    incoming: dict[str, set[str]] = {i: set() for i in ids}
    for e in edges:
        if e["source"] in incoming and e["target"] in incoming:
            incoming[e["target"]].add(e["source"])
    order: list[str] = []
    ready = [i for i in ids if not incoming[i]]
    while ready:
        n = ready.pop(0)
        order.append(n)
        for m in ids:
            if n in incoming[m]:
                incoming[m].discard(n)
                if not incoming[m] and m not in order and m not in ready:
                    ready.append(m)
    # append any leftovers (cycles) so they at least get logged/skipped
    for i in ids:
        if i not in order:
            order.append(i)
    return order


async def _log(conn, run_id: int, node: dict, *, task: str, subtasks: list,
               status: str, rows_in=None, rows_out=None, duration_ms=None,
               message=None) -> None:
    await conn.execute(
        "INSERT INTO app.pipeline_logs "
        "(run_id, node_id, node_type, task, subtasks, status, rows_in, "
        " rows_out, duration_ms, message) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        run_id, node["id"], node.get("type", "?"), task,
        json.dumps(subtasks), status, rows_in, rows_out, duration_ms, message)


def _node_label(node: dict) -> str:
    return (node.get("data") or {}).get("label") or node.get("type") or node["id"]


async def run(pipeline_id: int, user_id: int, graph: dict) -> int:
    """Execute the pipeline DAG. Returns the run id."""
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    node_map = {n["id"]: n for n in nodes}
    schema = schema_for(pipeline_id)

    await provision(pipeline_id)
    run_id = await db.pool().fetchval(
        "INSERT INTO app.pipeline_runs (pipeline_id, user_id, status) "
        "VALUES ($1,$2,'running') RETURNING id", pipeline_id, user_id)

    order = _topo_order(nodes, edges)
    failed: set[str] = set()
    produced: set[str] = set()
    ok_count = 0

    for nid in order:
        node = node_map[nid]
        ntype = node.get("type", "?")
        data = node.get("data") or {}
        label = _node_label(node)
        incoming = [e for e in edges if e["target"] == nid]
        upstream_failed = any(e["source"] in failed or e["source"] not in produced
                              for e in incoming) and incoming
        t0 = datetime.utcnow()

        async with db.pool().acquire() as conn:
            if upstream_failed:
                await _log(conn, run_id, node, task=f"Skip {label}",
                           subtasks=[{"label": "upstream failed", "status": "skipped"}],
                           status="skipped",
                           message="Skipped because an upstream node failed.")
                failed.add(nid)
                continue

            # gather input rows from upstream output tables
            in_rows: list[dict] = []
            for e in incoming:
                src = node_map[e["source"]]
                is_gate = src.get("type") == "gate"
                tbl = _out_table(e["source"], nid, is_gate)
                in_rows.extend(await _read_table(schema, tbl))

            subtasks: list[dict] = []
            try:
                if ntype == "datasource":
                    subtasks, out_rows = await _run_datasource(pipeline_id, node)
                elif ntype == "function":
                    subtasks, out_rows = await _run_function(data, in_rows)
                elif ntype == "gate":
                    await _run_gate(conn, schema, nid, node, edges, in_rows)
                    dur = (datetime.utcnow() - t0).total_seconds() * 1000
                    await _log(conn, run_id, node, task=f"Route {label}",
                               subtasks=[{"label": f"routed {len(in_rows)} rows",
                                          "status": "success"}],
                               status="success", rows_in=len(in_rows),
                               rows_out=len(in_rows), duration_ms=round(dur, 1))
                    produced.add(nid)
                    ok_count += 1
                    continue
                elif ntype == "llm":
                    subtasks, out_rows = _run_llm_stub(data, in_rows)
                elif ntype == "output":
                    subtasks, out_rows = _run_output_stub(data, in_rows)
                else:
                    subtasks, out_rows = [], in_rows

                await _write_table(conn, schema, f"node_{nid}", out_rows)
                produced.add(nid)
                ok_count += 1
                dur = (datetime.utcnow() - t0).total_seconds() * 1000
                await _log(conn, run_id, node, task=f"Run {label}",
                           subtasks=subtasks, status="success",
                           rows_in=len(in_rows), rows_out=len(out_rows),
                           duration_ms=round(dur, 1))
            except Exception as exc:  # noqa: BLE001
                failed.add(nid)
                dur = (datetime.utcnow() - t0).total_seconds() * 1000
                await _log(conn, run_id, node, task=f"Run {label}",
                           subtasks=subtasks + [{"label": "error", "status": "error"}],
                           status="error", rows_in=len(in_rows),
                           duration_ms=round(dur, 1), message=str(exc))

    status = "error" if failed else "success"
    await db.pool().execute(
        "UPDATE app.pipeline_runs SET status=$1, finished_at=now(), stats=$2 "
        "WHERE id=$3", status,
        json.dumps({"nodes": len(nodes), "ok": ok_count, "failed": len(failed)}),
        run_id)
    return run_id


async def _run_datasource(pipeline_id: int, node: dict):
    data = node.get("data") or {}
    kind = data.get("kind") or "csv"
    subtasks = [{"label": f"connect ({kind})", "status": "success"}]
    if kind == "csv":
        rows = await _rows_from_csv_source(pipeline_id, node["id"])
    elif kind == "public":
        rows = await _rows_from_public(data)
    elif kind == "api":
        rows = await _rows_from_api(data)
    elif kind == "postgres":
        rows = await _rows_from_postgres(data)
    elif kind == "ws":
        raise ValueError("WebSocket sources are coming soon.")
    else:
        raise ValueError(f"Unknown datasource kind: {kind!r}")
    subtasks.append({"label": f"fetched {len(rows)} rows", "status": "success"})
    return subtasks, rows


async def _run_function(data: dict, in_rows: list[dict]):
    code = data.get("code") or "def transform(df):\n    return df"
    subtasks = [{"label": "start sandbox", "status": "success"}]
    res = await func_runner.run_function(code, in_rows)
    if not res["ok"]:
        raise ValueError(res.get("error") or "Function failed.")
    subtasks.append({"label": f"returned {len(res['rows'])} rows", "status": "success"})
    return subtasks, res["rows"]


async def _run_gate(conn, schema: str, nid: str, node: dict,
                    edges: list[dict], in_rows: list[dict]) -> None:
    """Route rows to a per-target output table based on each branch predicate."""
    conds = {c["target"]: c.get("expr", "")
             for c in (node.get("data") or {}).get("conditions") or []}
    out_edges = [e for e in edges if e["source"] == nid]
    for e in out_edges:
        expr = conds.get(e["target"], "")
        matched = [r for r in in_rows if _eval_predicate(expr, r)]
        await _write_table(conn, schema, _out_table(nid, e["target"], True), matched)


def _run_llm_stub(data: dict, in_rows: list[dict]):
    model = data.get("model") or "(unset)"
    subtasks = [
        {"label": f"model: {model}", "status": "success"},
        {"label": "reasoning execution — coming soon", "status": "skipped"},
    ]
    # pass rows through unchanged so downstream nodes still receive data
    return subtasks, in_rows


def _run_output_stub(data: dict, in_rows: list[dict]):
    kind = data.get("kind") or "api"
    subtasks = [
        {"label": f"target: {kind}", "status": "success"},
        {"label": f"{kind} delivery — coming soon", "status": "skipped"},
    ]
    return subtasks, in_rows


# --------------------------------------------------------------------------
# Node output preview (for the Config panel)
# --------------------------------------------------------------------------

async def node_preview(pipeline_id: int, node_id: str, limit: int = 100) -> dict:
    schema = schema_for(pipeline_id)
    rows = await _read_table(schema, f"node_{node_id}")
    columns = list(rows[0].keys()) if rows else []
    return {"ok": True, "columns": columns,
            "rows": rows[:limit], "row_count": len(rows)}


# --------------------------------------------------------------------------
# LLM: generate a system prompt from the user's intent
# --------------------------------------------------------------------------

async def gen_system_prompt(intent: str, sample_columns: list[str]) -> str:
    cols = ", ".join(sample_columns[:30]) or "(unknown)"
    messages = [
        {"role": "system", "content":
         "You write concise, effective system prompts for an LLM node inside a "
         "data pipeline. Output ONLY the system prompt text, no preamble."},
        {"role": "user", "content":
         f"The data has these columns: {cols}.\n"
         f"The user wants this node to: {intent}\n"
         "Write a system prompt instructing the model how to process each row."},
    ]
    try:
        return (await ai._chat(messages, max_tokens=300)).strip()
    except Exception:
        return (f"You are a data-processing assistant. For each record "
                f"(columns: {cols}), {intent}. Respond concisely with only the "
                f"requested result.")
