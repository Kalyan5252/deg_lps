"""Fetch public Kaggle datasets (via kagglehub, anonymous) and stage them as
CSVs under app/global_data/<key>/ for the global-datasets catalog.

Large child tables are capped, keeping foreign keys joinable (parents stay whole
and children are filtered to referenced parent ids where practical). Re-runnable.

    ./.venv/bin/python -m scripts.build_global_data
"""
from __future__ import annotations

import csv
import io
import os
import re
import shutil

import kagglehub

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "app", "global_data")


def _find(root: str, filename: str) -> str:
    for r, _, files in os.walk(root):
        for f in files:
            if f == filename:
                return os.path.join(r, f)
    raise FileNotFoundError(filename)


def _read_rows(path: str) -> tuple[list[str], list[list[str]]]:
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as fh:
        rows = list(csv.reader(fh))
    return rows[0], rows[1:]


def _write(key: str, table: str, header: list[str], rows: list[list[str]]) -> None:
    d = os.path.join(OUT, key)
    os.makedirs(d, exist_ok=True)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    with open(os.path.join(d, f"{table}.csv"), "w", encoding="utf-8", newline="") as fh:
        fh.write(buf.getvalue())
    print(f"  {key}/{table}.csv  {len(rows)} rows")


def copy_plain(key: str, slug: str, mapping: dict[str, str], cap: dict | None = None):
    """mapping: {source_filename: out_table}. cap: {out_table: max_rows}."""
    cap = cap or {}
    root = kagglehub.dataset_download(slug)
    print(f"== {key} ({slug}) ==")
    for src, table in mapping.items():
        header, rows = _read_rows(_find(root, src))
        n = cap.get(table)
        if n:
            rows = rows[:n]
        _write(key, table, header, rows)


def build_healthcare():
    key, slug = "healthcare", "ottiliewinterbourne/healthcare-clinic-dataset"
    root = kagglehub.dataset_download(slug)
    print(f"== {key} ({slug}) ==")
    MAX_APPTS = 6000
    ah, arows = _read_rows(_find(root, "appointments.csv"))
    # ids are prefixed (e.g. "A1234") — cap by the numeric suffix.
    def _num(s: str) -> int:
        digits = re.sub(r"\D", "", s or "")
        return int(digits) if digits else 10 ** 12
    arows = [r for r in arows if r and _num(r[0]) <= MAX_APPTS]
    appt_ids = {r[0] for r in arows}
    patient_ids = {r[1] for r in arows}
    _write(key, "appointments", ah, arows)
    # parents
    for src, table, keep_ids, idcol in (
        ("clinics.csv", "clinics", None, 0),
        ("doctors.csv", "doctors", None, 0),
        ("staff.csv", "staff", None, 0),
        ("patients.csv", "patients", patient_ids, 0),
    ):
        h, rows = _read_rows(_find(root, src))
        if keep_ids is not None:
            rows = [r for r in rows if r and r[idcol] in keep_ids]
        _write(key, table, h, rows)
    # children keyed by appointment_id (col 1)
    for src, table in (("payments.csv", "payments"),
                       ("prescriptions.csv", "prescriptions"),
                       ("treatments.csv", "treatments")):
        h, rows = _read_rows(_find(root, src))
        rows = [r for r in rows if len(r) > 1 and r[1] in appt_ids]
        _write(key, table, h, rows)


def build_olympics():
    key, slug = "olympics", "youssefismail20/olympic-games-1994-2024"
    root = kagglehub.dataset_download(slug)
    print(f"== {key} ({slug}) ==")
    combined: list[list[str]] = []
    header = ["games", "noc", "gold", "silver", "bronze", "total"]
    for r, _, files in os.walk(root):
        for f in sorted(files):
            if not f.lower().endswith(".csv"):
                continue
            games = re.sub(r"[_\s]*olympics.*$", "", f, flags=re.IGNORECASE)
            games = re.sub(r"[_]+", " ", games).strip()
            h, rows = _read_rows(os.path.join(r, f))
            for row in rows:
                if len(row) >= 5 and row[0].strip():
                    combined.append([games, *row[:5]])
    _write(key, "nation_medals", header, combined)


def main():
    # coffee shop — 8 small related tables
    copy_plain("coffee_shop", "viramatv/coffee-shop-data", {
        "orders.csv": "orders", "items.csv": "items", "recipe.csv": "recipe",
        "ingredients.csv": "ingredients", "inventory.csv": "inventory",
        "rota.csv": "rota", "shift.csv": "shift", "staff.csv": "staff",
    })
    # finance fraud & loans — relational; cap the big transactions table
    copy_plain("finance_fraud", "testdatabox/finance-fraud-and-loans-dataset-testdatabox", {
        "customers.csv": "customers", "customer_types.csv": "customer_types",
        "addresses.csv": "addresses", "branches.csv": "branches",
        "account_types.csv": "account_types", "account_statuses.csv": "account_statuses",
        "accounts.csv": "accounts", "loan_statuses.csv": "loan_statuses",
        "loans.csv": "loans", "transaction_types.csv": "transaction_types",
        "transactions.csv": "transactions",
    }, cap={"transactions": 12000})
    # WWE events + match ratings
    copy_plain("wwe", "franchise403/wwe-events-and-match-ratings-20152025", {
        "wwe_events.csv": "events", "wwe_match_rating.csv": "match_ratings",
    })
    # gym — the cleaned per-visit table (the rest are pre-aggregated outputs)
    copy_plain("gym", "anetakowalik/gym-members-activity-analysis", {
        "gym_attendance_cleaned_data.csv": "attendance",
    })
    build_healthcare()
    build_olympics()
    print("done.")


if __name__ == "__main__":
    main()
