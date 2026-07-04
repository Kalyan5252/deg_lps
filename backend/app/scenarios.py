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


_register(Scenario(
    key="failed_etl",
    title="Failed ETL Import",
    summary="The nightly loader crashed mid-batch. Source and target disagree and finance is reporting off the target table. Find the gap.",
    path="data_quality",
    difficulty=3,
    tables=["staging_orders", "orders"],
    story=(
        "The 02:00 ETL job that copies staging_orders into orders died with an "
        "out-of-memory error partway through last night's run. It was restarted "
        "by the on-call, but nobody verified the load. This morning finance says "
        "revenue 'looks light' — the target table seems to be missing part of the "
        "newest batch (batch_id 5). Before re-running the loader you must quantify "
        "the damage: exactly which source rows never made it into orders. "
        "Reconcile the two tables and report every missing order id."
    ),
    objectives=[
        "Compare staging_orders (source of truth) against orders (target).",
        "Return the id of every source row that is missing from the target.",
        "Order the ids ascending so the report is stable.",
    ],
    constraints=[
        "Read-only triage: do NOT insert the missing rows yet.",
        "Rows must be matched by id, the business key shared by both tables.",
        "Expected output: a single `id` column, ascending.",
    ],
    hidden_problems=[
        "The loader crashed 38% of the way through batch 5.",
        "orders is missing every staging_orders row with id > 21900.",
    ],
    skills=["JOINS", "CTEs", "SELECT"],
    success_criteria="Return exactly the source order ids absent from the target table, ordered ascending.",
    kind="query",
    starter_sql=(
        "-- Which staging_orders rows never made it into orders?\n"
        "-- Expected column: id (ascending)\n"
        "-- Hint: an anti-join (LEFT JOIN ... IS NULL, or NOT EXISTS) finds\n"
        "-- rows present on one side only.\n"
        "SELECT count(*) AS source_rows FROM staging_orders;\n"
    ),
    seed_sql="""
CREATE TABLE staging_orders (
    id           BIGINT PRIMARY KEY,
    customer_id  BIGINT NOT NULL,
    amount       NUMERIC(10,2) NOT NULL,
    batch_id     INT NOT NULL,
    loaded_at    TIMESTAMPTZ NOT NULL
);
CREATE TABLE orders (
    id           BIGINT PRIMARY KEY,
    customer_id  BIGINT NOT NULL,
    amount       NUMERIC(10,2) NOT NULL,
    batch_id     INT NOT NULL,
    loaded_at    TIMESTAMPTZ NOT NULL
);

-- 25k source rows across 5 nightly batches (5k each)
INSERT INTO staging_orders (id, customer_id, amount, batch_id, loaded_at)
SELECT g,
       1 + (g % 3000),
       round((20 + (g % 480))::numeric, 2),
       1 + (g - 1) / 5000,
       now() - (5 - (1 + (g - 1) / 5000)) * interval '1 day'
FROM generate_series(1, 25000) g;

-- the loader crashed partway through batch 5: only ids <= 21900 were copied
INSERT INTO orders
SELECT * FROM staging_orders WHERE id <= 21900;

ANALYZE;
""",
    expected_sql=(
        "SELECT s.id FROM staging_orders s "
        "LEFT JOIN orders o ON o.id = s.id "
        "WHERE o.id IS NULL ORDER BY s.id"
    ),
    checks=[
        {"type": "matches", "weight": 80,
         "label": "Returns exactly the source rows missing from the target"},
        {"type": "row_count", "count": 3100, "weight": 20,
         "label": "Finds all 3,100 unloaded rows"},
    ],
))


_register(Scenario(
    key="consumer_lag",
    title="Consumer Lag Pileup",
    summary="A Kafka consumer group is falling behind. One partition is frozen on a poison message while the topic keeps growing. Find it before checkout data goes stale.",
    path="streaming",
    difficulty=3,
    tables=["partitions", "consumer_offsets"],
    story=(
        "PagerDuty fired: 'fraud-detector consumer lag > SLo'. The fraud team's "
        "Kafka consumer group reads checkout.events (12 partitions), and the "
        "dashboard fed by it has been flat for hours while orders keep flowing. "
        "You've exported the broker state into two tables: partitions holds each "
        "partition's log_end_offset (the newest message), and consumer_offsets "
        "holds each group's committed_offset per partition. Lag for a partition "
        "is log_end_offset - committed_offset. Healthy consumers here run a lag "
        "of a few hundred to a couple thousand. Somewhere, one partition has "
        "stopped moving entirely — the classic poison-message signature: the "
        "committed offset froze hours ago while the log end keeps growing. "
        "Report every (group_id, topic, partition) whose lag exceeds 100,000, "
        "with the lag itself."
    ),
    objectives=[
        "Join consumer_offsets to partitions on (topic, partition).",
        "Compute lag = log_end_offset - committed_offset per group/partition.",
        "Return group_id, topic, partition, lag for lag > 100000, biggest first.",
    ],
    constraints=[
        "Expected columns, in order: group_id, topic, partition, lag.",
        "Only rows with lag greater than 100,000.",
        "Order by lag descending.",
    ],
    hidden_problems=[
        "fraud-detector's partition 7 of checkout.events froze at offset 41,213 "
        "six hours ago (poison message); its lag is ~2 million.",
        "Every other group/partition has a healthy lag under ~2,000.",
    ],
    skills=["JOINS", "SELECT"],
    success_criteria="Return exactly the stuck group/partition rows (lag > 100k) with correct lag values, largest lag first.",
    kind="query",
    starter_sql=(
        "-- Kafka state exported from the brokers:\n"
        "--   partitions(topic, partition, log_end_offset)\n"
        "--   consumer_offsets(group_id, topic, partition, committed_offset, last_commit_at)\n"
        "-- lag = log_end_offset - committed_offset\n"
        "-- Expected columns: group_id, topic, partition, lag (lag > 100000, desc)\n"
        "SELECT * FROM consumer_offsets LIMIT 10;\n"
    ),
    seed_sql="""
CREATE TABLE partitions (
    topic           TEXT NOT NULL,
    partition       INT NOT NULL,
    log_end_offset  BIGINT NOT NULL,
    PRIMARY KEY (topic, partition)
);
CREATE TABLE consumer_offsets (
    group_id         TEXT NOT NULL,
    topic            TEXT NOT NULL,
    partition        INT NOT NULL,
    committed_offset BIGINT NOT NULL,
    last_commit_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, topic, partition)
);

INSERT INTO partitions
SELECT 'checkout.events', g, 2000000 + g * 13777 FROM generate_series(0, 11) g
UNION ALL
SELECT 'email.sends', g, 400000 + g * 9311 FROM generate_series(0, 5) g;

-- healthy consumers: lag stays in the hundreds-to-low-thousands
INSERT INTO consumer_offsets
SELECT 'billing-service', topic, partition,
       log_end_offset - (150 + partition * 37),
       now() - interval '5 seconds'
FROM partitions WHERE topic = 'checkout.events';

INSERT INTO consumer_offsets
SELECT 'email-sender', topic, partition,
       log_end_offset - (80 + partition * 21),
       now() - interval '3 seconds'
FROM partitions WHERE topic = 'email.sends';

-- fraud-detector: healthy everywhere EXCEPT partition 7, frozen on a poison
-- message six hours ago
INSERT INTO consumer_offsets
SELECT 'fraud-detector', topic, partition,
       CASE WHEN partition = 7 THEN 41213
            ELSE log_end_offset - (900 + partition * 55) END,
       CASE WHEN partition = 7 THEN now() - interval '6 hours'
            ELSE now() - interval '4 seconds' END
FROM partitions WHERE topic = 'checkout.events';

ANALYZE;
""",
    expected_sql=(
        "SELECT co.group_id, co.topic, co.partition, "
        "p.log_end_offset - co.committed_offset AS lag "
        "FROM consumer_offsets co "
        "JOIN partitions p ON p.topic = co.topic AND p.partition = co.partition "
        "WHERE p.log_end_offset - co.committed_offset > 100000 "
        "ORDER BY lag DESC"
    ),
    checks=[
        {"type": "matches", "weight": 80,
         "label": "Returns exactly the stuck partition(s) with correct lag"},
        {"type": "row_count", "count": 1, "weight": 20,
         "label": "Exactly one partition is pathologically behind"},
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
_stub("rebalance_storm", "Rebalance Storm",
      "A consumer group churns through rebalances every few minutes. Trace membership flapping from the group-coordinator log.",
      "streaming", 4, ["SELECT", "GROUP BY", "WINDOW FUNCTIONS"])
_stub("exactly_once", "Double-Charged: Exactly-Once Gone Wrong",
      "A non-idempotent producer retried during a broker failover. Find the duplicated payment events by business key.",
      "streaming", 4, ["JOINS", "GROUP BY", "CTEs"])


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
    "streaming": {
        "key": "streaming",
        "title": "Streaming & Kafka",
        "description": "Diagnose consumer lag, rebalance storms and delivery-semantics bugs the way an on-call streaming engineer does.",
    },
}


def get_scenario(key: str) -> Scenario | None:
    return SCENARIOS.get(key)


def all_scenarios() -> list[Scenario]:
    return list(SCENARIOS.values())
