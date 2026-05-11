# alethIA — Te acercamos al hecho, no a la noticia.

<img src="./project-logo.png" alt="alethIA logo" width="200" />

**Track:** 🛸 Future · **Hackathon:** Platanus Hack 26 · **Team:** team-9

> *"En 5 años no vas a poder distinguir un comentario humano de uno generado por IA. Cuando eso pase, la verdad va a necesitar una infraestructura nueva. Esto es esa infraestructura, empezando por Argentina."*

**Live demo:** https://frontend-snowy-sigma-68qmpeb3q0.vercel.app/

---

## The problem

The threshold between human and synthetic content was crossed in 2024. Bots, automated accounts, and generative AI now produce content at industrial scale — fabricated news, distorted headlines, contradictory versions of the same event. Figuring out what actually happened, without spending hours reading every outlet, has become nearly impossible.

At the same time, Argentine media is highly concentrated: **8 holdings control 60% of digital audience**, with Grupo Clarín alone accounting for 25%. Argentina ranks **98th in RSF's 2026 Press Freedom Index** (down 32 places in two years). In that context, trusting a single source is structurally risky.

alethIA is the infrastructure to read critically in that world.

---

## What it does

Given a stream of current news, alethIA:

1. **Collects** coverage from multiple Argentine media sources via their public RSS feeds.
2. **Groups articles semantically** into events — clusters of articles covering the same real-world occurrence.
3. **Synthesizes** each event across sources using the **Axioma Protocol**: for every event with coverage from 2+ outlets, it extracts:
   - **Verdad consensuada** — points all sources agree on.
   - **Datos aislados** — data present in some but not all sources (potential omissions).
   - **Contradicciones** — explicit disagreements between sources.
4. **Scores divergence** per event based on the number of contradictions and isolated data points.
5. **Visualizes** all events on an interactive 2D embedding map and lets users drill into each event's full evidence trail.

The system never tells you what to think. It shows you what each source chose to say, where they agree, where they clash, and what some of them are leaving out — citing the original text.

---

## Architecture

The pipeline is split into three independent processes, each in its own folder:

```
scraper/    →   analyzer/   →   frontend/
(TypeScript)    (Python)        (Next.js)
RSS ingest      Embeddings      Event portal
+ AI parse      Clustering      + Axioma UI
                Axioma
```

All three share a single **PostgreSQL (Supabase)** database. The scraper writes raw articles; the analyzer enriches them with embeddings, clusters, and Axioma output; the frontend reads and displays the results.

---

## Stage 1 — Scraper (`scraper/`)

**Runtime:** Node.js / TypeScript

The scraper is a news ingestion pipeline that fetches articles from Argentine media RSS feeds and stores structured data in the database.

### What it does
- Polls configured RSS feeds (`feeds.json`) for new articles.
- Fetches and parses full article bodies using **Playwright** (for JS-heavy pages) and **@mozilla/readability**.
- Uses **Claude Haiku** to normalize and extract structured metadata (summary, lead, topics) from raw HTML.
- Deduplicates articles by GUID and persists them to the shared database.

### Key files
| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point — orchestrates the ingest loop |
| `src/rss/` | RSS parsing and feed management |
| `src/extract/` | Full-article fetching and readability extraction |
| `src/ai/` | Claude Haiku prompts for normalization and filtering |
| `src/db/` | Supabase client and article storage layer |
| `feeds.json` | List of monitored RSS feeds |

### Stack
- TypeScript, Node.js, `tsx`
- `rss-parser`, `playwright`, `@mozilla/readability`, `jsdom`
- `@anthropic-ai/sdk` (Claude Haiku 4.5)
- `@supabase/supabase-js`, `pino`

### Setup
```bash
cd scraper
npm install
cp .env.example .env   # fill SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
npm start
```

---

## Stage 2 — Analyzer (`analyzer/`)

**Runtime:** Python 3.10+, Flask

The analyzer is the intelligence core of the pipeline. It exposes a small HTTP API consumed by both the scraper (for embeddings) and an internal cron (for clustering and synthesis).

### What it does

#### 1. Embeddings (`pipeline/ingest.py`)
Computes sentence-transformer embeddings for each article using a weighted combination of title (70%) and lead text (30%). Stored as 384-dim float32 vectors in `article_embeddings`.

#### 2. K-means clustering (`pipeline/kmeans_clustering.py`)
Groups articles into **events** using K-means over the embedding space. Optimal K is selected via a silhouette sweep (`k_min=2` to `N/3`). Heterogeneous clusters are recursively subdivided up to `max_recursion_depth=2`. UMAP projects each event into 2D coordinates for the frontend map.

#### 3. Axioma Protocol (`pipeline/axioma.py`)
For every event with articles from 2+ distinct media sources, Axioma calls **Claude Sonnet** with all article bodies and asks it to extract:
- `verdad_consensuada` (string[]) — the consensus facts
- `datos_aislados` (JSONB) — data mentioned by only some sources
- `contradicciones` (JSONB) — direct contradictions between sources

Divergence is then scored as:
```
divergence = min(1.0, 0.35 × |contradicciones| + 0.05 × |datos_aislados|)
```
Events are bucketed into `low / medium / high` divergence bands.

#### 4. Topic clustering (`pipeline/topics_clustering.py`)
Groups events into broader topic centroids (macro-themes) for top-level navigation.

### Key files
| Path | Purpose |
|---|---|
| `server.py` | Flask API server |
| `pipeline/ingest.py` | Embedding computation |
| `pipeline/kmeans_clustering.py` | K-means + UMAP + event creation |
| `pipeline/axioma.py` | Cross-source synthesis via Claude Sonnet |
| `pipeline/topics_clustering.py` | Macro-topic grouping |
| `schema/postgres_schema.sql` | Full DB schema for analyzer tables |
| `config.toml` | All tunable parameters (models, K ranges, Axioma limits) |

### Stack
- Python, Flask, `flask-cors`
- `sentence-transformers` (paraphrase-multilingual-MiniLM-L12-v2, ~120 MB)
- `scikit-learn` (K-means, silhouette), `umap-learn`, `numpy`
- `anthropic` (Claude Sonnet 4.6 for Axioma, Claude Haiku 4.5 for naming)
- `psycopg[binary]` (PostgreSQL)

### Setup
```bash
cd analyzer
bash setup.sh          # installs deps + applies DB schema
cp .env.example .env   # fill ANTHROPIC_API_KEY, SCRAPER_DB_URL
python server.py
```

The first run downloads the MiniLM model (~120 MB).

---

## Stage 3 — Frontend (`frontend/`)

**Runtime:** Next.js 16, React 19, TypeScript

The frontend is a news portal that displays events grouped by semantic similarity, their divergence scores, and the full Axioma analysis for each event.

### Views

**Home (`/`)** — Event feed with divergence badges, keyword tags, source logos, and a 2D **embedding map** (D3-rendered) showing all events as points in semantic space colored by divergence band.

**Event detail (`/event/[id]`)** — Deep-dive view for a single event:
- **ConsensusBlock** — verdad consensuada with inline citations.
- **DiscrepanciesBlock** — contradictions between sources with side-by-side evidence.
- **IsolatedDataBlock** — datos aislados — what some outlets reported and others didn't.
- **ArticlesBlock** — all source articles grouped by medium.

### Key files
| Path | Purpose |
|---|---|
| `app/page.tsx` | Home — event feed + embedding map |
| `app/event/[id]/` | Event detail page |
| `components/ConsensusBlock.tsx` | Renders verdad consensuada |
| `components/DiscrepanciesBlock.tsx` | Renders contradicciones |
| `components/IsolatedDataBlock.tsx` | Renders datos aislados |
| `components/EmbeddingMap.tsx` | D3 2D scatter of events |
| `components/SearchBar.tsx` | Event search/filter |

### Stack
- Next.js 16, React 19, TypeScript
- Tailwind CSS v4, Radix UI, `lucide-react`
- D3 (embedding map visualization)
- Zustand (client state)
- `@supabase/supabase-js` (data fetching)

### Setup
```bash
cd frontend
pnpm install
cp .env.local.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev
```

---

## Database schema

All three stages share a PostgreSQL database (hosted on Supabase). The scraper owns `articles` and `media`. The analyzer owns:

| Table | Description |
|---|---|
| `article_embeddings` | 384-dim float32 vectors per article |
| `topic_centroids` | Macro-topic groups with UMAP coordinates |
| `events` | Semantic clusters — title, keywords, divergence score, 2D position |
| `event_details` | Axioma output: verdad_consensuada, datos_aislados, contradicciones |
| `event_articles` | Article ↔ event membership (pipeline-internal) |

Apply the schema:
```bash
psql $SCRAPER_DB_URL -f analyzer/schema/postgres_schema.sql
```

---

## Environment variables

| Variable | Used by | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | scraper, analyzer | Anthropic API key |
| `SUPABASE_URL` | scraper | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | scraper | Supabase service role key |
| `SCRAPER_DB_URL` | analyzer | Direct PostgreSQL connection string |
| `NEXT_PUBLIC_SUPABASE_URL` | frontend | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | frontend | Supabase anon key (public) |

---

## Configuration

All analyzer parameters are in `config.toml` at the repo root:

| Section | Controls |
|---|---|
| `[llm]` | Model names — Sonnet 4.6 for Axioma, Haiku 4.5 for naming |
| `[embeddings]` | Sentence-transformer model, title/lead weighting, batch size |
| `[clustering]` | K-means sweep range, UMAP neighbors/distance, recursion depth |
| `[axioma]` | Min sources per event, article body cap, parallelism |
| `[ingest]` | Max articles per run, per-feed limits |

---

## Running the full pipeline

```bash
# 1. Start the analyzer API
cd analyzer && python server.py &

# 2. Run the scraper (fetches + embeds new articles)
cd scraper && npm start

# 3. Trigger clustering + Axioma (via analyzer API or cron)
curl -X POST http://localhost:5000/api/cluster/run
curl -X POST http://localhost:5000/api/axioma/run

# 4. Start the frontend
cd frontend && pnpm dev
```

---

## Team

| Name | GitHub |
|---|---|
| Cristian Arean | [@CristianArean](https://github.com/CristianArean) |
| Francisco Juarez | [@franjuarez](https://github.com/franjuarez) |
| Joaquin Hernandez | [@joaquin-her](https://github.com/joaquin-her) |
| Valentin Schneider | [@Valen1611](https://github.com/Valen1611) |
| Juan Martin De La Cruz | [@juandelaHD](https://github.com/juandelaHD) |

---

*No te decimos qué pensar. Te mostramos cómo distintas fuentes cuentan lo mismo, dónde chocan, y qué se está callando.*
