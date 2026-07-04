"""Unit tests for the traffic simulation engine (no DB, no HTTP).

Run directly::

    cd backend
    ./.venv/bin/python -m tests.test_simulate
"""
from __future__ import annotations

import asyncio

from app import pipelines, simulate

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
    # fail pytest too — these test_* functions are collected directly
    assert cond, f"{label}  {extra}"


def test_deterministic_with_seed() -> None:
    cfg = {"preset": "orders", "rows": 50, "seed": 42}
    a, b = simulate.generate(cfg), simulate.generate(cfg)
    check(a == b, "sim: same seed -> identical rows")
    c = simulate.generate({**cfg, "seed": 43})
    check(a != c, "sim: different seed -> different rows")


def test_presets_generate_clean_rows() -> None:
    for key in simulate.PRESETS:
        rows = simulate.generate({"preset": key, "rows": 20, "seed": 1})
        check(len(rows) == 20, f"sim[{key}]: exact row count")
        fields = [f["name"] for f in simulate.PRESETS[key]["fields"]]
        check(all(list(r.keys()) == fields for r in rows),
              f"sim[{key}]: rows carry all preset fields")
        check(all(v is not None for r in rows for v in r.values()),
              f"sim[{key}]: no faults when rates are 0")


def test_custom_fields() -> None:
    rows = simulate.generate({
        "rows": 10, "seed": 7,
        "fields": [
            {"name": "id", "gen": "seq", "start": 100},
            {"name": "city", "gen": "choice", "choices": ["NY", "SF"]},
            {"name": "temp", "gen": "float", "min": -5, "max": 40, "round": 1},
            {"name": "tag", "gen": "const", "value": "x"},
        ],
    })
    check([r["id"] for r in rows] == list(range(100, 110)),
          "sim: seq starts at configured value")
    check(all(r["city"] in ("NY", "SF") for r in rows),
          "sim: choice respects choices")
    check(all(-5 <= r["temp"] <= 40 for r in rows), "sim: float respects range")
    check(all(r["tag"] == "x" for r in rows), "sim: const value")


def test_fault_injection() -> None:
    base = {"preset": "orders", "rows": 1000, "seed": 5}

    nulls = simulate.generate({**base, "null_rate": 0.2})
    null_count = sum(1 for r in nulls for v in r.values() if v is None)
    check(0 < null_count, "sim: null_rate injects nulls")
    check(all(r["order_id"] is not None for r in nulls),
          "sim: key field never nulled")

    dups = simulate.generate({**base, "dup_rate": 0.2})
    keys = [r["order_id"] for r in dups]
    check(len(dups) > 1000 and len(set(keys)) < len(keys),
          "sim: dup_rate emits duplicate rows", f"{len(dups)} rows")

    bad = simulate.generate({**base, "error_rate": 0.2})
    corrupt = sum(1 for r in bad if isinstance(r["amount"], str))
    check(corrupt > 0, "sim: error_rate corrupts typed values")

    clamped = simulate.generate({**base, "rows": 10, "null_rate": 5})
    check(all(v is None for r in clamped
              for k, v in r.items() if k != "order_id"),
          "sim: rates clamp to 1.0")


def test_validation() -> None:
    try:
        simulate.generate({"preset": "nope"})
        check(False, "sim: unknown preset raises")
    except ValueError:
        check(True, "sim: unknown preset raises")
    try:
        simulate.generate({"fields": [{"gen": "int"}]})
        check(False, "sim: field without name raises")
    except ValueError:
        check(True, "sim: field without name raises")
    rows = simulate.generate({"preset": "users", "rows": 10 ** 9, "seed": 1})
    check(len(rows) == simulate.MAX_ROWS, "sim: row count capped")


def test_datasource_integration() -> None:
    """The sim kind runs through the pipeline datasource dispatcher."""
    node = {"id": "sim1", "type": "datasource",
            "data": {"kind": "sim", "preset": "sensors", "rows": 15,
                     "seed": 3, "error_rate": 0.1}}
    subtasks, rows = asyncio.run(pipelines._run_datasource(0, node))
    check(len(rows) == 15, "engine: sim datasource returns rows")
    check(any("simulated traffic" in s["label"] for s in subtasks),
          "engine: subtask describes the simulation")
    check(simulate.preset_listing() and all(
        {"key", "label", "fields"} <= set(p) for p in simulate.preset_listing()),
        "engine: preset listing shape")


def main() -> int:
    print("== traffic simulation unit tests ==")
    for fn in (test_deterministic_with_seed, test_presets_generate_clean_rows,
               test_custom_fields, test_fault_injection, test_validation,
               test_datasource_integration):
        print(f"\n-- {fn.__name__}")
        fn()
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
