"""Connectome container, neuron-group selection and the MaleCNS v1.0 builder.

A :class:`Connectome` is just a signed synapse-count matrix plus per-neuron
labels (cell type, side, superclass). Everything else in FlyDrones talks to
neurons through *groups*: named sets of neurons selected by cell-type regex and
side, e.g. ``DNg02_L = type ~ ^DNg02$ and side == L``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import sparse

# Neurotransmitter -> sign. Acetylcholine is the main excitatory transmitter in the
# fly CNS; GABA and glutamate (via GluCl) are treated as inhibitory, as in
# Shiu et al. 2024. Histamine is inhibitory (photoreceptor output).
# Modulatory amines are treated as weakly excitatory by default.
NT_SIGN = {
    "acetylcholine": 1.0,
    "ach": 1.0,
    "gaba": -1.0,
    "glutamate": -1.0,
    "glu": -1.0,
    "histamine": -1.0,
    "his": -1.0,
    "dopamine": 1.0,
    "da": 1.0,
    "serotonin": 1.0,
    "5ht": 1.0,
    "octopamine": 1.0,
    "oa": 1.0,
}


@dataclass
class GroupSpec:
    """How to find a neuron group inside a connectome."""

    name: str
    types: list[str]
    side: str | None = None  # "L", "R" or None for both
    role: str = "hidden"  # "input", "output" or "hidden"
    note: str = ""

    @classmethod
    def from_dict(cls, name: str, d: dict) -> GroupSpec:
        types = d.get("types") or d.get("type") or []
        if isinstance(types, str):
            types = [types]
        return cls(name=name, types=list(types), side=d.get("side"), role=d.get("role", "hidden"), note=d.get("note", ""))


@dataclass
class Connectome:
    name: str
    weights: sparse.csc_matrix  # (post, pre) signed synapse counts
    types: np.ndarray  # str per neuron
    sides: np.ndarray  # "L" / "R" / "" per neuron
    superclass: np.ndarray | None = None
    body_ids: np.ndarray | None = None
    groups: dict[str, np.ndarray] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return self.weights.shape[0]

    @property
    def n_connections(self) -> int:
        return int(self.weights.nnz)

    @property
    def n_synapses(self) -> int:
        return int(np.abs(self.weights.data).sum())

    def summary(self) -> str:
        return (
            f"{self.name}: {self.n:,} neurons, {self.n_connections:,} directed connections, "
            f"{self.n_synapses:,} synapses in kept connections"
        )

    # ------------------------------------------------------------- selection
    def select(self, type_patterns: list[str] | str, side: str | None = None) -> np.ndarray:
        if isinstance(type_patterns, str):
            type_patterns = [type_patterns]
        mask = np.zeros(self.n, dtype=bool)
        types = self.types.astype(str)
        for pat in type_patterns:
            rx = re.compile(pat)
            mask |= np.fromiter((bool(rx.search(t)) for t in types), dtype=bool, count=self.n)
        if side:
            mask &= self.sides.astype(str) == side
        return np.flatnonzero(mask)

    def resolve_groups(self, specs: dict[str, GroupSpec]) -> dict[str, np.ndarray]:
        for name, spec in specs.items():
            self.groups[name] = self.select(spec.types, spec.side)
        return self.groups

    def group(self, name: str) -> np.ndarray:
        return self.groups.get(name, np.zeros(0, dtype=np.int64))

    # ------------------------------------------------------------- io
    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        W = self.weights.tocsc()
        np.savez_compressed(
            path,
            indptr=W.indptr,
            indices=W.indices,
            data=W.data.astype(np.float32),
            shape=np.array(W.shape),
            types=self.types.astype(str),
            sides=self.sides.astype(str),
            superclass=(self.superclass if self.superclass is not None else np.array([], dtype=str)).astype(str),
            body_ids=self.body_ids if self.body_ids is not None else np.array([], dtype=np.int64),
            groups=json.dumps({k: v.tolist() for k, v in self.groups.items()}),
            meta=json.dumps({"name": self.name, **self.meta}),
        )
        return path

    @classmethod
    def load(cls, path: str | Path) -> Connectome:
        z = np.load(path, allow_pickle=False)
        W = sparse.csc_matrix((z["data"], z["indices"], z["indptr"]), shape=tuple(z["shape"]))
        meta = json.loads(str(z["meta"]))
        groups = {k: np.asarray(v, dtype=np.int64) for k, v in json.loads(str(z["groups"])).items()}
        sc = z["superclass"]
        bid = z["body_ids"]
        return cls(
            name=meta.pop("name", Path(path).stem),
            weights=W,
            types=z["types"],
            sides=z["sides"],
            superclass=sc if sc.size else None,
            body_ids=bid if bid.size else None,
            groups=groups,
            meta=meta,
        )

    # ------------------------------------------------------------- subgraph
    def subgraph(self, keep: np.ndarray, name: str | None = None) -> Connectome:
        keep = np.unique(np.asarray(keep, dtype=np.int64))
        remap = np.full(self.n, -1, dtype=np.int64)
        remap[keep] = np.arange(keep.size)
        W = self.weights.tocsr()[keep][:, keep].tocsc()
        groups = {}
        for g, idx in self.groups.items():
            m = remap[idx]
            groups[g] = m[m >= 0]
        return Connectome(
            name=name or f"{self.name}-sub{keep.size}",
            weights=W,
            types=self.types[keep],
            sides=self.sides[keep],
            superclass=None if self.superclass is None else self.superclass[keep],
            body_ids=None if self.body_ids is None else self.body_ids[keep],
            groups=groups,
            meta={**self.meta, "parent": self.name, "subgraph_neurons": int(keep.size)},
        )

    def sensorimotor_core(self, hops: int = 3, max_neurons: int | None = None) -> Connectome:
        """Keep neurons within ``hops`` synapses downstream of inputs AND upstream of outputs.

        This removes circuits that cannot influence the drone within a few
        synapses and makes the model several times faster.
        """
        inputs = np.concatenate([v for k, v in self.groups.items() if self.meta.get("roles", {}).get(k) == "input"] or [np.zeros(0, np.int64)])
        outputs = np.concatenate([v for k, v in self.groups.items() if self.meta.get("roles", {}).get(k) == "output"] or [np.zeros(0, np.int64)])
        if inputs.size == 0 or outputs.size == 0:
            raise ValueError("sensorimotor_core needs resolved input and output groups (meta['roles'])")
        A = (self.weights != 0).astype(np.int8)  # (post, pre)
        down = _reach(A, inputs, hops)
        up = _reach(A.T.tocsc(), outputs, hops)
        keep = np.flatnonzero(down & up)
        keep = np.union1d(keep, np.union1d(inputs, outputs))
        if max_neurons and keep.size > max_neurons:
            # keep the most connected intermediates
            deg = np.asarray(np.abs(self.weights[keep][:, keep]).sum(axis=0)).ravel()
            order = np.argsort(-deg)
            must = np.isin(keep, np.union1d(inputs, outputs))
            chosen = keep[must]
            rest = keep[order][~must[order]][: max(0, max_neurons - chosen.size)]
            keep = np.union1d(chosen, rest)
        return self.subgraph(keep, name=f"{self.name}-core{hops}")


def _reach(A: sparse.spmatrix, seeds: np.ndarray, hops: int) -> np.ndarray:
    """Boolean mask of nodes reachable from seeds in <= hops along A (post, pre)."""
    n = A.shape[0]
    frontier = np.zeros(n, dtype=np.float32)
    frontier[seeds] = 1
    seen = frontier > 0
    A = sparse.csr_matrix(A, dtype=np.float32)
    for _ in range(hops):
        frontier = (A @ frontier > 0).astype(np.float32)
        frontier[seen] = 0
        if not frontier.any():
            break
        seen |= frontier > 0
    return seen


# ---------------------------------------------------------------------------
# MaleCNS v1.0 (Janelia FlyEM + Cambridge + MRC LMB + Google Research, CC-BY)
# ---------------------------------------------------------------------------

MALECNS_BASE = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome"
MALECNS_FILES = {
    "annotations": "body-annotations-male-cns-v1.0-minconf-0.5.feather",
    "neurotransmitters": "body-neurotransmitters-male-cns-v1.0.feather",
    "weights": "connectome-weights-male-cns-v1.0-minconf-0.5.feather",
}


def _pick(cols, *candidates):
    low = {c.lower(): c for c in cols}
    for c in candidates:
        if c.lower() in low:
            return low[c.lower()]
    return None


def build_malecns(
    data_dir: str | Path,
    min_synapses: int = 3,
    nt_default_sign: float = 1.0,
    drop_status: tuple[str, ...] = ("Glia",),
    verbose: bool = True,
) -> Connectome:
    """Build a signed connectome from the MaleCNS v1.0 flat feather files.

    Requires ``pyarrow`` (``pip install flydrones[data]``). Uses ~4-6 GB RAM
    while filtering the 1.1 GB weights table; the resulting .npz is small.
    """
    try:
        import pyarrow.feather as feather
        import pyarrow.ipc as ipc
    except ImportError as e:  # pragma: no cover - optional dependency
        raise SystemExit("pyarrow is required: pip install 'flydrones[data]'") from e

    data_dir = Path(data_dir)
    log = print if verbose else (lambda *a, **k: None)

    ann = feather.read_table(data_dir / MALECNS_FILES["annotations"]).to_pandas()
    body_col = _pick(ann.columns, "bodyId", "body_id", "body")
    type_col = _pick(ann.columns, "type", "cell_type", "celltype")
    side_col = _pick(ann.columns, "rootSide", "somaSide", "side", "root_side", "soma_side")
    sc_col = _pick(ann.columns, "superclass", "super_class")
    status_col = _pick(ann.columns, "status", "statusLabel")
    if body_col is None or type_col is None:
        raise ValueError(f"unexpected annotation columns: {list(ann.columns)[:30]}")

    keep = ann[body_col].notna()
    if sc_col:
        keep &= ann[sc_col].notna() & (ann[sc_col].astype(str) != "")
    if status_col:
        keep &= ~ann[status_col].astype(str).isin(drop_status)
    ann = ann[keep].reset_index(drop=True)
    log(f"annotations: kept {len(ann):,} neurons")

    body_ids = ann[body_col].to_numpy(np.int64)
    order = np.argsort(body_ids)
    body_sorted = body_ids[order]

    # neurotransmitter signs
    signs = np.full(len(ann), nt_default_sign, dtype=np.float32)
    nt_path = data_dir / MALECNS_FILES["neurotransmitters"]
    if nt_path.exists():
        nt = feather.read_table(nt_path).to_pandas()
        nb = _pick(nt.columns, "body", "bodyId", "body_id")
        nc = _pick(nt.columns, "consensus_nt", "consensusNt", "predicted_nt", "predictedNt")
        if nb and nc:
            m = dict(zip(nt[nb].to_numpy(np.int64), nt[nc].astype(str).str.lower()))
            for i, b in enumerate(body_ids):
                s = NT_SIGN.get(m.get(int(b), ""), None)
                if s is not None:
                    signs[i] = s
    log(f"inhibitory neurons: {(signs < 0).sum():,}")

    # stream the weights table batch by batch
    rows, cols, vals = [], [], []
    src = ipc.open_file(str(data_dir / MALECNS_FILES["weights"]))
    total = 0
    for b in range(src.num_record_batches):
        batch = src.get_batch(b)
        names = batch.schema.names
        pre = batch.column(names.index(_pick(names, "body_pre", "pre", "bodyId_pre"))).to_numpy()
        post = batch.column(names.index(_pick(names, "body_post", "post", "bodyId_post"))).to_numpy()
        w = batch.column(names.index(_pick(names, "weight", "synapses", "count"))).to_numpy()
        total += len(w)
        ok = w >= min_synapses
        pre, post, w = pre[ok], post[ok], w[ok]
        ip = np.searchsorted(body_sorted, pre)
        iq = np.searchsorted(body_sorted, post)
        ip = np.clip(ip, 0, len(body_sorted) - 1)
        iq = np.clip(iq, 0, len(body_sorted) - 1)
        ok = (body_sorted[ip] == pre) & (body_sorted[iq] == post) & (pre != post)
        pi, qi = order[ip[ok]], order[iq[ok]]
        rows.append(qi)
        cols.append(pi)
        vals.append(w[ok].astype(np.float32) * signs[pi])
    rows = np.concatenate(rows)
    cols = np.concatenate(cols)
    vals = np.concatenate(vals)
    n = len(ann)
    W = sparse.csc_matrix((vals, (rows, cols)), shape=(n, n), dtype=np.float32)
    log(f"weights: scanned {total:,} rows, kept {W.nnz:,} connections (>= {min_synapses} synapses)")

    sides = ann[side_col].astype(str).str.upper().str[:1].replace({"N": "", "U": ""}).to_numpy() if side_col else np.array([""] * n)
    return Connectome(
        name="malecns-v1.0",
        weights=W,
        types=ann[type_col].fillna("").astype(str).to_numpy(),
        sides=sides,
        superclass=ann[sc_col].astype(str).to_numpy() if sc_col else None,
        body_ids=body_ids,
        meta={
            "source": MALECNS_BASE,
            "license": "MaleCNS data: CC-BY 4.0 (Janelia FlyEM, Cambridge, MRC LMB, Google Research)",
            "min_synapses": min_synapses,
        },
    )
