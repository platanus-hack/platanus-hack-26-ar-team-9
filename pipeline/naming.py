"""
Naming canónico de clusters con Claude Haiku.

- Una llamada por cluster.
- Recibe la lista de títulos del cluster (típicamente 3-30).
- Si Haiku falla → log + name queda NULL en DB.
"""
from __future__ import annotations

import sys

from llm import call_haiku
from prompts import EVENT_CLASSIFY_PROMPT, NAMING_PROMPT, TOPIC_NAMING_PROMPT


def name_cluster(titles: list[str], max_titles: int = 30) -> tuple[str | None, bool, dict | None, str | None]:
    """
    Llama a Haiku para nombrar un cluster a partir de los títulos de sus artículos.

    Retorna (name, is_heterogeneous, usage, error):
      - (str, bool, dict, None) si succeeded
      - (None, False, None, str) si falló
    """
    if not titles:
        return None, False, None, "empty_titles"

    sample = titles[:max_titles]
    bullet_list = "\n".join(f"- {t}" for t in sample if t and t.strip())
    user_msg = f"Títulos del cluster:\n{bullet_list}"

    result = call_haiku(NAMING_PROMPT, user_msg, max_tokens=160)

    if "error" in result:
        return None, False, None, result.get("error", "unknown")

    name = result.get("canonical_name")
    if not name or not isinstance(name, str):
        return None, False, None, "missing_canonical_name"

    is_het = bool(result.get("is_heterogeneous", False))
    return name.strip(), is_het, result.get("_usage"), None


def name_topic(titles: list[str], max_titles: int = 30) -> tuple[str | None, str | None, dict | None, str | None]:
    """
    Llama a Haiku para nombrar un meta-cluster (topic) a partir de los títulos
    de los events miembros.

    Retorna (label, summary, usage, error):
      - (str, str, dict, None) si succeeded
      - (None, None, None, str) si falló
    """
    if not titles:
        return None, None, None, "empty_titles"

    sample = titles[:max_titles]
    bullet_list = "\n".join(f"- {t}" for t in sample if t and t.strip())
    user_msg = f"Títulos:\n{bullet_list}"

    result = call_haiku(TOPIC_NAMING_PROMPT, user_msg, max_tokens=200)

    if "error" in result:
        return None, None, None, result.get("error", "unknown")

    label = result.get("label")
    summary = result.get("summary", "")
    if not label or not isinstance(label, str):
        return None, None, None, "missing_label"

    return label.strip(), summary.strip() if isinstance(summary, str) else "", result.get("_usage"), None


def classify_event(event_title: str, sample_article_titles: list[str] = None) -> tuple[str | None, dict | None, str | None]:
    """
    Llama a Haiku para clasificar un event en una categoría noticiera.
    Input: título del event + opcionalmente 1-2 titulares de articles que lo cubren.
    Retorna (label, usage, error).
    """
    if not event_title or not event_title.strip():
        return None, None, "empty_title"

    parts = [f"Título del evento: {event_title.strip()}"]
    if sample_article_titles:
        bullets = "\n".join(f"- {t}" for t in sample_article_titles[:2] if t and t.strip())
        if bullets:
            parts.append(f"Titulares de cobertura:\n{bullets}")
    user_msg = "\n\n".join(parts)

    result = call_haiku(EVENT_CLASSIFY_PROMPT, user_msg, max_tokens=80)

    if "error" in result:
        return None, None, result.get("error", "unknown")

    label = result.get("label")
    if not label or not isinstance(label, str):
        return None, None, "missing_label"

    return label.strip(), result.get("_usage"), None


def log_naming_error(run_id: int, cluster_idx: int, error: str):
    """Log grep-able para errores de naming."""
    print(
        f"[naming_error] run_id={run_id} cluster_idx={cluster_idx} error={error!r}",
        file=sys.stderr,
        flush=True,
    )
