-- Schema de Axioma sobre el Postgres del scraper.
--
-- Convive con `articles` y `media` (read-only para nosotros). Las tablas
-- de abajo son nuestras: las leemos y escribimos.
--
-- Aplicar con:
--   psql $SCRAPER_DB_URL -f postgres_schema.sql
--
-- Schema alineado al contrato del frontend (contrato-bdd/schema.sql).
-- Diferencias mínimas: NO cargamos las RPC ni RLS acá (Supabase-specific).
-- Cuando se promueva a Supabase, se aplica contrato-bdd/schema.sql tal cual.

-- ============================================================================
-- Embedding por artículo
-- ============================================================================
-- Lo calcula /api/ingest/run con MiniLM y lo persiste acá.
-- BYTEA = float32 raw (np.tobytes), 384 dims * 4 bytes = 1536 bytes por fila.
CREATE TABLE IF NOT EXISTS article_embeddings (
    medium_slug   TEXT NOT NULL,
    guid          TEXT NOT NULL,
    embedding     BYTEA NOT NULL,
    embedded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (medium_slug, guid),
    FOREIGN KEY (medium_slug, guid) REFERENCES articles(medium_slug, guid)
);


-- ============================================================================
-- Topic centroids (gigacentroides)
-- ============================================================================
-- Placeholder por ahora — se poblará en una iteración siguiente (etapa 2).
-- Los events vivirán con topic_centroid_id NULL hasta entonces.
CREATE TABLE IF NOT EXISTS topic_centroids (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    x               DOUBLE PRECISION NOT NULL,
    y               DOUBLE PRECISION NOT NULL,
    volume          INTEGER NOT NULL DEFAULT 0,
    avg_divergence  REAL,
    color_band      TEXT NOT NULL CHECK (color_band IN ('low', 'medium', 'high')),
    summary         TEXT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- Events (clusters de KMeans)
-- ============================================================================
-- Reescritura completa: id pasa a TEXT (slug-like) para alinear con contrato.
-- Cada /api/cluster/run hace TRUNCATE + INSERT.
CREATE TABLE IF NOT EXISTS events (
    id                  TEXT PRIMARY KEY,
    slug                TEXT UNIQUE NOT NULL,
    topic_centroid_id   TEXT REFERENCES topic_centroids(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    x                   DOUBLE PRECISION NOT NULL,
    y                   DOUBLE PRECISION NOT NULL,
    media_count         INTEGER NOT NULL DEFAULT 0,
    divergence          REAL NOT NULL DEFAULT 0,
    divergence_band     TEXT NOT NULL DEFAULT 'low' CHECK (divergence_band IN ('low', 'medium', 'high')),
    summary             TEXT,
    keywords            TEXT[] NOT NULL DEFAULT '{}',
    media_sources       TEXT[] NOT NULL DEFAULT '{}',
    article_count       INTEGER NOT NULL DEFAULT 0,    -- métrica interna del pipeline (no en contrato)
    k_chosen            INTEGER,                       -- métrica interna del sweep
    silhouette          REAL,                          -- métrica interna del sweep
    published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_topic_idx     ON events(topic_centroid_id);
CREATE INDEX IF NOT EXISTS events_slug_idx      ON events(slug);
CREATE INDEX IF NOT EXISTS events_published_idx ON events(published_at DESC);


-- ============================================================================
-- Event details (axioma — verdad consensuada / aislados / contradicciones)
-- ============================================================================
-- Placeholder — se poblará con el endpoint /api/axioma/run en otra iteración.
CREATE TABLE IF NOT EXISTS event_details (
    event_id            TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    verdad_consensuada  TEXT[] NOT NULL DEFAULT '{}',
    datos_aislados      JSONB  NOT NULL DEFAULT '[]',
    contradicciones     JSONB  NOT NULL DEFAULT '[]',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- Event articles (interna — no está en el contrato)
-- ============================================================================
-- Membresía artículo → evento. La usa el pipeline para que axioma pueda
-- recuperar los summaries de cada cluster. El frontend NO la consume.
CREATE TABLE IF NOT EXISTS event_articles (
    event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    medium_slug   TEXT NOT NULL,
    guid          TEXT NOT NULL,
    PRIMARY KEY (event_id, medium_slug, guid),
    FOREIGN KEY (medium_slug, guid) REFERENCES articles(medium_slug, guid)
);

CREATE INDEX IF NOT EXISTS idx_event_articles_event ON event_articles(event_id);
CREATE INDEX IF NOT EXISTS idx_event_articles_article ON event_articles(medium_slug, guid);
