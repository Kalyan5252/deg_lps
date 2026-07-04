from __future__ import annotations

from app import sandbox


def test_infer_relations_from_foreign_key_style_columns():
    tables = [
        {
            "name": "customers",
            "row_count": 10,
            "columns": [
                {"name": "id", "type": "BIGINT", "pk": True},
                {"name": "email", "type": "TEXT", "pk": False},
            ],
        },
        {
            "name": "orders",
            "row_count": 20,
            "columns": [
                {"name": "id", "type": "BIGINT", "pk": True},
                {"name": "customer_id", "type": "BIGINT", "pk": False},
            ],
        },
        {
            "name": "order_items",
            "row_count": 30,
            "columns": [
                {"name": "id", "type": "BIGINT", "pk": True},
                {"name": "order_id", "type": "BIGINT", "pk": False},
            ],
        },
    ]

    assert sandbox._infer_relations(tables) == [
        {
            "from_table": "orders",
            "from_col": "customer_id",
            "to_table": "customers",
            "to_col": "id",
        },
        {
            "from_table": "order_items",
            "from_col": "order_id",
            "to_table": "orders",
            "to_col": "id",
        },
    ]


def test_display_type_normalizes_postgres_types_for_canvas():
    assert sandbox._display_type("bigint") == "BIGINT"
    assert sandbox._display_type("timestamp with time zone") == "TIMESTAMP"
    assert sandbox._display_type("character varying") == "TEXT"
