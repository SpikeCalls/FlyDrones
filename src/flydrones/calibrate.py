"""Fit the motor read-out on the connectome you actually use.

Real connectomes do not come with a "which neuron means climb" label. This
tool shows the brain a set of visual situations, records the descending
neurons, and fits a small ridge regression from their rates to the flight
command a fly would need in that situation:

    sinking illusion (scene moves up)   -> throttle +
    rising illusion (scene moves down)  -> throttle -
    scene rotates right / left          -> yaw + / -   (optomotor)
    looming on the left / right         -> yaw away from it

Only the read-out is fitted. The connectome and neuron dynamics stay untouched.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .brain import Brain
from .senses.encoder import InputEncoder
from .senses.retina import FEATURES, EyeFeatures, VisualFrame

STIMULI = [
    # name, {eye: {feature: value}}, targets
    ("rest", {}, {"throttle": 0.0, "yaw": 0.0}),
    ("sinking (scene up)", {"L": {"up": 0.7}, "R": {"up": 0.7}}, {"throttle": 0.8, "yaw": 0.0}),
    ("rising (scene down)", {"L": {"down": 0.7}, "R": {"down": 0.7}}, {"throttle": -0.8, "yaw": 0.0}),
    ("rotate right", {"L": {"btf": 0.7}, "R": {"ftb": 0.7}}, {"throttle": 0.0, "yaw": 0.8}),
    ("rotate left", {"L": {"ftb": 0.7}, "R": {"btf": 0.7}}, {"throttle": 0.0, "yaw": -0.8}),
    ("loom left", {"L": {"loom": 0.9, "loom_speed": 0.6}}, {"throttle": 0.0, "yaw": 0.8}),
    ("loom right", {"R": {"loom": 0.9, "loom_speed": 0.6}}, {"throttle": 0.0, "yaw": -0.8}),
]


def _frame(spec: dict, grid: tuple[int, int]) -> VisualFrame:
    eyes = {}
    for e in "LR":
        grids = {f: np.zeros(grid, np.float32) for f in FEATURES}
        grids["brightness"][:] = 0.5
        for f, v in spec.get(e, {}).items():
            grids[f][:] = v
        eyes[e] = EyeFeatures(grids)
    return VisualFrame(eyes)


def record_responses(brain: Brain, cfg: dict, settle_ms: float = 300, measure_ms: float = 1200, repeats: int = 2) -> tuple[list[str], np.ndarray, list[dict]]:
    enc = InputEncoder(brain.connectome, cfg)
    grid = tuple(cfg.get("vision", {}).get("grid", (6, 8)))
    outs = [k for k in brain.output_specs if brain.connectome.group(k).size]
    X, Y = [], []
    for _ in range(repeats):
        for name, spec, target in STIMULI:
            rates = enc.encode(_frame(spec, grid))
            brain.tick(rates, settle_ms)
            r = brain.tick(rates, measure_ms)
            X.append([r[k] for k in outs])
            Y.append(target)
            print(f"  {name:22s} " + "  ".join(f"{k}={r[k]:5.1f}" for k in outs))
    return outs, np.asarray(X), Y


def fit_readout(outs: list[str], X: np.ndarray, Y: list[dict], ridge: float = 1.0) -> dict:
    n_stim = len(STIMULI)
    rest = X[[i for i in range(len(X)) if i % n_stim == 0]].mean(axis=0)
    Xc = X - rest
    scale = np.abs(Xc).max(axis=0) + 1e-6
    Xn = Xc / scale
    result = {"baseline": dict(zip(outs, rest.round(3).tolist())), "axes": {}}
    for axis in ("throttle", "yaw"):
        y = np.array([t[axis] for t in Y])
        A = Xn.T @ Xn + ridge * np.eye(Xn.shape[1])
        w = np.linalg.solve(A, Xn.T @ y) / scale
        pred = Xc @ w
        r2 = 1 - ((y - pred) ** 2).sum() / (((y - y.mean()) ** 2).sum() + 1e-9)
        terms = {k: round(float(v), 5) for k, v in zip(outs, w) if abs(v) > 1e-5}
        result["axes"][axis] = {"gain": 1.0, "terms": terms, "r2": round(float(r2), 3)}
    return result


def calibrate(brain: Brain, cfg: dict, out: str | Path) -> dict:
    print(f"calibrating read-out on {brain.connectome.name} ({brain.n_neurons:,} neurons)")
    brain.tick({}, 500)
    outs, X, Y = record_responses(brain, cfg)
    res = fit_readout(outs, X, Y)
    Path(out).write_text(json.dumps(res, indent=2), encoding="utf-8")
    for axis, spec in res["axes"].items():
        print(f"{axis}: R^2 = {spec['r2']}")
    print(f"saved -> {out}  (use it with decoder.readout_file)")
    return res
