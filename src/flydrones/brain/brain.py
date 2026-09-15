"""Brain = connectome + LIF dynamics + named input/output groups."""

from __future__ import annotations

import time
import warnings
from pathlib import Path

import numpy as np

from .connectome import Connectome, GroupSpec
from .lif import LIFNetwork, LIFParams
from .synthetic import build_minifly


def load_connectome(source: str | Path) -> Connectome:
    if str(source).lower() in ("minifly", "synthetic", "mini"):
        return build_minifly()
    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(
            f"brain file {path} not found. Run `flydrones download malecns` and "
            "`flydrones build-brain` first, or use brain.source: minifly"
        )
    return Connectome.load(path)


class Brain:
    """A simulated fly brain with sensory entry points and motor read-outs."""

    def __init__(self, connectome: Connectome, cfg: dict, seed: int | None = None, _net: LIFNetwork | None = None):
        self.cfg = cfg
        self.connectome = connectome
        bcfg = cfg.get("brain", {})
        self.input_specs = {k: GroupSpec.from_dict(k, v) for k, v in cfg.get("inputs", {}).items()}
        self.output_specs = {k: GroupSpec.from_dict(k, v) for k, v in cfg.get("outputs", {}).items()}
        for s in self.input_specs.values():
            s.role = "input"
        for s in self.output_specs.values():
            s.role = "output"

        connectome.resolve_groups({**self.input_specs, **self.output_specs})  # always follow the current config
        connectome.meta.setdefault("roles", {})
        connectome.meta["roles"].update({k: "input" for k in self.input_specs})
        connectome.meta["roles"].update({k: "output" for k in self.output_specs})

        self.empty = [k for k in {**self.input_specs, **self.output_specs} if connectome.group(k).size == 0]
        if self.empty:
            warnings.warn(f"groups with no matching neurons in {connectome.name}: {', '.join(self.empty)}", stacklevel=2)

        params = LIFParams.from_dict(bcfg.get("lif"))
        seed = bcfg.get("seed", 0) if seed is None else seed
        self.net = _net if _net is not None else LIFNetwork(connectome.weights, params, seed=seed)
        for g, mv in (bcfg.get("bias") or {}).items():
            idx = connectome.group(g)
            if idx.size:
                self.net.set_bias(idx, float(mv))

        rng = np.random.default_rng(seed)
        n_rec = int(bcfg.get("record_neurons", 400))
        outs = np.concatenate([connectome.group(k) for k in self.output_specs] or [np.zeros(0, np.int64)])
        pool = np.setdiff1d(np.arange(connectome.n), outs)
        extra = rng.choice(pool, size=min(max(0, n_rec - outs.size), pool.size), replace=False) if pool.size else pool
        self.record = np.concatenate([np.sort(extra), outs]).astype(np.int64)
        self.last_raster: list[tuple[float, np.ndarray]] = []
        self.last_rates: dict[str, float] = {}
        self.realtime_factor = float("nan")

    # ------------------------------------------------------------------
    def copy(self, seed: int) -> Brain:
        """Same wiring, independent neural state and noise (one fly -> many pilots)."""
        return Brain(self.connectome, self.cfg, seed=seed, _net=self.net.copy(seed=seed))

    @property
    def n_neurons(self) -> int:
        return self.connectome.n

    def tick(self, input_rates: dict[str, np.ndarray | float], ms: float) -> dict[str, float]:
        """Apply input rates (Hz per neuron), simulate ``ms`` milliseconds, return output rates (Hz)."""
        idx_all, rate_all = [], []
        for name, rates in input_rates.items():
            idx = self.connectome.group(name)
            if idx.size == 0:
                continue
            r = np.broadcast_to(np.asarray(rates, dtype=np.float32), idx.shape)
            idx_all.append(idx)
            rate_all.append(r)
        if idx_all:
            self.net.set_input(np.concatenate(idx_all), np.concatenate(rate_all))
        else:
            self.net.set_input(np.zeros(0, np.int64), 0.0)

        t0 = time.perf_counter()
        counts, raster = self.net.run(ms, record=self.record)
        wall = time.perf_counter() - t0
        self.realtime_factor = (ms / 1000.0) / wall if wall > 0 else float("inf")
        self.last_raster = raster
        rates = {}
        for name in list(self.output_specs) + list(self.input_specs):
            idx = self.connectome.group(name)
            rates[name] = float(counts[idx].mean() * 1000.0 / ms) if idx.size else 0.0
        self.last_rates = rates
        self.last_counts = counts
        return rates

    def stimulate(self, group: str, hz: float, ms: float) -> dict[str, float]:
        """Poke one group with Poisson spikes and see what the motor neurons do."""
        return self.tick({group: hz}, ms)
