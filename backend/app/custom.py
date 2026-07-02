"""Custom Tracks: user-imported datasets + AI interactive learning.

Flow:
  1. User uploads CSV(s). We infer column types and persist the raw data in
     ``app.custom_tables`` (personal storage).
  2. When the user opens a track we *provision* a dedicated ``custom_<id>``
     schema (CREATE TABLE + COPY). On "stop" we DROP it — the dataset DB is
     only live while the user is working on it.
  3. We generate questions from the actual schema (AI when available, with a
     deterministic template generator as the always-on backbone), each carrying
     a server-side reference SQL used to grade the learner's query.
"""
from __future__ import annotations

import csv
import io
import random
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from . import db, sandbox

MAX_ROWS = 150_000
SAMPLE = 500

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_INT_RE = re.compile(r"^-?\d+$")


def schema_for(track_id: int) -> str:
    return f"custom_{track_id}"


# --------------------------------------------------------------------------
# CSV parsing + type inference
# --------------------------------------------------------------------------

def _sanitize(name: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9_]", "_", name.strip().lower())
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        s = fallback
    if s[0].isdigit():
        s = "c_" + s
    return s[:60]


def _looks_int(v: str) -> bool:
    if not _INT_RE.match(v):
        return False
    try:
        return -(2**63) <= int(v) < 2**63
    except ValueError:
        return False


def _looks_float(v: str) -> bool:
    try:
        float(v)
        return True
    except ValueError:
        return False


def _looks_ts(v: str) -> bool:
    try:
        datetime.fromisoformat(v.replace(" ", "T").rstrip("Z"))
        return True
    except ValueError:
        return False


def _infer_type(values: list[str]) -> str:
    vals = [v for v in values if v != ""]
    if not vals:
        return "TEXT"
    sample = vals[:SAMPLE]
    if all(_looks_int(v) for v in sample):
        return "BIGINT"
    if all(_looks_float(v) for v in sample):
        return "NUMERIC"
    low = {v.strip().lower() for v in sample}
    if low <= {"true", "false", "t", "f", "yes", "no", "y", "n"}:
        return "BOOLEAN"
    if all(_DATE_RE.match(v) for v in sample):
        return "DATE"
    if all(_looks_ts(v) for v in sample):
        return "TIMESTAMP"
    return "TEXT"


def parse_csv(filename: str, text: str) -> dict[str, Any]:
    """Parse CSV text into a table definition + retained raw text."""
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if any(c.strip() for c in r)]
    if len(rows) < 1:
        raise ValueError(f"{filename}: empty file")
    header, *data = rows
    data = data[:MAX_ROWS]

    seen: set[str] = set()
    col_names: list[str] = []
    for i, h in enumerate(header):
        name = _sanitize(h, f"col_{i + 1}")
        base, n = name, 1
        while name in seen:
            n += 1
            name = f"{base}_{n}"
        seen.add(name)
        col_names.append(name)

    table_name = _sanitize(filename.rsplit(".", 1)[0], "table")

    columns = []
    for idx, name in enumerate(col_names):
        col_vals = [r[idx] if idx < len(r) else "" for r in data]
        ctype = _infer_type(col_vals)
        uniq = _all_unique(col_vals)
        # Primary key: a unique column that is either literally `id`, or a
        # natural key whose prefix matches the table name (e.g. order_id in an
        # orders table — the Olist convention).
        prefix = name[:-3] if name.endswith("_id") else ""
        is_pk = uniq and (
            name == "id" or (bool(prefix) and prefix in table_name)
        )
        columns.append({"name": name, "type": ctype, "pk": is_pk, "unique": uniq})

    # store a trimmed CSV (header + capped rows) so storage stays bounded even
    # for very large source files
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(col_names)
    w.writerows(data)

    return {
        "table_name": table_name,
        "columns": columns,
        "row_count": len(data),
        "csv_text": buf.getvalue(),
    }


def _all_unique(vals: list[str]) -> bool:
    seen = set()
    for v in vals:
        if v == "" or v in seen:
            return False
        seen.add(v)
    return True


def _convert(ctype: str, raw: str):
    if raw is None or raw == "":
        return None
    try:
        if ctype == "BIGINT":
            return int(raw)
        if ctype == "NUMERIC":
            return Decimal(raw)
        if ctype == "BOOLEAN":
            return raw.strip().lower() in ("true", "t", "yes", "y", "1")
        if ctype == "DATE":
            return date.fromisoformat(raw)
        if ctype == "TIMESTAMP":
            return datetime.fromisoformat(raw.replace(" ", "T").rstrip("Z"))
    except (ValueError, InvalidOperation):
        return None
    return str(raw)


# --------------------------------------------------------------------------
# Provisioning (spin up / tear down the dataset schema on demand)
# --------------------------------------------------------------------------

async def provision(track_id: int) -> None:
    schema = schema_for(track_id)
    tables = await db.pool().fetch(
        "SELECT table_name, columns, csv_text FROM app.custom_tables WHERE track_id=$1",
        track_id)
    async with db.pool().acquire() as conn:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        try:
            async with conn.transaction():
                await conn.execute(f'CREATE SCHEMA "{schema}"')
                for t in tables:
                    cols = t["columns"]
                    coldefs = ", ".join(
                        f'"{c["name"]}" {c["type"]}' + (" PRIMARY KEY" if c["pk"] else "")
                        for c in cols)
                    await conn.execute(
                        f'CREATE TABLE "{schema}"."{t["table_name"]}" ({coldefs})')

                    reader = csv.reader(io.StringIO(t["csv_text"]))
                    all_rows = [r for r in reader if any(c.strip() for c in r)]
                    data = all_rows[1:][:MAX_ROWS]
                    recs = []
                    for r in data:
                        rec = tuple(
                            _convert(cols[i]["type"], r[i] if i < len(r) else "")
                            for i in range(len(cols)))
                        recs.append(rec)
                    if recs:
                        await conn.copy_records_to_table(
                            t["table_name"], records=recs,
                            columns=[c["name"] for c in cols], schema_name=schema)
                # ANALYZE targets tables, not schemas — analyze each table we
                # just created (ANALYZE "custom_N" would look for a *relation*
                # named custom_N and fail with "relation does not exist").
                for t in tables:
                    await conn.execute(
                        f'ANALYZE "{schema}"."{t["table_name"]}"')
        except Exception:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            raise


async def teardown(track_id: int) -> None:
    await sandbox.drop_schema(schema_for(track_id))


# --------------------------------------------------------------------------
# Schema introspection (for the whiteboard) + relation inference
# --------------------------------------------------------------------------

def _singular(name: str) -> str:
    if name.endswith("ies"):
        return name[:-3] + "y"
    if name.endswith("s") and not name.endswith("ss"):
        return name[:-1]
    return name


async def schema_graph(track_id: int) -> dict[str, Any]:
    rows = await db.pool().fetch(
        "SELECT table_name, columns, row_count FROM app.custom_tables "
        "WHERE track_id=$1 ORDER BY table_name", track_id)
    tables = [
        {"name": r["table_name"], "columns": r["columns"], "row_count": r["row_count"]}
        for r in rows
    ]
    tmap = {t["name"]: t for t in tables}
    names = set(tmap)
    # build lookup of singular/plural -> table name (for the `x_id -> x.id` style)
    alias = {}
    for n in names:
        alias[n] = n
        alias[_singular(n)] = n
        alias[n + "s"] = n
        alias[_singular(n) + "s"] = n

    # which tables contain each column name
    colmap: dict[str, list[str]] = {}
    for t in tables:
        for c in t["columns"]:
            colmap.setdefault(c["name"], []).append(t["name"])

    def _flag(table: str, col: str, key: str) -> bool:
        return any(cc["name"] == col and cc.get(key) for cc in tmap[table]["columns"])

    relations = []
    seen: set[tuple] = set()

    def add(ft, fc, tt, tc):
        k = (ft, fc, tt)
        if ft != tt and tt in tmap and k not in seen:
            seen.add(k)
            relations.append({"from_table": ft, "from_col": fc,
                              "to_table": tt, "to_col": tc})

    for t in tables:
        for c in t["columns"]:
            col = c["name"]
            # Heuristic A: `x_id` referencing a table named x/xs that has an `id`.
            if col.endswith("_id") and col != "id":
                base = col[:-3]
                target = alias.get(base) or alias.get(base + "s")
                if target and any(cc["name"] == "id" for cc in tmap[target]["columns"]):
                    add(t["name"], col, target, "id")
                    continue
            # Heuristic B: shared natural key — the owner is the table where the
            # column is the primary key (preferred) or otherwise unique.
            if col.endswith("_id") or col.endswith("_name"):
                holders = [h for h in colmap.get(col, []) if h != t["name"]]
                owner = next((h for h in holders if _flag(h, col, "pk")), None) \
                    or next((h for h in holders if _flag(h, col, "unique")), None)
                if owner and not _flag(t["name"], col, "pk"):
                    add(t["name"], col, owner, col)
    return {"tables": tables, "relations": relations}


# --------------------------------------------------------------------------
# Question generation (template backbone)
# --------------------------------------------------------------------------

def _cols_by_kind(table: dict) -> dict[str, list[str]]:
    cols = table["columns"]
    nums = [c["name"] for c in cols if c["type"] in ("BIGINT", "NUMERIC")]
    # "measures" are numeric columns that are meaningful to aggregate/filter —
    # exclude surrogate keys (the pk and any *_id foreign keys).
    measures = [
        n for n in nums
        if not n.endswith("_id") and not any(c["name"] == n and c["pk"] for c in cols)
    ]
    return {
        "num": nums,
        "measure": measures,  # real measures only (may be empty for key-only tables)
        "text": [c["name"] for c in cols if c["type"] == "TEXT"],
        "time": [c["name"] for c in cols if c["type"] in ("DATE", "TIMESTAMP")],
        "pk": next((c["name"] for c in cols if c["pk"]), None),
        "all": [c["name"] for c in cols],
    }


def _cols(*names: str | None) -> str:
    """Join column names, dropping blanks and duplicates, preserving order."""
    out: list[str] = []
    for n in names:
        if n and n not in out:
            out.append(n)
    return ", ".join(out)


async def _scalar(schema: str, sql: str):
    res = await sandbox.run_in_schema(schema, sql)
    if res["ok"] and res["rows"]:
        return list(res["rows"][0].values())[0]
    return None


async def _build_candidates(schema: str, graph: dict, level: int, rng: random.Random):
    """Yield (prompt, reference_sql, skills) candidates suited to `level`."""
    tables = [t for t in graph["tables"] if t["row_count"] > 0] or graph["tables"]
    rels = graph["relations"]
    out: list[tuple[str, str, list[str]]] = []

    def order_clause(kind: dict) -> str:
        return kind["pk"] or kind["all"][0]

    # ---- Level 1: single-table basics ----
    for t in tables:
        k = _cols_by_kind(t)
        out.append((
            f"How many rows are in the **{t['name']}** table?",
            f"SELECT count(*) AS row_count FROM {t['name']}",
            ["SELECT"], 1))
        oc = order_clause(k)
        out.append((
            f"Return the first 10 rows of **{t['name']}**, ordered by `{oc}` ascending.",
            f"SELECT * FROM {t['name']} ORDER BY {oc} LIMIT 10",
            ["SELECT"], 1))
        for tc in k["text"][:2]:
            out.append((
                f"List the distinct values of `{tc}` in **{t['name']}**, alphabetically.",
                f"SELECT DISTINCT {tc} FROM {t['name']} ORDER BY {tc}",
                ["SELECT"], 1))

    # ---- Level 2: filters / top-N (use real measures, not surrogate keys) ----
    for t in tables:
        k = _cols_by_kind(t)
        label = k["text"][0] if k["text"] else k["pk"]
        for nc in k["measure"][:2]:
            thr = await _scalar(schema, f"SELECT round(avg({nc}), 2) FROM {t['name']}")
            if thr is not None:
                cols = _cols(label, nc)
                out.append((
                    f"From **{t['name']}**, return `{cols}` for rows where `{nc}` is greater "
                    f"than {thr}, ordered by `{nc}` descending.",
                    f"SELECT {cols} FROM {t['name']} WHERE {nc} > {thr} ORDER BY {nc} DESC",
                    ["SELECT"], 2))
            cols = _cols(label, nc)
            out.append((
                f"Return the `{cols}` of the **top 5** rows in **{t['name']}** by `{nc}` "
                f"(highest first).",
                f"SELECT {cols} FROM {t['name']} ORDER BY {nc} DESC LIMIT 5",
                ["SELECT"], 2))

    # ---- Level 3: aggregations ----
    for t in tables:
        k = _cols_by_kind(t)
        for cat in k["text"][:2]:
            out.append((
                f"For each `{cat}` in **{t['name']}**, count the number of rows. "
                f"Order by the count, highest first.",
                f"SELECT {cat}, count(*) AS n FROM {t['name']} GROUP BY {cat} "
                f"ORDER BY n DESC",
                ["GROUP BY"], 3))
            for nc in k["measure"][:1]:
                out.append((
                    f"What is the average `{nc}` for each `{cat}` in **{t['name']}**? "
                    f"Round to 2 decimals.",
                    f"SELECT {cat}, round(avg({nc}), 2) AS avg_{nc} FROM {t['name']} "
                    f"GROUP BY {cat}",
                    ["GROUP BY"], 3))

    # ---- Level 4+: joins across relations ----
    tmap = {t["name"]: t for t in graph["tables"]}
    for r in rels:
        parent, child = tmap.get(r["to_table"]), tmap.get(r["from_table"])
        if not parent or not child:
            continue
        pk = _cols_by_kind(parent)
        label = (pk["text"][0] if pk["text"] else pk["pk"] or pk["all"][0])
        out.append((
            f"For each **{parent['name']}** (by `{label}`), count how many "
            f"**{child['name']}** rows reference it (via `{r['from_col']}`). "
            f"Order by the count, highest first.",
            f"SELECT p.{label}, count(*) AS n "
            f"FROM {parent['name']} p JOIN {child['name']} c "
            f"ON c.{r['from_col']} = p.{r['to_col']} "
            f"GROUP BY p.{label} ORDER BY n DESC",
            ["JOINS", "GROUP BY"], 4))
        ck = _cols_by_kind(child)
        for nc in ck["measure"][:1]:
            out.append((
                f"What is the total `{nc}` from **{child['name']}** for each "
                f"**{parent['name']}** (by `{label}`)? Highest total first.",
                f"SELECT p.{label}, sum(c.{nc}) AS total_{nc} "
                f"FROM {parent['name']} p JOIN {child['name']} c "
                f"ON c.{r['from_col']} = p.{r['to_col']} "
                f"GROUP BY p.{label} ORDER BY total_{nc} DESC NULLS LAST",
                ["JOINS", "GROUP BY"], 5))

    # choose candidates for the requested level, with graceful fallback downward
    for lvl in (level, level - 1, level + 1, level - 2, 1):
        pool = [c for c in out if c[3] == lvl]
        if pool:
            rng.shuffle(pool)
            return pool
    rng.shuffle(out)
    return out


async def generate_question(track_id: int, level: int, recent_prompts: list[str]):
    """Return a validated question dict, preferring a fresh template/topic."""
    schema = schema_for(track_id)
    graph = await schema_graph(track_id)
    rng = random.Random()
    candidates = await _build_candidates(schema, graph, level, rng)

    recent = set(recent_prompts[-8:])
    ordered = [c for c in candidates if c[0] not in recent] + \
              [c for c in candidates if c[0] in recent]

    for prompt, ref_sql, skills, lvl in ordered:
        check = await sandbox.run_in_schema(schema, ref_sql)
        if check["ok"]:
            return {
                "prompt": prompt, "reference_sql": ref_sql,
                "skills": skills, "source": "template", "level": lvl,
            }
    return None


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

async def evaluate(track_id: int, reference_sql: str, user_sql: str):
    schema = schema_for(track_id)
    user = await sandbox.run_in_schema(schema, user_sql, max_rows=None)
    if not user["ok"]:
        return {
            "ok": False, "passed": False, "score": 0,
            "error": user["error"],
            "expected_columns": [], "expected_preview": [],
        }
    ref = await sandbox.run_in_schema(schema, reference_sql, max_rows=None)
    exp_ms = sandbox._multiset([dict(r) for r in ref["rows"]])
    got_ms = sandbox._multiset(user["rows"])
    passed = exp_ms == got_ms
    score = 100 if passed else (
        40 if len(exp_ms) == len(got_ms) and exp_ms else 0)
    return {
        "ok": True, "passed": passed, "score": score,
        "expected_rows": len(exp_ms), "got_rows": len(got_ms),
        "result": user,
        "expected_columns": ref["columns"],
        "expected_preview": ref["rows"][:5],
    }
