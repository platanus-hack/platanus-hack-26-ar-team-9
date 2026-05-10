#!/usr/bin/env bash
# Setup del pipeline. Correr una sola vez después de clonar el repo.
#
# Asume Python 3.10+ y pip.
set -euo pipefail

echo "==> Installing Python dependencies..."
pip install -r requirements.txt

echo ""
echo "==> Aplicando schema en Postgres..."
echo "    (skip si la DB del scraper ya tiene article_embeddings/events/event_articles)"
if [ -n "${SCRAPER_DB_URL:-}" ]; then
    psql "$SCRAPER_DB_URL" -f postgres_schema.sql
else
    echo "    SCRAPER_DB_URL no seteada — saltá esta parte y corré el psql a mano:"
    echo "      psql \$SCRAPER_DB_URL -f postgres_schema.sql"
fi

echo ""
echo "Setup OK."
echo ""
echo "Antes de correr el server, asegurate de que tu .env tiene:"
echo "  ANTHROPIC_API_KEY=sk-ant-..."
echo "  SCRAPER_DB_URL=postgresql://user:pass@host:5432/dbname"
echo ""
echo "El primer run de ingesta descarga el modelo de embeddings"
echo "(paraphrase-multilingual-MiniLM-L12-v2, ~120MB)."
