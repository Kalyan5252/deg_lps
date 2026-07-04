"""Platform event backbone.

Every significant platform action emits a typed event. Events are durably
appended to ``app.events`` (the always-on backbone — queryable, replayable,
zero extra infrastructure) and, when ``KAFKA_BOOTSTRAP_SERVERS`` is set,
mirrored to Kafka so external consumers (dashboards, warehouses, alerting)
can react in real time.

Design rules:

* ``emit()`` NEVER raises — the event bus must not break the user action that
  produced the event. Failures are logged and swallowed.
* The Kafka mirror is fire-and-forget on a shared producer; Postgres remains
  the source of truth. If the broker is down, events still land in the table.
* Topics are dot-namespaced (``scenario.submitted``, ``pipeline.run_finished``,
  ``hunt.checkpoint_submitted``, ``track.submitted``, ``user.login``). On the
  Kafka side they are prefixed with ``deg.``.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from . import db
from .config import get_settings

logger = logging.getLogger("sqlforge.events")

EVENTS_DDL = """
CREATE TABLE IF NOT EXISTS app.events (
    id          BIGSERIAL PRIMARY KEY,
    topic       TEXT NOT NULL,
    user_id     BIGINT,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_topic_idx ON app.events (topic, id);
CREATE INDEX IF NOT EXISTS events_user_idx ON app.events (user_id, id);
"""

_producer = None
_producer_lock: asyncio.Lock | None = None


async def _kafka_producer():
    """Lazily start (and cache) one shared producer; None if unavailable."""
    global _producer, _producer_lock
    servers = get_settings().kafka_bootstrap_servers.strip()
    if not servers:
        return None
    if _producer is not None:
        return _producer
    if _producer_lock is None:
        _producer_lock = asyncio.Lock()
    async with _producer_lock:
        if _producer is not None:
            return _producer
        p = None
        try:
            from aiokafka import AIOKafkaProducer
            p = AIOKafkaProducer(bootstrap_servers=servers,
                                 request_timeout_ms=5000)
            await asyncio.wait_for(p.start(), timeout=8)
            _producer = p
        except Exception as exc:  # noqa: BLE001
            logger.warning("Kafka mirror unavailable (%s); events stay in "
                           "Postgres only.", exc)
            if p is not None:
                try:
                    await p.stop()
                except Exception:  # noqa: BLE001
                    pass
    return _producer


async def close() -> None:
    """Stop the shared producer (called from app shutdown)."""
    global _producer
    if _producer is not None:
        try:
            await _producer.stop()
        except Exception:  # noqa: BLE001
            pass
        _producer = None


async def _mirror(topic: str, record: dict) -> None:
    p = await _kafka_producer()
    if p is None:
        return
    try:
        await p.send_and_wait(
            f"deg.{topic}", json.dumps(record, default=str).encode())
    except Exception as exc:  # noqa: BLE001
        logger.warning("Kafka mirror send failed for %s: %s", topic, exc)


async def emit(topic: str, payload: dict[str, Any] | None = None,
               user_id: int | None = None) -> None:
    """Append an event to the backbone. Never raises."""
    payload = payload or {}
    try:
        await db.pool().execute(
            "INSERT INTO app.events (topic, user_id, payload) VALUES ($1,$2,$3)",
            topic, user_id, payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("event emit(%s) failed: %s", topic, exc)
        return
    if get_settings().kafka_bootstrap_servers.strip():
        record = {"topic": topic, "user_id": user_id, "payload": payload}
        # fire-and-forget: the user's request must not wait on the broker
        asyncio.get_running_loop().create_task(_mirror(topic, record))


async def recent(topic: str | None = None, limit: int = 100) -> list[dict]:
    """Most recent events, optionally filtered by topic (for ops/debugging)."""
    limit = max(1, min(500, limit))
    if topic:
        rows = await db.pool().fetch(
            "SELECT id, topic, user_id, payload, created_at FROM app.events "
            "WHERE topic=$1 ORDER BY id DESC LIMIT $2", topic, limit)
    else:
        rows = await db.pool().fetch(
            "SELECT id, topic, user_id, payload, created_at FROM app.events "
            "ORDER BY id DESC LIMIT $1", limit)
    return [dict(r) for r in rows]
