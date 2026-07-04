from __future__ import annotations

import asyncio

from app import sandbox
from app.scenarios import Scenario, all_scenarios


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Acquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Conn:
    def __init__(self):
        self.sql: list[str] = []

    async def fetchval(self, query, *args):
        if "information_schema.schemata" in query:
            return None
        return None

    async def fetch(self, query, *args):
        if "FROM pg_tables" in query:
            return [{"tablename": "customers"}, {"tablename": "orders"}]
        return []

    async def execute(self, query, *args):
        self.sql.append(query)
        return "OK"

    def transaction(self):
        return _Tx()


class _Pool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return _Acquire(self.conn)


def _scenario() -> Scenario:
    return Scenario(
        key="unit_incident",
        title="Unit Incident",
        summary="",
        path="performance",
        difficulty=1,
        tables=["customers", "orders"],
        story="",
        objectives=[],
        constraints=[],
        hidden_problems=[],
        skills=[],
        success_criteria="",
        kind="query",
        starter_sql="",
        seed_sql="SELECT 1;",
    )


def test_user_snapshot_analyzes_copied_tables(monkeypatch):
    conn = _Conn()

    async def fake_provision(scenario):
        return None

    monkeypatch.setattr(sandbox, "provision", fake_provision)
    monkeypatch.setattr(sandbox.db, "pool", lambda: _Pool(conn))

    schema = asyncio.run(sandbox.provision_user_snapshot(_scenario(), 7))

    assert schema == "sandbox_u7_unit_incident"
    assert 'ANALYZE "sandbox_u7_unit_incident"."customers"' in conn.sql
    assert 'ANALYZE "sandbox_u7_unit_incident"."orders"' in conn.sql
    assert 'ANALYZE "sandbox_u7_unit_incident"' not in conn.sql


def test_available_scenarios_have_seed_datasets():
    missing = [s.key for s in all_scenarios() if s.available and not s.seed_sql.strip()]
    assert missing == []
