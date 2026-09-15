import numpy as np

from flydrones.brain import Brain, Connectome, build_minifly
from flydrones.config import load_config


def brain():
    cfg = load_config()
    return Brain(build_minifly(), cfg), cfg


def test_minifly_groups_resolve():
    b, cfg = brain()
    for name in list(cfg["inputs"]) + list(cfg["outputs"]):
        assert b.connectome.group(name).size > 0, name


def test_optomotor_and_lift_responses():
    b, _ = brain()
    b.tick({}, 800)
    rest = b.tick({}, 800)
    up = b.tick({"T4c_L": 80, "T4c_R": 80}, 800)
    b.tick({}, 400)
    right = b.tick({"T4a_R": 80, "T4b_L": 80}, 800)
    lift_rest = rest["DNg02_L"] + rest["DNg02_R"]
    assert up["DNg02_L"] + up["DNg02_R"] > lift_rest * 1.3
    assert right["DNg02_R"] > right["DNg02_L"] + 8


def test_looming_drives_giant_fiber_and_saccade_side():
    b, _ = brain()
    b.tick({}, 500)
    r = b.tick({"LPLC2_L": 150, "LC4_L": 120}, 600)
    assert r["DNp01_L"] > r["DNp01_R"]
    assert r["DNp03_L"] > r["DNp03_R"]


def test_save_load_roundtrip(tmp_path):
    c = build_minifly()
    c.groups["x"] = np.array([1, 2, 3])
    path = c.save(tmp_path / "b.npz")
    d = Connectome.load(path)
    assert d.n == c.n and d.n_connections == c.n_connections
    assert list(d.group("x")) == [1, 2, 3]


def test_sensorimotor_core_keeps_io():
    b, _ = brain()
    core = b.connectome.sensorimotor_core(hops=4)
    assert core.n <= b.connectome.n
    assert core.group("DNg02_L").size == b.connectome.group("DNg02_L").size


def test_swarm_copy_independent():
    b, _ = brain()
    c = b.copy(seed=99)
    assert c.connectome is b.connectome
    b.tick({"T4c_L": 100}, 200)
    assert c.net.t_ms == 0.0
