"""DJI / Ryze Tello (and Tello EDU) over Wi-Fi using djitellopy.

The Tello's own flight controller does the stabilisation. We send stick
values with ``send_rc_control(left_right, forward_back, up_down, yaw)``, each
-100..100. The Tello camera becomes the fly's eyes.

    pip install "flydrones[tello]"
    connect your computer to the TELLO-XXXXXX Wi-Fi, then:
    flydrones fly --drone tello --send
"""

from __future__ import annotations

import time

import numpy as np

from ..motor.command import FlightCommand
from ..safety import Telemetry
from .base import Drone


class TelloDrone(Drone):
    name = "tello"
    has_camera = True

    def __init__(self, stick_percent: int = 60, host: str | None = None):
        try:
            from djitellopy import Tello
        except ImportError as e:  # pragma: no cover - optional dependency
            raise SystemExit("djitellopy missing: pip install 'flydrones[tello]'") from e
        self.tello = Tello(host) if host else Tello()
        self.scale = max(10, min(100, int(stick_percent)))
        self._reader = None
        self._last_yaw = None
        self._last_t = None
        self._yaw_rate = 0.0
        self.flying = False

    def connect(self) -> None:
        self.tello.connect()
        print(f"Tello battery {self.tello.get_battery()}%")
        self.tello.streamon()
        self._reader = self.tello.get_frame_read()

    def takeoff(self) -> None:
        self.tello.takeoff()
        self.flying = True

    def land(self) -> None:
        if self.flying:
            self.tello.send_rc_control(0, 0, 0, 0)
            self.tello.land()
            self.flying = False

    def emergency_stop(self) -> None:
        self.tello.emergency()  # motors off immediately
        self.flying = False

    def send(self, cmd: FlightCommand) -> None:
        s = self.scale
        self.tello.send_rc_control(int(cmd.lateral * s), int(cmd.forward * s), int(cmd.throttle * s), int(cmd.yaw * s))

    def telemetry(self) -> Telemetry:
        now = time.monotonic()
        yaw = float(self.tello.get_yaw())
        if self._last_yaw is not None and now > self._last_t:
            d = (yaw - self._last_yaw + 180) % 360 - 180
            self._yaw_rate = 0.7 * self._yaw_rate + 0.3 * d / (now - self._last_t)
        self._last_yaw, self._last_t = yaw, now
        return Telemetry(t=now, alt_m=self.tello.get_height() / 100.0, vz_mps=self.tello.get_speed_z() / 100.0,
                         yaw_deg=yaw, yaw_rate_dps=self._yaw_rate, battery_pct=float(self.tello.get_battery()), flying=self.flying)

    def frame(self) -> np.ndarray | None:
        if self._reader is None:
            return None
        f = self._reader.frame
        return None if f is None else np.ascontiguousarray(f[..., ::-1])  # djitellopy gives RGB

    def close(self) -> None:
        try:
            self.tello.streamoff()
        finally:
            self.tello.end()
