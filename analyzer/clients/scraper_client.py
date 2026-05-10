"""
Cliente de la DB Postgres del scraper.

Mismas tres funciones que cuando era HTTP (`health_check`, `fetch_batch`, `pull_all`),
ahora ejecutadas como queries SQL. El resto del pipeline NO cambia.

Diferencias con la versión HTTP:
- El scraper no tiene una columna `id` monotónica, así que usamos `created_at`
  (timestamptz, microsegundos) como cursor.
- Cursor se serializa en kv_store como ISO 8601 string.
- Dedup key local = "{medium_slug}:{guid}" (porque no hay url_canonical en la fuente).
- `source` (display name) viene de un JOIN con la tabla `media`.

Schema esperado del scraper:
    media(slug PK, name, feed_url, base_url, created_at)
    articles(url, guid, medium_slug, title, summary, body, author,
             published_at, language, topics, extraction_path, created_at)
"""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

SCRAPER_DB_URL = os.getenv("SCRAPER_DB_URL")


# Lazy import de psycopg (v3): permite testear el módulo (mockeando fetch_batch)
# sin tener psycopg instalado. El import real ocurre en _conn() la primera
# vez que se necesita una conexión.
def _import_psycopg():
    import psycopg
    from psycopg.rows import dict_row
    return psycopg, dict_row

# Cursor inicial para una DB virgen. Cualquier created_at será > a esto.
EPOCH_CURSOR = "1970-01-01T00:00:00Z"


class ScraperUnreachable(Exception):
    """Postgres no responde / timeout / auth error. Abortar el ingest run."""


@contextmanager
def _conn():
    """
    Conexión efímera por call. Sin pool — para hackatón con runs de minutos
    es OK abrir/cerrar. Si en el futuro hay 100s de calls/seg, sumamos pool.
    """
    if not SCRAPER_DB_URL:
        raise ScraperUnreachable("SCRAPER_DB_URL not configured in .env")
    psycopg, _ = _import_psycopg()
    try:
        c = psycopg.connect(SCRAPER_DB_URL, connect_timeout=5)
        try:
            yield c
        finally:
            c.close()
    except psycopg.Error as e:
        raise ScraperUnreachable(f"postgres connection failed: {e}") from e


def _to_iso_z(dt) -> str | None:
    """TIMESTAMPTZ de Postgres → ISO 8601 con sufijo Z (formato canónico interno)."""
    if dt is None:
        return None
    return dt.isoformat().replace("+00:00", "Z")


def _normalize_row(row: dict) -> dict:
    """
    Mapea una row del SELECT al shape que ingest.py espera (idéntico al que
    devolvía el HTTP scraper, así no tocamos el resto del pipeline).

    Decisiones de mapeo:
    - id: mantenemos created_at como ID lógico (string). ingest.py guarda
      `medium_slug` y `guid` en columnas dedicadas; el `id` que tiene en memoria
      es el cursor temporal del run.
    - source: display name de la tabla media (vía JOIN).
    - content: viene de `body`.
    - url_canonical: "{medium_slug}:{guid}" — clave compuesta del scraper.
    - extraction_method: rename de extraction_path.
    - topics: PG array → JSON string para guardar tal cual en SQLite.
    """
    medium_slug = row["medium_slug"]
    guid = row["guid"]
    return {
        "id": _to_iso_z(row["created_at"]),                  # cursor lógico
        "medium_slug": medium_slug,
        "guid": guid,
        "source": row["source_name"] or medium_slug,         # fallback al slug si JOIN nulo
        "title": row["title"] or "",
        "url": row["url"] or "",
        "url_canonical": f"{medium_slug}:{guid}",            # dedup key local
        "summary": row["summary"],
        "content": row["body"],                              # rename body → content
        "author": row["author"],
        "topics": json.dumps(row["topics"] or [], ensure_ascii=False),  # array → JSON
        "published_at": _to_iso_z(row["published_at"]),
        "scraped_at": _to_iso_z(row["created_at"]),          # alias del campo del scraper
        "extraction_method": row["extraction_path"],         # rename
    }


def health_check() -> dict:
    """
    Verifica conexión y devuelve métricas básicas. Tira ScraperUnreachable
    si falla — el caller (ingest.run) aborta el run sin gastar nada.
    """
    try:
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM articles")
                total = cur.fetchone()[0]
                cur.execute("SELECT MAX(created_at) FROM articles")
                last = cur.fetchone()[0]
    except Exception as e:
        raise ScraperUnreachable(f"health_check failed: {e}") from e
    return {
        "status": "ok",
        "articles_total": total,
        "last_scrape_at": _to_iso_z(last),
    }


def fetch_batch(after_cursor: str, limit: int = 50) -> dict:
    """
    Pide un batch de artículos posteriores al cursor.

    `after_cursor` es ISO 8601 string. `> created_at` strict ya que el orden
    determinístico (created_at, guid) garantiza que no perdemos rows con
    el mismo timestamp si vienen en distintos batches (siempre que cada
    batch tome todos los del mismo timestamp, cosa que el LIMIT puede romper
    en el borde — riesgo aceptado, microsegundo-coincidencia es ~imposible).
    """
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            # Convertir cursor string a timestamptz. Postgres parsea ISO 8601 OK.
            cur.execute(
                """
                SELECT a.url,
                       a.guid,
                       a.medium_slug,
                       a.title,
                       a.summary,
                       a.body,
                       a.author,
                       a.published_at,
                       a.topics,
                       a.extraction_path,
                       a.created_at,
                       m.name AS source_name
                FROM articles a
                LEFT JOIN media m ON m.slug = a.medium_slug
                WHERE a.created_at > %s::timestamptz
                ORDER BY a.created_at ASC, a.guid ASC
                LIMIT %s
                """,
                (after_cursor, limit),
            )
            rows = cur.fetchall()

    articles = [_normalize_row(r) for r in rows]
    next_cursor = articles[-1]["id"] if articles else after_cursor
    # Heurística: si trajimos un batch lleno, probablemente hay más
    has_more = len(articles) >= limit

    return {
        "articles": articles,
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


def pull_all(start_cursor: str, max_articles: int | None = None,
             batch_size: int = 50) -> Iterator[tuple[list[dict], str]]:
    """
    Generator: pullea batches hasta agotar O hasta max_articles.

    Yields (batch_articles, new_cursor) donde new_cursor es ISO string.
    El caller acumula y guarda el cursor en kv_store SOLO al final del run
    (no acá), así si crashea a mitad el cursor en DB no avanza.

    IMPORTANTE: si max_articles recorta el batch, el cursor avanza al `id`
    del último artículo retornado (que es su created_at), no al next_cursor
    del batch entero. Sin esto, próximo run perdería los descartados.
    """
    cursor = start_cursor
    total_collected = 0

    while True:
        data = fetch_batch(cursor, limit=batch_size)
        articles = data["articles"]
        if not articles:
            return

        truncated = False
        if max_articles is not None:
            remaining = max_articles - total_collected
            if remaining <= 0:
                return
            if len(articles) > remaining:
                articles = articles[:remaining]
                truncated = True

        if truncated:
            cursor = articles[-1]["id"]
        else:
            cursor = data["next_cursor"]

        total_collected += len(articles)
        yield articles, cursor

        if max_articles is not None and total_collected >= max_articles:
            return
        if not data.get("has_more", False):
            return
