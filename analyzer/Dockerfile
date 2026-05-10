# Pipeline de ingesta + análisis. Imagen ~2GB con modelos pre-cacheados.
#
# Decisiones:
# - python:3.11-slim como base (ligera, suficiente para nuestras deps).
# - libpq5 a nivel sistema porque psycopg2-binary lo necesita en runtime.
# - Modelos se descargan en el build, no en runtime → primer run rápido.
#   (Costo: imagen pesada, pero la armás una vez.)
# - data/ se monta como volume desde el host → SQLite persistente entre restarts.

FROM python:3.11-slim

WORKDIR /app

# Deps del sistema:
# - libpq5: runtime de Postgres (psycopg2-binary lo carga dinámicamente)
# - sqlite3: CLI para inspeccionar la DB local desde dentro del container
# - curl: usado por el HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        sqlite3 \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Instalar deps de Python desde PyPI público (evita problemas con mirrors corporativos).
COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://pypi.org/simple/ -r requirements.txt

# Pre-descargar el modelo de sentence-transformers (~120MB) — queda cacheado.
# Lo importamos y lo instanciamos para forzar la descarga en build, no en runtime.
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# Copiar el resto del código (después de las deps así el cache de pip es eficiente).
COPY . .

EXPOSE 5000

# Healthcheck simple: el endpoint /api/cursor responde si el server está vivo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:5000/api/cursor || exit 1

CMD ["python", "server.py"]
