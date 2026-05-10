"""
Axioma Protocol — síntesis cross-fuente por evento.

Para cada evento (cluster) con >= 2 fuentes distintas:
  1) Carga los articles del cluster (source, title, summary).
  2) Llama a Claude Sonnet con AXIOMA_PROMPT.
  3) Persiste en `event_details` (verdad_consensuada / datos_aislados / contradicciones).
  4) Recalcula divergence + divergence_band en `events` en base a la cantidad de
     contradicciones reportadas.

Eventos con < 2 fuentes se skipean (no tiene sentido consensuar con 1 sola voz).
"""
from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from ai.llm import call_sonnet
from ai.prompts import AXIOMA_PROMPT
from storage.pg_store import (
    load_events_for_axioma,
    refresh_topic_aggregates,
    update_event_divergence,
    upsert_event_details,
)


MIN_SOURCES = 2          # piso para correr axioma (sin esto no hay consenso posible)
MAX_BODY_CHARS = 2500    # cap por body.
MAX_ITEMS_PER_EVENT = 6  # cap de notas mandadas a Sonnet por event. Eventos con 11+ notas
                         # generaban prompts de 28k chars y respuestas que excedían max_tokens.
                         # Las notas cortadas son las MÁS VIEJAS (orden del query es DESC).

# Output. Subido a 4096 (era 2048) — events con muchas contradicciones/datos
# aislados llegaban al límite y Sonnet truncaba el JSON → "invalid_json".
MAX_OUTPUT_TOKENS = 4096

# Paralelismo. Bajamos a 4 (era 8): con 130+ events y bodies completos, demasiados
# workers golpean ITPM. Para subir/bajar: MAX_WORKERS_AXIOMA env.
MAX_WORKERS = int(os.getenv("MAX_WORKERS_AXIOMA", "4"))

# Slow-call threshold: si una llamada Sonnet pasa este tiempo, lo logueamos
# como "slow" (no es timeout, solo señal de que algo se está poniendo pesado).
SLOW_CALL_THRESHOLD = 30.0


def _compute_divergence(contradicciones: list, datos_aislados: list, media_count: int) -> float:
    """
    Divergence sensible. La fórmula vieja (N_contradicciones / media_count) era muy rígida y
    daba 0 cuando había 0 contradicciones explícitas, aún si los datos aislados gritaban
    sesgo editorial.

    Nueva fórmula: cada contradicción pesa 0.35, cada dato aislado pesa 0.05 (cap a 1.0).
    Así un evento con 2 contradicciones ya cae en banda HIGH; uno con 1 contradicción + 5
    datos aislados en MEDIUM; uno con solo datos consensuados en LOW.
    """
    score = 0.35 * len(contradicciones) + 0.05 * len(datos_aislados)
    return max(0.0, min(1.0, score))


def _normalize_axioma_output(raw: dict) -> tuple[list[str], list[dict], list[dict], str | None]:
    """Sanea el output de Claude — listas vacías por campo si viene mal-formado."""
    if not isinstance(raw, dict):
        return [], [], [], "raw_not_dict"

    vc = raw.get("verdad_consensuada") or []
    da = raw.get("datos_aislados") or []
    co = raw.get("contradicciones") or []

    if not isinstance(vc, list):
        vc = []
    if not isinstance(da, list):
        da = []
    if not isinstance(co, list):
        co = []

    vc = [str(x).strip() for x in vc if isinstance(x, (str, int, float)) and str(x).strip()]
    da = [d for d in da if isinstance(d, dict) and "hecho" in d and "fuente" in d]
    co = [d for d in co if isinstance(d, dict) and "punto_de_choque" in d and isinstance(d.get("versiones"), dict)]

    return vc, da, co, None


def _process_event(ev: dict) -> dict:
    """
    Procesa UN evento end-to-end. Pensada para correr en un thread.
    Logs en cada paso para que un cuelgue NO sea silencioso.
    """
    event_id = ev["id"]
    title = ev["title"]
    media_count = ev["media_count"]
    articles = ev.get("articles", [])

    # Cap de items: si vienen 11 notas, mandamos las primeras 6 (las más recientes).
    # Sonnet con 11 bodies completos genera respuestas que se truncan a 2k tokens.
    capped = articles[:MAX_ITEMS_PER_EVENT]
    items = [
        {
            "source": a.get("source") or "Desconocido",
            "title":  a.get("title") or "",
            "body":   (a.get("body") or "")[:MAX_BODY_CHARS],
        }
        for a in capped
    ]
    if not items:
        print(f"[axioma_skip] {event_id[:40]} — no articles", flush=True)
        return {"event_id": event_id, "ok": False, "error": "no_articles"}

    truncated = len(articles) - len(items)
    user_msg = f"Evento: {title}\n\nNotas:\n{json.dumps(items, ensure_ascii=False, indent=2)}"
    print(
        f"[axioma_call] {event_id[:40]:<40} arts={len(items)}"
        + (f" (+{truncated} truncated)" if truncated else "")
        + f" prompt={len(user_msg)}c",
        flush=True,
    )

    t0 = time.time()
    result = call_sonnet(AXIOMA_PROMPT, user_msg, max_tokens=MAX_OUTPUT_TOKENS)
    elapsed = time.time() - t0
    if elapsed > SLOW_CALL_THRESHOLD:
        print(
            f"[axioma_slow] {event_id[:40]:<40} took {elapsed:.1f}s (>{SLOW_CALL_THRESHOLD:.0f}s)",
            flush=True,
        )

    if "error" in result:
        print(
            f"[axioma_fail] {event_id[:40]:<40} error={result['error']!r} ({elapsed:.1f}s)",
            file=sys.stderr, flush=True,
        )
        return {"event_id": event_id, "ok": False, "error": result["error"]}

    usage = result.pop("_usage", {}) or {}

    vc, da, co, parse_err = _normalize_axioma_output(result)
    if parse_err:
        print(f"[axioma_fail] {event_id[:40]:<40} parse_err={parse_err}", file=sys.stderr, flush=True)
        return {"event_id": event_id, "ok": False, "error": parse_err}

    # Persistencia: si falla, lo logueamos pero NO matamos el run entero
    try:
        t1 = time.time()
        upsert_event_details(event_id, vc, da, co)
        divergence = _compute_divergence(co, da, media_count)
        update_event_divergence(event_id, divergence)
        db_elapsed = time.time() - t1
        if db_elapsed > 5.0:
            print(f"[axioma_slow_db] {event_id[:40]:<40} db took {db_elapsed:.1f}s", flush=True)
    except Exception as e:
        print(f"[axioma_fail] {event_id[:40]:<40} db_error={e!r}", file=sys.stderr, flush=True)
        return {"event_id": event_id, "ok": False, "error": f"db_error: {e}"}

    return {
        "event_id":      event_id,
        "ok":            True,
        "media_count":   media_count,
        "vc":            len(vc),
        "da":            len(da),
        "co":            len(co),
        "divergence":    divergence,
        "input_tokens":  usage.get("input_tokens", 0) or 0,
        "output_tokens": usage.get("output_tokens", 0) or 0,
        "elapsed":       elapsed,
    }


def run() -> dict:
    print(f"[axioma] loading events from DB...", flush=True)
    events = load_events_for_axioma(min_sources=MIN_SOURCES)
    n_total = len(events)
    print(f"[axioma] {n_total} events con >= {MIN_SOURCES} fuentes — paralelismo={MAX_WORKERS} body_cap={MAX_BODY_CHARS}c", flush=True)

    if n_total == 0:
        return {
            "status": "error",
            "error": "no_eligible_events",
            "detail": f"Ningún evento cumple media_count >= {MIN_SOURCES}.",
        }

    persisted = 0
    failed = 0
    failures: list[dict] = []
    total_input_tokens = 0
    total_output_tokens = 0

    started = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_process_event, ev): ev["id"] for ev in events}
        done = 0
        for fut in as_completed(futures):
            event_id = futures[fut]
            done += 1
            try:
                res = fut.result()
            except Exception as e:
                failed += 1
                failures.append({"event_id": event_id, "error": f"thread_exception: {e}"})
                print(f"[axioma_error] event_id={event_id} thread_exception={e!r}", file=sys.stderr, flush=True)
                continue

            if not res.get("ok"):
                failed += 1
                failures.append({"event_id": event_id, "error": res.get("error", "unknown")})
                print(f"[axioma_error] event_id={event_id} error={res.get('error')!r}", file=sys.stderr, flush=True)
                continue

            persisted += 1
            total_input_tokens += res["input_tokens"]
            total_output_tokens += res["output_tokens"]
            print(
                f"[axioma {done}/{n_total}] {event_id[:40]:<40} sources={res['media_count']} "
                f"vc={res['vc']} da={res['da']} co={res['co']} divergence={res['divergence']:.2f}",
                flush=True,
            )

    # Recalcular avg_divergence + color_band por topic basándose en los events
    # actualizados. Sin esto, todos los topics quedaban en `low` (verde) porque
    # avg_divergence se inseta a 0 en topics_run y nunca se refrescaba.
    topics_refreshed = 0
    try:
        topics_refreshed = refresh_topic_aggregates()
        print(f"[axioma] refreshed avg_divergence on {topics_refreshed} topics", flush=True)
    except Exception as e:
        print(f"[axioma] refresh_topic_aggregates failed: {e}", file=sys.stderr, flush=True)

    elapsed = time.time() - started
    print(f"[axioma] done in {elapsed:.1f}s", flush=True)

    return {
        "status":           "success" if failed == 0 else "partial",
        "events_total":     n_total,
        "events_persisted": persisted,
        "events_failed":    failed,
        "failures":         failures[:20],
        "elapsed_seconds":  round(elapsed, 1),
        "max_workers":      MAX_WORKERS,
        "topics_refreshed": topics_refreshed,
        "tokens": {
            "input":  total_input_tokens,
            "output": total_output_tokens,
        },
    }


if __name__ == "__main__":
    import json as _json
    print(_json.dumps(run(), indent=2, default=str, ensure_ascii=False))
