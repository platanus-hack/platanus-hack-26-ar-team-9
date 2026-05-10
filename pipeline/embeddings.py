"""
Embeddings locales (gratis, sin LLM).

Decisiones:
- Lazy load del modelo: la primera llamada lo baja (~120MB MiniLM).
- Modelo cacheado en memoria, thread-safe en inferencia.
- Embedding del artículo = 0.7 * MiniLM(title) + 0.3 * MiniLM(lead).
  El título concentra el significado en noticias; el lead aporta contexto.

Funciones:
- `embed_articles(articles, lead_chars=500)`: agrega `embedding` (np.array 384)
  a cada dict en la lista, in-place.
- `cosine_similarity(a, b)`: util suelto si lo necesita el caller.
- `embedding_to_blob` / `blob_to_embedding`: serialización para almacenamiento.
"""
from __future__ import annotations

import threading
from typing import List

import numpy as np

from config_loader import config as _cfg

_emb_cfg = _cfg.get("embeddings", {})
_EMBED_MODEL    = _emb_cfg.get("model",          "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
_TITLE_WEIGHT   = float(_emb_cfg.get("title_weight",   0.7))
_LEAD_MAX_CHARS = int(_emb_cfg.get("lead_max_chars",   500))
_BATCH_SIZE     = int(_emb_cfg.get("batch_size",        64))

_st_model = None
_lock = threading.Lock()


def _get_st_model():
    global _st_model
    if _st_model is None:
        with _lock:
            if _st_model is None:
                from sentence_transformers import SentenceTransformer
                _st_model = SentenceTransformer(_EMBED_MODEL)
    return _st_model


def encode_text(text: str) -> np.ndarray:
    """Helper para tests / 1 sola pieza. Usar embed_articles para listas."""
    model = _get_st_model()
    return model.encode([text])[0].astype(np.float32)


def embed_articles(articles: List[dict], lead_chars: int = _LEAD_MAX_CHARS) -> None:
    """
    Mutates `articles` in-place agregando 'embedding' (np.float32 array de 384 dim).
    Combina title (peso title_weight) + lead (peso 1-title_weight) para el vector final.

    Si content/summary es vacío/None, usa solo title.
    """
    if not articles:
        return

    model = _get_st_model()
    titles = [a.get("title", "") or "" for a in articles]
    leads = [(a.get("content") or a.get("summary") or "")[:lead_chars] for a in articles]

    title_embs = model.encode(titles, batch_size=_BATCH_SIZE, show_progress_bar=False)
    lead_embs = model.encode(leads, batch_size=_BATCH_SIZE, show_progress_bar=False)

    lead_weight = 1.0 - _TITLE_WEIGHT
    for a, t_emb, l_emb in zip(articles, title_embs, lead_embs):
        if not (a.get("content") or a.get("summary")):
            combined = t_emb
        else:
            combined = _TITLE_WEIGHT * t_emb + lead_weight * l_emb
        a["embedding"] = combined.astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity entre dos vectores. -1 a 1. Vector cero → 0.0."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def embedding_to_blob(emb: np.ndarray) -> bytes:
    """Serializa embedding para almacenamiento binario."""
    return emb.astype(np.float32).tobytes()


def blob_to_embedding(blob: bytes) -> np.ndarray:
    """Deserializa BLOB/BYTEA a np.array."""
    return np.frombuffer(blob, dtype=np.float32)
