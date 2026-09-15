import json
from pathlib import Path

from flydrones.brain import build_minifly

ROOT = Path(__file__).resolve().parents[1]


def test_browser_brain_matches_python_minifly():
    web = json.loads((ROOT / "docs" / "live" / "minifly.json").read_text())
    c = build_minifly()
    W = c.weights.tocsc()
    assert web["n"] == c.n
    assert web["nnz"] == W.nnz
    assert web["indptr"] == W.indptr.tolist()
    assert sum(web["data"]) == int(W.data.sum())
