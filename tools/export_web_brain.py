"""Export MiniFly + the default config to JSON for the browser demo (docs/live/minifly.json).

    python tools/export_web_brain.py
"""

import json
from pathlib import Path

import numpy as np

from flydrones.brain import Brain, build_minifly
from flydrones.config import load_config

OUT = Path(__file__).resolve().parents[1] / "docs" / "live" / "minifly.json"


def export(out: Path = OUT) -> dict:
    cfg = load_config()
    brain = Brain(build_minifly(), cfg)
    c = brain.connectome
    W = c.weights.tocsc()
    # population runs: consecutive neurons with the same (type, side)
    pops = []
    start = 0
    for i in range(1, c.n + 1):
        if i == c.n or c.types[i] != c.types[start] or c.sides[i] != c.sides[start]:
            pops.append([str(c.types[start]), str(c.sides[start]), start, i - start])
            start = i
    data = {
        "name": c.name,
        "n": int(c.n),
        "nnz": int(W.nnz),
        "indptr": W.indptr.astype(int).tolist(),
        "indices": W.indices.astype(int).tolist(),
        "data": W.data.astype(int).tolist(),
        "pops": pops,
        "groups": {k: v.astype(int).tolist() for k, v in c.groups.items()},
        "config": {k: cfg[k] for k in ("brain", "inputs", "outputs", "vision", "decoder", "safety", "imu")},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data


if __name__ == "__main__":
    d = export()
    print(f"exported {d['n']} neurons, {d['nnz']} connections -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    assert np.all(np.diff(d["indptr"]) >= 0)
