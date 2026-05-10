#!/usr/bin/env python3
"""
Flask API — Axioma Protocol pipeline (refactor).

Endpoints:
  GET  /                         → sirve index.html
  POST /api/ingest/run           → pull del scraper + embedding local + persist en Postgres
  POST /api/cluster/run          → KMeans + silhouette sweep + PCA 2D + naming → events
  POST /api/axioma/run           → 501 (iteración 2)
  GET  /api/dashboard            → eventos persistidos en Postgres con sus artículos
  GET  /api/analyze/<event_id>   → detalle de un evento
  GET  /api/runs                 → últimas N corridas de pipeline_runs
  GET  /api/cursor               → ver cursor del scraper
  POST /api/cursor?to=...        → setear cursor

Run: python server.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from db import get_conn, init_schema, now_utc_iso
import axioma
import ingest
import kmeans_clustering
import pg_store
import topics_clustering

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv(Path(__file__).resolve().parent / ".env")

app = Flask(__name__)
CORS(app)

init_schema()
print("[server] SQLite initialized at", Path(__file__).resolve().parent / "data" / "news.db")


# =============================================================================
# Pipeline endpoints
# =============================================================================

@app.route("/api/ingest/run", methods=["POST"])
def ingest_run():
    """
    Ingest: pull del scraper + embedding local + upsert en Postgres.

    Query params:
      - max_articles=N: limita la cantidad pulleada (testing).
    """
    max_articles_arg = request.args.get("max_articles")
    max_articles = int(max_articles_arg) if max_articles_arg else None

    print(f"\n[ingest] starting (max_articles={max_articles})...", flush=True)
    try:
        result = ingest.run(max_articles=max_articles)
        print(f"[ingest] done: {result}", flush=True)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": "ingest_failed", "detail": str(e)}), 500


@app.route("/api/cluster/run", methods=["POST"])
def cluster_run():
    """
    Clustering: lee article_embeddings, KMeans con sweep de K (silhouette),
    PCA 2D, naming con Haiku. TRUNCATE + INSERT en events + event_articles.

    Query params:
      - force_k=N: salta el sweep, usa N como K (testing manual).
    """
    force_k_arg = request.args.get("force_k")
    force_k = int(force_k_arg) if force_k_arg else None

    started_at = now_utc_iso()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO pipeline_runs (run_type, started_at, status) VALUES ('cluster', ?, 'running')",
            [started_at],
        )
        run_id = cur.lastrowid

    print(f"\n[cluster] starting run_id={run_id} force_k={force_k}...", flush=True)
    try:
        result = kmeans_clustering.run(force_k=force_k)
        result["run_id"] = run_id

        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?,
                    events_persisted = ?,
                    k_chosen = ?,
                    silhouette = ?,
                    status = ?
                WHERE id = ?
                """,
                [
                    now_utc_iso(),
                    result.get("events_persisted", 0),
                    result.get("k_chosen"),
                    result.get("silhouette"),
                    result.get("status", "success"),
                    run_id,
                ],
            )
        print(f"[cluster] done: {result}", flush=True)
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?, status = 'error', error_message = ?
                WHERE id = ?
                """,
                [now_utc_iso(), str(e)[:500], run_id],
            )
        return jsonify({"error": "cluster_failed", "detail": str(e), "run_id": run_id}), 500


@app.route("/api/topics/run", methods=["POST"])
def topics_run():
    """
    Etapa 2: meta-clustering. Lee centroides de los events (computados como
    mean de los embeddings de sus articles), corre KMeans nivel 2 con sweep
    silhouette, llama a Haiku para nombrar cada meta-cluster como una categoría
    noticiera, persiste en topic_centroids y actualiza events.topic_centroid_id.

    Query params:
      - force_k=N: salta el sweep, usa N como K (testing manual).
    """
    force_k_arg = request.args.get("force_k")
    force_k = int(force_k_arg) if force_k_arg else None

    started_at = now_utc_iso()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO pipeline_runs (run_type, started_at, status) VALUES ('topics', ?, 'running')",
            [started_at],
        )
        run_id = cur.lastrowid

    print(f"\n[topics] starting run_id={run_id} force_k={force_k}...", flush=True)
    try:
        result = topics_clustering.run(force_k=force_k)
        result["run_id"] = run_id

        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?,
                    events_persisted = ?,
                    k_chosen = ?,
                    silhouette = ?,
                    status = ?
                WHERE id = ?
                """,
                [
                    now_utc_iso(),
                    result.get("topics_persisted", 0),
                    result.get("k_chosen"),
                    result.get("silhouette"),
                    result.get("status", "success"),
                    run_id,
                ],
            )
        print(f"[topics] done: {result}", flush=True)
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?, status = 'error', error_message = ?
                WHERE id = ?
                """,
                [now_utc_iso(), str(e)[:500], run_id],
            )
        return jsonify({"error": "topics_failed", "detail": str(e), "run_id": run_id}), 500


@app.route("/api/axioma/run", methods=["POST"])
def axioma_run():
    """
    Síntesis cross-fuente (Axioma Protocol). Para cada evento con >= 2 fuentes,
    llama a Sonnet con los summaries y persiste en event_details. Recalcula
    divergence/divergence_band en events.
    """
    started_at = now_utc_iso()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO pipeline_runs (run_type, started_at, status) VALUES ('axioma', ?, 'running')",
            [started_at],
        )
        run_id = cur.lastrowid

    print(f"\n[axioma] starting run_id={run_id}...", flush=True)
    try:
        result = axioma.run()
        result["run_id"] = run_id

        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?,
                    events_persisted = ?,
                    status = ?
                WHERE id = ?
                """,
                [
                    now_utc_iso(),
                    result.get("events_persisted", 0),
                    result.get("status", "success"),
                    run_id,
                ],
            )
        print(f"[axioma] done: persisted={result.get('events_persisted')} failed={result.get('events_failed')}", flush=True)
        return jsonify(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE pipeline_runs SET
                    finished_at = ?, status = 'error', error_message = ?
                WHERE id = ?
                """,
                [now_utc_iso(), str(e)[:500], run_id],
            )
        return jsonify({"error": "axioma_failed", "detail": str(e), "run_id": run_id}), 500


@app.route("/api/cursor", methods=["GET"])
def cursor_get():
    from db import get_kv
    return jsonify({"scraper_cursor": get_kv("scraper_cursor", "1970-01-01T00:00:00Z")})


@app.route("/api/cursor", methods=["POST"])
def cursor_set():
    """
    Setea el cursor del scraper.
      - ?to=2026-05-09T00:00:00Z → saltar data vieja
      - ?to=now → usar timestamp actual
    """
    from db import set_kv
    to_arg = (request.args.get("to") or "").strip()
    if not to_arg:
        return jsonify({"error": "missing 'to' query param"}), 400
    if to_arg.lower() == "now":
        to_arg = now_utc_iso()
    set_kv("scraper_cursor", to_arg)
    return jsonify({"scraper_cursor": to_arg})


@app.route("/api/runs", methods=["GET"])
def runs():
    limit = int(request.args.get("limit", 10))
    run_type = request.args.get("type")  # 'ingest' | 'cluster' | 'axioma' | None

    sql = "SELECT * FROM pipeline_runs"
    params: list = []
    if run_type:
        sql += " WHERE run_type = ?"
        params.append(run_type)
    sql += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return jsonify({"runs": [dict(r) for r in rows]})


# =============================================================================
# Consumption endpoints (frontend)
# =============================================================================

@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/api/dashboard")
def dashboard():
    """
    Eventos persistidos en Postgres con todos los campos del contrato del
    frontend (slug, media_count, divergence, keywords, media_sources, etc.) +
    sus artículos para inspección rápida.
    """
    try:
        events = pg_store.get_dashboard_events()
    except pg_store.PostgresUnavailable as e:
        return jsonify({"error": "postgres_unavailable", "detail": str(e)}), 503

    eventos_out = []
    for ev in events:
        articles = ev.get("articles", [])
        eventos_out.append({
            "id":                ev["id"],
            "slug":              ev["slug"],
            "topic_centroid_id": ev.get("topic_centroid_id"),
            "title":             ev["title"],
            "x":                 ev["x"],
            "y":                 ev["y"],
            "media_count":       ev["media_count"],
            "divergence":        ev["divergence"],
            "divergence_band":   ev["divergence_band"],
            "summary":           ev.get("summary"),
            "keywords":          ev.get("keywords") or [],
            "media_sources":     ev.get("media_sources") or [],
            "published_at":      ev["published_at"].isoformat() if ev.get("published_at") else None,
            # internal pipeline metadata (no en contrato)
            "article_count":     ev["article_count"],
            "k_chosen":          ev.get("k_chosen"),
            "silhouette":        ev.get("silhouette"),
            "titulares":         [a["title"] for a in articles[:3]],
            "url":               articles[0]["url"] if articles else "",
        })

    return jsonify({
        "generated_at":    now_utc_iso(),
        "total_eventos":   len(eventos_out),
        "total_articulos": sum(ev["article_count"] for ev in eventos_out),
        "eventos":         eventos_out,
    })


@app.route("/api/topics", methods=["GET"])
def topics_list():
    """Gigacentroides — equivalente al get_giga_centroids del contrato."""
    try:
        topics = pg_store.get_topic_centroids()
    except pg_store.PostgresUnavailable as e:
        return jsonify({"error": "postgres_unavailable", "detail": str(e)}), 503

    return jsonify({
        "generated_at": now_utc_iso(),
        "centroids": [
            {
                "id":             t["id"],
                "label":          t["label"],
                "x":              t["x"],
                "y":              t["y"],
                "volume":         t["volume"],
                "avg_divergence": t["avg_divergence"],
                "color_band":     t["color_band"],
                "summary":        t["summary"],
            }
            for t in topics
        ],
    })


@app.route("/api/topics/<centroid_id>/events", methods=["GET"])
def topic_events(centroid_id: str):
    """Eventos de un topic — equivalente al get_centroid_events del contrato."""
    try:
        events = pg_store.get_events_by_topic(centroid_id)
    except pg_store.PostgresUnavailable as e:
        return jsonify({"error": "postgres_unavailable", "detail": str(e)}), 503

    return jsonify({
        "centroid_id": centroid_id,
        "events": [
            {
                "id":              ev["id"],
                "slug":            ev["slug"],
                "title":           ev["title"],
                "x":               ev["x"],
                "y":               ev["y"],
                "media_count":     ev["media_count"],
                "divergence":      ev["divergence"],
                "divergence_band": ev["divergence_band"],
                "summary":         ev["summary"],
                "keywords":        ev.get("keywords") or [],
            }
            for ev in events
        ],
    })


@app.route("/api/events/<slug>", methods=["GET"])
@app.route("/api/analyze/<slug>", methods=["GET"])
def event_detail(slug: str):
    """
    Detalle de un evento por slug + sus artículos + axioma (event_details si existe).
    Shape pensado para alimentar `/event/[slug]` del frontend.
    """
    try:
        ev = pg_store.get_event_by_slug(slug)
    except pg_store.PostgresUnavailable as e:
        return jsonify({"error": "postgres_unavailable", "detail": str(e)}), 503

    if not ev:
        return jsonify({"error": "not_found", "detail": f"slug '{slug}' no existe"}), 404

    return jsonify({
        "id":                ev["id"],
        "slug":              ev["slug"],
        "topic_centroid_id": ev.get("topic_centroid_id"),
        "title":             ev["title"],
        "summary":           ev.get("summary"),
        "x":                 ev["x"],
        "y":                 ev["y"],
        "media_count":       ev["media_count"],
        "divergence":        ev["divergence"],
        "divergence_band":   ev["divergence_band"],
        "keywords":          ev.get("keywords") or [],
        "media_sources":     ev.get("media_sources") or [],
        "published_at":      ev["published_at"].isoformat() if ev.get("published_at") else None,
        "article_count":     ev["article_count"],
        # axioma — null hasta que /api/axioma/run los popule
        "verdad_consensuada": ev.get("verdad_consensuada"),
        "datos_aislados":     ev.get("datos_aislados"),
        "contradicciones":    ev.get("contradicciones"),
        "axioma_updated_at":  ev["axioma_updated_at"].isoformat() if ev.get("axioma_updated_at") else None,
        "articulos":          ev.get("articles", []),
    })


# =============================================================================

if __name__ == "__main__":
    print("Starting server on http://localhost:5000")
    app.run(host="0.0.0.0", debug=False, port=5000, threaded=True)
