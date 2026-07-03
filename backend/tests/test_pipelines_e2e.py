"""End-to-end (HTTP) test for the Data Engineering DEI pipeline builder.

Drives the running backend over ``/api/...`` with a bearer token — the exact
same calls the frontend makes: create a pipeline, upload a CSV datasource
(multipart), save the graph, run it, poll the run + activity logs, preview node
output, generate an LLM system prompt, and verify the error short-circuit. Then
it deletes the pipeline.

Self-contained and idempotent. Skips cleanly if the backend isn't reachable.

Prereqs: the backend running (uvicorn on :8000) with its DB up.

Run::

    cd backend
    ./.venv/bin/python -m tests.test_pipelines_e2e
    API_BASE=http://127.0.0.1:8010/api ./.venv/bin/python -m tests.test_pipelines_e2e
"""
from __future__ import annotations

import os
import time

import httpx

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")
EMAIL = os.environ.get("ITEST_EMAIL", "pipe-e2e@example.com")

ORDERS_CSV = (
    "order_id,customer_id,amount\n"
    "1,10,50\n2,10,150\n3,20,250\n4,30,80\n5,30,300\n"
)

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


def _graph(fn_code: str) -> dict:
    return {
        "nodes": [
            {"id": "ds", "type": "datasource", "position": {"x": 0, "y": 0},
             "data": {"kind": "csv", "table_name": "orders", "label": "Orders"}},
            {"id": "fn", "type": "function", "position": {"x": 1, "y": 0},
             "data": {"label": "Cast", "code": fn_code}},
            {"id": "gate", "type": "gate", "position": {"x": 2, "y": 0},
             "data": {"conditions": [
                 {"target": "big", "expr": "amount > 100"},
                 {"target": "small", "expr": "amount <= 100"}]}},
            {"id": "big", "type": "output", "position": {"x": 3, "y": -1},
             "data": {"kind": "api"}},
            {"id": "small", "type": "output", "position": {"x": 3, "y": 1},
             "data": {"kind": "sheets"}},
        ],
        "edges": [
            {"id": "e1", "source": "ds", "target": "fn"},
            {"id": "e2", "source": "fn", "target": "gate"},
            {"id": "e3", "source": "gate", "target": "big"},
            {"id": "e4", "source": "gate", "target": "small"},
        ],
    }


GOOD_FN = ("def transform(df):\n"
           "    df = df.copy()\n"
           "    df['amount'] = df['amount'].astype(int)\n"
           "    return df\n")


def main() -> int:
    print(f"== pipeline E2E test @ {API_BASE} ==")
    try:
        client = httpx.Client(base_url=API_BASE, timeout=180.0)
        client.get("/health").raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"SKIP: backend not reachable at {API_BASE} ({exc}).")
        return 0

    # login
    r = client.post("/auth/login", json={"email": EMAIL, "display_name": "e2e"})
    check(r.status_code == 200, "login returns 200", r.text[:200])
    client.headers["Authorization"] = f"Bearer {r.json()['token']}"

    pid = None
    try:
        # 1. create pipeline
        r = client.post("/pipelines", json={"name": f"e2e-{int(time.time())}"})
        check(r.status_code == 200, "create pipeline 200", r.text[:200])
        pid = r.json()["id"]
        check(r.json()["status"] == "idle", "new pipeline is idle")

        # 2. it shows up in the list
        r = client.get("/pipelines")
        check(any(p["id"] == pid for p in r.json()), "pipeline appears in list")

        # 3. upload CSV datasource (multipart, like the UI file input)
        r = client.post(
            f"/pipelines/{pid}/datasources/csv",
            data={"node_id": "ds"},
            files={"file": ("orders.csv", ORDERS_CSV, "text/csv")})
        check(r.status_code == 200, "csv upload 200", r.text[:200])
        check(r.json()["row_count"] == 5, "csv upload reports 5 rows")

        # 4. save the graph
        r = client.put(f"/pipelines/{pid}", json={"graph": _graph(GOOD_FN)})
        check(r.status_code == 200, "save graph 200", r.text[:200])

        # 5. run it
        r = client.post(f"/pipelines/{pid}/run", json={"graph": _graph(GOOD_FN)})
        check(r.status_code == 200 and r.json().get("ok"), "run 200/ok", r.text[:200])
        run_id = r.json()["run_id"]

        # 6. run summary
        r = client.get(f"/pipelines/{pid}/runs")
        run = next((x for x in r.json() if x["id"] == run_id), None)
        check(run and run["status"] == "success", "run status success",
              f"got {run}")
        check(run and run["stats"].get("ok") == 5, "run reports 5 ok nodes")

        # 7. activity logs (the Activity panel feed)
        logs = client.get(f"/pipelines/runs/{run_id}/logs").json()
        by = {l["node_id"]: l for l in logs}
        check(set(by) == {"ds", "fn", "gate", "big", "small"},
              "logs: one entry per node", f"got {set(by)}")
        check(by["ds"]["rows_out"] == 5, "logs: datasource emitted 5 rows")
        check(by["big"]["rows_out"] == 3 and by["small"]["rows_out"] == 2,
              "logs: gate split 3/2 across branches",
              f"big={by['big']['rows_out']} small={by['small']['rows_out']}")
        check(all(s for s in by["ds"]["subtasks"]),
              "logs: subtasks present on nodes")

        # 8. node preview (Config panel "preview output")
        r = client.get(f"/pipelines/{pid}/nodes/big/preview")
        check(r.status_code == 200 and r.json()["row_count"] == 3,
              "preview: big branch has 3 rows", r.text[:200])

        # 9. LLM system-prompt generation (AI or graceful fallback)
        r = client.post(f"/pipelines/{pid}/llm/gen-prompt",
                        json={"intent": "flag high value orders",
                              "columns": ["amount", "customer_id"]})
        check(r.status_code == 200 and bool(r.json().get("prompt")),
              "llm: gen-prompt returns text", r.text[:200])

        # 10. error short-circuit — broken function
        bad = _graph("def transform(df):\n    raise RuntimeError('boom')")
        r = client.post(f"/pipelines/{pid}/run", json={"graph": bad})
        err_run = r.json()["run_id"]
        elogs = {l["node_id"]: l["status"]
                 for l in client.get(f"/pipelines/runs/{err_run}/logs").json()}
        check(elogs.get("fn") == "error", "error: function node errors")
        check(elogs.get("big") == "skipped" and elogs.get("small") == "skipped",
              "error: downstream skipped", f"got {elogs}")

        # 11. stop tears the pipeline back to idle
        r = client.post(f"/pipelines/{pid}/stop")
        check(r.status_code == 200, "stop 200")

        # 12. ownership isolation — another user cannot see this pipeline
        other = httpx.Client(base_url=API_BASE, timeout=30.0)
        tok = other.post("/auth/login",
                         json={"email": "pipe-e2e-other@example.com",
                               "display_name": "other"}).json()["token"]
        other.headers["Authorization"] = f"Bearer {tok}"
        check(other.get(f"/pipelines/{pid}").status_code == 404,
              "isolation: other user gets 404 for this pipeline")
        other.close()

    finally:
        if pid is not None:
            client.request("DELETE", f"/pipelines/{pid}")
            print(f"  (cleaned up pipeline {pid})")

    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_pipelines_e2e_http():
    assert main() == 0, "pipeline E2E HTTP checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
