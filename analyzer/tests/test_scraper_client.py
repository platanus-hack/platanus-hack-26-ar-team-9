"""
Tests del scraper_client (versión Postgres). Mockeamos psycopg2 para testear
la lógica de cursor pagination sin necesitar una DB Postgres levantada.

Crítico:
- El cursor cambió de int a string (ISO 8601 timestamp).
- El bug de cursor con max_articles sigue siendo crítico: si recortamos batch,
  cursor debe avanzar al "id" del último artículo retornado (que es su
  created_at en formato ISO), no al next_cursor del response.

Para correr:  pytest analyzer/tests/test_scraper_client.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from clients.scraper_client import EPOCH_CURSOR, pull_all  # noqa: E402


def make_article(timestamp: str, slug: str = "clarin", guid_suffix: str = "") -> dict:
    """
    Crea un dict con la shape que devuelve _normalize_row.
    El "id" es el created_at en ISO 8601 (cursor lógico).
    """
    guid = f"guid-{timestamp}{guid_suffix}"
    return {
        "id": timestamp,
        "medium_slug": slug,
        "guid": guid,
        "source": "Clarín" if slug == "clarin" else slug,
        "title": f"Artículo {timestamp}",
        "url": f"https://example.com/{guid}",
        "url_canonical": f"{slug}:{guid}",
        "summary": "...",
        "content": "...",
        "author": None,
        "topics": "[]",
        "published_at": timestamp,
        "scraped_at": timestamp,
        "extraction_method": "readability",
    }


def fake_fetch_batch_factory(batches: list[dict]):
    """Devuelve un fake fetch_batch que entrega cada batch en orden."""
    iterator = iter(batches)

    def fake(after_cursor: str, limit: int = 50) -> dict:
        return next(iterator)

    return fake


def test_pull_all_yields_each_batch():
    """Sin cap, pulleamos hasta que el scraper devuelva [] o has_more=False."""
    batch1 = [make_article(f"2026-05-09T12:00:{i:02d}Z") for i in range(50)]
    batch2 = [make_article(f"2026-05-09T13:00:{i:02d}Z") for i in range(20)]
    batches = [
        {"articles": batch1, "next_cursor": batch1[-1]["id"], "has_more": True},
        {"articles": batch2, "next_cursor": batch2[-1]["id"], "has_more": False},
    ]
    with patch("scraper_client.fetch_batch", side_effect=fake_fetch_batch_factory(batches)):
        results = list(pull_all(start_cursor=EPOCH_CURSOR))

    assert len(results) == 2
    assert len(results[0][0]) == 50
    assert results[0][1] == "2026-05-09T12:00:49Z"
    assert len(results[1][0]) == 20
    assert results[1][1] == "2026-05-09T13:00:19Z"


def test_pull_all_respects_max_articles_within_first_batch():
    """
    Bug crítico: si max_articles recorta el primer batch, el cursor debe
    avanzar al "id" (created_at) del último artículo recortado, NO al
    next_cursor del response (que apunta al final del batch original).
    """
    batch = [make_article(f"2026-05-09T12:00:{i:02d}Z") for i in range(50)]
    batches = [
        {"articles": batch, "next_cursor": batch[-1]["id"], "has_more": True},
    ]
    with patch("scraper_client.fetch_batch", side_effect=fake_fetch_batch_factory(batches)):
        results = list(pull_all(start_cursor=EPOCH_CURSOR, max_articles=10))

    assert len(results) == 1
    articles, cursor = results[0]
    assert len(articles) == 10
    # Cursor = id del último (el 10°, índice 9), NO el del 50°
    assert cursor == "2026-05-09T12:00:09Z", f"Cursor incorrecto: {cursor}"
    # Confirmar que NO avanzó al final del batch entero
    assert cursor != batch[-1]["id"]


def test_pull_all_respects_max_articles_across_batches():
    """max_articles cae cruzando batches: recorta el segundo y cursor correcto."""
    b1 = [make_article(f"2026-05-09T12:00:{i:02d}Z") for i in range(30)]
    b2 = [make_article(f"2026-05-09T13:00:{i:02d}Z") for i in range(20)]
    batches = [
        {"articles": b1, "next_cursor": b1[-1]["id"], "has_more": True},
        {"articles": b2, "next_cursor": b2[-1]["id"], "has_more": True},
    ]
    with patch("scraper_client.fetch_batch", side_effect=fake_fetch_batch_factory(batches)):
        results = list(pull_all(start_cursor=EPOCH_CURSOR, max_articles=35))

    total = sum(len(r[0]) for r in results)
    assert total == 35
    final_cursor = results[-1][1]
    # Tomamos los 30 del b1 + los primeros 5 de b2. Cursor = id del 5° de b2.
    assert final_cursor == "2026-05-09T13:00:04Z", f"Cursor incorrecto: {final_cursor}"


def test_pull_all_returns_empty_when_no_articles():
    """Scraper devuelve [] → pull_all sale sin yieldear."""
    batches = [{"articles": [], "next_cursor": EPOCH_CURSOR, "has_more": False}]
    with patch("scraper_client.fetch_batch", side_effect=fake_fetch_batch_factory(batches)):
        results = list(pull_all(start_cursor=EPOCH_CURSOR))
    assert results == []


def test_pull_all_stops_when_has_more_is_false():
    """has_more=False corta el loop sin pedir otro batch."""
    batches = [
        {
            "articles": [make_article("2026-05-09T12:00:00Z")],
            "next_cursor": "2026-05-09T12:00:00Z",
            "has_more": False,
        },
    ]
    with patch("scraper_client.fetch_batch", side_effect=fake_fetch_batch_factory(batches)):
        results = list(pull_all(start_cursor=EPOCH_CURSOR))
    assert len(results) == 1


def test_pull_all_starts_from_given_cursor():
    """El primer fetch_batch se llama con after_cursor=start_cursor."""
    batches = [
        {
            "articles": [make_article("2026-05-09T15:00:00Z")],
            "next_cursor": "2026-05-09T15:00:00Z",
            "has_more": False,
        },
    ]
    captured = {"after_cursor": None}

    def fake(after_cursor, limit=50):
        captured["after_cursor"] = after_cursor
        return batches[0]

    with patch("scraper_client.fetch_batch", side_effect=fake):
        list(pull_all(start_cursor="2026-05-09T14:00:00Z"))

    assert captured["after_cursor"] == "2026-05-09T14:00:00Z"


def test_normalize_row_maps_all_fields():
    """Test del mapeo Postgres → shape del pipeline. Sin DB, datos directos."""
    from clients.scraper_client import _normalize_row
    from datetime import datetime, timezone

    pg_row = {
        "url": "https://clarin.com/articulo",
        "guid": "abc123",
        "medium_slug": "clarin",
        "title": "Milei anuncia ajuste",
        "summary": "Resumen corto",
        "body": "Texto largo del artículo...",
        "author": "Juan Pérez",
        "published_at": datetime(2026, 5, 9, 14, 30, 0, tzinfo=timezone.utc),
        "topics": ["política", "economía"],
        "extraction_path": "readability",
        "created_at": datetime(2026, 5, 9, 15, 0, 0, tzinfo=timezone.utc),
        "source_name": "Clarín",
    }
    out = _normalize_row(pg_row)

    # Campos clave que el pipeline necesita
    assert out["medium_slug"] == "clarin"
    assert out["guid"] == "abc123"
    assert out["url_canonical"] == "clarin:abc123"
    assert out["source"] == "Clarín"  # display name del JOIN
    assert out["content"] == "Texto largo del artículo..."  # rename body→content
    assert out["author"] == "Juan Pérez"
    assert out["extraction_method"] == "readability"  # rename extraction_path
    assert out["published_at"] == "2026-05-09T14:30:00Z"
    assert out["id"] == "2026-05-09T15:00:00Z"  # cursor = created_at
    # topics se serializa a JSON string para guardar tal cual en SQLite
    import json as _json
    assert _json.loads(out["topics"]) == ["política", "economía"]


def test_normalize_row_handles_null_source_name():
    """Si el JOIN con media falla (slug huérfano), fallback al medium_slug."""
    from clients.scraper_client import _normalize_row
    pg_row = {
        "url": "x", "guid": "g", "medium_slug": "unknown",
        "title": "t", "summary": None, "body": None, "author": None,
        "published_at": None, "topics": None, "extraction_path": None,
        "created_at": None, "source_name": None,
    }
    out = _normalize_row(pg_row)
    assert out["source"] == "unknown"  # fallback al slug
