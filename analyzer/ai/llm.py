"""
Wrapper para llamadas a Anthropic. Maneja retries y parsing de JSON.

Decisiones:
- Cliente único compartido (anthropic.Anthropic es thread-safe).
- Dos modelos: Sonnet para análisis (bias, axioma), Haiku para naming.
- Retorna dict parseado o {"error": "..."} para manejar fallos sin tirar excepción
  y dejar que el caller decida qué hacer (log + NULL en DB).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# IDs de modelos. Si Anthropic cambia naming, actualizar acá.
SONNET_MODEL = "claude-sonnet-4-6"
HAIKU_MODEL = "claude-haiku-4-5"

# Lazy import + lazy init del cliente. Esto permite importar este módulo en tests
# que no usan Claude (slugify, hash, clustering) sin requerir anthropic instalado.
_client = None
_anthropic = None


def _get_client():
    """Inicializa el cliente la primera vez que se necesita."""
    global _client, _anthropic
    if _client is None:
        import anthropic  # type: ignore
        _anthropic = anthropic
        _client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _client


def _strip_markdown_fences(raw: str) -> str:
    """Sonnet a veces envuelve el JSON en ```json ... ```. Lo limpiamos."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0]
    return raw.strip()


def call(model: str, system: str, user: str, max_retries: int = 3, max_tokens: int = 4096, timeout: float = 90.0) -> dict:
    """
    Llamada genérica a Claude con retry. Devuelve:
      - dict parseado del JSON si todo OK
      - {"error": "msg", ...} si falla (invalid JSON, rate limit agotado, timeout, etc.)

    `timeout` es el HTTP timeout por intento. Sin esto el SDK puede esperar
    hasta 10 minutos silenciosamente — vimos exactamente eso en axioma.
    """
    import sys

    client = _get_client()
    import anthropic  # type: ignore

    raw = ""
    last_error = None

    user_chars = len(user)
    sys_chars = len(system)
    print(
        f"[llm] call model={model} sys={sys_chars}c user={user_chars}c max_tok={max_tokens} timeout={timeout}s",
        flush=True,
    )

    for attempt in range(max_retries):
        t0 = time.time()
        try:
            resp = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                temperature=0.1,
                timeout=timeout,
            )
            raw = resp.content[0].text
            cleaned = _strip_markdown_fences(raw)
            parsed = json.loads(cleaned)
            elapsed = time.time() - t0
            in_tok = resp.usage.input_tokens
            out_tok = resp.usage.output_tokens
            print(
                f"[llm] ok in {elapsed:.1f}s tokens in={in_tok} out={out_tok} attempt={attempt+1}",
                flush=True,
            )
            parsed["_usage"] = {"input_tokens": in_tok, "output_tokens": out_tok}
            return parsed

        except json.JSONDecodeError as e:
            elapsed = time.time() - t0
            print(f"[llm] invalid_json after {elapsed:.1f}s: {e}", file=sys.stderr, flush=True)
            return {"error": "invalid_json", "raw": raw[:500], "detail": str(e)}

        except anthropic.APITimeoutError as e:
            elapsed = time.time() - t0
            last_error = f"timeout after {elapsed:.0f}s"
            print(
                f"[llm] timeout after {elapsed:.1f}s attempt={attempt+1}/{max_retries}",
                file=sys.stderr, flush=True,
            )
            if attempt < max_retries - 1:
                continue
            return {"error": "http_timeout", "detail": last_error}

        except anthropic.RateLimitError as e:
            elapsed = time.time() - t0
            last_error = f"rate_limit: {e}"
            wait = min(5 * (2 ** attempt), 60)
            print(
                f"[llm] rate_limit after {elapsed:.1f}s attempt={attempt+1}/{max_retries} sleeping {wait}s",
                file=sys.stderr, flush=True,
            )
            if attempt < max_retries - 1:
                time.sleep(wait)
                continue
            return {"error": "rate_limit_exhausted", "detail": str(e)}

        except anthropic.APIError as e:
            elapsed = time.time() - t0
            last_error = f"api_error: {e}"
            print(
                f"[llm] api_error after {elapsed:.1f}s attempt={attempt+1}/{max_retries}: {e}",
                file=sys.stderr, flush=True,
            )
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"error": "api_error", "detail": str(e)}

        except Exception as e:
            elapsed = time.time() - t0
            print(f"[llm] unknown error after {elapsed:.1f}s: {e!r}", file=sys.stderr, flush=True)
            return {"error": "unknown", "detail": str(e)}

    return {"error": "max_retries_exhausted", "detail": last_error or ""}


def call_sonnet(system: str, user: str, max_tokens: int = 4096, timeout: float = 120.0) -> dict:
    """Helper específico para Sonnet (bias, axioma). Timeout 120s por defecto — bodies largos pueden tardar."""
    return call(SONNET_MODEL, system, user, max_tokens=max_tokens, timeout=timeout)


def call_haiku(system: str, user: str, max_tokens: int = 256, timeout: float = 30.0) -> dict:
    """Helper específico para Haiku (naming). max_tokens chico porque output es corto."""
    return call(HAIKU_MODEL, system, user, max_tokens=max_tokens, timeout=timeout)
