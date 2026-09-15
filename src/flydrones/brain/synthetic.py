"""MiniFly: a small, hand-wired stand-in connectome for demos and tests.

MiniFly is NOT real fly data. It is a ~1,000-neuron circuit whose cell-type
names and pathways follow published fly flight circuitry, so the whole
FlyDrones pipeline (camera -> neurons -> drone) runs in seconds without the
1.1 GB MaleCNS download:

* T4/T5 motion cells  -> HS / VS lobula-plate cells  -> DNg02 (wing-stroke
  amplitude; Namiki et al. 2022: left/right DNg02 act independently, rightward
  motion raises right DNg02 and lowers left)
* LPLC2 + LC4 looming detectors -> giant fiber DNp01 (escape takeoff;
  Ache et al. 2019) and DNp03 (evasive flight saccades; Current Biology 2025)
* haltere afferents (body rotation) -> DNg02 (yaw damping)

Weights are synapse counts with signs, exactly like the real connectome, so
``flydrones`` treats MiniFly and MaleCNS identically.
"""

from __future__ import annotations

import numpy as np
from scipy import sparse

from .connectome import Connectome

GRID_ROWS, GRID_COLS = 6, 8  # ommatidia-like grid per eye


def _pop(spec: list, name: str, n: int, side: str, sign: float) -> None:
    spec.append((name, n, side, sign))


def build_minifly(seed: int = 7) -> Connectome:
    rng = np.random.default_rng(seed)
    cells = GRID_ROWS * GRID_COLS
    pops: list = []
    for s in ("L", "R"):
        _pop(pops, "R1-R6", 2 * cells, s, -1.0)  # histaminergic
        for sub in ("T4a", "T4b", "T4c", "T4d"):
            _pop(pops, sub, cells, s, +1.0)
        _pop(pops, "LPLC2", 24, s, +1.0)
        _pop(pops, "LC4", 12, s, +1.0)
        _pop(pops, "haltere", 16, s, +1.0)
        _pop(pops, "LPi_h", 10, s, -1.0)  # glutamatergic lobula plate intrinsic (horizontal)
        _pop(pops, "LPi_v", 10, s, -1.0)  # glutamatergic lobula plate intrinsic (vertical)
        _pop(pops, "HS", 3, s, +1.0)
        _pop(pops, "VS", 6, s, +1.0)
        _pop(pops, "PVLP", 20, s, +1.0)  # looming integrators
        _pop(pops, "LAL_inh", 12, s, -1.0)  # steering inhibition
        _pop(pops, "PVLP_inh", 6, s, -1.0)  # left/right competition for saccade direction
        _pop(pops, "DNg02", 15, s, +1.0)
        _pop(pops, "DNp03", 2, s, +1.0)
        _pop(pops, "DNp01", 1, s, +1.0)

    types, sides, sign = [], [], []
    index: dict[tuple[str, str], np.ndarray] = {}
    start = 0
    for name, n, side, sg in pops:
        index[(name, side)] = np.arange(start, start + n)
        types += [name] * n
        sides += [side] * n
        sign += [sg] * n
        start += n
    N = start
    sign = np.asarray(sign, dtype=np.float32)

    rows: list[np.ndarray] = []
    cols: list[np.ndarray] = []
    vals: list[np.ndarray] = []

    def connect(pre: np.ndarray, post: np.ndarray, syn: float, p: float = 1.0, jitter: float = 0.3) -> None:
        pre, post = np.asarray(pre), np.asarray(post)
        P, Q = np.meshgrid(pre, post)
        mask = rng.random(P.shape) < p
        w = syn * (1 + jitter * rng.standard_normal(P.shape))
        w = np.clip(np.round(w), 1, None)
        rows.append(Q[mask])
        cols.append(P[mask])
        vals.append(w[mask])

    def g(name: str, side: str) -> np.ndarray:
        return index[(name, side)]

    other = {"L": "R", "R": "L"}
    for s in ("L", "R"):
        o = other[s]
        # --- optic flow -> lobula plate tangential cells
        # HS_s is driven by image motion toward side s (T4a in its own eye is
        # front-to-back; for the right eye that is rightward image motion).
        connect(g("T4a", s), g("HS", s), 6, p=0.8)
        connect(g("T4b", s), g("LPi_h", s), 5, p=0.5)
        connect(g("LPi_h", s), g("HS", s), 6, p=0.8)
        # VS = "scene moves up" = drone is sinking
        connect(g("T4c", s), g("VS", s), 5, p=0.8)
        connect(g("T4d", s), g("LPi_v", s), 5, p=0.6)
        connect(g("LPi_v", s), g("VS", s), 4, p=0.6)

        # --- HS -> DNg02: motion toward side s raises DNg02_s, lowers DNg02_o
        connect(g("HS", s), g("DNg02", s), 11, p=0.9)
        connect(g("HS", s), g("LAL_inh", o), 14, p=0.9)
        connect(g("LAL_inh", o), g("DNg02", o), 12, p=0.9)

        # --- VS -> DNg02 on both sides: sinking -> more lift
        connect(g("VS", s), g("DNg02", s), 10, p=0.9)
        connect(g("VS", s), g("DNg02", o), 6, p=0.6)
        # downward scene motion (rising) -> inhibit lift through LPi
        connect(g("LPi_v", s), g("DNg02", s), 7, p=0.7)

        # --- haltere rotation feedback: rotating toward s damps turning toward s
        connect(g("haltere", s), g("DNg02", o), 4, p=0.7)
        connect(g("haltere", s), g("LAL_inh", s), 5, p=0.7)
        connect(g("LAL_inh", s), g("DNg02", s), 4, p=0.5)

        # --- looming -> escape
        connect(g("LPLC2", s), g("PVLP", s), 6, p=0.7)
        connect(g("LC4", s), g("PVLP", s), 5, p=0.6)
        connect(g("LPLC2", s), g("DNp01", s), 3, p=1.0)
        connect(g("LC4", s), g("DNp01", s), 3, p=1.0)
        connect(g("PVLP", s), g("DNp03", s), 12, p=0.9)
        connect(g("PVLP", s), g("LAL_inh", s), 2, p=0.4)

        # --- photoreceptor brightness: dorsal light gives a weak lift bias
        connect(g("R1-R6", s)[: 2 * GRID_COLS], g("PVLP", s), 1, p=0.05)

        # DNp03 on the threatened side suppresses same-side DNg02 -> turn away
        connect(g("DNp03", s), g("LAL_inh", s), 20, p=1.0)
        # winner-take-all: a head-on threat still produces a turn to one side
        connect(g("DNp03", s), g("PVLP_inh", o), 25, p=1.0)
        connect(g("PVLP_inh", o), g("DNp03", o), 40, p=1.0)
        connect(g("PVLP_inh", o), g("PVLP", o), 3, p=0.5)

    r = np.concatenate(rows)
    c = np.concatenate(cols)
    v = np.concatenate(vals).astype(np.float32) * sign[c]
    W = sparse.csc_matrix((v, (r, c)), shape=(N, N), dtype=np.float32)

    return Connectome(
        name="minifly-synthetic",
        weights=W,
        types=np.asarray(types),
        sides=np.asarray(sides),
        superclass=None,
        body_ids=np.arange(N, dtype=np.int64),
        meta={"synthetic": True, "grid": [GRID_ROWS, GRID_COLS], "seed": seed},
    )
