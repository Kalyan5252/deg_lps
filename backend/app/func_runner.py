"""Run user-authored Python in an isolated subprocess.

Two shapes are supported, both executed in a separate Python process with a
wall-clock timeout and a stripped environment (best-effort no-network):

* **transform** — a *function node*. The user writes a whole ``transform(df)``
  function; ``df`` is a pandas DataFrame of the incoming rows.

* **conditional** — a *gate node* with multiple inputs. The signature is locked
  to ``conditional_function(input_1, …, input_N)`` (one arg per connected input);
  the user writes only the *body*. Each arg is a ``list[dict]`` of rows (so
  ``input_1 + input_2`` concatenates), and the user can ``pd.DataFrame(input_1)``
  for frame ops. This is how a gate combines several inputs (concat/format/join)
  — mixing schemas implicitly is unsafe, so the combine logic is the user's.

Both return a DataFrame or a list[dict], normalised back to rows + columns.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

TIMEOUT_S = 15
MAX_ROWS = 50_000

# One worker program handles both modes. Reads a JSON job on stdin, writes a
# JSON result (after a NUL marker) on stdout. Runs in a pristine interpreter.
_WORKER = r'''
import io, json, sys, contextlib, traceback

job = json.load(sys.stdin)
mode = job.get("mode", "transform")

def _emit(obj):
    sys.stdout.write("\x00RESULT\x00" + json.dumps(obj, default=str))
    sys.stdout.flush()

try:
    import pandas as pd  # type: ignore
    _has_pd = True
except Exception:
    _has_pd = False

def _frame(rows):
    return pd.DataFrame(rows) if _has_pd else rows

def _normalise(out):
    if _has_pd and isinstance(out, pd.DataFrame):
        cols = [str(c) for c in out.columns]
        return json.loads(out.to_json(orient="records", date_format="iso")), cols
    if _has_pd and isinstance(out, pd.Series):
        return [{"value": v} for v in out.tolist()], ["value"]
    if isinstance(out, list):
        rows = [r if isinstance(r, dict) else {"value": r} for r in out]
        return rows, (list(rows[0].keys()) if rows else [])
    if isinstance(out, dict):
        return [out], list(out.keys())
    if out is None:
        return [], []
    return [{"value": out}], ["value"]

buf = io.StringIO()
try:
    ns = {}
    with contextlib.redirect_stdout(buf):
        if mode == "conditional":
            argnames = job["argnames"]
            body = job.get("code") or "return " + (argnames[0] if argnames else "None")
            indented = "\n".join("    " + line for line in body.splitlines())
            src = "def conditional_function(" + ", ".join(argnames) + "):\n" + indented + "\n"
            exec(src, ns)
            fn = ns["conditional_function"]
            inputs = job.get("inputs") or {}
            # each input is a list[dict] so `input_1 + input_2` concatenates rows
            # as users expect; wrap in pd.DataFrame(...) explicitly for frame ops.
            out = fn(*[list(inputs.get(a) or []) for a in argnames])
        else:
            exec(job.get("code") or "", ns)
            fn = ns.get("transform") or ns.get("main") or ns.get("run")
            if not callable(fn):
                raise ValueError(
                    "Define a function named `transform(df)` that returns the rows.")
            out = fn(_frame(job.get("rows") or []))

    rows, columns = _normalise(out)
    _emit({"ok": True, "rows": rows, "columns": columns,
           "stdout": buf.getvalue(), "error": None})
except Exception as exc:  # noqa: BLE001
    _emit({"ok": False, "rows": [], "columns": [],
           "stdout": buf.getvalue(),
           "error": f"{type(exc).__name__}: {exc}",
           "traceback": traceback.format_exc()})
'''


def _minimal_env() -> dict[str, str]:
    keep = ("PATH", "PYTHONPATH", "LANG", "LC_ALL", "SYSTEMROOT", "TMPDIR")
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


async def _run(job: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps(job)
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


async def run_function(code: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Execute a `transform(df)` function against `rows`."""
    return await _run({"mode": "transform", "code": code, "rows": rows[:MAX_ROWS]})


async def run_conditional(
    code: str, inputs: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    """Execute a locked-signature `conditional_function(input_1, …)` body.

    `inputs` maps each arg name to its rows; arg order follows sorted input keys
    (input_1, input_2, …).
    """
    argnames = sorted(inputs.keys(), key=lambda k: (len(k), k))
    capped = {a: (inputs.get(a) or [])[:MAX_ROWS] for a in argnames}
    return await _run({"mode": "conditional", "code": code,
                       "argnames": argnames, "inputs": capped})
