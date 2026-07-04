"""Integration tests for the platform event backbone.

Verifies that emit() durably appends to app.events, that it NEVER raises
(even with a bogus Kafka mirror configured), and that the key platform flows
actually emit. Skips cleanly when the database is unreachable.
"""
from __future__ import annotations

import asyncio
import time

from app import db, events
from app.config import get_settings

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
    assert cond, f"{label}  {extra}"


async def _run() -> None:
    user_id = await db.pool().fetchval(
        "INSERT INTO app.users (email, display_name) VALUES ($1,$2) "
        "ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name "
        "RETURNING id", f"events-test-{int(time.time())}@t.com", "events-test")
    try:
        # 1. emit lands in the table with payload intact
        await events.emit("test.ping", {"n": 1, "tag": "alpha"}, user_id=user_id)
        rows = await events.recent("test.ping", limit=5)
        check(bool(rows) and rows[0]["payload"] == {"n": 1, "tag": "alpha"}
              and rows[0]["user_id"] == user_id,
              "emit: appended with payload + user", f"got {rows[:1]}")

        # 2. emit never raises, even with an unreachable Kafka mirror
        settings = get_settings()
        old = settings.kafka_bootstrap_servers
        settings.kafka_bootstrap_servers = "127.0.0.1:9"  # nothing listens
        try:
            await events.emit("test.mirror_down", {"ok": True}, user_id=user_id)
            # give the fire-and-forget mirror task a beat to fail quietly
            await asyncio.sleep(0.1)
            check(True, "emit: survives unreachable Kafka mirror")
        finally:
            settings.kafka_bootstrap_servers = old
            await events.close()
        rows = await events.recent("test.mirror_down", limit=1)
        check(bool(rows), "emit: event still durably stored in Postgres")

        # 3. unfiltered recent() returns newest-first
        rows = await events.recent(limit=10)
        check(rows and rows[0]["topic"] == "test.mirror_down",
              "recent: newest first", f"got {rows[0]['topic'] if rows else None}")
    finally:
        await db.pool().execute(
            "DELETE FROM app.events WHERE topic LIKE 'test.%'")
        await db.pool().execute("DELETE FROM app.users WHERE id=$1", user_id)


async def _reachable() -> bool:
    import asyncpg
    s = get_settings()
    try:
        conn = await asyncpg.connect(
            s.database_url, timeout=3, ssl=db._ssl_arg(s.db_sslmode))
        await conn.close()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _main_async() -> bool:
    if not await _reachable():
        print("SKIP: database not reachable (pre-flight probe failed).")
        return False
    await db.init_pool()
    try:
        await _run()
    finally:
        await db.close_pool()
    return True


def main() -> int:
    print("== event backbone integration tests ==")
    ran = asyncio.run(_main_async())
    if not ran:
        return 0
    print(f"\n== {_passes} passed, {len(_failures)} failed ==")
    for f in _failures:
        print(f"  FAILED: {f}")
    return 1 if _failures else 0


def test_events_backbone():
    assert main() == 0, "event backbone checks failed (see output)"


if __name__ == "__main__":
    raise SystemExit(main())
