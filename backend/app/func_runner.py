"""Run a user-authored Python transform in an isolated subprocess.

Data-engineering "function" nodes let a learner write real Python to validate,
parse, reshape or format rows flowing through the pipeline. We execute that code
in a *separate* Python process with a wall-clock timeout and a stripped
environment (best-effort no-network) so a runaway or misbehaving snippet can't
take down the API worker.

Contract for the user's code: define a ``transform`` function.

    def transform(df):
        # `df` is a pandas DataFrame of the incoming rows (or, if pandas is not
        # installed, a list[dict]). Return a DataFrame or a list[dict].
        return df

The harness feeds the upstream rows in, calls ``transform``, and serialises the
returned rows back out as JSON.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

TIMEOUT_S = 15
MAX_ROWS = 50_000

# The worker program. Reads {"code", "rows"} as JSON on stdin, writes
# {"ok", "rows", "columns", "stdout", "error"} as JSON on stdout. Kept as a
# string so it runs in a pristine interpreter with no app imports.
_WORKER = r'''
import io, json, sys, contextlib

payload = json.load(sys.stdin)
code = payload.get("code") or ""
rows = payload.get("rows") or []

def _emit(obj):
    sys.stdout.write("\x00RESULT\x00" + json.dumps(obj, default=str))
    sys.stdout.flush()

try:
    import pandas as pd  # type: ignore
    _has_pd = True
except Exception:
    _has_pd = False

buf = io.StringIO()
try:
    ns = {}
    with contextlib.redirect_stdout(buf):
        exec(code, ns)
        fn = ns.get("transform") or ns.get("main") or ns.get("run")
        if not callable(fn):
            raise ValueError(
                "Define a function named `transform(df)` that returns the rows.")
        data = pd.DataFrame(rows) if _has_pd else rows
        out = fn(data)

    # normalise the return value to rows + columns
    if _has_pd and isinstance(out, pd.DataFrame):
        columns = [str(c) for c in out.columns]
        out_rows = json.loads(out.to_json(orient="records", date_format="iso"))
    elif _has_pd and isinstance(out, pd.Series):
        columns = ["value"]
        out_rows = [{"value": v} for v in out.tolist()]
    elif isinstance(out, list):
        out_rows = [r if isinstance(r, dict) else {"value": r} for r in out]
        columns = list(out_rows[0].keys()) if out_rows else []
    elif isinstance(out, dict):
        out_rows = [out]
        columns = list(out.keys())
    elif out is None:
        out_rows, columns = [], []
    else:
        out_rows = [{"value": out}]
        columns = ["value"]

    _emit({"ok": True, "rows": out_rows, "columns": columns,
           "stdout": buf.getvalue(), "error": None})
except Exception as exc:  # noqa: BLE001
    import traceback
    _emit({"ok": False, "rows": [], "columns": [],
           "stdout": buf.getvalue(),
           "error": f"{type(exc).__name__}: {exc}",
           "traceback": traceback.format_exc()})
'''


def _minimal_env() -> dict[str, str]:
    # Keep only what the interpreter needs; drop anything that could carry creds
    # or configure network proxies. This is a hardening measure, not a jail.
    keep = ("PATH", "PYTHONPATH", "LANG", "LC_ALL", "SYSTEMROOT", "TMPDIR")
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


async def run_function(code: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Execute `code`'s transform against `rows` in a subprocess."""
    payload = json.dumps({"code": code, "rows": rows[:MAX_ROWS]})
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-I", "-c", _WORKER,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_minimal_env(),
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "rows": [], "columns": [], "stdout": "",
                "error": f"Could not start sandbox: {exc}"}

    try:
        out, err = await asyncio.wait_for(
            proc.communicate(payload.encode()), timeout=TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return {"ok": False, "rows": [], "columns": [], "stdout": "",
                "error": f"Function timed out after {TIMEOUT_S}s."}

    text = out.decode("utf-8", "replace")
    marker = "\x00RESULT\x00"
    if marker in text:
        try:
            return json.loads(text.split(marker, 1)[1])
        except json.JSONDecodeError:
            pass
    stderr = err.decode("utf-8", "replace").strip()
    return {"ok": False, "rows": [], "columns": [], "stdout": text.strip(),
            "error": stderr or "Sandbox produced no result."}
