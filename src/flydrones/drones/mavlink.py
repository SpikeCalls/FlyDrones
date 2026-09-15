"""ArduPilot / PX4 multirotors over MAVLink (real vehicles or SITL).

Sends body-frame velocity + yaw-rate setpoints (SET_POSITION_TARGET_LOCAL_NED).
ArduPilot: GUIDED mode. PX4: OFFBOARD mode (setpoints are streamed before the
mode switch, as PX4 requires).

    pip install "flydrones[mavlink]"
    flydrones fly --drone mavlink --mavlink udpin:0.0.0.0:14550 --send      # SITL
    flydrones fly --drone mavlink --mavlink /dev/ttyUSB0,57600 --send      # telemetry radio
"""

from __future__ import annotations

import math
import time

from ..motor.command import FlightCommand
from ..safety import Telemetry
from .base import Drone

# ignore position (0-2), acceleration (6-8) and yaw angle (10); use velocity + yaw rate
TYPE_MASK_VEL_YAWRATE = 0b0000_0101_1100_0111


class MavlinkDrone(Drone):
    name = "mavlink"
    has_camera = False

    def __init__(self, connection: str = "udpin:0.0.0.0:14550", autopilot: str = "ardupilot", v_max: float = 1.0,
                 vz_max: float = 0.5, yaw_rate_max_dps: float = 45.0, takeoff_alt: float = 1.5):
        try:
            from pymavlink import mavutil
        except ImportError as e:  # pragma: no cover - optional dependency
            raise SystemExit("pymavlink missing: pip install 'flydrones[mavlink]'") from e
        self.mavutil = mavutil
        self.conn_str = connection
        self.autopilot = autopilot.lower()
        self.v_max, self.vz_max, self.yr_max = v_max, vz_max, math.radians(yaw_rate_max_dps)
        self.takeoff_alt = takeoff_alt
        self.m = None
        self._tel = Telemetry()
        self.flying = False

    def connect(self) -> None:
        if "," in self.conn_str:
            dev, baud = self.conn_str.split(",", 1)
            self.m = self.mavutil.mavlink_connection(dev, baud=int(baud))
        else:
            self.m = self.mavutil.mavlink_connection(self.conn_str)
        self.m.wait_heartbeat(timeout=30)
        print(f"MAVLink heartbeat from system {self.m.target_system}")

    def _send_velocity(self, vx: float, vy: float, vz: float, yaw_rate: float) -> None:
        self.m.mav.set_position_target_local_ned_send(
            0, self.m.target_system, self.m.target_component, self.mavutil.mavlink.MAV_FRAME_BODY_OFFSET_NED,
            TYPE_MASK_VEL_YAWRATE, 0, 0, 0, vx, vy, vz, 0, 0, 0, 0, yaw_rate)

    def takeoff(self) -> None:
        m = self.m
        if self.autopilot == "px4":
            m.arducopter_arm()
            m.motors_armed_wait()
            # NaN altitude -> PX4 uses MIS_TAKEOFF_ALT
            m.mav.command_long_send(m.target_system, m.target_component, self.mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                                    0, 0, 0, 0, float("nan"), float("nan"), float("nan"), float("nan"))
            time.sleep(6)
            for _ in range(30):  # PX4 needs a >2 Hz setpoint stream before accepting OFFBOARD
                self._send_velocity(0, 0, 0, 0)
                time.sleep(0.05)
            m.set_mode("OFFBOARD")
        else:
            m.set_mode("GUIDED")
            m.arducopter_arm()
            m.motors_armed_wait()
            m.mav.command_long_send(m.target_system, m.target_component, self.mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
                                    0, 0, 0, 0, 0, 0, 0, self.takeoff_alt)
            time.sleep(6)
        self.flying = True

    def send(self, cmd: FlightCommand) -> None:
        # NED body frame: +x forward, +y right, +z DOWN; yaw rate + = clockwise
        self._send_velocity(cmd.forward * self.v_max, cmd.lateral * self.v_max, -cmd.throttle * self.vz_max, cmd.yaw * self.yr_max)

    def land(self) -> None:
        if self.autopilot == "px4":
            self.m.mav.command_long_send(self.m.target_system, self.m.target_component, self.mavutil.mavlink.MAV_CMD_NAV_LAND,
                                         0, 0, 0, 0, 0, 0, 0, 0)
        else:
            self.m.set_mode("LAND")
        self.flying = False

    def emergency_stop(self) -> None:
        # force disarm (param2 = 21196). The vehicle WILL fall.
        self.m.mav.command_long_send(self.m.target_system, self.m.target_component,
                                     self.mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0, 0, 21196, 0, 0, 0, 0, 0)
        self.flying = False

    def telemetry(self) -> Telemetry:
        t = self._tel
        while True:
            msg = self.m.recv_match(type=["LOCAL_POSITION_NED", "ATTITUDE", "BATTERY_STATUS", "SYS_STATUS"], blocking=False)
            if msg is None:
                break
            k = msg.get_type()
            if k == "LOCAL_POSITION_NED":
                t.x_m, t.y_m, t.alt_m, t.vz_mps = msg.x, msg.y, -msg.z, -msg.vz
            elif k == "ATTITUDE":
                t.yaw_deg, t.yaw_rate_dps = math.degrees(msg.yaw), math.degrees(msg.yawspeed)
            elif k == "SYS_STATUS" and msg.battery_remaining >= 0:
                t.battery_pct = float(msg.battery_remaining)
        t.t = time.monotonic()
        t.flying = self.flying
        return t
