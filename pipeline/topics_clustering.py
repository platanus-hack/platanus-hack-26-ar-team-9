"""
Topics nivel 2: clasificación NOTICIERA de cada event.

Decisión (rev): NO usamos KMeans + naming + merge. KMeans sobre embeddings MiniLM
captura similitud léxica/temática local pero NO la dimensión NOTICIERA (Política
vs Deportes vs Salud). Resultado: meta-clusters mezclaban un Messi con un Milei
porque sus embeddings caen cerca, y el naming defaultaba a "Política".

Approach actual:
  1) Por cada event, mandar a Haiku el título (+ 1-2 titulares de articles) →
     `{label}` de las categorías noticieras canónicas.
  2) Agrupar events por label → un topic_centroid por categoría que aparezca.
  3) Coords del topic = mean(coords events miembros). Vol = count.

Ventajas:
- La taxonomía la elige Claude, no la geometría del embedding.
- Más topics emergen naturalmente (Salud, Clima, Cultura, etc.).
- Un evento de fútbol cae en Deportes, no en "Política" por arrastre.

Paralelizado con threads (igual que axioma) para no tardar 2 minutos clasificando
40 events de a uno.
"""
from __future__ import annotations

import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import numpy as np

from naming import classify_event
from pg_store import load_event_centroids, replace_topic_centroids


# Paralelismo. Haiku tiene rate limits MUY altos así que con 12-16 estás bien.
MAX_WORKERS = int(os.getenv("MAX_WORKERS_TOPICS", "10"))


def _slugify(text: str, max_len: int = 30) -> str:
    if not text:
        return "categoria"
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = re.sub(r"[^\w\s-]", "", norm).strip().lower()
    norm = re.sub(r"[-\s]+", "-", norm).strip("-")
    return norm[:max_len] or "categoria"


def _classify_one(event_id: str, event_title: str, sample_titles: list[str]) -> dict:
    """Clasifica UN event. Para correr en thread."""
    label, _usage, error = classify_event(event_title, sample_titles)
    return {
        "event_id": event_id,
        "label":    label,
        "error":    error,
    }


def run(force_k: Optional[int] = None) -> dict:
    """
    Clasificación per-event + agregación por label en topic_centroids.

    `force_k` se acepta por compatibilidad con la firma anterior pero se IGNORA
    (ya no hay sweep KMeans).
    """
    event_ids, _centroids, titles_by_event, xy_by_event = load_event_centroids()
    n = len(event_ids)
    print(f"[topics] {n} events a clasificar — paralelismo={MAX_WORKERS}", flush=True)

    if n == 0:
        return {
            "status": "error",
            "error":  "no_events",
            "detail": "Corré /api/cluster/run primero.",
        }

    # ── Paso 1: clasificar cada event en paralelo ─────────────────────────────
    started = time.time()
    label_by_event: dict[str, str] = {}
    failed: list[dict] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {}
        for eid in event_ids:
            sample = titles_by_event.get(eid, [])
            # event_title ≈ titles_by_event[eid][0] (load_event_centroids prioriza el title del event)
            event_title = sample[0] if sample else ""
            futures[pool.submit(_classify_one, eid, event_title, sample)] = eid

        done = 0
        for fut in as_completed(futures):
            eid = futures[fut]
            done += 1
            try:
                res = fut.result()
            except Exception as e:
                failed.append({"event_id": eid, "error": f"thread_exception: {e}"})
                print(f"[topics_classify_error] event_id={eid} thread_exception={e!r}", file=sys.stderr, flush=True)
                continue

            if res.get("error") or not res.get("label"):
                failed.append({"event_id": eid, "error": res.get("error", "unknown")})
                # Fallback: tirarlo a "Sociedad" sería re-introducir el problema.
                # Mejor un bucket "Otros" que el frontend muestra aparte.
                label_by_event[eid] = "Otros"
                continue

            label_by_event[eid] = res["label"]
            print(f"[topics {done}/{n}] {eid[:40]:<40} → {res['label']}", flush=True)

    elapsed_classify = time.time() - started
    print(f"[topics] classify done in {elapsed_classify:.1f}s ({len(failed)} failed)", flush=True)

    # ── Paso 2: agrupar events por label → topics ─────────────────────────────
    members_by_label: dict[str, list[str]] = {}
    for eid, label in label_by_event.items():
        members_by_label.setdefault(label, []).append(eid)

    topics: list[dict] = []
    event_to_topic: dict[str, str] = {}
    used_ids: set[str] = set()

    for label, member_eids in members_by_label.items():
        # x/y del topic = mean(x/y de events miembros) — mismo plano que events.
        xys = [xy_by_event[eid] for eid in member_eids if eid in xy_by_event]
        if not xys:
            continue
        x = float(np.mean([p[0] for p in xys]))
        y = float(np.mean([p[1] for p in xys]))

        topic_id = f"topic_{_slugify(label, max_len=30)}"
        suffix = 1
        while topic_id in used_ids:
            topic_id = f"topic_{_slugify(label, max_len=30)}_{suffix}"
            suffix += 1
        used_ids.add(topic_id)

        topics.append({
            "id":             topic_id,
            "label":          label,
            "x":              x,
            "y":              y,
            "volume":         len(member_eids),
            "summary":        None,
            "avg_divergence": 0.0,    # placeholder hasta refresh post-axioma
            "color_band":     "low",
        })

        for eid in member_eids:
            event_to_topic[eid] = topic_id

    # Sanity: TODO event tiene topic
    missing = [eid for eid in event_ids if eid not in event_to_topic]
    if missing:
        return {
            "status": "error",
            "error":  "events_without_topic",
            "detail": f"{len(missing)} events sin topic asignado: {missing[:5]}",
        }

    replace_topic_centroids(topics, event_to_topic)

    elapsed_total = time.time() - started
    print(f"[topics] persisted {len(topics)} topics in {elapsed_total:.1f}s total", flush=True)

    return {
        "status":            "success" if not failed else "partial",
        "n_events":          n,
        "topics_persisted":  len(topics),
        "events_assigned":   len(event_to_topic),
        "elapsed_seconds":   round(elapsed_total, 1),
        "max_workers":       MAX_WORKERS,
        "failed":            failed[:20],
        "label_distribution": {
            label: len(eids) for label, eids in sorted(members_by_label.items(), key=lambda kv: -len(kv[1]))
        },
    }


if __name__ == "__main__":
    import json as _json
    print(_json.dumps(run(), indent=2, default=str, ensure_ascii=False))
