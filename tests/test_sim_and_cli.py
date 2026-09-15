from flydrones.brain import Brain, build_minifly
from flydrones.calibrate import fit_readout, record_responses
from flydrones.cli import main
from flydrones.config import load_config
from flydrones.drones import SimDrone
from flydrones.runtime import Pilot, run_sim
from flydrones.senses import ScriptedGestures, demo_timeline


def test_gesture_demo_climbs_holds_descends():
    cfg = load_config()
    p = Pilot(Brain(build_minifly(), cfg), SimDrone(start=(-1.5, 0, 0)), cfg, gestures=ScriptedGestures(demo_timeline()))
    run_sim([p], 21)
    alt = {round(h["t"], 2): h["alt"] for h in p.history}
    assert alt[4.5] > alt[2.5] + 0.3  # open palm -> climb
    assert abs(alt[9.0] - alt[6.0]) < 0.25  # fist -> hold
    assert alt[20.95] < alt[15.5] - 0.5  # hand dropped -> descend
    assert p.drone.collisions == 0


def test_calibration_recovers_signs():
    cfg = load_config()
    b = Brain(build_minifly(), cfg)
    outs, X, Y = record_responses(b, cfg, settle_ms=200, measure_ms=600, repeats=1)
    res = fit_readout(outs, X, Y)
    yaw = res["axes"]["yaw"]["terms"]
    thr = res["axes"]["throttle"]["terms"]
    assert yaw["DNg02_R"] > 0 > yaw["DNg02_L"]
    assert thr["DNg02_L"] + thr["DNg02_R"] > 0


def test_cli_demo_and_bench(tmp_path, capsys):
    assert main(["bench", "--ms", "200"]) == 0
    assert main(["demo", "--seconds", "3", "--log", str(tmp_path / "log.csv")]) == 0
    assert (tmp_path / "log.csv").exists()


def test_cli_fly_sim_dry(capsys):
    assert main(["fly", "--drone", "sim", "--input", "camera", "--seconds", "3"]) == 0
