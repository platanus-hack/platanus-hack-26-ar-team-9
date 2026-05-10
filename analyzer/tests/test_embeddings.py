"""
Tests del modelo de embeddings real.

REQUIERE el modelo descargado (sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).
Si no está, la primera ejecución lo baja (~120MB).

El test clave: dos noticias parecidas en español tienen que dar embeddings
con cosine similarity alta (>0.7), y dos no relacionadas baja (<0.5).

Para correr:  pytest analyzer/tests/test_embeddings.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.embeddings import (  # noqa: E402
    cosine_similarity,
    embed_articles,
    encode_text,
)


@pytest.fixture(scope="module")
def loaded_model():
    """Fixture que fuerza la carga del modelo una sola vez para todos los tests."""
    # encode_text dispara el lazy load. Si falla, todos los tests skipean.
    try:
        encode_text("test")
    except Exception as e:
        pytest.skip(f"sentence-transformers no disponible: {e}")
    return True


def test_two_similar_news_have_high_similarity(loaded_model):
    """
    Test crítico: dos titulares sobre el MISMO evento deben tener cosine alta.
    Esto es la base del clustering — si esto falla, todo el sistema falla.
    """
    news_a = encode_text("Milei anuncia ajuste fiscal y reducción del gasto público")
    news_b = encode_text("Milei impone fuerte recorte presupuestario al sector público")

    sim = cosine_similarity(news_a, news_b)
    assert sim > 0.7, f"Esperaba sim > 0.7 entre noticias parecidas, obtuve {sim:.3f}"


def test_unrelated_news_have_lower_similarity(loaded_model):
    """Dos noticias de temas totalmente distintos deben tener cosine más baja."""
    politica = encode_text("Milei anuncia ajuste fiscal y reducción del gasto público")
    deportes = encode_text("Boca venció a River en el clásico del fútbol argentino")

    sim = cosine_similarity(politica, deportes)
    assert sim < 0.5, f"Esperaba sim < 0.5 entre noticias no relacionadas, obtuve {sim:.3f}"


def test_three_adorni_articles_cluster_together(loaded_model):
    """
    Caso del plan: tres artículos sobre el caso Adorni deben tener entre sí
    cosine ≥ 0.72 (el threshold real del clustering).
    """
    titulos = [
        "Adorni en el ojo del huracán por el caso de los vuelos privados",
        "El portavoz Adorni admite irregularidades en el uso de aviones oficiales",
        "Caso Adorni: pedirán investigación sobre el uso de vuelos del Estado",
    ]
    embeddings = [encode_text(t) for t in titulos]

    # Todas las pares deben tener cosine >= 0.72
    for i, e_i in enumerate(embeddings):
        for j, e_j in enumerate(embeddings):
            if i >= j:
                continue
            sim = cosine_similarity(e_i, e_j)
            assert sim >= 0.72, (
                f"Adorni {i} vs Adorni {j}: cosine {sim:.3f} < threshold 0.72. "
                "El clustering no los va a unir."
            )


def test_embed_articles_adds_embedding_field(loaded_model):
    """embed_articles muta in-place y agrega 'embedding' a cada article."""
    arts = [
        {"title": "Milei ajuste", "content": "Texto completo del artículo..."},
        {"title": "Boca campeón", "content": "Otra nota..."},
    ]
    embed_articles(arts)

    assert "embedding" in arts[0]
    assert "embedding" in arts[1]
    assert arts[0]["embedding"].shape == (384,)
    assert arts[1]["embedding"].shape == (384,)


def test_embedding_combines_title_and_lead(loaded_model):
    """
    Verificar que el embedding combina title (peso 0.7) + lead (peso 0.3).
    Si fueran solo title, dos artículos con mismo título y content distinto
    serían idénticos. Quiero ver que aporta el content.
    """
    art_with_content = [{"title": "Milei", "content": "habla de ajuste fiscal y FMI"}]
    art_only_title = [{"title": "Milei", "content": ""}]

    embed_articles(art_with_content)
    embed_articles(art_only_title)

    sim = cosine_similarity(art_with_content[0]["embedding"], art_only_title[0]["embedding"])
    # Son parecidos (mismo título dominante con peso 0.7) pero no idénticos
    assert sim < 0.999, "El content debería aportar al embedding"
    assert sim > 0.7, "Pero el título sigue dominando, deberían ser parecidos"


