"""The MaleCNS builder on a tiny fake dataset with the real column names."""

import numpy as np
import pytest

pa = pytest.importorskip("pyarrow")
import pyarrow.feather as feather  # noqa: E402

from flydrones.brain import Brain, build_malecns  # noqa: E402
from flydrones.brain.connectome import MALECNS_FILES  # noqa: E402
from flydrones.config import load_config  # noqa: E402


def make_fake(tmp_path):
    ids = np.array([101, 102, 103, 104, 105, 106], dtype=np.int64)
    ann = pa.table({
        "bodyId": ids,
        "type": ["LPLC2", "LPLC2", "DNp01", "DNg02", "DNg02", "glia-x"],
        "rootSide": ["L", "R", "L", "L", "R", "L"],
        "superclass": ["visual_projection", "visual_projection", "descending", "descending", "descending", ""],
        "status": ["Traced", "Traced", "Traced", "Traced", "Traced", "Glia"],
    })
    nt = pa.table({"body": ids, "consensus_nt": ["acetylcholine", "acetylcholine", "acetylcholine", "gaba", "acetylcholine", "unclear"]})
    w = pa.table({
        "body_pre": np.array([101, 102, 104, 101, 999, 106], dtype=np.int64),
        "body_post": np.array([103, 103, 105, 104, 103, 101], dtype=np.int64),
        "weight": np.array([12, 2, 7, 5, 30, 9], dtype=np.int32),
    })
    feather.write_feather(ann, tmp_path / MALECNS_FILES["annotations"])
    feather.write_feather(nt, tmp_path / MALECNS_FILES["neurotransmitters"])
    feather.write_feather(w, tmp_path / MALECNS_FILES["weights"])


def test_build_malecns(tmp_path):
    make_fake(tmp_path)
    c = build_malecns(tmp_path, min_synapses=3, verbose=False)
    assert c.n == 5  # glia dropped
    # kept: 101->103 (12), 104->105 (-7, GABA), 101->104 (5); dropped: weight 2, unknown body, glia
    assert c.n_connections == 3
    W = c.weights.toarray()
    idx = {int(b): i for i, b in enumerate(c.body_ids)}
    assert W[idx[103], idx[101]] == 12
    assert W[idx[105], idx[104]] == -7
    b = Brain(c, load_config())
    assert c.group("LPLC2_L").size == 1 and c.group("DNg02_R").size == 1
    assert "T4a_L" in b.empty
    path = c.save(tmp_path / "brain.npz")
    assert path.exists()
