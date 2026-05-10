"""
Pipeline de ingesta — VERSIÓN REFACTORIZADA.

Responsabilidad única: leer artículos del scraper, generar embedding local con
MiniLM y persistirlo en Postgres (article_embeddings). Punto.

NO hace clustering, naming, NER, ni bias. Eso lo hace /api/cluster/run a partir
de los embeddings ya persistidos.

Orden:
  0. Health check del scraper.
  1. Pull batches con cursor (avanza solo al final).
  2. Filtrar artículos cuyo (medium_slug, guid) ya tiene embedding.
  3. Embedding en batch (in-memory).
  4. Upsert a article_embeddings.
  5. Avanzar cursor + métricas en pipeline_runs (SQLite).

Si crashea entre 1 y 5, el cursor en DB no avanza → próximo run re-pullea
sin pérdida; el filtro de step 2 dedupea contra lo que sí se llegó a guardar.
"""
from __future__ import annotations

import sys
from typing import Optional

from db import get_conn, now_utc_iso, get_kv, set_kv
from embeddings import embed_articles
from pg_store import (
    PostgresUnavailable,
    get_existing_embedding_keys,
    upsert_embeddings,
)
from scraper_client import EPOCH_CURSOR, ScraperUnreachable, health_check, pull_all


def _log_scraper_error(run_id: int, error: str):
    print(f"[scraper_error] run_id={run_id} error={error!r}", file=sys.stderr, flush=True)


def _filter_already_embedded(articles: list[dict]) -> list[dict]:
    """
    Filtra:
      1) Dedup intra-batch por (medium_slug, guid) — el scraper rara vez devuelve
         duplicados pero por las dudas.
      2) Filter contra article_embeddings (Postgres): si ya tenemos embedding,
         skip.
    """
    if not articles:
        return []

    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for a in articles:
        key = (a["medium_slug"], a["guid"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(a)

    existing = get_existing_embedding_keys()
    return [a for a in deduped if (a["medium_slug"], a["guid"]) not in existing]


def _mark_run_error(run_id: int, error_message: str) -> None:
    try:
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?,
                    status = 'error',
                    error_message = ?
                WHERE id = ?
                """,
                [now_utc_iso(), error_message[:500], run_id],
            )
    except Exception:
        print(
            f"[run_error] run_id={run_id} couldn't even mark error: {error_message}",
            file=sys.stderr,
            flush=True,
        )


def run(max_articles: Optional[int] = None) -> dict:
    """
    Orquesta el pipeline de ingesta. Retorna métricas (response del endpoint).
    """
    started_at = now_utc_iso()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO pipeline_runs (run_type, started_at, max_articles_param, status)
            VALUES ('ingest', ?, ?, 'running')
            """,
            [started_at, max_articles],
        )
        run_id = cur.lastrowid

    try:
        return _run_inner(run_id, max_articles)
    except Exception as e:
        import traceback
        traceback.print_exc()
        _mark_run_error(run_id, f"unhandled: {e}")
        return {"run_id": run_id, "status": "error", "error_message": str(e)}


def _run_inner(run_id: int, max_articles: Optional[int]) -> dict:
    # ===== Step 0: health check =====
    try:
        health_check()
    except ScraperUnreachable as e:
        _mark_run_error(run_id, f"scraper_unreachable: {e}")
        return {"run_id": run_id, "status": "error", "error_message": str(e)}

    # ===== Step 1: pull batches =====
    cursor_inicial = get_kv("scraper_cursor", EPOCH_CURSOR)
    if cursor_inicial == "0":
        cursor_inicial = EPOCH_CURSOR
    cursor_actual = cursor_inicial
    articles: list[dict] = []

    try:
        for batch, new_cursor in pull_all(cursor_inicial, max_articles=max_articles):
            articles.extend(batch)
            cursor_actual = new_cursor
    except ScraperUnreachable as e:
        _log_scraper_error(run_id, f"scraper_failed_midpull: {e}")
        # Procesamos lo que tenemos. Cursor avanza solo al final del run.

    if not articles:
        _finalize_run(run_id, processed=0, embedded=0)
        return {
            "run_id": run_id,
            "status": "success",
            "articles_pulled": 0,
            "articles_embedded": 0,
            "message": "no new articles",
        }

    # Skip artículos sin título (no se pueden embedar útilmente)
    articles = [a for a in articles if (a.get("title") or "").strip()]

    # ===== Step 2: filter ya embedados =====
    try:
        articles = _filter_already_embedded(articles)
    except PostgresUnavailable as e:
        _mark_run_error(run_id, f"postgres_unavailable: {e}")
        return {"run_id": run_id, "status": "error", "error_message": str(e)}

    if not articles:
        # Todos ya estaban. Avanzamos cursor igual.
        set_kv("scraper_cursor", cursor_actual)
        _finalize_run(run_id, processed=0, embedded=0)
        return {
            "run_id": run_id,
            "status": "success",
            "articles_pulled": 0,
            "articles_embedded": 0,
            "message": "all already embedded",
        }

    # ===== Step 3: embed =====
    embed_articles(articles)

    # ===== Step 4: upsert =====
    try:
        rows = [(a["medium_slug"], a["guid"], a["embedding"]) for a in articles]
        n_upserted = upsert_embeddings(rows)
    except PostgresUnavailable as e:
        _mark_run_error(run_id, f"postgres_upsert_failed: {e}")
        return {"run_id": run_id, "status": "error", "error_message": str(e)}

    # ===== Step 5: cursor + métricas =====
    set_kv("scraper_cursor", cursor_actual)
    _finalize_run(run_id, processed=len(articles), embedded=n_upserted)

    return {
        "run_id": run_id,
        "status": "success",
        "articles_pulled": len(articles),
        "articles_embedded": n_upserted,
        "cursor": cursor_actual,
    }


def _finalize_run(run_id: int, processed: int, embedded: int) -> None:
    """Cierra pipeline_runs con status=success."""
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE pipeline_runs SET
                finished_at = ?,
                articles_processed = ?,
                articles_embedded = ?,
                status = 'success'
            WHERE id = ?
            """,
            [now_utc_iso(), processed, embedded, run_id],
        )
