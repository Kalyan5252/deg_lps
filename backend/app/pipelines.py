"""Data Engineering DEI — pipeline provisioning, ingestion, and DAG execution.

A pipeline is a DAG of typed nodes stored as JSONB on ``app.pipelines``:

    nodes: [{ id, type, data, position }]     type ∈ datasource|function|gate|llm|output
    edges: [{ id, source, target, targetHandle? }]

Running a pipeline provisions a fresh on-demand ``pipe_<id>`` schema, walks the
DAG in topological order, and writes each node's output to a table there. Every
node execution appends a row to ``app.pipeline_logs`` (the Activity feed).
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import time
from decimal import Decimal
from typing import Any

import httpx

from . import (ai, custom, db, events, func_runner, global_datasets, sandbox,
               simulate)

MAX_ROWS = 50_000


def schema_for(pipeline_id: int) -> str:
    return f"pipe_{pipeline_id}"


def _out_table(source_id: str, target_id: str, is_gate: bool) -> str:
    """Table holding a source node's output for a given target. Gates fan out —
    each branch gets its own table; everything else shares one output table."""
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

    types = [_pg_type([r.get(orig) for r in rows]) for orig in columns]
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
    return [{names[i]: (r[i] if i < len(r) else None) for i in range(len(names))}
            for r in data]


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
        # common shapes: {data: [...]}, {results: [...]}, {events: [...]} (Coinbase)
        for key in ("data", "results", "items", "records", "rows", "events"):
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


def _dig(obj: Any, path: str) -> Any:
    """Resolve a dotted path (with numeric indices) into a nested structure."""
    cur = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _ws_rows(payload: Any, path: str | None) -> list[dict]:
    return _flatten(_dig(payload, path) if path else payload)


async def _rows_from_ws(data: dict) -> list[dict]:
    """Connect to a WebSocket feed, subscribe, and collect a bounded window.

    The engine is batch, so a live source is a "connector": open the socket,
    send the subscribe payload(s), collect until ``max_messages``/``max_seconds``,
    then hand those rows to the pipeline.
    """
    import time

    import websockets  # lazy import

    url = (data.get("ws_url") or "").strip()
    if not url:
        raise ValueError("WebSocket source needs a ws_url.")
    subs = data.get("subscribe") or []
    if isinstance(subs, str):
        subs = [ln for ln in subs.splitlines() if ln.strip()]
    max_messages = int(data.get("max_messages") or 20)
    max_seconds = float(data.get("max_seconds") or 10)
    path = (data.get("json_path") or "").strip() or None

    rows: list[dict] = []
    try:
        async with websockets.connect(url, open_timeout=10, max_size=2 ** 22) as ws:
            for s in subs:
                await ws.send(s if isinstance(s, str) else json.dumps(s))
            deadline = time.monotonic() + max_seconds
            while len(rows) < max_messages and time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=max(0.1, remaining))
                except asyncio.TimeoutError:
                    break
                try:
                    payload = json.loads(msg)
                except (json.JSONDecodeError, TypeError):
                    payload = {"raw": str(msg)}
                for r in _ws_rows(payload, path):
                    rows.append(r)
                    if len(rows) >= max_messages:
                        break
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"WebSocket error: {exc}")
    return rows[:max_messages]


def _fields_dict(data: dict) -> dict:
    return {f.get("key"): f.get("value")
            for f in (data.get("body_fields") or []) if f.get("key")}


async def _rows_from_api(data: dict) -> list[dict]:
    """Fetch from an HTTP API. Supports Postman-style body types on non-GET
    requests: json, raw, xml, urlencoded (x-www-form-urlencoded), formdata."""
    url = (data.get("url") or "").strip()
    if not url:
        raise ValueError("API datasource needs a URL.")
    method = (data.get("method") or "GET").upper()
    headers = dict(data.get("headers") or {})
    kwargs: dict[str, Any] = {}

    if method != "GET":
        body_type = (data.get("body_type") or "none").lower()
        if body_type == "json":
            body = data.get("body")
            if isinstance(body, str) and body.strip():
                try:
                    body = json.loads(body)
                except json.JSONDecodeError:
                    pass
            if body not in (None, "", {}, []):
                kwargs["json"] = body
        elif body_type in ("raw", "xml"):
            kwargs["content"] = (data.get("raw_body") or "").encode()
            headers.setdefault(
                "Content-Type",
                "application/xml" if body_type == "xml"
                else (data.get("raw_content_type") or "text/plain"))
        elif body_type == "urlencoded":
            kwargs["data"] = _fields_dict(data)
        elif body_type == "formdata":
            kwargs["files"] = {k: (None, str(v))
                               for k, v in _fields_dict(data).items()}

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(method, url, headers=headers, **kwargs)
        resp.raise_for_status()
        try:
            payload = resp.json()
        except Exception:  # noqa: BLE001
            payload = {"raw": resp.text}
    return _flatten(payload)[:MAX_ROWS]


def _kafka_common(data: dict) -> tuple[str, dict]:
    """Shared connection kwargs for Kafka source/sink nodes."""
    servers = (data.get("bootstrap_servers") or "").strip()
    if not servers:
        raise ValueError("Kafka node needs bootstrap_servers (host:port[,host:port]).")
    kwargs: dict[str, Any] = {"bootstrap_servers": servers,
                              "request_timeout_ms": 15000}
    protocol = (data.get("security_protocol") or "").strip().upper()
    if protocol:
        kwargs["security_protocol"] = protocol
    username = (data.get("sasl_username") or "").strip()
    if username:
        kwargs.setdefault("security_protocol", "SASL_SSL")
        kwargs["sasl_mechanism"] = (data.get("sasl_mechanism")
                                    or "PLAIN").strip().upper()
        kwargs["sasl_plain_username"] = username
        kwargs["sasl_plain_password"] = data.get("sasl_password") or ""
    return servers, kwargs


async def _rows_from_kafka(data: dict) -> list[dict]:
    """Consume a bounded window from a Kafka topic (batch 'connector', like WS).

    Reads until ``max_messages`` or ``max_seconds``, then hands the rows to the
    pipeline. JSON payloads become columns (plus _topic/_partition/_offset
    metadata); non-JSON payloads land in a ``raw`` column.
    """
    import time as _time

    from aiokafka import AIOKafkaConsumer  # lazy: only for Kafka sources

    _, kwargs = _kafka_common(data)
    topic = (data.get("topic") or "").strip()
    if not topic:
        raise ValueError("Kafka source needs a topic.")
    max_messages = int(data.get("max_messages") or 100)
    max_seconds = float(data.get("max_seconds") or 10)
    group = (data.get("group_id") or "").strip() or None

    consumer = AIOKafkaConsumer(
        topic,
        group_id=group,
        auto_offset_reset=(data.get("offset_reset") or "earliest"),
        enable_auto_commit=bool(group),
        **kwargs,
    )
    rows: list[dict] = []
    try:
        await asyncio.wait_for(consumer.start(), timeout=15)
        deadline = _time.monotonic() + max_seconds
        while len(rows) < max_messages and _time.monotonic() < deadline:
            remaining = max(0.05, deadline - _time.monotonic())
            batches = await consumer.getmany(
                timeout_ms=int(remaining * 1000), max_records=max_messages - len(rows))
            for msgs in batches.values():
                for m in msgs:
                    try:
                        payload = json.loads(m.value)
                    except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
                        payload = {"raw": m.value.decode("utf-8", "replace")
                                   if m.value else None}
                    for r in _flatten(payload):
                        rows.append({**r, "_topic": m.topic,
                                     "_partition": m.partition,
                                     "_offset": m.offset})
                        if len(rows) >= max_messages:
                            break
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Kafka error: {exc}")
    finally:
        try:
            await consumer.stop()
        except Exception:  # noqa: BLE001
            pass
    return rows[:max_messages]


async def _deliver_to_kafka(data: dict, rows: list[dict]) -> int:
    """Produce rows as JSON messages to a Kafka topic. Returns messages sent."""
    from aiokafka import AIOKafkaProducer  # lazy: only for Kafka outputs

    _, kwargs = _kafka_common(data)
    topic = (data.get("target") or data.get("topic") or "").strip()
    if not topic:
        raise ValueError("Kafka output needs a topic.")
    key_field = (data.get("key_field") or "").strip() or None
    capped = rows[:10_000]

    producer = AIOKafkaProducer(**kwargs)
    try:
        await asyncio.wait_for(producer.start(), timeout=15)
        for r in capped:
            key = (str(r.get(key_field)).encode()
                   if key_field and r.get(key_field) is not None else None)
            await producer.send(topic, json.dumps(r, default=str).encode(), key=key)
        await producer.flush()
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Kafka error: {exc}")
    finally:
        try:
            await producer.stop()
        except Exception:  # noqa: BLE001
            pass
    return len(capped)


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
        recs = await conn.fetch(
            f"SELECT * FROM ({query.rstrip(';')}) _src LIMIT {MAX_ROWS}")
    finally:
        await conn.close()
    return [{k: sandbox._jsonable(v) for k, v in r.items()} for r in recs]


async def _rows_from_public(data: dict) -> list[dict]:
    key = (data.get("dataset_key") or "").strip()
    table = (data.get("table") or "").strip()
    tables = global_datasets.load_tables(key)
    if not tables:
        raise ValueError(f"Unknown public dataset: {key!r}")
    name, csv_text = next((t for t in tables if t[0] == table), tables[0])
    reader = csv.reader(io.StringIO(csv_text))
    all_rows = [r for r in reader if any(c.strip() for c in r)]
    if not all_rows:
        return []
    header, *rows = all_rows
    return [{header[i]: (r[i] if i < len(r) else None) for i in range(len(header))}
            for r in rows[:MAX_ROWS]]


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
    for i in ids:
        if i not in order:
            order.append(i)
    return order


def _ancestors(node_id: str, edges: list[dict]) -> set[str]:
    parents: dict[str, list[str]] = {}
    for e in edges:
        parents.setdefault(e["target"], []).append(e["source"])
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        for p in parents.get(stack.pop(), []):
            if p not in seen:
                seen.add(p)
                stack.append(p)
    return seen


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


async def _gather_inputs(schema: str, node_map: dict, edges: list[dict], nid: str):
    """Read a node's upstream rows. Returns (all_rows, by_handle) where by_handle
    keys on each incoming edge's targetHandle (input_1, input_2, …)."""
    all_rows: list[dict] = []
    by_handle: dict[str, list[dict]] = {}
    for e in [e for e in edges if e["target"] == nid]:
        src = node_map.get(e["source"], {})
        is_gate = src.get("type") == "gate"
        rows = await _read_table(schema, _out_table(e["source"], nid, is_gate))
        all_rows.extend(rows)
        handle = e.get("targetHandle") or "input_1"
        by_handle.setdefault(handle, []).extend(rows)
    return all_rows, by_handle


async def _execute_node(pipeline_id: int, conn, schema: str, node: dict,
                        edges: list[dict], all_rows: list[dict],
                        by_handle: dict[str, list[dict]],
                        user_id: int | None = None, preview: bool = False):
    """Run a single node into the sandbox schema. Returns (subtasks, out_rows).
    Shared by the full run and by live previews. With ``preview=True`` output
    nodes pass rows through WITHOUT delivering to their external target."""
    nid = node["id"]
    ntype = node.get("type", "?")
    data = node.get("data") or {}
    if ntype == "datasource":
        subtasks, out_rows = await _run_datasource(pipeline_id, node)
    elif ntype == "function":
        subtasks, out_rows = await _run_function(data, all_rows)
    elif ntype == "gate":
        return await _run_gate(conn, schema, nid, node, edges, all_rows, by_handle)
    elif ntype == "llm":
        subtasks, out_rows = await _run_llm(data, all_rows, user_id=user_id)
    elif ntype == "output":
        if preview:
            subtasks, out_rows = (
                [{"label": "preview — delivery skipped", "status": "skipped"}],
                all_rows)
        else:
            subtasks, out_rows = await _run_output(data, all_rows)
    else:
        subtasks, out_rows = [], all_rows
    await _write_table(conn, schema, f"node_{nid}", out_rows)
    return subtasks, out_rows


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
        label = _node_label(node)
        incoming = [e for e in edges if e["target"] == nid]
        upstream_failed = any(e["source"] in failed or e["source"] not in produced
                              for e in incoming) and incoming
        t0 = time.perf_counter()

        async with db.pool().acquire() as conn:
            if upstream_failed:
                await _log(conn, run_id, node, task=f"Skip {label}",
                           subtasks=[{"label": "upstream failed", "status": "skipped"}],
                           status="skipped",
                           message="Skipped because an upstream node failed.")
                failed.add(nid)
                continue

            all_rows, by_handle = await _gather_inputs(schema, node_map, edges, nid)
            subtasks: list[dict] = []
            try:
                subtasks, out_rows = await _execute_node(
                    pipeline_id, conn, schema, node, edges, all_rows, by_handle,
                    user_id=user_id)
                produced.add(nid)
                ok_count += 1
                dur = (time.perf_counter() - t0) * 1000
                await _log(conn, run_id, node, task=f"Run {label}",
                           subtasks=subtasks, status="success",
                           rows_in=len(all_rows), rows_out=len(out_rows),
                           duration_ms=round(dur, 1))
            except Exception as exc:  # noqa: BLE001
                failed.add(nid)
                dur = (time.perf_counter() - t0) * 1000
                await _log(conn, run_id, node, task=f"Run {label}",
                           subtasks=subtasks + [{"label": "error", "status": "error"}],
                           status="error", rows_in=len(all_rows),
                           duration_ms=round(dur, 1), message=str(exc))

    status = "error" if failed else "success"
    await db.pool().execute(
        "UPDATE app.pipeline_runs SET status=$1, finished_at=now(), stats=$2 "
        "WHERE id=$3", status,
        json.dumps({"nodes": len(nodes), "ok": ok_count, "failed": len(failed)}),
        run_id)
    await events.emit("pipeline.run_finished",
                      {"pipeline_id": pipeline_id, "run_id": run_id,
                       "status": status, "nodes": len(nodes),
                       "failed": len(failed)}, user_id=user_id)
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
        rows = await _rows_from_ws(data)
    elif kind == "kafka":
        rows = await _rows_from_kafka(data)
    elif kind == "sim":
        rows = simulate.generate(data)
        faults = ", ".join(
            f"{k.split('_')[0]}s {float(data.get(k)) * 100:.0f}%"
            for k in ("null_rate", "dup_rate", "error_rate") if data.get(k))
        subtasks.append({
            "label": f"simulated traffic ({data.get('preset') or 'custom'}"
                     + (f" · {faults}" if faults else "") + ")",
            "status": "success"})
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


async def _run_gate(conn, schema: str, nid: str, node: dict, edges: list[dict],
                    all_rows: list[dict], by_handle: dict[str, list[dict]]):
    """Combine the gate's inputs (via an optional/required conditional_function),
    write the combined result to ``node_<gate>`` (for preview), then route rows to
    each outgoing branch's table by its predicate. Returns (subtasks, rows)."""
    data = node.get("data") or {}
    n_inputs = int(data.get("inputs") or 1)
    code = (data.get("code") or "").strip()
    subtasks: list[dict] = []

    # gather named inputs; fall back to concatenated rows on input_1 if the edges
    # carry no handle ids (older graphs)
    inputs = {f"input_{i}": list(by_handle.get(f"input_{i}", []))
              for i in range(1, n_inputs + 1)}
    if not any(inputs.values()) and all_rows:
        inputs["input_1"] = all_rows

    if n_inputs >= 2:
        if not code:
            raise ValueError(
                "A gate with multiple inputs requires a conditional_function "
                "to combine them.")
        res = await func_runner.run_conditional(code, inputs)
        if not res["ok"]:
            raise ValueError(res.get("error") or "conditional_function failed.")
        combined = res["rows"]
        subtasks.append({"label": f"combined {n_inputs} inputs → {len(combined)} rows",
                         "status": "success"})
    else:
        base = inputs.get("input_1") or all_rows
        if code:
            res = await func_runner.run_conditional(code, {"input_1": base})
            if not res["ok"]:
                raise ValueError(res.get("error") or "conditional_function failed.")
            combined = res["rows"]
            subtasks.append({"label": "applied conditional_function",
                             "status": "success"})
        else:
            combined = base

    # combined result (feeds preview + is the source for routing)
    await _write_table(conn, schema, f"node_{nid}", combined)

    conds = {c["target"]: c.get("expr", "") for c in data.get("conditions") or []}
    out_edges = [e for e in edges if e["source"] == nid]
    for e in out_edges:
        matched = [r for r in combined if _eval_predicate(conds.get(e["target"], ""), r)]
        await _write_table(conn, schema, _out_table(nid, e["target"], True), matched)
    subtasks.append({"label": f"routed {len(combined)} rows → "
                              f"{len(out_edges)} branch(es)", "status": "success"})
    return subtasks, combined


# --------------------------------------------------------------------------
# LLM node — reason over data with an OpenAI-compatible model
# --------------------------------------------------------------------------

async def _llm_complete(messages: list[dict], *, model: str, api_key: str,
                        base_url: str, max_tokens: int = 300,
                        user_id: int | None = None) -> str:
    """Call an OpenAI-compatible endpoint using the node's own model/key/base
    URL when provided; otherwise fall back to the platform's configured provider."""
    if not (model and base_url):
        return await ai._chat(messages, max_tokens=max_tokens, user_id=user_id)
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"model": model, "messages": messages,
               "max_tokens": max_tokens, "temperature": 0.3}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


async def _run_llm(data: dict, in_rows: list[dict], user_id: int | None = None):
    model = (data.get("model") or "").strip()
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    system_prompt = (data.get("system_prompt")
                     or "You are a concise data-processing assistant.").strip()
    mode = data.get("mode") or "per_row"
    out_field = (data.get("output_field") or "llm_output").strip()
    cap = int(data.get("max_rows") or 20)
    subtasks = [{"label": f"model: {model or 'platform default'}", "status": "success"}]

    if mode == "aggregate":
        sample = in_rows[:cap]
        user = "Here are the rows as JSON:\n" + json.dumps(sample)[:6000]
        resp = await _llm_complete(
            [{"role": "system", "content": system_prompt},
             {"role": "user", "content": user}],
            model=model, api_key=api_key, base_url=base_url, max_tokens=500,
            user_id=user_id)
        subtasks.append({"label": "aggregate reasoning", "status": "success"})
        return subtasks, [{out_field: resp}]

    # per-row: reason over each of the first `cap` rows, pass the rest through
    used = in_rows[:cap]
    out: list[dict] = []
    errors = 0
    for r in used:
        try:
            resp = await _llm_complete(
                [{"role": "system", "content": system_prompt},
                 {"role": "user", "content": json.dumps(r)[:4000]}],
                model=model, api_key=api_key, base_url=base_url, max_tokens=200,
                user_id=user_id)
        except Exception as exc:  # noqa: BLE001
            resp = f"[llm error: {exc}]"
            errors += 1
        out.append({**r, out_field: resp})
    out.extend(in_rows[cap:])
    if used and errors == len(used):
        raise ValueError("LLM node failed for every row — check the model, "
                         "API key and base URL.")
    subtasks.append({
        "label": f"reasoned over {len(used)} rows"
                 + (f" ({errors} errors)" if errors else ""),
        "status": "error" if errors else "success"})
    return subtasks, out


# --------------------------------------------------------------------------
# Output / Stream node — deliver rows to an external target
# --------------------------------------------------------------------------

async def _run_output(data: dict, in_rows: list[dict]):
    """Deliver rows out, then pass them through unchanged so nodes can chain.

    api/webhook/sheets/alert → HTTP POST JSON to the target URL.
    ws → open a socket to the target and push each row.
    sse → needs a persistent server; recorded as skipped.
    """
    kind = (data.get("kind") or "api").lower()
    target = (data.get("target") or "").strip()
    if kind == "kafka" and not target:
        target = (data.get("topic") or "").strip()
    headers = dict(data.get("headers") or {})
    rows = in_rows[:MAX_ROWS]
    subtasks = [{"label": f"target: {kind}", "status": "success"}]

    if not target and kind in ("api", "webhook", "sheets", "alert", "ws", "kafka"):
        # unconfigured output shouldn't crash a run — pass rows through
        subtasks.append({"label": "no target set — pass-through", "status": "skipped"})
        return subtasks, in_rows

    if kind == "kafka":
        sent = await _deliver_to_kafka(data, rows)
        subtasks.append({"label": f"produced {sent} messages to Kafka",
                         "status": "success"})
    elif kind in ("api", "webhook", "sheets", "alert"):
        if kind == "alert":
            body: Any = {"message": data.get("message")
                         or f"Pipeline alert: {len(rows)} rows", "rows": rows[:50]}
        else:
            body = {"rows": rows}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                target, headers={"Content-Type": "application/json", **headers},
                json=body)
            resp.raise_for_status()
        subtasks.append({"label": f"POST {resp.status_code} · delivered {len(rows)} rows",
                         "status": "success"})
    elif kind == "ws":
        import websockets
        async with websockets.connect(target, open_timeout=10) as ws:
            for r in rows[:1000]:
                await ws.send(json.dumps(r))
        subtasks.append({"label": f"streamed {min(len(rows), 1000)} rows",
                         "status": "success"})
    elif kind == "sse":
        subtasks.append({"label": "SSE needs the live streaming server",
                         "status": "skipped"})
    else:
        subtasks.append({"label": f"{kind} — not implemented", "status": "skipped"})
    return subtasks, in_rows


# --------------------------------------------------------------------------
# Node output preview (for the Config panel)
# --------------------------------------------------------------------------

async def node_preview(pipeline_id: int, node_id: str, limit: int = 100) -> dict:
    schema = schema_for(pipeline_id)
    rows = await _read_table(schema, f"node_{node_id}")
    columns = list(rows[0].keys()) if rows else []
    return {"ok": True, "columns": columns, "rows": rows[:limit],
            "row_count": len(rows), "empty": len(rows) == 0}


async def preview_node(pipeline_id: int, graph: dict, node_id: str,
                       limit: int = 100) -> dict:
    """Live preview: execute the target node and all its ancestors on the CURRENT
    (possibly unsaved) graph, then return the node's output rows. This makes
    previews accurate for every node type instead of reading a stale last run."""
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    node_map = {n["id"]: n for n in nodes}
    if node_id not in node_map:
        return {"ok": True, "columns": [], "rows": [], "row_count": 0, "empty": True}

    needed = _ancestors(node_id, edges) | {node_id}
    sub_nodes = [n for n in nodes if n["id"] in needed]
    sub_edges = [e for e in edges
                 if e["source"] in needed and e["target"] in needed]
    schema = schema_for(pipeline_id)
    await provision(pipeline_id)
    async with db.pool().acquire() as conn:
        for nid in _topo_order(sub_nodes, sub_edges):
            node = node_map[nid]
            all_rows, by_handle = await _gather_inputs(schema, node_map, sub_edges, nid)
            await _execute_node(pipeline_id, conn, schema, node, sub_edges,
                                all_rows, by_handle, preview=True)
    return await node_preview(pipeline_id, node_id, limit)


# --------------------------------------------------------------------------
# LLM: generate a system prompt from the user's intent
# --------------------------------------------------------------------------

async def gen_system_prompt(
    intent: str, sample_columns: list[str], user_id: int | None = None
) -> str:
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
        return (await ai._chat(messages, max_tokens=300, user_id=user_id)).strip()
    except Exception:
        return (f"You are a data-processing assistant. For each record "
                f"(columns: {cols}), {intent}. Respond concisely with only the "
                f"requested result.")
