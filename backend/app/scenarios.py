"""Scenario registry.

Each scenario is a small "production incident" with seeded data that contains
real, observable problems (duplicates, missing indexes, sequential scans, bad
aggregations). Evaluation is driven by declarative ``checks`` that the
evaluator runs against the sandbox — see ``sandbox.run_checks``.

Check types (interpreted in sandbox.run_checks):
  * matches         -> user query result must equal the result of ``expected_sql``
  * explain_no_seqscan -> EXPLAIN of the target query must not Seq Scan ``table``
  * uses_index_scan -> EXPLAIN of the target query must contain an Index Scan
  * runs_under_ms   -> target query must execute under ``ms`` milliseconds
  * index_exists    -> an index must exist on ``table`` covering ``columns``
  * row_count       -> user query must return exactly ``count`` rows

"target query" is the user's own SQL for kind="query" scenarios, and the
scenario's fixed ``target_sql`` for kind="optimize" scenarios.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Scenario:
    key: str
    title: str
    summary: str
    path: str                       # learning path this belongs to
    difficulty: int                 # 1..5
    tables: list[str]
    story: str
    objectives: list[str]
    constraints: list[str]
    hidden_problems: list[str]
    skills: list[str]
    success_criteria: str
    kind: str                       # "query" | "optimize"
    starter_sql: str
    seed_sql: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    expected_sql: str | None = None
    target_sql: str | None = None
    available: bool = True

    def public(self) -> dict[str, Any]:
        """Everything safe to send to the client (no answer keys)."""
        return {
            "key": self.key,
            "title": self.title,
            "summary": self.summary,
            "path": self.path,
            "difficulty": self.difficulty,
            "tables": self.tables,
            "story": self.story,
            "objectives": self.objectives,
            "constraints": self.constraints,
            "hidden_problems": self.hidden_problems,
            "skills": self.skills,
            "success_criteria": self.success_criteria,
            "kind": self.kind,
            "starter_sql": self.starter_sql,
            "target_sql": self.target_sql,
            "available": self.available,
        }


# --------------------------------------------------------------------------
# Seed building blocks
# --------------------------------------------------------------------------

_ECOMMERCE_SEED = """
CREATE TABLE customers (
    id          BIGINT PRIMARY KEY,
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    country     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE products (
    id        BIGINT PRIMARY KEY,
    name      TEXT NOT NULL,
    category  TEXT NOT NULL,
    price     NUMERIC(10,2) NOT NULL
);

CREATE TABLE orders (
    id           BIGINT PRIMARY KEY,
    customer_id  BIGINT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE order_items (
    id          BIGINT PRIMARY KEY,
    order_id    BIGINT NOT NULL,
    product_id  BIGINT NOT NULL,
    quantity    INT NOT NULL
);

INSERT INTO customers (id, email, full_name, country, created_at)
SELECT g,
       'user' || g || '@example.com',
       'Customer ' || g,
       (ARRAY['US','UK','DE','IN','BR','CA'])[1 + (g % 6)],
       now() - (g % 400) * interval '1 day'
FROM generate_series(1, 8000) g;

INSERT INTO products (id, name, category, price)
SELECT g,
       'Product ' || g,
       (ARRAY['Electronics','Home','Toys','Books','Apparel','Garden'])[1 + (g % 6)],
       round((10 + (g % 500))::numeric, 2)
FROM generate_series(1, 800) g;

INSERT INTO orders (id, customer_id, status, created_at)
SELECT g,
       1 + (g % 8000),
       (ARRAY['paid','paid','paid','refunded','cancelled'])[1 + (g % 5)],
       now() - (g % 365) * interval '1 day'
FROM generate_series(1, 40000) g;

INSERT INTO order_items (id, order_id, product_id, quantity)
SELECT g,
       1 + (g % 40000),
       1 + (g % 800),
       1 + (g % 5)
FROM generate_series(1, 250000) g;

ANALYZE;
"""


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------

SCENARIOS: dict[str, Scenario] = {}


def _register(s: Scenario) -> None:
    SCENARIOS[s.key] = s


_register(Scenario(
    key="slow_dashboard",
    title="The Dashboard Is Timing Out",
    summary="Opening any order's detail panel hangs for 12s — every click scans all 250k order_items rows. Support needs it instant.",
    path="performance",
    difficulty=2,
    tables=["customers", "products", "orders", "order_items"],
    story=(
        "It's Tuesday afternoon. On the ops dashboard, clicking any order to open its "
        "detail panel now hangs for ~12 seconds — it used to be instant. Support has a "
        "VIP escalation and needs to read order #12345's line items in the next 20 "
        "minutes. The panel runs one query: fetch the line items for a single order, "
        "joined to products. There are only a handful of rows per order — yet every "
        "click makes the database read all 250k rows in order_items. Find out why, and "
        "make the drill-down instant."
    ),
    objectives=[
        "Reproduce the slow order-detail query (line items for order #12345).",
        "Use EXPLAIN ANALYZE to see how order_items is being accessed.",
        "Make the lookup instant without changing the rows it returns.",
    ],
    constraints=[
        "You may add indexes but must not delete or mutate business data.",
        "The panel must still return the line items for a given order_id.",
    ],
    hidden_problems=[
        "No index on the foreign key order_items.order_id.",
        "Every single-order lookup sequentially scans all 250k order_items rows.",
    ],
    skills=["JOINS", "INDEXES", "QUERY OPTIMIZATION"],
    success_criteria="The order-detail lookup uses an index on order_items.order_id instead of sequentially scanning the table.",
    kind="optimize",
    starter_sql=(
        "-- The order-detail panel's query (this is what hangs):\n"
        "SELECT p.name, p.category, oi.quantity,\n"
        "       oi.quantity * p.price AS line_total\n"
        "FROM order_items oi\n"
        "JOIN products p ON p.id = oi.product_id\n"
        "WHERE oi.order_id = 12345\n"
        "ORDER BY line_total DESC;\n\n"
        "-- Investigate first:\n"
        "-- EXPLAIN ANALYZE SELECT ... ;  -- how is order_items being read?\n"
    ),
    seed_sql=_ECOMMERCE_SEED,
    target_sql=(
        "SELECT p.name, p.category, oi.quantity, oi.quantity * p.price AS line_total "
        "FROM order_items oi "
        "JOIN products p ON p.id = oi.product_id "
        "WHERE oi.order_id = 12345 "
        "ORDER BY line_total DESC"
    ),
    checks=[
        {"type": "index_exists", "table": "order_items", "columns": ["order_id"],
         "weight": 35, "label": "Index added on order_items.order_id"},
        {"type": "explain_no_seqscan", "table": "order_items",
         "weight": 45, "label": "Lookup no longer sequentially scans order_items"},
        {"type": "runs_under_ms", "ms": 50,
         "weight": 20, "label": "Order-detail lookup runs under 50ms"},
    ],
))


_register(Scenario(
    key="duplicate_customers",
    title="Duplicate Customers Are Inflating the CRM",
    summary="Support imported a CSV twice. The same person now exists under several customer IDs and metrics are double-counting.",
    path="data_quality",
    difficulty=2,
    tables=["customers", "orders"],
    story=(
        "Customer Success ran a bulk import last night and a retry double-fired. Now "
        "the CRM shows the same person under multiple customer rows sharing one email. "
        "Finance noticed 'active customers' jumped overnight and orders look split "
        "across duplicate IDs. Before anyone deletes anything, leadership wants the "
        "blast radius: which emails are duplicated and how many extra rows exist."
    ),
    objectives=[
        "Find every email that maps to more than one customer row.",
        "Report the email and the number of duplicate rows for each.",
        "Do not modify data yet — first quantify the problem.",
    ],
    constraints=[
        "Read-only investigation. No DELETE/UPDATE during triage.",
        "Group by the natural key (email), not the surrogate id.",
    ],
    hidden_problems=[
        "Email is not unique in customers.",
        "Roughly the bottom slice of IDs are re-imported duplicates.",
    ],
    skills=["SELECT", "GROUP BY", "JOINS"],
    success_criteria="Return each duplicated email alongside its row count, for emails that appear more than once.",
    kind="query",
    starter_sql=(
        "-- Find duplicated emails and how many customer rows each one has.\n"
        "-- Expected columns: email, row_count\n"
        "SELECT email, COUNT(*) AS row_count\n"
        "FROM customers\n"
        "-- GROUP BY ... HAVING ...\n"
        ";\n"
    ),
    seed_sql="""
CREATE TABLE customers (
    id          BIGINT PRIMARY KEY,
    email       TEXT NOT NULL,
    full_name   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE TABLE orders (
    id          BIGINT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    total       NUMERIC(10,2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);

-- 5000 clean customers
INSERT INTO customers (id, email, full_name, created_at)
SELECT g, 'person' || g || '@mail.com', 'Person ' || g, now() - (g % 200) * interval '1 day'
FROM generate_series(1, 5000) g;

-- re-import duplicated the first 1200 customers under new IDs (same email)
INSERT INTO customers (id, email, full_name, created_at)
SELECT 100000 + g, 'person' || g || '@mail.com', 'Person ' || g, now()
FROM generate_series(1, 1200) g;

INSERT INTO orders (id, customer_id, total, created_at)
SELECT g, 1 + (g % 5000), round((20 + g % 300)::numeric, 2), now() - (g % 120) * interval '1 day'
FROM generate_series(1, 12000) g;

ANALYZE;
""",
    expected_sql=(
        "SELECT email, COUNT(*) AS row_count FROM customers "
        "GROUP BY email HAVING COUNT(*) > 1 ORDER BY email"
    ),
    checks=[
        {"type": "matches", "weight": 100,
         "label": "Returns exactly the duplicated emails with correct counts"},
    ],
))


_register(Scenario(
    key="missing_indexes",
    title="The Login Audit Lookup Crawls",
    summary="A point lookup over the events table scans 500k rows. Security needs sub-50ms lookups during an investigation.",
    path="performance",
    difficulty=3,
    tables=["events"],
    story=(
        "Security is investigating a suspicious account and keeps running lookups for a "
        "single user's events. Each lookup takes seconds because the events table has "
        "no supporting index — every query scans all 500k rows. They need the lookup "
        "fast (sub-50ms) so they can iterate during the incident. The query they run is "
        "a filter on user_id ordered by created_at."
    ),
    objectives=[
        "Run EXPLAIN ANALYZE on the lookup to confirm the sequential scan.",
        "Add an index so the lookup uses an Index Scan.",
        "Verify the planner now uses the index.",
    ],
    constraints=[
        "Do not change the lookup query itself; make it fast via schema.",
        "The lookup filters events by user_id.",
    ],
    hidden_problems=[
        "No index on events.user_id.",
        "Every lookup is a full sequential scan of 500k rows.",
    ],
    skills=["INDEXES", "QUERY OPTIMIZATION"],
    success_criteria="The user-event lookup uses an Index Scan instead of a sequential scan and returns quickly.",
    kind="optimize",
    starter_sql=(
        "-- The lookup security keeps running:\n"
        "EXPLAIN ANALYZE\n"
        "SELECT * FROM events WHERE user_id = 4242 ORDER BY created_at DESC;\n\n"
        "-- Confirm the Seq Scan, then create the index that fixes it.\n"
    ),
    seed_sql="""
CREATE TABLE events (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    event_type  TEXT NOT NULL,
    ip          TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
INSERT INTO events (id, user_id, event_type, ip, created_at)
SELECT g,
       1 + (g % 10000),
       (ARRAY['login','logout','password_reset','view','purchase'])[1 + (g % 5)],
       '10.0.' || (g % 255) || '.' || ((g * 7) % 255),
       now() - (g % 5000) * interval '1 minute'
FROM generate_series(1, 500000) g;
ANALYZE;
""",
    target_sql="SELECT * FROM events WHERE user_id = 4242 ORDER BY created_at DESC",
    checks=[
        {"type": "index_exists", "table": "events", "columns": ["user_id"],
         "weight": 40, "label": "Index added on events.user_id"},
        {"type": "explain_no_seqscan", "table": "events",
         "weight": 40, "label": "Lookup no longer sequentially scans events"},
        {"type": "runs_under_ms", "ms": 50,
         "weight": 20, "label": "Lookup runs under 50ms"},
    ],
))


# ----- Stubbed scenarios (visible, authored later) ------------------------

def _stub(key: str, title: str, summary: str, path: str, difficulty: int,
          skills: list[str]) -> None:
    _register(Scenario(
        key=key, title=title, summary=summary, path=path, difficulty=difficulty,
        tables=[], story=summary,
        objectives=[], constraints=[], hidden_problems=[], skills=skills,
        success_criteria="", kind="query", starter_sql="", seed_sql="",
        available=False,
    ))


_stub("failed_etl", "Failed ETL Import",
      "A nightly ETL job half-loaded a batch. Reconcile source vs. target and find the gap.",
      "data_quality", 3, ["JOINS", "CTEs", "SELECT"])
_stub("revenue_reporting", "Revenue Reporting Issue",
      "Monthly revenue doesn't tie out. Refunds and timezones are double-counting.",
      "analytics", 3, ["GROUP BY", "WINDOW FUNCTIONS", "CTEs"])
_stub("data_quality", "Data Quality Problems",
      "Nulls, bad enums and orphaned rows are polluting a key table. Profile and quantify.",
      "data_quality", 2, ["SELECT", "GROUP BY"])
_stub("inventory_mismatch", "Inventory Mismatch",
      "Warehouse counts disagree with the ledger. Trace the discrepancy across movements.",
      "analytics", 4, ["JOINS", "WINDOW FUNCTIONS", "CTEs"])
_stub("customer_segmentation", "Customer Segmentation",
      "Build RFM-style segments from raw orders using window functions.",
      "analytics", 4, ["WINDOW FUNCTIONS", "CTEs", "GROUP BY"])


PATHS = {
    "performance": {
        "key": "performance",
        "title": "Performance & Optimization",
        "description": "Make slow systems fast. Read execution plans, add the right indexes, fix bad joins.",
    },
    "data_quality": {
        "key": "data_quality",
        "title": "Data Quality & Integrity",
        "description": "Hunt duplicates, reconcile loads, and profile dirty data like an on-call engineer.",
    },
    "analytics": {
        "key": "analytics",
        "title": "Analytics Engineering",
        "description": "Turn messy operational data into trustworthy reports with CTEs and window functions.",
    },
}


def get_scenario(key: str) -> Scenario | None:
    return SCENARIOS.get(key)


def all_scenarios() -> list[Scenario]:
    return list(SCENARIOS.values())
