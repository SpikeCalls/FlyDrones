"""A tiny indoor quadcopter simulator with a ray-cast camera.

The simulated drone behaves like a Tello or a Crazyflie in velocity mode: the
onboard flight controller keeps it level and we command velocities. The
camera renders a textured room (checkered floor, striped walls) plus boxes
such as a chair, so the fly's eyes get real optic flow and looming.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..motor.command import FlightCommand
from ..safety import Telemetry
from .base import Drone


@dataclass
class Box:
    lo: tuple[float, float, float]
    hi: tuple[float, float, float]
    shade: float = 0.18
    name: str = "box"


@dataclass
class Room:
    size_x: float = 6.0
    size_y: float = 6.0
    height: float = 2.7
    boxes: list[Box] = field(default_factory=list)

    @staticmethod
    def bedroom() -> Room:
        return Room(boxes=[
            Box((1.2, -0.25, 0.0), (1.7, 0.25, 1.15), 0.12, "chair"),
            Box((-2.9, 1.2, 0.0), (-1.3, 2.9, 0.55), 0.3, "bed"),
            Box((2.4, -2.9, 0.0), (2.9, -1.9, 1.9), 0.22, "wardrobe"),
        ])


class RayCamera:
    def __init__(self, width: int = 96, height: int = 72, fov_deg: float = 82.0):
        self.w, self.h = width, height
        tx = math.tan(math.radians(fov_deg) / 2)
        ty = tx * height / width
        u = (np.arange(width) + 0.5) / width * 2 - 1
        v = 1 - (np.arange(height) + 0.5) / height * 2
        self.U, self.V = np.meshgrid(u * tx, v * ty)

    def render(self, room: Room, pos: np.ndarray, yaw: float) -> np.ndarray:
        fwd = np.array([math.cos(yaw), math.sin(yaw), 0.0])
        right = np.array([math.sin(yaw), -math.cos(yaw), 0.0])
        d = fwd[None, None, :] + self.U[..., None] * right[None, None, :] + self.V[..., None] * np.array([0, 0, 1.0])
        d /= np.linalg.norm(d, axis=-1, keepdims=True)
        dx, dy, dz = d[..., 0], d[..., 1], d[..., 2]
        px, py, pz = pos
        INF = 1e9
        t_best = np.full(dx.shape, INF)
        shade = np.zeros(dx.shape)

        def safe_div(a, b):
            with np.errstate(divide="ignore", invalid="ignore"):
                r = a / b
            r[~np.isfinite(r) | (r <= 1e-6)] = INF
            return r

        hx, hy = room.size_x / 2, room.size_y / 2
        # walls
        for plane, t in (("x+", safe_div(hx - px, dx)), ("x-", safe_div(-hx - px, dx)), ("y+", safe_div(hy - py, dy)), ("y-", safe_div(-hy - py, dy))):
            m = t < t_best
            if m.any():
                along = (py + t * dy) if plane[0] == "x" else (px + t * dx)
                zz = pz + t * dz
                stripe = (np.floor(along / 0.3) % 2) * 0.35 + 0.35
                band = np.where((np.floor(zz / 0.45) % 2) == 0, 1.0, 0.8)
                shade = np.where(m, stripe * band, shade)
                t_best = np.where(m, t, t_best)
        # floor and ceiling
        t = safe_div(-pz, dz)
        m = t < t_best
        fx, fy = px + t * dx, py + t * dy
        checker = ((np.floor(fx / 0.35) + np.floor(fy / 0.35)) % 2) * 0.35 + 0.25
        shade = np.where(m, checker, shade)
        t_best = np.where(m, t, t_best)
        t = safe_div(room.height - pz, dz)
        m = t < t_best
        shade = np.where(m, 0.9, shade)
        t_best = np.where(m, t, t_best)
        # boxes (slab method)
        for b in room.boxes:
            lo, hi = np.array(b.lo), np.array(b.hi)
            with np.errstate(divide="ignore", invalid="ignore"):
                t1 = (lo[0] - px) / dx
                t2 = (hi[0] - px) / dx
                t3 = (lo[1] - py) / dy
                t4 = (hi[1] - py) / dy
                t5 = (lo[2] - pz) / dz
                t6 = (hi[2] - pz) / dz
            tmin = np.maximum(np.maximum(np.minimum(t1, t2), np.minimum(t3, t4)), np.minimum(t5, t6))
            tmax = np.minimum(np.minimum(np.maximum(t1, t2), np.maximum(t3, t4)), np.maximum(t5, t6))
            hit = (tmax >= tmin) & (tmin > 1e-6) & (tmin < t_best)
            if hit.any():
                hx_, hy_, hz_ = px + tmin * dx, py + tmin * dy, pz + tmin * dz
                # fabric-like checker so the camera can see the surface move
                edge = ((np.floor((hx_ + hy_) / 0.12) + np.floor(hz_ / 0.12)) % 2) * 0.22
                shade = np.where(hit, b.shade + edge, shade)
                t_best = np.where(hit, tmin, t_best)
        shade = shade / (1 + 0.06 * np.minimum(t_best, 50))
        g = np.clip(shade * 255, 0, 255).astype(np.uint8)
        return np.stack([g, g, np.clip(g.astype(int) + 8, 0, 255).astype(np.uint8)], axis=-1)  # BGR, slight warm tint


class SimDrone(Drone):
    name = "sim"
    has_camera = True

    def __init__(self, room: Room | None = None, start=(0.0, 0.0, 0.0), yaw_deg: float = 0.0, seed: int = 0,
                 v_max: float = 1.0, vz_max: float = 0.8, yaw_rate_max_dps: float = 120.0, tau: float = 0.35,
                 wind: float = 0.03, camera: RayCamera | None = None):
        self.room = room or Room.bedroom()
        self.pos = np.array(start, dtype=float)
        self.vel = np.zeros(3)
        self.yaw = math.radians(yaw_deg)
        self.yaw_rate = 0.0
        self.v_max, self.vz_max, self.yr_max = v_max, vz_max, math.radians(yaw_rate_max_dps)
        self.tau = tau
        self.wind = wind
        self.rng = np.random.default_rng(seed)
        self.cam = camera or RayCamera()
        self.cmd = FlightCommand()
        self.flying = False
        self.t = 0.0
        self.collisions = 0
        self._touching = False
        self._takeoff_target: float | None = None
        self._landing = False
        self.battery = 100.0

    # ---------------------------------------------------------------- api
    def takeoff(self) -> None:
        self.flying = True
        self._takeoff_target = 0.9
        self._landing = False

    def land(self) -> None:
        self._landing = True

    def emergency_stop(self) -> None:
        self.flying = False
        self.vel[:] = 0
        self.pos[2] = 0

    def send(self, cmd: FlightCommand) -> None:
        self.cmd = cmd

    def telemetry(self) -> Telemetry:
        return Telemetry(t=self.t, alt_m=float(self.pos[2]), vz_mps=float(self.vel[2]), yaw_deg=math.degrees(self.yaw) % 360,
                         yaw_rate_dps=-math.degrees(self.yaw_rate), x_m=float(self.pos[0]), y_m=float(self.pos[1]),
                         battery_pct=self.battery, flying=self.flying)

    def frame(self) -> np.ndarray:
        return self.cam.render(self.room, self.pos, self.yaw)

    # ---------------------------------------------------------------- physics
    def step(self, dt: float) -> None:
        self.t += dt
        self.battery = max(0.0, self.battery - dt * 100 / 600)  # ~10 min battery
        if not self.flying:
            self.vel[:] = 0
            self.yaw_rate = 0
            return
        c = self.cmd
        if self._takeoff_target is not None:
            vz_t = 0.6 if self.pos[2] < self._takeoff_target else 0.0
            if self.pos[2] >= self._takeoff_target:
                self._takeoff_target = None
            target = np.array([0.0, 0.0, vz_t])
            yr_t = 0.0
        elif self._landing:
            target = np.array([0.0, 0.0, -0.5])
            yr_t = 0.0
        else:
            f = np.array([math.cos(self.yaw), math.sin(self.yaw)])
            r = np.array([math.sin(self.yaw), -math.cos(self.yaw)])
            vxy = (c.forward * f + c.lateral * r) * self.v_max
            target = np.array([vxy[0], vxy[1], c.throttle * self.vz_max])
            yr_t = -c.yaw * self.yr_max  # +yaw command = clockwise, math yaw is counter-clockwise
        k = 1 - math.exp(-dt / self.tau)
        self.vel += (target - self.vel) * k + self.rng.standard_normal(3) * self.wind * math.sqrt(dt)
        self.yaw_rate += (yr_t - self.yaw_rate) * k
        self.yaw += self.yaw_rate * dt
        new = self.pos + self.vel * dt
        new, hit = self._collide(new)
        if hit:
            if not self._touching:
                self.collisions += 1
            self.vel *= -0.2
        self._touching = hit
        self.pos = new
        if self._landing and self.pos[2] <= 0.02:
            self.flying = False
            self.pos[2] = 0.0

    def _collide(self, p: np.ndarray) -> tuple[np.ndarray, bool]:
        r = 0.12  # drone radius
        hit = False
        hx, hy = self.room.size_x / 2 - r, self.room.size_y / 2 - r
        q = p.copy()
        q[0] = np.clip(q[0], -hx, hx)
        q[1] = np.clip(q[1], -hy, hy)
        q[2] = np.clip(q[2], 0.0, self.room.height - r)
        hit |= bool(np.any(np.abs(q[:2] - p[:2]) > 1e-9)) or (q[2] != p[2] and p[2] > 0)
        for b in self.room.boxes:
            lo, hi = np.array(b.lo) - r, np.array(b.hi) + r
            if np.all(q > lo) and np.all(q < hi):
                q = self.pos.copy()  # stay where we were
                hit = True
        return q, hit
