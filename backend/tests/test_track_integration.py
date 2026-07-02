"""Client-side (HTTP) integration test for custom tracks.

Drives the running backend exactly like the frontend does — over HTTP against
`/api/...`, with a bearer token — instead of poking server internals. It
reproduces and guards the whole "import a dataset → see its data → run queries →
get a question" flow that was failing with "Failed to fetch" / the provisioning
bug (ANALYZE on a schema, custom.py).

It is self-contained: it creates its OWN throwaway track from small inline CSVs,
exercises everything, and deletes it. Nothing depends on pre-existing data.

Prereqs: the backend must be running and the DB tunnel up
    (infra/digitalocean/connect.sh + uvicorn on :8000).

Run:
    cd backend
    ./.venv/bin/python -m tests.test_track_integration
    # against a different host:
    API_BASE=http://127.0.0.1:8000/api ./.venv/bin/python -m tests.test_track_integration
"""
from __future__ import annotations

import os
import sys
import time

import httpx

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api")
EMAIL = os.environ.get("ITEST_EMAIL", "itest@example.com")

# --- tiny fixtures (clean CSVs so type inference is predictable) -------------
CUSTOMERS_CSV = (
    "customer_id,name,city\n"
    "1,Ana,Sao Paulo\n"
    "2,Bruno,Rio\n"
    "3,Carla,Sao Paulo\n"
    "4,Diego,Belo Horizonte\n"
)
ORDERS_CSV = (
    "order_id,customer_id,amount\n"
    "10,1,100\n"
    "11,1,50\n"
    "12,2,200\n"
    "13,3,75\n"
    "14,3,25\n"
)
CUST_ROWS = 4
ORDER_ROWS = 5

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


def main() -> int:
    print(f"== track integration test @ {API_BASE} ==")
    try:
        client = httpx.Client(base_url=API_BASE, timeout=180.0)
        client.get("/health").raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"SKIP: backend not reachable at {API_BASE} ({exc}).")
        print("      Start the tunnel + uvicorn, then re-run.")
        return 0  # skip cleanly rather than fail

    # 1. login (like the frontend: email -> token)
    r = client.post("/auth/login", json={"email": EMAIL, "display_name": "itest"})
    check(r.status_code == 200, "login returns 200", f"got {r.status_code}: {r.text[:200]}")
    token = r.json().get("token", "")
    check(bool(token), "login yields a token")
    client.headers["Authorization"] = f"Bearer {token}"

    track_id = None
    try:
        # 2. create a track by uploading CSVs (multipart, exactly like the UI)
        name = f"itest-{int(time.time())}"
        files = [
            ("files", ("customers.csv", CUSTOMERS_CSV, "text/csv")),
            ("files", ("orders.csv", ORDERS_CSV, "text/csv")),
        ]
        r = client.post("/tracks", data={"name": name, "level": "2"}, files=files)
        check(r.status_code == 200, "create track returns 200", f"got {r.status_code}: {r.text[:200]}")
        if r.status_code != 200:
            return _summary()
        track_id = r.json()["id"]
        check(r.json().get("tables") == 2, "track reports 2 tables")

        # 3. fetch schema (Data/Schema tab) — table names + row counts
        r = client.get(f"/tracks/{track_id}")
        check(r.status_code == 200, "get track returns 200", f"got {r.status_code}: {r.text[:200]}")
        tables = {t["name"]: t for t in r.json()["schema"]["tables"]}
        check(set(tables) == {"customers", "orders"}, "schema lists both tables", f"got {list(tables)}")
        check(tables.get("customers", {}).get("row_count") == CUST_ROWS,
              "customers row_count == 4")
        check(tables.get("orders", {}).get("row_count") == ORDER_ROWS,
              "orders row_count == 5")

        # 4. RETRIEVE TABLE DATA (the "Data" tab preview) via a run — this is the
        #    path that was throwing "Failed to fetch" / provisioning errors.
        run = _run(client, track_id, "SELECT * FROM customers ORDER BY customer_id")
        check(run.get("ok") is True, "preview customers ok", f"err={run.get('error')}")
        check(run.get("row_count") == CUST_ROWS, "preview returns 4 customer rows",
              f"got {run.get('row_count')}")
        check(set(run.get("columns", [])) == {"customer_id", "name", "city"},
              "preview has expected columns", f"got {run.get('columns')}")
        first = (run.get("rows") or [{}])[0]
        check(first.get("name") == "Ana", "first customer row is Ana", f"got {first}")

        run = _run(client, track_id, "SELECT * FROM orders")
        check(run.get("ok") and run.get("row_count") == ORDER_ROWS,
              "preview orders returns 5 rows", f"{run.get('error')} rc={run.get('row_count')}")

        # 5. QUERY TESTS — aggregate + join, verifying actual computed values.
        run = _run(client, track_id,
                   "SELECT count(*) AS n FROM customers WHERE city='Sao Paulo'")
        check(run.get("ok") and run["rows"][0]["n"] == 2,
              "aggregate: 2 customers in Sao Paulo", f"{run.get('error')} {run.get('rows')}")

        run = _run(client, track_id,
                   "SELECT c.name, sum(o.amount) AS total FROM customers c "
                   "JOIN orders o ON o.customer_id=c.customer_id "
                   "GROUP BY c.name ORDER BY total DESC")
        ok = run.get("ok") and run["rows"] and run["rows"][0] == {"name": "Bruno", "total": 200}
        check(bool(ok), "join+group by: top spender is Bruno (200)",
              f"{run.get('error')} {run.get('rows')}")

        # 6. error handling — a bad query returns ok=false with a message, not 500
        run = _run(client, track_id, "SELECT * FROM does_not_exist")
        check(run.get("ok") is False and bool(run.get("error")),
              "bad query returns structured error (not a crash)", f"got {run}")

        # 7. generate a question over the dataset
        r = client.post(f"/tracks/{track_id}/question")
        check(r.status_code == 200, "generate question returns 200",
              f"got {r.status_code}: {r.text[:200]}")
        check(bool(r.json().get("prompt")), "question has a prompt")
    finally:
        if track_id is not None:
            client.request("DELETE", f"/tracks/{track_id}", json={"confirm": True})
            print(f"  (cleaned up track {track_id})")

    return _summary()


def _run(client: httpx.Client, track_id: int, sql: str) -> dict:
    r = client.post(f"/tracks/{track_id}/run", json={"sql": sql})
    if r.status_code != 200:
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    return r.json()


def _summary() -> int:
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


# pytest entry point
def test_track_integration_http():
    rc = main()
    assert rc == 0, "track HTTP integration checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
