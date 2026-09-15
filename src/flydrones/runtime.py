"""The closed loop: eyes -> brain -> decoder -> safety -> drone -> eyes."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .brain import Brain
from .drones.base import Drone
from .drones.sim import SimDrone
from .motor import FlightCommand, MotorDecoder
from .safety import SafetyGovernor, Telemetry
from .senses import GestureIllusion, InputEncoder, Retina
from .senses.gestures import GestureState


@dataclass
class TickInfo:
    t: float
    frame: np.ndarray | None
    rates: dict[str, float]
    raw: FlightCommand
    cmd: FlightCommand
    tel: Telemetry
    gesture: GestureState | None
    illusion: str
    raster: list = field(default_factory=list)
    rtf: float = float("nan")
    spikes: int = 0
    brain_ms: float = 0.0  # brain clock at the end of this tick


class Pilot:
    """One brain flying one drone."""

    def __init__(self, brain: Brain, drone: Drone, cfg: dict, gestures=None, webcam=None, name: str = "fly-1"):
        self.name = name
        self.brain = brain
        self.drone = drone
        self.cfg = cfg
        self.gestures = gestures
        self.webcam = webcam
        self.retina = Retina.from_config(cfg)
        self.encoder = InputEncoder(brain.connectome, cfg)
        self.decoder = MotorDecoder(cfg)
        self.safety = SafetyGovernor(cfg)
        self.illusion = GestureIllusion()
        self.history: list[dict] = []
        self._t0 = None

    def warmup(self, seconds: float, dt: float = 0.05) -> None:
        """Let the brain settle on the ground (still scene) and measure resting rates."""
        from .motor.command import FlightCommand as _FC

        t = -seconds
        while t < 0:
            frame = self.drone.frame() if self.drone.has_camera else None
            vision = self.retina.encode(frame)
            inputs = self.encoder.encode(vision, 0.0)
            rates = self.brain.tick(inputs, ms=dt * 1000.0)
            self.decoder.update(rates, dt)
            t += dt
        self.drone.send(_FC.hover("warmup done"))

    def tick(self, t: float, dt: float) -> TickInfo:
        frame = self.drone.frame() if self.drone.has_camera else None
        cam = self.webcam.read() if self.webcam is not None else None
        vision = self.retina.encode(frame)
        g = None
        if self.gestures is not None:
            g = self.gestures.read(t, cam)
            vision = self.illusion.apply(vision, g, t)
        tel = self.drone.telemetry()
        inputs = self.encoder.encode(vision, tel.yaw_rate_dps)
        rates = self.brain.tick(inputs, ms=dt * 1000.0)
        raw = self.decoder.update(rates, dt)
        cmd = self.safety.filter(raw, tel, dt)
        if self.safety.land_requested:
            self.drone.land()
        else:
            self.drone.send(cmd)
        self.history.append({"t": t, "alt": tel.alt_m, "x": tel.x_m, "y": tel.y_m, "yaw": tel.yaw_deg, **{f"cmd_{k}": getattr(cmd, k) for k in ("throttle", "yaw", "forward")},
                             "escape": cmd.escape, **{f"hz_{k}": v for k, v in rates.items() if k.startswith("DN")}})
        return TickInfo(t, cam if cam is not None else frame, rates, raw, cmd, tel, g, self.illusion.mode if g is not None else "camera",
                        self.brain.last_raster, self.brain.realtime_factor, int(self.brain.last_counts.sum()),
                        self.brain.net.t_ms)


def run_sim(pilots: list[Pilot], seconds: float, hz: float = 20.0, on_tick=None, physics_substeps: int = 4) -> list[list[TickInfo]]:
    """Run pilots whose drones are SimDrones in simulated time (no sleeping)."""
    dt = 1.0 / hz
    out: list[list[TickInfo]] = [[] for _ in pilots]
    for p in pilots:
        p.drone.connect()
        p.warmup(p.decoder.settle_s + 0.1, dt)
        if p.cfg.get("control", {}).get("takeoff", True):
            p.drone.takeoff()
    steps = int(seconds * hz)
    for k in range(steps):
        t = k * dt
        infos = []
        for i, p in enumerate(pilots):
            info = p.tick(t, dt)
            out[i].append(info)
            infos.append(info)
            assert isinstance(p.drone, SimDrone)
            for _ in range(physics_substeps):
                p.drone.step(dt / physics_substeps)
        if on_tick:
            on_tick(k, infos)
    return out


def run_realtime(pilot: Pilot, seconds: float | None = None, hz: float = 20.0, on_tick=None) -> None:
    """Fly real hardware. Ctrl+C lands."""
    dt_target = 1.0 / hz
    d = pilot.drone
    d.connect()
    try:
        print(f"warming up the brain for {pilot.decoder.settle_s:.1f} s (drone stays on the ground)...")
        pilot.warmup(pilot.decoder.settle_s + 0.1, dt_target)
        if pilot.cfg.get("control", {}).get("takeoff", True):
            d.takeoff()
        t0 = last = time.monotonic()
        while seconds is None or time.monotonic() - t0 < seconds:
            now = time.monotonic()
            dt = min(0.25, max(1e-3, now - last))
            last = now
            info = pilot.tick(now - t0, dt)
            if on_tick and on_tick(info) is False:
                break
            if pilot.safety.land_requested:
                print("safety: landing ->", "; ".join(pilot.safety.events[-3:]))
                break
            if info.rtf < 0.8:
                print(f"warning: brain runs at {info.rtf:.2f}x real time - try a sensorimotor core (build-brain --core-hops 3)")
            sleep = dt_target - (time.monotonic() - now)
            if sleep > 0:
                time.sleep(sleep)
    except KeyboardInterrupt:
        print("\nCtrl+C -> landing")
    finally:
        d.send(FlightCommand.hover("stop"))
        d.land()
        d.close()
