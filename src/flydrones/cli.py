"""flydrones command line."""

from __future__ import annotations

import argparse
import copy
import csv
import sys

import numpy as np

from . import __version__

BANNER = r"""
   ___ _       ___
  | __| |_  _ |   \ _ _ ___ _ _  ___ ___
  | _|| | || || |) | '_/ _ \ ' \/ -_|_-<
  |_| |_|\_, ||___/|_| \___/_||_\___/__/
         |__/   fruit fly connectome -> drone
"""


def _cfg(args):
    from .config import load_config

    over = {}
    if getattr(args, "brain", None):
        over.setdefault("brain", {})["source"] = args.brain
    return load_config(getattr(args, "config", None), over)


def _brain(cfg, quiet: bool = False):
    from .brain import Brain, load_connectome

    c = load_connectome(cfg["brain"]["source"])
    if not quiet:
        print(c.summary())
    return Brain(c, cfg)


def _record_or_show(dash, frames, infos, args, k):
    if args.record:
        if k % max(1, args.every) == 0:
            frames.append(dash.render(infos))
        else:
            dash.push(infos)
    elif getattr(args, "live", False):
        if k % 2 == 0:
            if not _record_or_show.window.show(dash.render(infos)):
                raise KeyboardInterrupt
        else:
            dash.push(infos)


_record_or_show.window = None


# ---------------------------------------------------------------- commands
def cmd_demo(args) -> int:
    from .drones import SimDrone
    from .runtime import Pilot, run_sim
    from .senses import ScriptedGestures, demo_timeline
    from .viz import Dashboard, LiveWindow, save_gif

    print(BANNER)
    cfg = _cfg(args)
    brain = _brain(cfg)
    pilot = Pilot(brain, SimDrone(start=(-1.5, 0.0, 0.0)), cfg, gestures=ScriptedGestures(demo_timeline()))
    dash = Dashboard(brain, [pilot], title="FlyDrones · hand -> fly eyes -> fly brain -> drone")
    frames: list = []
    if args.live:
        _record_or_show.window = LiveWindow()
    last_label = [""]

    def on_tick(k, infos):
        i = infos[0]
        label = i.illusion + (" | ESCAPE" if i.cmd.escape else "")
        if label != last_label[0]:
            print(f"t={i.t:5.1f}s alt={i.tel.alt_m:4.2f} m  {label}")
            last_label[0] = label
        _record_or_show(dash, frames, infos, args, k)

    try:
        run_sim([pilot], args.seconds, hz=cfg["control"]["hz"], on_tick=on_tick)
    except KeyboardInterrupt:
        pass
    print(f"collisions: {pilot.drone.collisions}")
    if args.record and frames:
        save_gif(frames, args.record, fps=int(cfg["control"]["hz"] / max(1, args.every)))
        print(f"saved {len(frames)} frames -> {args.record}")
    if args.log:
        _write_log(args.log, pilot.history)
    return 0


def cmd_swarm(args) -> int:
    from .drones import SimDrone
    from .runtime import Pilot, run_sim
    from .senses import GestureState, ScriptedGestures
    from .viz import Dashboard, LiveWindow, save_gif

    print(BANNER)
    cfg = _cfg(args)
    brain = _brain(cfg)
    roles = [
        ("hover", (-1.6, -1.4, 0.0), 0.0, 0.0, None),
        ("cruise", (-0.9, 0.05, 0.0), 0.0, 0.35, None),
        ("follow-hand", (-1.6, 1.0, 0.0), 0.0, 0.0,
         ScriptedGestures([(0.0, GestureState(True, 0.1, 0, 0, 0.15, "fist")), (6.0, GestureState(False, 0, 0, 1, 0, "dropped"))])),
    ]
    pilots = []
    for i, (_role, start, yaw, cruise, gest) in enumerate(roles[: args.n] + [roles[0]] * max(0, args.n - len(roles))):
        c = copy.deepcopy(cfg)
        c["decoder"]["cruise"] = cruise
        b = brain if i == 0 else brain.copy(seed=1000 + i)
        pilots.append(Pilot(b, SimDrone(start=start, yaw_deg=yaw, seed=i), c, gestures=gest, name=f"fly-{i + 1}"))
    print(f"1 connectome -> {len(pilots)} independent brains (same wiring, own spikes and noise)")
    dash = Dashboard(pilots[0].brain, pilots, title=f"FlyDrones · 1 fly brain, {len(pilots)} pilots")
    frames: list = []
    if args.live:
        _record_or_show.window = LiveWindow()
    try:
        run_sim(pilots, args.seconds, hz=cfg["control"]["hz"], on_tick=lambda k, infos: _record_or_show(dash, frames, infos, args, k))
    except KeyboardInterrupt:
        pass
    for p in pilots:
        h = p.history
        esc = sum(1 for a, b in zip(h, h[1:]) if b["escape"] and not a["escape"])
        print(f"{p.name}: final alt {h[-1]['alt']:.2f} m, pos ({h[-1]['x']:.2f}, {h[-1]['y']:.2f}), escapes {esc}, collisions {p.drone.collisions}")
    if args.record and frames:
        save_gif(frames, args.record, fps=int(cfg["control"]["hz"] / max(1, args.every)))
        print(f"saved {len(frames)} frames -> {args.record}")
    return 0


def cmd_fly(args) -> int:
    from .drones import DryRunDrone, make_drone
    from .runtime import Pilot, run_realtime

    print(BANNER)
    cfg = _cfg(args)
    brain = _brain(cfg)
    kw = {}
    if args.drone == "mavlink":
        kw = {"connection": args.mavlink, "autopilot": args.autopilot}
    elif args.drone == "esp32":
        kw = {"host": args.esp32_host}
    elif args.drone == "crazyflie":
        kw = {"uri": args.uri}
    drone = make_drone(args.drone, **kw) if args.send or args.drone == "sim" else None
    if drone is None:
        drone = DryRunDrone(_Stub(args.drone))
        print("DRY RUN: nothing will fly. Re-run with --send when the drone is in a safe, open space.")

    webcam = gestures = None
    if args.input in ("gesture", "both"):
        from .senses import make_gesture_source
        from .senses.webcam import Webcam

        webcam = Webcam(args.webcam)
        gestures = make_gesture_source(args.gestures)
    pilot = Pilot(brain, drone, cfg, gestures=gestures, webcam=webcam)
    if args.input == "gesture" and drone.has_camera:
        drone.has_camera = False  # hand only

    window = None
    dash = None
    if args.live:
        from .viz import Dashboard, LiveWindow

        window = LiveWindow()
        dash = Dashboard(brain, [pilot], title=f"FlyDrones · {args.drone}")

    tick = [0]

    def on_tick(info):
        tick[0] += 1
        if window is None:
            return True
        if tick[0] % 2 == 0:
            return window.show(dash.render([info]))
        dash.push([info])
        return True

    if args.drone == "sim":
        from .runtime import run_sim

        run_sim([pilot], args.seconds or 30, hz=cfg["control"]["hz"], on_tick=lambda k, infos: on_tick(infos[0]))
    else:
        run_realtime(pilot, args.seconds, hz=cfg["control"]["hz"], on_tick=on_tick)
    if args.log:
        _write_log(args.log, pilot.history)
    return 0


class _Stub:
    def __init__(self, name):
        self.name = name
        self.has_camera = False


def cmd_download(args) -> int:
    from .data import download_malecns

    download_malecns(args.dir)
    print("next: flydrones build-brain")
    return 0


def cmd_build(args) -> int:
    from .brain import Brain, build_malecns
    from .config import load_config

    cfg = load_config(args.config)
    c = build_malecns(args.data_dir, min_synapses=args.min_synapses)
    print(c.summary())
    b = Brain(c, cfg)  # resolves groups and warns about empty ones
    for name in list(b.input_specs) + list(b.output_specs):
        print(f"  {name:10s} {c.group(name).size:6d} neurons")
    if args.core_hops:
        c = c.sensorimotor_core(args.core_hops, args.max_neurons)
        print("sensorimotor core:", c.summary())
    out = c.save(args.out)
    print(f"saved -> {out}\nuse it: flydrones demo --brain {out}")
    return 0


def cmd_inspect(args) -> int:
    cfg = _cfg(args)
    brain = _brain(cfg)
    c = brain.connectome
    print("\ninput groups:")
    for k in brain.input_specs:
        print(f"  {k:10s} {c.group(k).size:6d}  types={brain.input_specs[k].types} side={brain.input_specs[k].side}")
    print("output groups:")
    for k in brain.output_specs:
        print(f"  {k:10s} {c.group(k).size:6d}  {brain.output_specs[k].note}")
    print("\npoke test (500 ms each):")
    brain.tick({}, 500)
    for g in [k for k in brain.input_specs if c.group(k).size]:
        r = brain.stimulate(g, args.hz, 500)
        print(f"  {g:10s} -> " + "  ".join(f"{k}={r[k]:5.1f}" for k in brain.output_specs))
    return 0


def cmd_calibrate(args) -> int:
    from .calibrate import calibrate

    cfg = _cfg(args)
    brain = _brain(cfg)
    calibrate(brain, cfg, args.out)
    return 0


def cmd_bench(args) -> int:
    import time

    cfg = _cfg(args)
    brain = _brain(cfg)
    rng = np.random.default_rng(0)
    inputs = {k: rng.random(brain.connectome.group(k).size) * 60 for k in brain.input_specs}
    brain.tick(inputs, 100)
    t0 = time.perf_counter()
    brain.tick(inputs, args.ms)
    wall = time.perf_counter() - t0
    st = brain.net.stats
    print(f"{args.ms:.0f} ms of brain time in {wall * 1000:.0f} ms wall -> {args.ms / 1000 / wall:.2f}x real time")
    print(f"dt={brain.net.p.dt} ms, spikes so far {st.spikes:,}, synaptic events {st.synaptic_events:,}")
    return 0


def _write_log(path, rows) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"log -> {path}")


# ---------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="flydrones", description="Plug a fruit fly connectome into a drone.")
    p.add_argument("--version", action="version", version=f"flydrones {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--config", help="YAML file overriding defaults")
        sp.add_argument("--brain", help="minifly or path to a built .npz brain")

    sp = sub.add_parser("demo", help="simulated drone + scripted hand gestures")
    common(sp)
    sp.add_argument("--seconds", type=float, default=22)
    sp.add_argument("--record", help="save a GIF of the dashboard")
    sp.add_argument("--every", type=int, default=2, help="record every Nth control tick")
    sp.add_argument("--live", action="store_true", help="show the dashboard in a window (needs OpenCV)")
    sp.add_argument("--log", help="write a CSV flight log")
    sp.set_defaults(func=cmd_demo)

    sp = sub.add_parser("swarm", help="one connectome, several drone pilots (simulated)")
    common(sp)
    sp.add_argument("--n", type=int, default=3)
    sp.add_argument("--seconds", type=float, default=20)
    sp.add_argument("--record")
    sp.add_argument("--every", type=int, default=2)
    sp.add_argument("--live", action="store_true")
    sp.set_defaults(func=cmd_swarm)

    sp = sub.add_parser("fly", help="fly a real drone (dry run unless --send)")
    common(sp)
    sp.add_argument("--drone", choices=["sim", "tello", "crazyflie", "mavlink", "esp32"], default="tello")
    sp.add_argument("--input", choices=["camera", "gesture", "both"], default="both",
                    help="camera = drone camera optic flow, gesture = webcam hand, both = both")
    sp.add_argument("--send", action="store_true", help="really send commands to the drone")
    sp.add_argument("--seconds", type=float)
    sp.add_argument("--webcam", default="0")
    sp.add_argument("--gestures", default="auto", choices=["auto", "mediapipe", "opencv", "scripted"])
    sp.add_argument("--mavlink", default="udpin:0.0.0.0:14550")
    sp.add_argument("--autopilot", default="ardupilot", choices=["ardupilot", "px4"])
    sp.add_argument("--esp32-host", default="192.168.4.1")
    sp.add_argument("--uri", default="radio://0/80/2M/E7E7E7E7E7")
    sp.add_argument("--live", action="store_true")
    sp.add_argument("--log")
    sp.set_defaults(func=cmd_fly)

    sp = sub.add_parser("download", help="download connectome data")
    sp.add_argument("dataset", choices=["malecns"])
    sp.add_argument("--dir", default="data/malecns_v1")
    sp.set_defaults(func=cmd_download)

    sp = sub.add_parser("build-brain", help="build a signed connectome .npz from MaleCNS v1.0")
    sp.add_argument("--data-dir", default="data/malecns_v1")
    sp.add_argument("--config")
    sp.add_argument("--min-synapses", type=int, default=3)
    sp.add_argument("--core-hops", type=int, default=0, help="keep only neurons within N synapses of inputs and outputs")
    sp.add_argument("--max-neurons", type=int)
    sp.add_argument("--out", default="data/malecns_brain.npz")
    sp.set_defaults(func=cmd_build)

    sp = sub.add_parser("inspect", help="list input/output groups and poke each input")
    common(sp)
    sp.add_argument("--hz", type=float, default=100)
    sp.set_defaults(func=cmd_inspect)

    sp = sub.add_parser("calibrate", help="fit the descending-neuron read-out for this brain")
    common(sp)
    sp.add_argument("--out", default="readout.json")
    sp.set_defaults(func=cmd_calibrate)

    sp = sub.add_parser("bench", help="measure simulation speed")
    common(sp)
    sp.add_argument("--ms", type=float, default=1000)
    sp.set_defaults(func=cmd_bench)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
