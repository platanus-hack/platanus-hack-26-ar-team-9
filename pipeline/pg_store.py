"""
Persistencia en Postgres para nuestras tablas (article_embeddings, events,
event_articles, event_details, topic_centroids). Misma DB que el scraper,
otra capa lógica.

scraper_client.py = read-only sobre articles/media.
pg_store.py       = read+write sobre nuestras tablas.

Schema alineado al contrato del frontend (contrato-bdd/schema.sql). Eventos
con id TEXT (slug-like). topic_centroids y event_details quedan como placeholder
hasta sus iteraciones (etapa 2 y 3).

Conexión efímera por call. Sin pool — para hackatón con runs de minutos
alcanza. psycopg v3 (no psycopg2).
"""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable

import numpy as np
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

SCRAPER_DB_URL = os.getenv("SCRAPER_DB_URL")


class PostgresUnavailable(Exception):
    """Postgres no responde. Caller decide qué hacer."""


def _import_psycopg():
    import psycopg
    from psycopg.rows import dict_row
    return psycopg, dict_row


@contextmanager
def _conn():
    if not SCRAPER_DB_URL:
        raise PostgresUnavailable("SCRAPER_DB_URL not configured in .env")
    psycopg, _ = _import_psycopg()
    try:
        c = psycopg.connect(SCRAPER_DB_URL, connect_timeout=5)
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()
    except psycopg.Error as e:
        raise PostgresUnavailable(f"postgres connection failed: {e}") from e


# ---------------------------------------------------------------------------
# article_embeddings
# ---------------------------------------------------------------------------

def get_existing_embedding_keys() -> set[tuple[str, str]]:
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute("SELECT medium_slug, guid FROM article_embeddings")
            return {(r[0], r[1]) for r in cur.fetchall()}


def upsert_embeddings(rows: Iterable[tuple[str, str, np.ndarray]]) -> int:
    payload = [
        (slug, guid, emb.astype(np.float32).tobytes())
        for slug, guid, emb in rows
    ]
    if not payload:
        return 0

    with _conn() as c:
        with c.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO article_embeddings (medium_slug, guid, embedding)
                VALUES (%s, %s, %s)
                ON CONFLICT (medium_slug, guid) DO UPDATE SET
                    embedding = EXCLUDED.embedding,
                    embedded_at = NOW()
                """,
                payload,
            )
    return len(payload)


def load_all_embeddings() -> tuple[list[tuple[str, str]], np.ndarray, list[str]]:
    """
    Lee todos los embeddings JOIN articles para títulos.
    Retorna (keys, matrix, titles).
    """
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT ae.medium_slug, ae.guid, ae.embedding, a.title
                FROM article_embeddings ae
                JOIN articles a USING (medium_slug, guid)
                """
            )
            rows = cur.fetchall()

    if not rows:
        return [], np.zeros((0, 0), dtype=np.float32), []

    keys = [(r["medium_slug"], r["guid"]) for r in rows]
    titles = [r["title"] or "" for r in rows]
    vectors = [np.frombuffer(bytes(r["embedding"]), dtype=np.float32) for r in rows]
    matrix = np.vstack(vectors)
    return keys, matrix, titles


# ---------------------------------------------------------------------------
# events + event_articles (TRUNCATE + INSERT por run)
# ---------------------------------------------------------------------------

def replace_events(
    events: list[dict],
    memberships: list[tuple[str, str, str]],
) -> None:
    """
    Atómico: TRUNCATE events (CASCADE limpia event_articles + event_details),
    INSERT events con todos los campos del contrato, INSERT memberships.

    `events`: list[{
        "id":               str,                 # = slug, único
        "slug":             str,
        "title":            str,
        "x":                float,
        "y":                float,
        "media_count":      int,
        "media_sources":    list[str],
        "keywords":         list[str],
        "summary":          str | None,
        "article_count":    int,
        "k_chosen":         int,
        "silhouette":       float | None,
        "published_at":     str | None,           # ISO timestamp del MAX(published_at) del cluster
    }]
    `memberships`: list[(event_id, medium_slug, guid)]

    `divergence` y `divergence_band` quedan en sus DEFAULT (0 / 'low') hasta
    que axioma los recalcule. `topic_centroid_id` queda NULL hasta etapa 2.
    """
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute("TRUNCATE events CASCADE")

            for ev in events:
                cur.execute(
                    """
                    INSERT INTO events (
                        id, slug, title, x, y,
                        media_count, media_sources, keywords, summary,
                        article_count, k_chosen, silhouette, published_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, COALESCE(%s, NOW())
                    )
                    """,
                    (
                        ev["id"],
                        ev["slug"],
                        ev["title"],
                        float(ev["x"]),
                        float(ev["y"]),
                        int(ev["media_count"]),
                        ev["media_sources"],
                        ev["keywords"],
                        ev.get("summary"),
                        int(ev["article_count"]),
                        int(ev["k_chosen"]) if ev.get("k_chosen") is not None else None,
                        float(ev["silhouette"]) if ev.get("silhouette") is not None else None,
                        ev.get("published_at"),
                    ),
                )

            if memberships:
                cur.executemany(
                    """
                    INSERT INTO event_articles (event_id, medium_slug, guid)
                    VALUES (%s, %s, %s)
                    """,
                    memberships,
                )


def fetch_cluster_metadata(memberships_by_event: dict[str, list[tuple[str, str]]]) -> dict[str, dict]:
    """
    Para cada event_id, calcula los campos derivables a partir de los artículos
    del cluster:
      - media_count         = COUNT DISTINCT medium_slug
      - media_sources       = ARRAY DISTINCT medium.name (o slug si name NULL)
      - keywords            = topics agregados, top-N por frecuencia
      - published_at        = MAX(articles.published_at)
    """
    if not memberships_by_event:
        return {}

    all_keys = [(slug, guid) for ms in memberships_by_event.values() for (slug, guid) in ms]
    if not all_keys:
        return {}

    _, dict_row = _import_psycopg()
    article_meta: dict[tuple[str, str], dict] = {}
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT a.medium_slug, a.guid, a.published_at, a.topics,
                       COALESCE(m.name, a.medium_slug) AS source
                FROM articles a
                LEFT JOIN media m ON m.slug = a.medium_slug
                JOIN unnest(%s::text[], %s::text[]) AS x(slug_q, guid_q)
                  ON x.slug_q = a.medium_slug AND x.guid_q = a.guid
                """,
                ([k[0] for k in all_keys], [k[1] for k in all_keys]),
            )
            for r in cur.fetchall():
                article_meta[(r["medium_slug"], r["guid"])] = {
                    "published_at": r["published_at"],
                    "topics": r["topics"] or [],
                    "source": r["source"],
                }

    out: dict[str, dict] = {}
    for event_id, ms in memberships_by_event.items():
        sources: list[str] = []
        topic_freq: dict[str, int] = {}
        published_max = None
        for (slug, guid) in ms:
            meta = article_meta.get((slug, guid))
            if not meta:
                continue
            if meta["source"] not in sources:
                sources.append(meta["source"])
            for t in meta["topics"]:
                topic_freq[t] = topic_freq.get(t, 0) + 1
            if meta["published_at"] and (published_max is None or meta["published_at"] > published_max):
                published_max = meta["published_at"]

        keywords = sorted(topic_freq.items(), key=lambda kv: (-kv[1], kv[0]))
        keywords = [k for k, _ in keywords[:8]]

        out[event_id] = {
            "media_count": len(sources),
            "media_sources": sources,
            "keywords": keywords,
            "published_at": published_max.isoformat() if published_max else None,
        }
    return out


def get_dashboard_events() -> list[dict]:
    """Eventos persistidos + sus artículos. Para /api/dashboard."""
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, slug, topic_centroid_id, title, x, y,
                       media_count, divergence, divergence_band,
                       summary, keywords, media_sources,
                       article_count, k_chosen, silhouette, published_at
                FROM events
                ORDER BY media_count DESC, article_count DESC, id ASC
                """
            )
            events = [dict(r) for r in cur.fetchall()]

            for ev in events:
                cur.execute(
                    """
                    SELECT a.title, a.url, COALESCE(m.name, a.medium_slug) AS source
                    FROM event_articles ea
                    JOIN articles a USING (medium_slug, guid)
                    LEFT JOIN media m ON m.slug = a.medium_slug
                    WHERE ea.event_id = %s
                    ORDER BY a.published_at DESC NULLS LAST
                    """,
                    (ev["id"],),
                )
                ev["articles"] = [dict(r) for r in cur.fetchall()]

    return events


def get_event_by_slug(slug: str) -> dict | None:
    """Detalle de un evento + axioma (si existe). Para /api/analyze/<slug>."""
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT e.id, e.slug, e.topic_centroid_id, e.title, e.x, e.y,
                       e.media_count, e.divergence, e.divergence_band,
                       e.summary, e.keywords, e.media_sources,
                       e.article_count, e.k_chosen, e.silhouette, e.published_at,
                       d.verdad_consensuada, d.datos_aislados, d.contradicciones, d.updated_at AS axioma_updated_at
                FROM events e
                LEFT JOIN event_details d ON d.event_id = e.id
                WHERE e.slug = %s
                """,
                (slug,),
            )
            row = cur.fetchone()
            if not row:
                return None
            ev = dict(row)

            cur.execute(
                """
                SELECT a.title, a.url, a.summary, a.author, a.published_at,
                       COALESCE(m.name, a.medium_slug) AS source
                FROM event_articles ea
                JOIN articles a USING (medium_slug, guid)
                LEFT JOIN media m ON m.slug = a.medium_slug
                WHERE ea.event_id = %s
                ORDER BY a.published_at DESC NULLS LAST
                """,
                (ev["id"],),
            )
            ev["articles"] = [dict(r) for r in cur.fetchall()]
    return ev


# ---------------------------------------------------------------------------
# topic_centroids (etapa 2 — meta-clustering)
# ---------------------------------------------------------------------------

def load_event_centroids() -> tuple[list[str], np.ndarray, dict[str, list[str]], dict[str, tuple[float, float]]]:
    """
    Para /api/topics/run.

    Retorna:
      - event_ids: list[str], ordenados.
      - centroids: np.ndarray (N_events, 384) — para hacer KMeans nivel 2.
      - titles_by_event: dict[event_id, list[str]] para naming.
      - xy_by_event: dict[event_id, (x, y)] coords 2D YA proyectadas que viven
        en `events`. Las usamos para que el x/y del topic sea el promedio de
        los x/y de sus events miembros, garantizando alineación visual entre
        topics y events en el mismo plano.
    """
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT e.id AS event_id, e.title AS event_title, e.x, e.y,
                       ae.embedding, a.title AS article_title
                FROM events e
                JOIN event_articles ea ON ea.event_id = e.id
                JOIN article_embeddings ae USING (medium_slug, guid)
                JOIN articles a USING (medium_slug, guid)
                ORDER BY e.id
                """
            )
            rows = cur.fetchall()

    if not rows:
        return [], np.zeros((0, 0), dtype=np.float32), {}, {}

    embeddings_by_event: dict[str, list[np.ndarray]] = {}
    titles_by_event: dict[str, list[str]] = {}
    event_titles: dict[str, str] = {}
    xy_by_event: dict[str, tuple[float, float]] = {}
    for r in rows:
        eid = r["event_id"]
        emb = np.frombuffer(bytes(r["embedding"]), dtype=np.float32)
        embeddings_by_event.setdefault(eid, []).append(emb)
        titles_by_event.setdefault(eid, []).append(r["article_title"] or "")
        event_titles[eid] = r["event_title"]
        xy_by_event[eid] = (float(r["x"]), float(r["y"]))

    event_ids = sorted(embeddings_by_event.keys())
    centroids = np.vstack([
        np.mean(embeddings_by_event[eid], axis=0) for eid in event_ids
    ])

    naming_titles: dict[str, list[str]] = {}
    for eid in event_ids:
        ev_title = event_titles.get(eid)
        if ev_title:
            naming_titles[eid] = [ev_title]
        else:
            naming_titles[eid] = titles_by_event[eid][:3]

    return event_ids, centroids, naming_titles, xy_by_event


def replace_topic_centroids(
    topics: list[dict],
    event_to_topic: dict[str, str],
) -> None:
    """
    Atómico: limpia topic_centroids (FK SET NULL en events.topic_centroid_id),
    INSERT topics, UPDATE events.topic_centroid_id.

    `topics`: list[{
        "id":              str,
        "label":           str,
        "x":               float,
        "y":               float,
        "volume":          int,
        "summary":         str | None,
        "avg_divergence":  float,        # 0 hasta axioma
        "color_band":      'low'|'medium'|'high',
    }]
    `event_to_topic`: {event_id: topic_id}  — debe cubrir TODOS los events.
    """
    with _conn() as c:
        with c.cursor() as cur:
            # ON DELETE SET NULL en events.topic_centroid_id se dispara con DELETE
            # (TRUNCATE saltearía el trigger / requeriría CASCADE).
            cur.execute("DELETE FROM topic_centroids")

            for t in topics:
                cur.execute(
                    """
                    INSERT INTO topic_centroids (
                        id, label, x, y, volume,
                        avg_divergence, color_band, summary, generated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, NOW()
                    )
                    """,
                    (
                        t["id"],
                        t["label"],
                        float(t["x"]),
                        float(t["y"]),
                        int(t.get("volume", 0)),
                        float(t.get("avg_divergence", 0.0)),
                        t.get("color_band", "low"),
                        t.get("summary"),
                    ),
                )

            if event_to_topic:
                cur.executemany(
                    "UPDATE events SET topic_centroid_id = %s WHERE id = %s",
                    [(topic_id, event_id) for event_id, topic_id in event_to_topic.items()],
                )


# ---------------------------------------------------------------------------
# event_details (axioma) — placeholder, se popula en /api/axioma/run
# ---------------------------------------------------------------------------

def get_topic_centroids() -> list[dict]:
    """Lista de gigacentroides para /api/topics (= get_giga_centroids del contrato)."""
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, label, x, y, volume, avg_divergence, color_band, summary, generated_at
                FROM topic_centroids
                ORDER BY volume DESC, label ASC
                """
            )
            return [dict(r) for r in cur.fetchall()]


def get_events_by_topic(topic_centroid_id: str) -> list[dict]:
    """Eventos de un topic dado, para /api/topics/<id>/events (= get_centroid_events del contrato)."""
    _, dict_row = _import_psycopg()
    with _conn() as c:
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, slug, title, x, y, media_count, divergence, divergence_band,
                       summary, keywords, media_sources, published_at,
                       article_count
                FROM events
                WHERE topic_centroid_id = %s
                ORDER BY media_count DESC, article_count DESC, published_at DESC
                """,
                (topic_centroid_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def load_events_for_axioma(min_sources: int = 2) -> list[dict]:
    """
    Para /api/axioma/run.
    Devuelve eventos con sus articles (source/title/body) en UNA sola query
    (antes era N+1 — colgaba con 130+ events vía pooler de Supabase).

    Solo events con `media_count >= min_sources`.
    """
    import sys
    import time as _t

    _, dict_row = _import_psycopg()
    t0 = _t.time()
    print(f"[load_axioma] connecting to DB...", flush=True)

    with _conn() as c:
        print(f"[load_axioma] connected in {_t.time()-t0:.2f}s, querying events...", flush=True)
        t1 = _t.time()
        with c.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                SELECT id, title, media_count
                FROM events
                WHERE media_count >= %s
                ORDER BY media_count DESC, article_count DESC
                """,
                (min_sources,),
            )
            events = [dict(r) for r in cur.fetchall()]
            print(f"[load_axioma] {len(events)} events fetched in {_t.time()-t1:.2f}s", flush=True)

            if not events:
                return events

            # 1 sola query para TODOS los articles de TODOS los events.
            # Reemplaza el N+1 que con pooler + 131 events colgaba.
            t2 = _t.time()
            event_ids = [e["id"] for e in events]
            cur.execute(
                """
                SELECT ea.event_id,
                       a.title, a.body, a.summary,
                       COALESCE(m.name, a.medium_slug) AS source
                FROM event_articles ea
                JOIN articles a USING (medium_slug, guid)
                LEFT JOIN media m ON m.slug = a.medium_slug
                WHERE ea.event_id = ANY(%s)
                ORDER BY ea.event_id, a.published_at DESC NULLS LAST
                """,
                (event_ids,),
            )
            articles_rows = cur.fetchall()
            print(
                f"[load_axioma] {len(articles_rows)} articles fetched "
                f"in {_t.time()-t2:.2f}s ({len(articles_rows)/max(len(events),1):.1f}/event)",
                flush=True,
            )

    # Group articles by event_id en memoria (Python rápido).
    articles_by_event: dict[str, list[dict]] = {}
    for r in articles_rows:
        d = dict(r)
        eid = d.pop("event_id")
        articles_by_event.setdefault(eid, []).append(d)

    for ev in events:
        ev["articles"] = articles_by_event.get(ev["id"], [])

    print(f"[load_axioma] DONE in {_t.time()-t0:.2f}s total", flush=True)
    return events


def update_event_divergence(event_id: str, divergence: float) -> None:
    """
    Recalcula divergence/divergence_band en events después de axioma.

    Umbrales más estrictos para mostrar la divergencia editorial real del feed
    argentino — los medios casi siempre tienen sesgo, así que el piso de "high"
    es bajo a propósito.

    Bands: <0.15 → low, [0.15, 0.4) → medium, ≥0.4 → high.
    """
    div = max(0.0, min(1.0, float(divergence)))
    if div < 0.15:
        band = "low"
    elif div < 0.4:
        band = "medium"
    else:
        band = "high"

    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                "UPDATE events SET divergence = %s, divergence_band = %s WHERE id = %s",
                (div, band, event_id),
            )


def refresh_topic_aggregates() -> int:
    """
    Recalcula avg_divergence y color_band de cada topic_centroid en base al
    AVG(divergence) de sus events. Llamar al final de axioma (cuando los
    events.divergence ya están actualizados).

    Bandas usan los mismos umbrales que los events:
      <0.15 → low, [0.15, 0.4) → medium, ≥0.4 → high.

    Retorna la cantidad de topics actualizados.
    """
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                """
                UPDATE topic_centroids tc
                SET avg_divergence = COALESCE(agg.avg_div, 0),
                    color_band = CASE
                        WHEN COALESCE(agg.avg_div, 0) < 0.15 THEN 'low'
                        WHEN COALESCE(agg.avg_div, 0) < 0.4  THEN 'medium'
                        ELSE 'high'
                    END
                FROM (
                    SELECT topic_centroid_id, AVG(divergence)::real AS avg_div
                    FROM events
                    WHERE topic_centroid_id IS NOT NULL
                    GROUP BY topic_centroid_id
                ) agg
                WHERE tc.id = agg.topic_centroid_id
                """,
            )
            return cur.rowcount


def upsert_event_details(
    event_id: str,
    verdad_consensuada: list[str],
    datos_aislados: list[dict],
    contradicciones: list[dict],
) -> None:
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                """
                INSERT INTO event_details (event_id, verdad_consensuada, datos_aislados, contradicciones, updated_at)
                VALUES (%s, %s, %s::jsonb, %s::jsonb, NOW())
                ON CONFLICT (event_id) DO UPDATE SET
                    verdad_consensuada = EXCLUDED.verdad_consensuada,
                    datos_aislados     = EXCLUDED.datos_aislados,
                    contradicciones    = EXCLUDED.contradicciones,
                    updated_at         = NOW()
                """,
                (
                    event_id,
                    verdad_consensuada,
                    json.dumps(datos_aislados, ensure_ascii=False),
                    json.dumps(contradicciones, ensure_ascii=False),
                ),
            )
