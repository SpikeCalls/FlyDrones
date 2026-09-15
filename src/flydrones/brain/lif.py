"""Event-driven leaky integrate-and-fire (LIF) simulator for whole-connectome models.

Neuron model and default parameters follow the connectome LIF model of
Shiu et al., Nature 2024 ("A Drosophila computational brain model reveals
sensorimotor processing"):

    dv/dt = (v_rest - v + g) / tau_m        (frozen while refractory)
    dg/dt = -g / tau_syn
    spike when v > v_th  ->  v = v_reset, g = 0, refractory for t_ref

A presynaptic spike adds ``w_syn * weight`` to ``g`` of every postsynaptic
partner after ``delay`` ms, where ``weight`` is the signed synapse count
(+ excitatory, - inhibitory). External (camera / IMU) input arrives as Poisson
spike trains with strength ``w_syn * poisson_factor``.

The simulator only touches the synapses of neurons that actually spiked in a
step, so a 166k-neuron / 25M-connection graph runs on a laptop CPU.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
from scipy import sparse


@dataclass
class LIFParams:
    v_rest: float = -52.0  # mV
    v_reset: float = -52.0  # mV
    v_th: float = -45.0  # mV
    tau_m: float = 20.0  # ms, membrane time constant
    tau_syn: float = 5.0  # ms, synaptic time constant
    t_ref: float = 2.2  # ms, refractory period
    delay: float = 1.8  # ms, synaptic delay
    w_syn: float = 0.275  # mV per synapse
    poisson_factor: float = 250.0  # strength multiplier for external input spikes
    dt: float = 0.5  # ms, integration step (Shiu et al. use 0.1 ms; 0.5 ms keeps real time)
    noise_mv: float = 0.0  # optional membrane noise (std, mV per sqrt(ms))

    @classmethod
    def from_dict(cls, d: dict | None) -> LIFParams:
        d = dict(d or {})
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StepStats:
    steps: int = 0
    spikes: int = 0
    synaptic_events: int = 0
    extra: dict = field(default_factory=dict)


class LIFNetwork:
    """Numpy LIF network over a signed sparse connectivity matrix.

    Parameters
    ----------
    weights:
        Sparse matrix of shape (n_post, n_pre) holding signed synapse counts.
    params:
        Neuron / synapse parameters.
    seed:
        RNG seed. Brain copies with different seeds share wiring but not noise.
    """

    def __init__(self, weights: sparse.spmatrix, params: LIFParams | None = None, seed: int | None = 0):
        self.p = params or LIFParams()
        W = sparse.csc_matrix(weights, dtype=np.float32)
        if W.shape[0] != W.shape[1]:
            raise ValueError(f"connectivity must be square, got {W.shape}")
        W.sum_duplicates()
        W.eliminate_zeros()
        self.W = W
        self.n = W.shape[0]
        self._indptr = W.indptr.astype(np.int64)
        self._indices = W.indices.astype(np.int64)
        self._data = (W.data * self.p.w_syn).astype(np.float32)
        self.rng = np.random.default_rng(seed)

        self.delay_steps = max(1, int(round(self.p.delay / self.p.dt)))
        self.ref_steps = max(1, int(round(self.p.t_ref / self.p.dt)))
        self._decay_g = np.float32(np.exp(-self.p.dt / self.p.tau_syn))
        self._k_v = np.float32(self.p.dt / self.p.tau_m)
        self.reset()

        self._input_idx = np.zeros(0, dtype=np.int64)
        self._input_rate = np.zeros(0, dtype=np.float32)
        self.stats = StepStats()

    # ------------------------------------------------------------------ state
    def reset(self) -> None:
        self.v = np.full(self.n, self.p.v_rest, dtype=np.float32)
        self.g = np.zeros(self.n, dtype=np.float32)
        self._buf = np.zeros((self.delay_steps, self.n), dtype=np.float32)
        self._tmp = np.zeros(self.n, dtype=np.float32)
        self._spk_mask = np.zeros(self.n, dtype=bool)
        self._ref_idx = np.zeros(0, dtype=np.int64)
        self._ref_left = np.zeros(0, dtype=np.int32)
        if self.p.noise_mv > 0 and getattr(self, "_noise", None) is None:
            std = np.float32(self.p.noise_mv * np.sqrt(self.p.dt))
            self._noise = [self.rng.standard_normal(self.n, dtype=np.float32) * std for _ in range(16)]
        if not hasattr(self, "bias"):
            self.bias = np.zeros(self.n, dtype=np.float32)
        self._t = 0
        self.t_ms = 0.0

    def copy(self, seed: int | None = None) -> LIFNetwork:
        """A new brain with identical wiring and fresh state (for swarms)."""
        clone = LIFNetwork.__new__(LIFNetwork)
        clone.p = self.p
        clone.W = self.W
        clone.n = self.n
        clone._indptr, clone._indices, clone._data = self._indptr, self._indices, self._data
        clone.rng = np.random.default_rng(seed)
        clone.delay_steps, clone.ref_steps = self.delay_steps, self.ref_steps
        clone._decay_g, clone._k_v = self._decay_g, self._k_v
        clone.bias = self.bias.copy()
        clone._noise = getattr(self, "_noise", None)
        clone.reset()
        clone._input_idx = self._input_idx.copy()
        clone._input_rate = self._input_rate.copy()
        clone.stats = StepStats()
        return clone

    # ------------------------------------------------------------------ input
    def set_input(self, idx: np.ndarray, rates_hz: np.ndarray | float) -> None:
        """Set Poisson input rates (Hz) for neurons ``idx``. Replaces previous input."""
        idx = np.asarray(idx, dtype=np.int64)
        rates = np.broadcast_to(np.asarray(rates_hz, dtype=np.float32), idx.shape)
        keep = rates > 0
        self._input_idx = idx[keep]
        self._input_rate = np.ascontiguousarray(rates[keep])

    def set_bias(self, idx: np.ndarray, mv: np.ndarray | float) -> None:
        """Tonic depolarisation (mV) for neurons ``idx`` - an internal-state drive that
        inhibition can still overcome (unlike strong Poisson kicks)."""
        self.bias[np.asarray(idx, dtype=np.int64)] = np.float32(mv) if np.isscalar(mv) else np.asarray(mv, np.float32)

    def inject(self, idx: np.ndarray, mv: float) -> None:
        """Directly add ``mv`` to the synaptic conductance of neurons (current pulse)."""
        self.g[np.asarray(idx, dtype=np.int64)] += np.float32(mv)

    # ------------------------------------------------------------------ core
    def _propagate(self, spk: np.ndarray) -> np.ndarray | None:
        starts = self._indptr[spk]
        lens = self._indptr[spk + 1] - starts
        total = int(lens.sum())
        if total == 0:
            return None
        self.stats.synaptic_events += total
        if total > 0.25 * self._indices.size:  # dense burst: plain sparse matvec is cheaper
            s = np.zeros(self.n, dtype=np.float32)
            s[spk] = 1.0
            return (self.W @ s).astype(np.float32) * np.float32(self.p.w_syn)
        csum = np.cumsum(lens)
        offs = np.repeat(starts - (csum - lens), lens) + np.arange(total, dtype=np.int64)
        return np.bincount(self._indices[offs], weights=self._data[offs], minlength=self.n).astype(np.float32)

    def step(self) -> np.ndarray:
        """Advance one dt. Returns indices of neurons that spiked.

        Written with in-place numpy ops: at 166k neurons the per-step array
        work, not the synapses, is the main cost.
        """
        p = self.p
        slot = self._t % self.delay_steps
        arriving = self._buf[slot]

        # synaptic input that arrives now (after delay); like Brian2 on_pre it
        # lands even on refractory neurons, only integration is frozen
        self.g += arriving
        arriving.fill(0.0)

        # external Poisson drive
        if self._input_idx.size:
            hit = self.rng.random(self._input_idx.size, dtype=np.float32) < self._input_rate * np.float32(p.dt / 1000.0)
            if hit.any():
                np.add.at(self.g, self._input_idx[hit], np.float32(p.w_syn * p.poisson_factor))

        ref = self._ref_idx
        if ref.size:
            g_frozen = self.g[ref]

        # dv = dt/tau_m * (v_rest - v + g + bias)
        tmp = self._tmp
        np.subtract(np.float32(p.v_rest), self.v, out=tmp)
        tmp += self.g
        tmp += self.bias
        tmp *= self._k_v
        self.v += tmp
        if p.noise_mv > 0:
            bank = self._noise[int(self.rng.integers(len(self._noise)))]
            o = int(self.rng.integers(self.n))
            self.v[: self.n - o] += bank[o:]
            self.v[self.n - o :] += bank[:o]
        self.g *= self._decay_g

        if ref.size:  # refractory neurons stay clamped
            self.v[ref] = p.v_reset
            self.g[ref] = g_frozen
            self._ref_left -= 1
            keep = self._ref_left > 0
            self._ref_idx = ref[keep]
            self._ref_left = self._ref_left[keep]

        np.greater(self.v, p.v_th, out=self._spk_mask)
        spk = np.flatnonzero(self._spk_mask)
        if spk.size:
            self.v[spk] = p.v_reset
            self.g[spk] = 0.0
            self._ref_idx = np.concatenate([self._ref_idx, spk])
            self._ref_left = np.concatenate([self._ref_left, np.full(spk.size, self.ref_steps, np.int32)])
            out = self._propagate(spk)
            if out is not None:
                self._buf[slot] += out  # read again after delay_steps steps
            self.stats.spikes += int(spk.size)

        self._t += 1
        self.t_ms += p.dt
        self.stats.steps += 1
        return spk

    def run(self, ms: float, record: np.ndarray | None = None) -> tuple[np.ndarray, list[tuple[float, np.ndarray]]]:
        """Run for ``ms`` milliseconds.

        Returns (spike_counts_per_neuron, raster) where raster holds
        (t_ms, recorded_neuron_positions) for neurons in ``record``.
        """
        steps = max(1, int(round(ms / self.p.dt)))
        counts = np.zeros(self.n, dtype=np.int32)
        raster: list[tuple[float, np.ndarray]] = []
        rec_lookup = None
        if record is not None and len(record):
            rec_lookup = np.full(self.n, -1, dtype=np.int64)
            rec_lookup[np.asarray(record)] = np.arange(len(record))
        for _ in range(steps):
            spk = self.step()
            if spk.size:
                counts[spk] += 1
                if rec_lookup is not None:
                    pos = rec_lookup[spk]
                    pos = pos[pos >= 0]
                    if pos.size:
                        raster.append((self.t_ms, pos))
        return counts, raster
