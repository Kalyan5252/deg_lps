"""Global (public) dataset catalog.

Real-world public datasets bundled as CSVs under ``global_data/``. Users don't
work on a shared copy — when a user "uses" a dataset we clone it into a fresh
private custom track for them (their own replica), which then flows through all
the existing track machinery (provisioning, schema graph + relation inference,
queries, the agentic mentor).

Column headers are normalised camelCase -> snake_case on load so the platform's
`<x>_id -> <x>.id` relation inference links foreign keys automatically (e.g.
Northwind's ``customerID`` -> ``customer_id`` -> ``customers``).
"""
from __future__ import annotations

import os
import re
from functools import lru_cache

DATA_DIR = os.path.join(os.path.dirname(__file__), "global_data")

# Ordered catalog. `tables` = list of (table_name, csv_filename). Parents first
# so the schema reads naturally.
CATALOG: list[dict] = [
    {
        "key": "northwind",
        "name": "Northwind Traders",
        "category": "E-commerce",
        "description": (
            "The classic Northwind sales database — a specialty foods importer. "
            "Customers, employees, orders and line items, products, categories, "
            "suppliers and shippers, richly linked by foreign keys. Great for "
            "JOINs, aggregations, and revenue analysis."
        ),
        "tables": [
            ("categories", "categories.csv"),
            ("suppliers", "suppliers.csv"),
            ("products", "products.csv"),
            ("customers", "customers.csv"),
            ("employees", "employees.csv"),
            ("shippers", "shippers.csv"),
            ("orders", "orders.csv"),
            ("order_details", "order_details.csv"),
        ],
    },
    {
        "key": "healthcare",
        "name": "Healthcare Clinic",
        "category": "Healthcare",
        "description": (
            "A clinic network: patients, doctors, clinics and staff, plus "
            "appointments and their payments, prescriptions and treatments. Fully "
            "linked by foreign keys — a strong playground for multi-table JOINs, "
            "patient histories, and revenue/treatment analysis."
        ),
        "tables": [
            ("clinics", "clinics.csv"),
            ("doctors", "doctors.csv"),
            ("staff", "staff.csv"),
            ("patients", "patients.csv"),
            ("appointments", "appointments.csv"),
            ("payments", "payments.csv"),
            ("prescriptions", "prescriptions.csv"),
            ("treatments", "treatments.csv"),
        ],
    },
    {
        "key": "finance_fraud",
        "name": "Retail Bank — Accounts, Loans & Transactions",
        "category": "Banking",
        "description": (
            "A retail bank schema: customers and addresses, accounts and their "
            "types/statuses, loans, branches, and ~12k transactions. Highly "
            "relational — ideal for balances, transaction flows, loan portfolios "
            "and fraud-style anomaly queries."
        ),
        "tables": [
            ("customer_types", "customer_types.csv"),
            ("account_types", "account_types.csv"),
            ("account_statuses", "account_statuses.csv"),
            ("loan_statuses", "loan_statuses.csv"),
            ("transaction_types", "transaction_types.csv"),
            ("addresses", "addresses.csv"),
            ("customers", "customers.csv"),
            ("branches", "branches.csv"),
            ("accounts", "accounts.csv"),
            ("loans", "loans.csv"),
            ("transactions", "transactions.csv"),
        ],
    },
    {
        "key": "coffee_shop",
        "name": "Coffee Shop Operations",
        "category": "Retail / F&B",
        "description": (
            "A coffee shop's operational database: menu items and recipes, "
            "ingredients and inventory, staff, shifts and rota, and customer "
            "orders. Small but richly linked — great for JOINs across sales, "
            "recipes and staffing."
        ),
        "tables": [
            ("ingredients", "ingredients.csv"),
            ("items", "items.csv"),
            ("staff", "staff.csv"),
            ("shift", "shift.csv"),
            ("recipe", "recipe.csv"),
            ("inventory", "inventory.csv"),
            ("rota", "rota.csv"),
            ("orders", "orders.csv"),
        ],
    },
    {
        "key": "wwe",
        "name": "WWE Events & Match Ratings (2015–2025)",
        "category": "Sports & Entertainment",
        "description": (
            "A decade of WWE programming: events (date, promotion, venue) and "
            "individual match ratings (CageMatch and Wrestling Observer star "
            "ratings). Good for time trends, rating distributions, and event "
            "vs. match analysis."
        ),
        "tables": [
            ("events", "events.csv"),
            ("match_ratings", "match_ratings.csv"),
        ],
    },
    {
        "key": "olympics",
        "name": "Olympic Games Medals (1994–2024)",
        "category": "Sports",
        "description": (
            "Nation-level medal tallies (gold/silver/bronze/total) across every "
            "Summer and Winter Games from 1994 to 2024, combined into one table "
            "with a `games` column. Great for GROUP BY, ranking, and trends by "
            "country over time."
        ),
        "tables": [("nation_medals", "nation_medals.csv")],
    },
    {
        "key": "gym",
        "name": "Gym Member Activity",
        "category": "Fitness",
        "description": (
            "Per-visit gym attendance: member, date, age, gender, membership "
            "type, workout type and duration, calories burned, and attendance "
            "status. Good for aggregations by membership tier and workout type."
        ),
        "tables": [("attendance", "attendance.csv")],
    },
    {
        "key": "automobiles",
        "name": "Automobile Fuel Economy",
        "category": "Automotive",
        "description": (
            "Classic auto-mpg dataset: fuel economy, cylinders, horsepower, "
            "weight and origin for hundreds of car models. Ideal for filtering, "
            "GROUP BY, and comparing performance across model years and regions."
        ),
        "tables": [("cars", "cars.csv")],
    },
    {
        "key": "nyc_taxi",
        "name": "NYC Taxi Rides",
        "category": "Logistics",
        "description": (
            "A sample of New York City taxi trips: pickup/dropoff times and "
            "zones, distance, fare, tip and payment type. Good for time-based "
            "analysis, fare/tip aggregations, and borough-level breakdowns."
        ),
        "tables": [("trips", "trips.csv")],
    },
    {
        "key": "diamonds",
        "name": "Diamond Sales",
        "category": "Retail",
        "description": (
            "~5,000 diamonds with carat, cut, color, clarity, dimensions and "
            "price. A retail-pricing playground for GROUP BY, percentiles, and "
            "price-vs-quality analysis."
        ),
        "tables": [("diamonds", "diamonds.csv")],
    },
]

_BY_KEY = {d["key"]: d for d in CATALOG}


def _snake(name: str) -> str:
    """camelCase / PascalCase -> snake_case (leaves already-snake names alone)."""
    name = name.strip().strip('"').strip()
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return name.lower()


def get(key: str) -> dict | None:
    return _BY_KEY.get(key)


def load_tables(key: str) -> list[tuple[str, str]]:
    """Return [(table_name, csv_text)] for a dataset, headers snake_cased.

    Only the header row is rewritten (to snake_case); data rows are untouched.
    """
    ds = _BY_KEY.get(key)
    if not ds:
        raise KeyError(key)
    out: list[tuple[str, str]] = []
    for tname, fname in ds["tables"]:
        path = os.path.join(DATA_DIR, key, fname)
        with open(path, encoding="utf-8-sig") as fh:
            text = fh.read()
        lines = text.splitlines()
        if lines:
            header = ",".join(_snake(c) for c in lines[0].split(","))
            text = "\n".join([header, *lines[1:]])
        out.append((tname, text))
    return out


@lru_cache(maxsize=None)
def _summary(key: str) -> tuple:
    """(table_summaries, total_rows) — cached; parses each CSV once."""
    from . import custom  # local import to avoid a cycle at module load

    tables = []
    total = 0
    for tname, text in load_tables(key):
        parsed = custom.parse_csv(f"{tname}.csv", text)
        total += parsed["row_count"]
        tables.append({
            "name": tname,
            "row_count": parsed["row_count"],
            "columns": [c["name"] for c in parsed["columns"]],
        })
    return tables, total


def listing() -> list[dict]:
    """Catalog metadata for the browse UI (with per-table columns + row counts)."""
    items = []
    for ds in CATALOG:
        tables, total = _summary(ds["key"])
        items.append({
            "key": ds["key"],
            "name": ds["name"],
            "category": ds["category"],
            "description": ds["description"],
            "table_count": len(tables),
            "total_rows": total,
            "tables": tables,
        })
    return items
