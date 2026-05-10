#!/usr/bin/env python3
"""
Fetches news about a specific event from Google News + major Argentine RSS feeds.
Parses each article with Groq (Data Parser), then runs Axioma Protocol consensus.

Outputs:
  noticias_hoy.txt         — raw article text
  noticias_parseadas.json  — per-article structured JSON
  consenso.json            — cross-source consensus (Axioma Protocol)

Dependencies: pip install feedparser requests beautifulsoup4 trafilatura groq python-dotenv
"""

import feedparser
import requests
import trafilatura
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from groq import Groq
import json
import os
import time
import sys
import urllib.parse

# Force UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Event-specific search terms ───────────────────────────────────────────────
# Change these to target a different event.
EVENT_SEARCH_TERMS = [
    "Adorni escándalo vuelos",
    "Adorni causa judicial dinero",
    "Adorni SIRA coimas",
    "causa Adorni portavoz",
]

# ── RSS feeds: Google News searches + major Argentine sources ─────────────────
def build_gnews_url(query: str) -> str:
    q = urllib.parse.quote(query)
    return f"https://news.google.com/rss/search?q={q}&hl=es-419&gl=AR&ceid=AR:es-419"

SEARCH_FEEDS = [(f"Google News: {t}", build_gnews_url(t)) for t in EVENT_SEARCH_TERMS]

GENERAL_FEEDS = [
    ("La Nacion",           "https://www.lanacion.com.ar/arc/outboundfeeds/rss/"),
    ("Clarin",              "https://www.clarin.com/rss/lo-ultimo/"),
    ("TN",                  "https://tn.com.ar/feed/"),
    ("Perfil",              "https://www.perfil.com/rss/"),
    ("Infobae",             "https://www.infobae.com/feeds/rss/"),
    ("Pagina 12",           "https://www.pagina12.com.ar/rss/portada"),
    ("El Destape",          "https://www.eldestapeweb.com/rss/"),
    ("Noticias Argentinas", "https://www.noticiasargentinas.com/rss"),
]

RSS_FEEDS = SEARCH_FEEDS + GENERAL_FEEDS

# ── Event-specific keyword filter ─────────────────────────────────────────────
# Articles from general feeds must match these to be included.
EVENT_KEYWORDS = ["adorni", "sira", "causa adorni", "portavoz adorni"]

OUTPUT_FILE   = "noticias_hoy.txt"
PARSED_FILE   = "noticias_parseadas.json"
CONSENSUS_FILE = "consenso.json"
GROQ_PARSE_MODEL   = "llama-3.1-8b-instant"    # 500k TPD — used for per-article parsing
GROQ_AXIOMA_MODEL  = "llama-3.3-70b-versatile"  # 100k TPD — used only for final synthesis

REQUEST_TIMEOUT = 10
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

PARSER_PROMPT = (
    "Sos un extractor de datos crudos (Data Parser). Tu objetivo es leer el texto de una noticia "
    "y extraer únicamente los hechos objetivos, ignorando adjetivos, opiniones, y cualquier texto "
    "irrelevante o publicitario (ej: 'otras noticias', 'minutos de lectura').\n\n"
    "Debes devolver la información estrictamente en el siguiente formato JSON:\n\n"
    "tema_principal: Un string corto definiendo el evento.\n"
    "entidades_clave: Array de strings (lugares, organizaciones, personas).\n"
    "hechos_atomicos: Array de strings. Cada hecho debe ser una oración simple, directa y comprobable. "
    "Separa los datos numéricos si es posible.\n"
    "citas_directas: Array de strings (solo si hay declaraciones literales entre comillas).\n"
    "recomendaciones_oficiales: Array de strings (si aplica).\n\n"
    "No agregues formato Markdown al output, solo el JSON puro."
)

AXIOMA_PROMPT = (
    "Sos el Motor de Consenso (Axioma Protocol). Recibirás un array de objetos JSON, cada uno "
    "representando los hechos extraídos de distintos medios sobre un mismo evento.\n\n"
    "Tu tarea es cruzar los arrays de 'hechos_atomicos' y categorizarlos en un nuevo JSON:\n\n"
    "'verdad_consensuada': Hechos que aparecen reportados en al menos el 70% de las fuentes. "
    "Redactalos como viñetas absolutas.\n"
    "'datos_aislados': Hechos o cifras que solo son reportados por una única fuente "
    "(indica qué fuente lo dijo).\n"
    "'contradicciones': Datos donde las fuentes chocan directamente "
    "(ej: la fuente A dice 140km/h, la fuente B dice 100km/h).\n\n"
    "Output estrictamente en JSON."
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_last_24h(entry) -> bool:
    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=24)
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                pub = datetime(*t[:6], tzinfo=timezone.utc)
                return pub >= cutoff
            except Exception:
                continue
    return True  # no date → include


def is_event_relevant(entry, is_search_feed: bool) -> bool:
    """Search feeds are already filtered by query; general feeds need keyword check."""
    if is_search_feed:
        return True
    text = " ".join([
        entry.get("title", ""),
        entry.get("summary", ""),
    ]).lower()
    return any(kw in text for kw in EVENT_KEYWORDS)


def fetch_article_text(url: str) -> str:
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers=HEADERS)
        resp.raise_for_status()
        text = trafilatura.extract(resp.text, include_comments=False,
                                   include_tables=False, no_fallback=False)
        if text and len(text) > 150:
            return text
    except Exception:
        pass
    try:
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer",
                         "aside", "form", "iframe", "noscript"]):
            tag.decompose()
        paragraphs = [p.get_text(strip=True) for p in soup.find_all("p")
                      if len(p.get_text(strip=True)) > 60]
        return "\n".join(paragraphs)
    except Exception as e:
        return f"[Error: {e}]"


def process_feed(name: str, url: str, is_search: bool) -> list[dict]:
    print(f"  {name}...", end=" ", flush=True)
    try:
        feed = feedparser.parse(url, request_headers=HEADERS)
        entries = feed.get("entries", [])
        recent = [e for e in entries if is_last_24h(e)]
        relevant = [e for e in recent if is_event_relevant(e, is_search)]
        print(f"{len(relevant)} articles (of {len(entries)} total)")
        return [{"source": name, "entry": e} for e in relevant]
    except Exception as e:
        print(f"ERROR: {e}")
        return []


def entry_to_text_and_data(source: str, entry) -> tuple[str, dict]:
    title   = entry.get("title", "Sin título").strip()
    link    = entry.get("link", "")
    summary = entry.get("summary", "")

    if summary:
        summary = BeautifulSoup(summary, "html.parser").get_text(separator=" ", strip=True)

    rss_content = ""
    for c in entry.get("content", []):
        raw = c.get("value", "")
        if raw:
            rss_content = BeautifulSoup(raw, "html.parser").get_text(separator="\n", strip=True)
            break

    scraped = ""
    if link:
        scraped = fetch_article_text(link)
        time.sleep(0.3)

    content = max([scraped, rss_content, summary], key=len)

    block = "\n".join([
        f"=== {source.upper()} ===",
        f"Titulo: {title}",
        f"URL: {link}",
        "---",
        content,
        "",
    ])
    return block, {"source": source, "title": title, "url": link, "content": content}


def call_groq(client: Groq, model: str, system: str, user: str,
              max_retries: int = 3) -> dict | list:
    for attempt in range(max_retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
                temperature=0.1,
            )
            raw = resp.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"error": "invalid_json", "raw": raw}
        except Exception as e:
            msg = str(e)
            if "rate_limit_exceeded" in msg and attempt < max_retries - 1:
                # Extract wait time from error message if present
                wait = 60
                import re
                m = re.search(r"try again in (\d+)m(\d+)", msg)
                if m:
                    wait = int(m.group(1)) * 60 + int(m.group(2)) + 5
                print(f"    Rate limit hit — waiting {wait}s before retry {attempt+2}/{max_retries}...")
                time.sleep(wait)
            else:
                return {"error": msg}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    load_dotenv()
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        print("ERROR: GROQ_API_KEY not found in .env")
        sys.exit(1)
    groq_client = Groq(api_key=groq_key)

    now = datetime.now()
    print(f"\nEvent: Adorni scandal — last 24 h (since {(now - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M')})\n")

    # ── Step 1: collect articles ──────────────────────────────────────────────
    all_items: list[dict] = []
    seen_urls: set[str] = set()

    print("── Search feeds (Google News) ──")
    for name, url in SEARCH_FEEDS:
        for item in process_feed(name, url, is_search=True):
            link = item["entry"].get("link", "")
            if link not in seen_urls:
                seen_urls.add(link)
                all_items.append(item)

    print("\n── General feeds (keyword-filtered) ──")
    for name, url in GENERAL_FEEDS:
        for item in process_feed(name, url, is_search=False):
            link = item["entry"].get("link", "")
            if link not in seen_urls:
                seen_urls.add(link)
                all_items.append(item)

    print(f"\nUnique articles to process: {len(all_items)}")

    if not all_items:
        print("No articles found. Try broadening EVENT_SEARCH_TERMS.")
        return

    # ── Step 2: fetch full text & write raw file ──────────────────────────────
    print(f"\nFetching article text → '{OUTPUT_FILE}'...\n")
    article_data: list[dict] = []

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(f"ESCÁNDALO ADORNI — últimas 24 hs al {now.strftime('%Y-%m-%d %H:%M')}\n")
        f.write(f"Total articulos: {len(all_items)}\n")
        f.write("=" * 60 + "\n\n")

        for i, item in enumerate(all_items, 1):
            title = item["entry"].get("title", "")
            print(f"  [{i}/{len(all_items)}] {item['source']}: {title[:70]}")
            block, data = entry_to_text_and_data(item["source"], item["entry"])
            f.write(block + "\n")
            article_data.append(data)

    print(f"\nRaw text → '{OUTPUT_FILE}'")

    # ── Step 3: parse each article with Groq (Data Parser) ───────────────────
    print(f"\nParsing {len(article_data)} articles with Groq...\n")
    parsed_results: list[dict] = []

    for i, art in enumerate(article_data, 1):
        print(f"  [{i}/{len(article_data)}] {art['source']}: {art['title'][:65]}")
        user_msg = f"Título: {art['title']}\n\nTexto:\n{art['content'][:6000]}"
        parsed = call_groq(groq_client, GROQ_PARSE_MODEL, PARSER_PROMPT, user_msg)
        parsed_results.append({
            "source": art["source"],
            "title":  art["title"],
            "url":    art["url"],
            "parsed": parsed,
        })
        time.sleep(0.3)

    with open(PARSED_FILE, "w", encoding="utf-8") as f:
        json.dump(parsed_results, f, ensure_ascii=False, indent=2)
    print(f"\nParsed articles → '{PARSED_FILE}'")

    # ── Step 4: Axioma Protocol — cross-source consensus ─────────────────────
    # Feed only the parsed JSON objects (no raw text) to keep the prompt small.
    valid_parsed = [r for r in parsed_results if "error" not in r.get("parsed", {})]
    print(f"\nRunning Axioma Protocol on {len(valid_parsed)} valid articles...\n")

    axioma_input = json.dumps(
        [{"fuente": r["source"], **r["parsed"]} for r in valid_parsed],
        ensure_ascii=False,
    )
    consensus = call_groq(groq_client, GROQ_AXIOMA_MODEL, AXIOMA_PROMPT, axioma_input[:20000])

    with open(CONSENSUS_FILE, "w", encoding="utf-8") as f:
        json.dump(consensus, f, ensure_ascii=False, indent=2)

    print(f"Consensus → '{CONSENSUS_FILE}'\n")
    print(json.dumps(consensus, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
