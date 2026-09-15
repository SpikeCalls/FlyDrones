"""Bitcraze Crazyflie 2.x with a Flow deck (or Lighthouse / Loco positioning).

Uses hover setpoints: (vx, vy, yaw rate, absolute height). The brain's
throttle is integrated into a height target, so the Crazyflie's estimator
holds altitude between brain decisions. The Crazyflie has no video camera,
so pair it with your laptop webcam in gesture mode:

    pip install "flydrones[crazyflie]"
    flydrones fly --drone crazyflie --input gesture --send
"""

from __future__ import annotations

import time

from ..motor.command import FlightCommand
from ..safety import Telemetry
from .base import Drone


class CrazyflieDrone(Drone):
    name = "crazyflie"
    has_camera = False

    def __init__(self, uri: str = "radio://0/80/2M/E7E7E7E7E7", v_max: float = 0.5, vz_max: float = 0.3,
                 yaw_rate_max_dps: float = 90.0, takeoff_height: float = 0.5, min_h: float = 0.2, max_h: float = 1.5):
        try:
            import cflib.crtp
            from cflib.crazyflie import Crazyflie
            from cflib.crazyflie.log import LogConfig
            from cflib.crazyflie.syncCrazyflie import SyncCrazyflie
        except ImportError as e:  # pragma: no cover - optional dependency
            raise SystemExit("cflib missing: pip install 'flydrones[crazyflie]'") from e
        cflib.crtp.init_drivers()
        self._LogConfig = LogConfig
        self.scf = SyncCrazyflie(uri, cf=Crazyflie(rw_cache="./.cf_cache"))
        self.v_max, self.vz_max, self.yr_max = v_max, vz_max, yaw_rate_max_dps
        self.h_target = 0.0
        self.takeoff_height = takeoff_height
        self.min_h, self.max_h = min_h, max_h
        self._state = {"z": None, "gyro_z": 0.0, "vbat": None}
        self._t = time.monotonic()
        self.flying = False

    def connect(self) -> None:
        self.scf.open_link()
        cf = self.scf.cf
        try:  # newer firmware requires arming
            cf.platform.send_arming_request(True)
            time.sleep(1.0)
        except AttributeError:
            pass
        log = self._LogConfig(name="flydrones", period_in_ms=50)
        log.add_variable("stateEstimate.z", "float")
        log.add_variable("gyro.z", "float")
        log.add_variable("pm.vbat", "float")
        cf.log.add_config(log)
        log.data_received_cb.add_callback(self._on_log)
        log.start()

    def _on_log(self, ts, data, cfg) -> None:
        self._state.update(z=data["stateEstimate.z"], gyro_z=data["gyro.z"], vbat=data["pm.vbat"])

    def takeoff(self) -> None:
        cf = self.scf.cf
        for i in range(20):
            cf.commander.send_hover_setpoint(0, 0, 0, self.takeoff_height * (i + 1) / 20)
            time.sleep(0.1)
        self.h_target = self.takeoff_height
        self.flying = True
        self._t = time.monotonic()

    def send(self, cmd: FlightCommand) -> None:
        now = time.monotonic()
        dt, self._t = min(0.2, now - self._t), now
        self.h_target = min(self.max_h, max(self.min_h, self.h_target + cmd.throttle * self.vz_max * dt))
        # Crazyflie: +vy = left, +yaw rate = counter-clockwise
        self.scf.cf.commander.send_hover_setpoint(cmd.forward * self.v_max, -cmd.lateral * self.v_max,
                                                  -cmd.yaw * self.yr_max, self.h_target)

    def land(self) -> None:
        cf = self.scf.cf
        h = self.h_target
        for i in range(20):
            cf.commander.send_hover_setpoint(0, 0, 0, max(0.05, h * (1 - (i + 1) / 20)))
            time.sleep(0.1)
        cf.commander.send_stop_setpoint()
        cf.commander.send_notify_setpoint_stop()
        self.flying = False

    def emergency_stop(self) -> None:
        self.scf.cf.commander.send_stop_setpoint()
        self.flying = False

    def telemetry(self) -> Telemetry:
        v = self._state["vbat"]
        pct = None if v is None else max(0.0, min(100.0, (v - 3.0) / (4.2 - 3.0) * 100))
        return Telemetry(t=time.monotonic(), alt_m=self._state["z"], yaw_rate_dps=-float(self._state["gyro_z"] or 0.0),
                         battery_pct=pct, flying=self.flying)

    def close(self) -> None:
        self.scf.close_link()
