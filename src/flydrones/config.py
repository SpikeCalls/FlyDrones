"""Configuration loading: packaged defaults deep-merged with a user YAML file."""

from __future__ import annotations

import copy
from importlib import resources
from pathlib import Path

import yaml


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and not k.endswith("terms"):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def default_config() -> dict:
    text = resources.files("flydrones").joinpath("defaults.yaml").read_text(encoding="utf-8")
    return yaml.safe_load(text)


def load_config(path: str | Path | None = None, overrides: dict | None = None) -> dict:
    cfg = default_config()
    if path:
        with open(path, encoding="utf-8") as f:
            cfg = _deep_merge(cfg, yaml.safe_load(f) or {})
    if overrides:
        cfg = _deep_merge(cfg, overrides)
    return cfg
