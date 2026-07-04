"""Traffic simulation for the pipeline builder.

A ``sim`` datasource generates synthetic rows so a pipeline can be exercised
end-to-end without any real upstream system. Three properties make it a test
bench rather than a toy:

* **Deterministic** — the same ``seed`` always produces the same rows, so a
  pipeline test is reproducible.
* **Realistic shapes** — presets model common feeds (orders, users,
  clickstream, payments, IoT sensors) with plausible keys, categories,
  amounts and timestamps; or the user defines their own field specs.
* **Fault injection** — configurable rates of NULLs, duplicate rows, and
  corrupted values let users prove their gates/transforms actually catch the
  bad traffic they claim to.

Config (the datasource node's ``data``):

    {"kind": "sim", "preset": "orders", "rows": 200, "seed": 42,
     "null_rate": 0.05, "dup_rate": 0.02, "error_rate": 0.03}

or with custom fields instead of a preset:

    {"kind": "sim", "rows": 100,
     "fields": [{"name": "id", "gen": "seq"},
                {"name": "city", "gen": "choice", "choices": ["NY", "SF"]},
                {"name": "temp", "gen": "float", "min": -5, "max": 40}]}
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

MAX_ROWS = 50_000

_FIRST = ["Ava", "Ben", "Chloe", "Dev", "Elena", "Farid", "Grace", "Hiro",
          "Isla", "Jonas", "Kira", "Liam", "Mona", "Noah", "Priya", "Ravi",
          "Sara", "Tomas", "Uma", "Wei"]
_LAST = ["Adams", "Baker", "Chen", "Diaz", "Evans", "Fischer", "Gupta",
         "Haas", "Ito", "Jones", "Khan", "Lopez", "Mehta", "Novak",
         "Okafor", "Patel", "Quinn", "Rossi", "Silva", "Tanaka"]

# Corruptions applied by error_rate, keyed by the field's generator family.
_CORRUPT_NUMERIC = ["N/A", "", "error", "-1", "999999999"]
_CORRUPT_TS = ["not-a-date", "0000-00-00", "13/32/2026"]
# NB: no NUL bytes here — Postgres TEXT rejects 0x00 ("invalid byte sequence")
_CORRUPT_TEXT = ["", "???", "�", "NULL", "undefined"]


# --------------------------------------------------------------------------
# Presets — field specs for common traffic shapes
# --------------------------------------------------------------------------

PRESETS: dict[str, dict[str, Any]] = {
    "orders": {
        "label": "E-commerce orders",
        "fields": [
            {"name": "order_id", "gen": "seq"},
            {"name": "customer_id", "gen": "int", "min": 1, "max": 800},
            {"name": "amount", "gen": "float", "min": 5, "max": 900, "round": 2},
            {"name": "currency", "gen": "choice",
             "choices": ["USD", "USD", "USD", "EUR", "GBP", "INR"]},
            {"name": "status", "gen": "choice",
             "choices": ["paid", "paid", "paid", "paid", "refunded", "cancelled"]},
            {"name": "created_at", "gen": "timestamp", "period_s": 30 * 86400},
        ],
    },
    "users": {
        "label": "User signups",
        "fields": [
            {"name": "user_id", "gen": "seq"},
            {"name": "name", "gen": "name"},
            {"name": "email", "gen": "email"},
            {"name": "country", "gen": "choice",
             "choices": ["US", "US", "UK", "DE", "IN", "BR", "JP"]},
            {"name": "marketing_opt_in", "gen": "bool", "p": 0.35},
            {"name": "signed_up_at", "gen": "timestamp", "period_s": 90 * 86400},
        ],
    },
    "clickstream": {
        "label": "Web clickstream",
        "fields": [
            {"name": "event_id", "gen": "uuid"},
            {"name": "session_id", "gen": "int", "min": 1, "max": 300},
            {"name": "user_id", "gen": "int", "min": 1, "max": 900},
            {"name": "event_type", "gen": "choice",
             "choices": ["page_view", "page_view", "page_view", "click",
                         "scroll", "add_to_cart", "checkout"]},
            {"name": "url", "gen": "choice",
             "choices": ["/", "/products", "/products/42", "/cart",
                         "/checkout", "/account", "/search?q=lamp"]},
            {"name": "device", "gen": "choice",
             "choices": ["mobile", "mobile", "desktop", "tablet"]},
            {"name": "ts", "gen": "timestamp", "period_s": 3600},
        ],
    },
    "payments": {
        "label": "Payment transactions",
        "fields": [
            {"name": "txn_id", "gen": "uuid"},
            {"name": "account_id", "gen": "int", "min": 1000, "max": 1400},
            {"name": "amount", "gen": "float", "min": 1, "max": 5000, "round": 2},
            {"name": "method", "gen": "choice",
             "choices": ["card", "card", "card", "ach", "wire", "wallet"]},
            {"name": "merchant", "gen": "choice",
             "choices": ["Acme Corp", "Blue Bottle", "CloudMart", "DataDome",
                         "Eastside Gym", "FreshFoods"]},
            {"name": "fraud_score", "gen": "float", "min": 0, "max": 1, "round": 3},
            {"name": "ts", "gen": "timestamp", "period_s": 7 * 86400},
        ],
    },
    "sensors": {
        "label": "IoT sensor readings",
        "fields": [
            {"name": "reading_id", "gen": "seq"},
            {"name": "device_id", "gen": "choice",
             "choices": [f"sensor-{i:03d}" for i in range(1, 25)]},
            {"name": "temperature_c", "gen": "float", "min": -10, "max": 45,
             "round": 1},
            {"name": "humidity_pct", "gen": "float", "min": 10, "max": 100,
             "round": 1},
            {"name": "battery_pct", "gen": "int", "min": 1, "max": 100},
            {"name": "ts", "gen": "timestamp", "period_s": 86400},
        ],
    },
}


# --------------------------------------------------------------------------
# Field generators
# --------------------------------------------------------------------------

def _gen_value(spec: dict, i: int, rng: random.Random, now: datetime) -> Any:
    gen = (spec.get("gen") or "int").lower()
    if gen == "seq":
        return int(spec.get("start", 1)) + i
    if gen == "uuid":
        return f"{rng.getrandbits(128):032x}"
    if gen == "int":
        return rng.randint(int(spec.get("min", 0)), int(spec.get("max", 100)))
    if gen == "float":
        lo, hi = float(spec.get("min", 0)), float(spec.get("max", 1))
        return round(rng.uniform(lo, hi), int(spec.get("round", 2)))
    if gen == "choice":
        choices = spec.get("choices") or ["a", "b", "c"]
        return rng.choice(choices)
    if gen == "bool":
        return rng.random() < float(spec.get("p", 0.5))
    if gen == "name":
        return f"{rng.choice(_FIRST)} {rng.choice(_LAST)}"
    if gen == "email":
        return (f"{rng.choice(_FIRST)}.{rng.choice(_LAST)}"
                f"{rng.randint(1, 999)}@example.com").lower()
    if gen == "timestamp":
        period = float(spec.get("period_s", 86400))
        return (now - timedelta(seconds=rng.uniform(0, period))).isoformat()
    if gen == "const":
        return spec.get("value")
    # unknown generator -> deterministic text token
    return f"{spec.get('name', 'value')}_{i}"


def _corrupt(spec: dict, rng: random.Random) -> Any:
    gen = (spec.get("gen") or "int").lower()
    if gen in ("int", "float", "seq"):
        return rng.choice(_CORRUPT_NUMERIC)
    if gen == "timestamp":
        return rng.choice(_CORRUPT_TS)
    return rng.choice(_CORRUPT_TEXT)


def _rate(data: dict, key: str) -> float:
    try:
        return max(0.0, min(1.0, float(data.get(key) or 0)))
    except (TypeError, ValueError):
        return 0.0


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def generate(data: dict) -> list[dict]:
    """Generate synthetic rows from a sim-datasource config (see module doc)."""
    preset_key = (data.get("preset") or "").strip()
    fields = data.get("fields")
    if not fields:
        preset = PRESETS.get(preset_key or "orders")
        if not preset:
            raise ValueError(
                f"Unknown sim preset {preset_key!r}. "
                f"Available: {', '.join(sorted(PRESETS))}.")
        fields = preset["fields"]
    if not isinstance(fields, list) or not all(
            isinstance(f, dict) and f.get("name") for f in fields):
        raise ValueError("Sim fields must be a list of {name, gen, ...} specs.")

    try:
        n_rows = int(data.get("rows") or 100)
    except (TypeError, ValueError):
        raise ValueError("Sim rows must be a number.")
    n_rows = max(1, min(MAX_ROWS, n_rows))

    seed = data.get("seed")
    if seed not in (None, ""):
        rng = random.Random(int(seed))
        # a seeded run must be FULLY reproducible, so timestamps anchor to a
        # fixed instant instead of wall-clock now
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    else:
        rng = random.Random()
        now = datetime.now(timezone.utc)

    null_rate = _rate(data, "null_rate")
    dup_rate = _rate(data, "dup_rate")
    error_rate = _rate(data, "error_rate")

    # never null/corrupt the first field — it's the row's key, and losing it
    # would make duplicates undetectable (the main thing dup_rate tests)
    rows: list[dict] = []
    for i in range(n_rows):
        row: dict[str, Any] = {}
        for j, spec in enumerate(fields):
            val = _gen_value(spec, i, rng, now)
            if j > 0 and error_rate and rng.random() < error_rate:
                val = _corrupt(spec, rng)
            elif j > 0 and null_rate and rng.random() < null_rate:
                val = None
            row[spec["name"]] = val
        rows.append(row)
        if dup_rate and rng.random() < dup_rate and len(rows) < MAX_ROWS:
            rows.append(dict(row))
    return rows


def preset_listing() -> list[dict]:
    """Preset metadata for the frontend picker."""
    return [
        {"key": k, "label": v["label"],
         "fields": [{"name": f["name"], "gen": f["gen"]} for f in v["fields"]]}
        for k, v in PRESETS.items()
    ]
