"""
Clustering BATCH con KMeans + selección de K por silhouette + PCA 2D.

Entrada: todos los embeddings de Postgres (article_embeddings JOIN articles).
Salida: tabla `events` y `event_articles` reescritas (TRUNCATE + INSERT).

Pipeline:
  1) Cargar embeddings + títulos (pg_store.load_all_embeddings).
  2) Sweep K en [K_MIN, min(K_MAX, N//MIN_PER_CLUSTER)] y elegir el de
     mayor silhouette_score. Printeamos K vs score para que el usuario pueda
     auditar.
  3) Reentrenar KMeans con K* y recoger labels.
  4) PCA 2D sobre TODA la matriz de embeddings → coords (xi, yi) por punto.
     Coord del cluster = promedio de sus puntos en 2D.
  5) Para cada cluster, mandar los títulos a Haiku → name.
  6) Persistir: replace_events(events, memberships).

Notas:
- Si N < K_MIN*2: salteamos el sweep, devolvemos 1 cluster con name de Haiku.
- KMeans usa init='k-means++', n_init=10 (default sklearn 1.4+).
- random_state fijo para reproducibilidad dentro del mismo input.
"""
from __future__ import annotations

import re
import sys
import unicodedata
from typing import Optional

import numpy as np
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

try:
    from umap import UMAP  # type: ignore
    _HAS_UMAP = True
except ImportError:
    _HAS_UMAP = False

from naming import log_naming_error, name_cluster
from pg_store import fetch_cluster_metadata, load_all_embeddings, replace_events


def _slugify(text: str, max_len: int = 50) -> str:
    """Slug URL-safe ASCII, sin tildes, kebab-case. Trunca a max_len."""
    if not text:
        return "evento"
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    norm = re.sub(r"[^\w\s-]", "", norm).strip().lower()
    norm = re.sub(r"[-\s]+", "-", norm)
    norm = norm.strip("-")
    return norm[:max_len] or "evento"


def _project_2d(matrix: np.ndarray) -> tuple[np.ndarray, str, float | None]:
    """
    Proyecta una matriz (N, D) a 2D. Si umap-learn está instalado, usa UMAP con
    cosine metric (preserva vecindades local y global, métrica nativa de
    embeddings de transformers). Si no, fallback a PCA lineal.

    Retorna (coords_2d, method, explained_variance).
    `explained_variance` solo aplica a PCA; UMAP devuelve None.
    """
    n = matrix.shape[0]

    if _HAS_UMAP and n >= 4:
        # n_neighbors balancea local (chico) vs global (grande). Para N=149,
        # 25 da un buen punto medio. Cap a min(n-1, 30) para datasets chicos.
        n_neighbors = max(2, min(25, n - 1))
        reducer = UMAP(
            n_components=2,
            metric="cosine",
            n_neighbors=n_neighbors,
            min_dist=0.15,
            random_state=RANDOM_STATE,
            n_jobs=1,           # n_jobs>1 rompe la reproducibilidad con random_state
        )
        coords = reducer.fit_transform(matrix)
        return coords, f"umap(cosine, n_neighbors={n_neighbors})", None

    # Fallback: PCA. Mantiene comportamiento histórico.
    pca = PCA(n_components=2, random_state=RANDOM_STATE)
    coords = pca.fit_transform(matrix)
    return coords, "pca", float(pca.explained_variance_ratio_.sum())


def _normalize_to_unit(coords: np.ndarray) -> np.ndarray:
    """
    Normaliza un array (N, 2) para que todas las coords caigan en [-1, 1] por
    eje (independiente x e y). El frontend asume domain [-1, 1] al proyectar a
    canvas (ver `d3.scaleLinear().domain([-1, 1])` en EmbeddingMap.tsx).
    """
    if coords.size == 0:
        return coords
    max_abs_x = float(np.max(np.abs(coords[:, 0]))) or 1.0
    max_abs_y = float(np.max(np.abs(coords[:, 1]))) or 1.0
    out = coords.astype(np.float64).copy()
    out[:, 0] /= max_abs_x
    out[:, 1] /= max_abs_y
    return out

# Tunables
K_MIN = 2
MIN_PER_CLUSTER = 3   # piso de artículos por cluster — define K_MAX dinámico = N // MIN_PER_CLUSTER
RANDOM_STATE = 42

# Heterogéneo splitting: si Claude marca un cluster como heterogéneo, lo sub-clusterizamos.
MAX_RECURSION_DEPTH = 2     # cuántas veces podemos sub-dividir antes de aceptar el cluster como está
MIN_FOR_SUBCLUSTER = 4      # por debajo no tiene sentido split (poca señal interna)
SUB_K_MAX = 4               # K máximo del sub-KMeans interno


def _sweep_k(matrix: np.ndarray, k_min: int, k_max: int) -> tuple[int, float, list[tuple[int, float]]]:
    """
    Para cada K en [k_min, k_max], entrena KMeans y calcula silhouette_score.
    Retorna (best_k, best_score, todos_los_scores).

    Printea cada iteración para que el usuario lo pueda revisar en el log.
    """
    scores: list[tuple[int, float]] = []
    best_k = k_min
    best_score = -1.0

    for k in range(k_min, k_max + 1):
        km = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
        labels = km.fit_predict(matrix)
        # silhouette requiere al menos 2 clusters Y al menos 2 puntos por cluster
        unique = np.unique(labels)
        if len(unique) < 2:
            score = -1.0
        else:
            score = float(silhouette_score(matrix, labels))
        scores.append((k, score))
        print(f"[kmeans_sweep] K={k} silhouette={score:.4f}", flush=True)
        if score > best_score:
            best_score = score
            best_k = k

    return best_k, best_score, scores


def _resolve_and_collect(
    member_idx: np.ndarray,
    matrix: np.ndarray,
    coords_2d: np.ndarray,
    titles: list[str],
    keys: list[tuple[str, str]],
    depth: int,
    events: list[dict],
    memberships_by_event: dict[str, list[tuple[str, str]]],
    memberships: list[tuple[str, str, str]],
    used_slugs: set[str],
    cluster_seq: list[int],
    best_k: int,
    best_score: float,
    naming_failed_box: list[int],
    split_count_box: list[int],
) -> None:
    """
    Resuelve un cluster (potencialmente recursivo). Si Claude lo marca como
    heterogéneo y todavía hay margen para sub-clusterizar, parte el cluster
    en sub-grupos con un KMeans interno y se llama recursivamente sobre cada
    sub-grupo. En caso contrario, persiste el cluster como un evento.

    Trabaja por side-effects sobre los buffers `events`, `memberships`,
    `memberships_by_event`, `used_slugs`, contadores boxed.
    """
    n_members = len(member_idx)
    cluster_titles = [titles[i] for i in member_idx]

    name, is_het, _usage, error = name_cluster(cluster_titles)
    if error:
        log_naming_error(run_id=-1, cluster_idx=cluster_seq[0], error=error)
        naming_failed_box[0] += 1
        name = name or f"Cluster {cluster_seq[0]}"
        is_het = False  # si falló el naming no podemos confiar en el flag

    # ── Sub-clusterizar si Claude marcó heterogéneo y hay tela para cortar ──
    can_split = (
        is_het
        and depth < MAX_RECURSION_DEPTH
        and n_members >= MIN_FOR_SUBCLUSTER
    )
    if can_split:
        sub_matrix = matrix[member_idx]
        sub_k_max = min(SUB_K_MAX, n_members // 2)
        if sub_k_max >= 2:
            # Sweep silhouette interno chico (K=2..sub_k_max)
            best_sub_k = 2
            best_sub_score = -1.0
            for k in range(2, sub_k_max + 1):
                km_sub = KMeans(n_clusters=k, random_state=RANDOM_STATE, n_init=10)
                labels_sub = km_sub.fit_predict(sub_matrix)
                if len(np.unique(labels_sub)) >= 2:
                    score = float(silhouette_score(sub_matrix, labels_sub))
                else:
                    score = -1.0
                if score > best_sub_score:
                    best_sub_score = score
                    best_sub_k = k

            km_final = KMeans(n_clusters=best_sub_k, random_state=RANDOM_STATE, n_init=10)
            sub_labels = km_final.fit_predict(sub_matrix)

            print(
                f"[cluster] heterogeneous split depth={depth} N={n_members} "
                f"→ K={best_sub_k} sub-clusters (silhouette={best_sub_score:.3f})",
                flush=True,
            )
            split_count_box[0] += 1

            for sub_idx in range(best_sub_k):
                local_member_indices = np.where(sub_labels == sub_idx)[0]
                if len(local_member_indices) == 0:
                    continue
                # Mapear índices locales del sub_matrix a los índices globales
                global_member_indices = member_idx[local_member_indices]
                _resolve_and_collect(
                    member_idx=global_member_indices,
                    matrix=matrix,
                    coords_2d=coords_2d,
                    titles=titles,
                    keys=keys,
                    depth=depth + 1,
                    events=events,
                    memberships_by_event=memberships_by_event,
                    memberships=memberships,
                    used_slugs=used_slugs,
                    cluster_seq=cluster_seq,
                    best_k=best_k,
                    best_score=best_score,
                    naming_failed_box=naming_failed_box,
                    split_count_box=split_count_box,
                )
            return  # ← no persistimos el padre, solo los hijos

    # ── Persistir como evento (caso base) ───────────────────────────────────
    cluster_seq[0] += 1
    cluster_idx = cluster_seq[0]
    x = float(np.mean(coords_2d[member_idx, 0]))
    y = float(np.mean(coords_2d[member_idx, 1]))

    slug_base = _slugify(name, max_len=40)
    slug = f"{slug_base}-{cluster_idx}"
    suffix = 1
    while slug in used_slugs:
        slug = f"{slug_base}-{cluster_idx}-{suffix}"
        suffix += 1
    used_slugs.add(slug)
    event_id = slug

    cluster_keys = [(keys[i][0], keys[i][1]) for i in member_idx]
    memberships_by_event[event_id] = cluster_keys
    for (slug_, guid) in cluster_keys:
        memberships.append((event_id, slug_, guid))

    events.append({
        "id":             event_id,
        "slug":           slug,
        "title":          name,
        "summary":        name,
        "x":              x,
        "y":              y,
        "article_count":  int(n_members),
        "k_chosen":       best_k,
        "silhouette":     best_score if not np.isnan(best_score) else None,
    })


def run(force_k: Optional[int] = None) -> dict:
    """
    Corre el clustering completo y persiste en Postgres.

    Args:
      force_k: si está, salta el sweep y usa ese K. Útil para testing manual.

    Retorna métricas para el endpoint.
    """
    # 1) Cargar embeddings
    keys, matrix, titles = load_all_embeddings()
    n = len(keys)
    print(f"[cluster] loaded {n} embeddings, dim={matrix.shape[1] if n else 0}", flush=True)

    if n == 0:
        return {
            "status": "error",
            "error": "no_embeddings",
            "detail": "Corré /api/ingest/run primero para generar embeddings.",
        }

    # Caso degenerado: muy pocos artículos → 1 solo cluster
    if n < K_MIN * 2:
        print(f"[cluster] N={n} < {K_MIN*2}, fallback a 1 cluster único", flush=True)
        return _persist_single_cluster(keys, matrix, titles, n)

    # 2) Sweep K — techo dinámico en base a N (al menos MIN_PER_CLUSTER artículos por cluster)
    k_max_dynamic = max(K_MIN, n // MIN_PER_CLUSTER)
    if force_k is not None:
        if not (K_MIN <= force_k <= k_max_dynamic):
            return {
                "status": "error",
                "error": "invalid_force_k",
                "detail": f"force_k debe estar en [{K_MIN}, {k_max_dynamic}]",
            }
        best_k = force_k
        best_score = float("nan")
        scores = [(force_k, best_score)]
        print(f"[cluster] force_k={force_k}, salteo sweep", flush=True)
    else:
        best_k, best_score, scores = _sweep_k(matrix, K_MIN, k_max_dynamic)
        print(f"[cluster] best K={best_k} silhouette={best_score:.4f}", flush=True)

    # 3) KMeans final con K*
    km = KMeans(n_clusters=best_k, random_state=RANDOM_STATE, n_init=10)
    labels = km.fit_predict(matrix)

    # 4) Proyección 2D (UMAP con cosine si está disponible, PCA como fallback)
    #    + normalización a [-1, 1] que el frontend espera.
    coords_2d, method, explained = _project_2d(matrix)
    coords_2d = _normalize_to_unit(coords_2d)
    if explained is not None:
        print(f"[cluster] 2D method={method} explained_variance={explained:.4f} (normalized)", flush=True)
    else:
        print(f"[cluster] 2D method={method} (normalized to [-1, 1])", flush=True)

    # 5) Naming + sub-cluster recursivo de heterogéneos + armado de events
    #    Cada cluster pasa por _resolve_cluster, que decide si aceptarlo
    #    como un solo evento o partirlo en sub-clusters más finos.
    events: list[dict] = []
    memberships_by_event: dict[str, list[tuple[str, str]]] = {}
    memberships: list[tuple[str, str, str]] = []
    naming_failed_box = [0]   # mutable contador para que la recursión lo update
    split_count_box   = [0]
    used_slugs: set[str] = set()

    cluster_seq = [0]  # mutable seq para slugs únicos transversal a la recursión
    for cluster_idx in range(best_k):
        member_idx = np.where(labels == cluster_idx)[0]
        if len(member_idx) == 0:
            continue
        _resolve_and_collect(
            member_idx=member_idx,
            matrix=matrix,
            coords_2d=coords_2d,
            titles=titles,
            keys=keys,
            depth=0,
            events=events,
            memberships_by_event=memberships_by_event,
            memberships=memberships,
            used_slugs=used_slugs,
            cluster_seq=cluster_seq,
            best_k=best_k,
            best_score=best_score,
            naming_failed_box=naming_failed_box,
            split_count_box=split_count_box,
        )

    naming_failed = naming_failed_box[0]
    splits_done = split_count_box[0]
    print(f"[cluster] heterogeneous splits done: {splits_done}", flush=True)

    # 5b) Enriquecer eventos con metadata derivada de los artículos
    enriched = fetch_cluster_metadata(memberships_by_event)
    for ev in events:
        meta = enriched.get(ev["id"], {})
        ev["media_count"]   = meta.get("media_count", 0)
        ev["media_sources"] = meta.get("media_sources", [])
        ev["keywords"]      = meta.get("keywords", [])
        ev["published_at"]  = meta.get("published_at")

    # 6) Persistir
    replace_events(events, memberships)

    return {
        "status": "success",
        "n_articles": n,
        "k_chosen": best_k,
        "silhouette": best_score if not np.isnan(best_score) else None,
        "pca_explained_variance": explained,
        "naming_failed": naming_failed,
        "heterogeneous_splits": splits_done,
        "k_sweep": [{"k": k, "silhouette": s} for k, s in scores],
        "events_persisted": len(events),
    }


def _persist_single_cluster(
    keys: list[tuple[str, str]],
    matrix: np.ndarray,
    titles: list[str],
    n: int,
) -> dict:
    """Caso degenerado: muy pocos puntos. 1 cluster, PCA igual para tener X/Y."""
    if n >= 2:
        pca = PCA(n_components=2, random_state=RANDOM_STATE)
        coords_2d = pca.fit_transform(matrix)
        x = float(np.mean(coords_2d[:, 0]))
        y = float(np.mean(coords_2d[:, 1]))
    else:
        x = 0.0
        y = 0.0

    name, _is_het, _usage, error = name_cluster(titles)
    if error:
        log_naming_error(run_id=-1, cluster_idx=0, error=error)
        name = name or "Cluster 0"

    slug = f"{_slugify(name, max_len=40)}-0"
    event_id = slug

    memberships_by_event = {event_id: list(keys)}
    enriched = fetch_cluster_metadata(memberships_by_event)
    meta = enriched.get(event_id, {})

    events = [{
        "id":             event_id,
        "slug":           slug,
        "title":          name,
        "summary":        name,
        "x":              x,
        "y":              y,
        "article_count":  n,
        "k_chosen":       1,
        "silhouette":     None,
        "media_count":    meta.get("media_count", 0),
        "media_sources":  meta.get("media_sources", []),
        "keywords":       meta.get("keywords", []),
        "published_at":   meta.get("published_at"),
    }]
    memberships = [(event_id, slug_, guid) for (slug_, guid) in keys]
    replace_events(events, memberships)

    return {
        "status": "success",
        "n_articles": n,
        "k_chosen": 1,
        "silhouette": None,
        "pca_explained_variance": None,
        "naming_failed": 1 if error else 0,
        "k_sweep": [],
        "events_persisted": 1,
        "note": f"N={n} muy chico, 1 cluster único",
    }


if __name__ == "__main__":
    # Permite correr `python kmeans_clustering.py` para testing rápido
    import json as _json
    force = None
    if len(sys.argv) > 1:
        force = int(sys.argv[1])
    print(_json.dumps(run(force_k=force), indent=2, default=str))
