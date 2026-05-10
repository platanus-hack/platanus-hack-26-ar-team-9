"""
Carga config.toml desde el root del repo.

Estrategia de búsqueda:
  1. Mismo directorio que este archivo (Docker: config.toml montado en /app/)
  2. Directorio padre (dev local: pipeline/ → repo root)
"""
from __future__ import annotations

import sys
import tomllib
from pathlib import Path


def _find_config() -> Path:
    here = Path(__file__).parent
    for candidate in (here / "config.toml", here.parent / "config.toml"):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"config.toml not found in {here} or {here.parent}. "
        "Copy config.toml from the repo root."
    )


def _load() -> dict:
    path = _find_config()
    with open(path, "rb") as f:
        return tomllib.load(f)


try:
    config = _load()
except Exception as e:
    print(f"[config_loader] WARN: {e} — usando defaults vacíos", file=sys.stderr)
    config: dict = {}
