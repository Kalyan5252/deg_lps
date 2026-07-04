"""Tests for the Kafka datasource/output pipeline nodes.

Two layers:

* **Validation (always runs)** — config errors surface as clean ValueErrors,
  and unreachable brokers fail fast with a "Kafka error" instead of hanging.
* **Broker round-trip (self-skips)** — produce rows to a topic, then consume
  them back through ``_rows_from_kafka``. Needs a real broker; set
  ``KAFKA_BOOTSTRAP`` (default ``localhost:9092``). Skips cleanly when the
  broker is unreachable, so a bare ``pytest`` never hard-fails.

Run directly::

    cd backend
    ./.venv/bin/python -m tests.test_kafka_nodes
    KAFKA_BOOTSTRAP=localhost:9092 ./.venv/bin/python -m tests.test_kafka_nodes
"""
from __future__ import annotations

import asyncio
import json
import os
import time

from app import pipelines

_failures: list[str] = []
_passes = 0

BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092")


def check(cond: bool, label: str, extra: str = "") -> None:
    global _passes
    if cond:
        _passes += 1
        print(f"  [PASS] {label}")
    else:
        _failures.append(label)
        print(f"  [FAIL] {label}  {extra}")
    # fail pytest too — some test_* functions here are collected directly
    assert cond, f"{label}  {extra}"


# --------------------------------------------------------------------------
# Validation — always runs
# --------------------------------------------------------------------------

def _raises_value_error(coro) -> str | None:
    try:
        asyncio.run(coro)
        return None
    except ValueError as exc:
        return str(exc)


def test_config_validation() -> None:
    err = _raises_value_error(pipelines._rows_from_kafka({}))
    check(err is not None and "bootstrap_servers" in err,
          "source: missing servers -> ValueError", str(err))
    err = _raises_value_error(
        pipelines._rows_from_kafka({"bootstrap_servers": "x:9092"}))
    check(err is not None and "topic" in err,
          "source: missing topic -> ValueError", str(err))
    err = _raises_value_error(
        pipelines._deliver_to_kafka({"bootstrap_servers": "x:9092"}, [{"a": 1}]))
    check(err is not None and "topic" in err,
          "sink: missing topic -> ValueError", str(err))

    servers, kwargs = pipelines._kafka_common(
        {"bootstrap_servers": "b:9092", "sasl_username": "u",
         "sasl_password": "p"})
    check(kwargs.get("security_protocol") == "SASL_SSL"
          and kwargs.get("sasl_plain_username") == "u",
          "auth: SASL creds imply SASL_SSL")


def test_unreachable_broker_fails_fast() -> None:
    t0 = time.monotonic()
    err = _raises_value_error(pipelines._rows_from_kafka({
        "bootstrap_servers": "127.0.0.1:9", "topic": "t",
        "max_messages": 1, "max_seconds": 2}))
    took = time.monotonic() - t0
    check(err is not None and "Kafka error" in err,
          "source: unreachable broker -> clean error", str(err))
    check(took < 30, "source: fails fast (bounded)", f"{took:.1f}s")


# --------------------------------------------------------------------------
# Broker round-trip — self-skips without a reachable broker
# --------------------------------------------------------------------------

async def _broker_reachable() -> bool:
    from aiokafka import AIOKafkaProducer
    p = AIOKafkaProducer(bootstrap_servers=BOOTSTRAP, request_timeout_ms=3000)
    try:
        await asyncio.wait_for(p.start(), timeout=4)
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        try:
            await p.stop()
        except Exception:  # noqa: BLE001
            pass


async def _roundtrip() -> None:
    topic = f"deg_test_{int(time.time())}"
    rows = [{"order_id": i, "amount": i * 10.5} for i in range(1, 6)]
    sent = await pipelines._deliver_to_kafka(
        {"bootstrap_servers": BOOTSTRAP, "target": topic,
         "key_field": "order_id"}, rows)
    check(sent == 5, "sink: produced 5 messages")

    got = await pipelines._rows_from_kafka(
        {"bootstrap_servers": BOOTSTRAP, "topic": topic,
         "max_messages": 5, "max_seconds": 10})
    check(len(got) == 5, "source: consumed 5 messages", f"got {len(got)}")
    check(sorted(r["order_id"] for r in got) == [1, 2, 3, 4, 5],
          "roundtrip: payloads intact")
    check(all("_offset" in r and r["_topic"] == topic for r in got),
          "source: kafka metadata columns attached")


def main() -> int:
    print("== kafka node tests ==")
    print("\n-- validation (offline)")
    test_config_validation()
    test_unreachable_broker_fails_fast()

    print(f"\n-- broker round-trip ({BOOTSTRAP})")
    if asyncio.run(_broker_reachable()):
        asyncio.run(_roundtrip())
    else:
        print("  SKIP: no Kafka broker reachable "
              "(set KAFKA_BOOTSTRAP or start one to run the round-trip).")

    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_kafka_nodes():
    assert main() == 0, "kafka node checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
