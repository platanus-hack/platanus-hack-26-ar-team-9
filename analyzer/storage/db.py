"""
SQLite local — solo para state del pipeline.

Después del refactor, los datos de negocio (embeddings, events, event_articles)
viven en Postgres (ver storage/pg_store.py + schema/postgres_schema.sql). SQLite queda solo
para:
  - pipeline_runs: auditoría de runs (cuántos artículos se procesaron, cuándo, etc.)
  - kv_store: scraper_cursor (timestamp del último artículo procesado)

Decisiones:
- Cada thread abre su propia conexión.
- WAL mode para reads concurrentes.
- Schema idempotente: corre al arrancar el server.
- Timestamps en UTC ISO 8601 con sufijo Z.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "data" / "news.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                   INTEGER PRIMARY KEY,
    run_type             TEXT NOT NULL,                  -- 'ingest' | 'cluster' | 'axioma'
    started_at           TIMESTAMP NOT NULL,
    finished_at          TIMESTAMP,
    max_articles_param   INTEGER,
    articles_processed   INTEGER DEFAULT 0,
    articles_embedded    INTEGER DEFAULT 0,
    events_persisted     INTEGER DEFAULT 0,
    k_chosen             INTEGER,
    silhouette           REAL,
    status               TEXT,
    error_message        TEXT
);

CREATE TABLE IF NOT EXISTS kv_store (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


def now_utc_iso() -> str:
    """ISO 8601 UTC con sufijo Z. Único formato de timestamp en toda la app."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@contextmanager
def get_conn():
    """Conexión nueva por thread, autocommit."""
    conn = sqlite3.connect(str(DB_PATH), timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction():
    """Bloque atómico multi-statement. Excepción → ROLLBACK."""
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


def init_schema():
    """
    Idempotente. Corre al arrancar el server.

    Si existe una DB vieja (pre-refactor) con tablas obsoletas (events,
    articles, axioma_results), las dejamos en paz — no estorban porque ya
    nadie las consulta. Si querés DB limpia: borrá analyzer/data/news.db.
    """
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        conn.execute(
            "INSERT OR IGNORE INTO kv_store (key, value) VALUES ('scraper_cursor', '1970-01-01T00:00:00Z')"
        )
        # Mini-migración: agregar columnas nuevas si la tabla pipeline_runs viene
        # del schema viejo. SQLite no soporta ADD COLUMN IF NOT EXISTS, así que
        # try/except por columna.
        for col_def in (
            ("articles_embedded", "INTEGER DEFAULT 0"),
            ("events_persisted",  "INTEGER DEFAULT 0"),
            ("k_chosen",          "INTEGER"),
            ("silhouette",        "REAL"),
        ):
            try:
                conn.execute(f"ALTER TABLE pipeline_runs ADD COLUMN {col_def[0]} {col_def[1]}")
            except sqlite3.OperationalError:
                pass  # ya existe


def get_kv(key: str, default: str = "0") -> str:
    """Leer del kv_store. Retorna default si no existe."""
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM kv_store WHERE key = ?", [key]).fetchone()
        return row["value"] if row else default


def set_kv(key: str, value: str):
    """Upsert al kv_store."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO kv_store (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,
                                          updated_at=CURRENT_TIMESTAMP
            """,
            [key, value],
        )
