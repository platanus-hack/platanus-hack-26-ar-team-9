"""
Tests del módulo db: schema init, kv_store, transacciones.

Usamos la DB real del proyecto (analyzer/data/news.db). Init es idempotente,
no rompe data existente.

Para correr:  pytest analyzer/tests/test_db.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from storage.db import (  # noqa: E402
    get_conn,
    get_kv,
    init_schema,
    now_utc_iso,
    set_kv,
    transaction,
)


def test_init_schema_idempotent():
    """init_schema corre dos veces seguidas sin tirar error."""
    init_schema()
    init_schema()  # segunda vez no rompe


def test_kv_store_default():
    """get_kv con key inexistente devuelve el default."""
    init_schema()
    val = get_kv("__test_key_does_not_exist__", default="42")
    assert val == "42"


def test_kv_store_upsert():
    init_schema()
    set_kv("__test_key__", "first")
    assert get_kv("__test_key__") == "first"
    set_kv("__test_key__", "second")
    assert get_kv("__test_key__") == "second"


def test_kv_store_scraper_cursor_initialized():
    """init_schema debe insertar el scraper_cursor (ISO 8601 string)."""
    init_schema()
    val = get_kv("scraper_cursor")
    # Puede haber sido modificado por un run previo, pero al menos debe existir
    assert val is not None
    # Default = "1970-01-01T00:00:00Z" o un timestamp ISO 8601 después de runs
    assert isinstance(val, str) and len(val) > 0


def test_now_utc_iso_format():
    """now_utc_iso devuelve ISO 8601 con sufijo Z (UTC)."""
    s = now_utc_iso()
    assert s.endswith("Z")
    assert "T" in s


def test_transaction_rolls_back_on_exception():
    """Si tira excepción dentro de transaction, se rollbackeа."""
    init_schema()
    set_kv("__rollback_test__", "before")

    try:
        with transaction() as conn:
            conn.execute(
                """
                INSERT INTO kv_store (key, value, updated_at)
                VALUES ('__rollback_test__', 'after', CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )
            raise RuntimeError("forced")
    except RuntimeError:
        pass

    # El UPDATE no debió persistir
    assert get_kv("__rollback_test__") == "before"


def test_schema_has_all_expected_tables():
    """SQLite local solo guarda pipeline_runs y kv_store post-refactor."""
    init_schema()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
    tables = {r["name"] for r in rows}
    assert "pipeline_runs" in tables
    assert "kv_store" in tables
