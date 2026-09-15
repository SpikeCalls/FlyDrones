"""Features (vision grids, IMU, gestures) -> Poisson rates for input neuron groups."""

from __future__ import annotations

import numpy as np

from ..brain.connectome import Connectome
from .retina import VisualFrame


class InputEncoder:
    """Maps each configured input group to a per-neuron rate array.

    Neurons of a group are spread over the eye grid in index order (neuron k of
    n goes to cell floor(k * cells / n)). MiniFly is built that way; for MaleCNS
    this is an approximation of retinotopy (see docs/SCIENCE.md).
    """

    def __init__(self, connectome: Connectome, cfg: dict):
        self.c = connectome
        self.specs = cfg.get("inputs", {})
        self.yaw_gain_dps = float(cfg.get("imu", {}).get("yaw_saturation_dps", 90.0))
        self._cellmap: dict[str, np.ndarray] = {}

    def _cells(self, group: str, n_cells: int) -> np.ndarray:
        key = f"{group}:{n_cells}"
        if key not in self._cellmap:
            n = self.c.group(group).size
            self._cellmap[key] = (np.arange(n) * n_cells // max(n, 1)).astype(np.int64)
        return self._cellmap[key]

    def encode(self, vision: VisualFrame | None, yaw_rate_dps: float = 0.0,
               extra: dict[str, float] | None = None) -> dict[str, np.ndarray]:
        rates: dict[str, np.ndarray] = {}
        for name, spec in self.specs.items():
            idx = self.c.group(name)
            if idx.size == 0:
                continue
            feat = spec.get("feature")
            max_hz = float(spec.get("max_hz", 100.0))
            if feat in ("yaw_pos", "yaw_neg"):
                val = yaw_rate_dps if feat == "yaw_pos" else -yaw_rate_dps
                rates[name] = np.full(idx.size, max_hz * np.clip(val / self.yaw_gain_dps, 0, 1), np.float32)
                continue
            if extra and feat in extra:
                rates[name] = np.full(idx.size, max_hz * float(np.clip(extra[feat], 0, 1)), np.float32)
                continue
            if vision is None:
                continue
            eye = spec.get("eye", "L")
            grid = vision.eyes[eye].grids.get(feat)
            if grid is None:
                continue
            flat = grid.reshape(-1)
            rates[name] = (max_hz * flat[self._cells(name, flat.size)]).astype(np.float32)
        return rates
