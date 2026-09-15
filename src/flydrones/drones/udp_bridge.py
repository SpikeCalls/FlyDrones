"""ESP32 Wi-Fi bridge -> Betaflight / INAV flight controller (MSP RC override).

Packet format (ASCII, one line per UDP datagram, 50 Hz):

    FD1,<seq>,<arm 0|1>,<throttle>,<yaw>,<pitch>,<roll>\n      values -1000..1000

The ESP32 firmware in ``firmware/esp32_msp_bridge`` turns it into
MSP_SET_RAW_RC frames for the flight controller and stops sending if no packet
arrives for 300 ms, so the FC's own RX-loss failsafe takes over.

Telemetry back from the ESP32 (optional): ``FT1,<alt_cm>,<yaw_rate_dps>,<vbat_cV>``
(-1 / 0 mean "unknown").
"""

from __future__ import annotations

import socket
import struct
import time

from ..motor.command import FlightCommand
from ..safety import Telemetry
from .base import Drone

MSP_SET_RAW_RC = 200


def encode_packet(seq: int, arm: bool, cmd: FlightCommand) -> bytes:
    c = lambda v: int(max(-1000, min(1000, round(v * 1000))))  # noqa: E731
    return f"FD1,{seq},{1 if arm else 0},{c(cmd.throttle)},{c(cmd.yaw)},{c(cmd.forward)},{c(cmd.lateral)}\n".encode()


def decode_packet(data: bytes) -> dict | None:
    try:
        parts = data.decode().strip().split(",")
        if parts[0] != "FD1" or len(parts) != 7:
            return None
        seq, arm, thr, yaw, pitch, roll = (int(p) for p in parts[1:])
        return {"seq": seq, "arm": bool(arm), "throttle": thr, "yaw": yaw, "pitch": pitch, "roll": roll}
    except (ValueError, UnicodeDecodeError):
        return None


def msp_frame(cmd: int, payload: bytes) -> bytes:
    """MSP v1 frame: '$M<' size cmd payload checksum(xor)."""
    size = len(payload)
    chk = size ^ cmd
    for b in payload:
        chk ^= b
    return b"$M<" + bytes([size, cmd]) + payload + bytes([chk])


def rc_channels(cmd: FlightCommand, arm: bool, hover_pwm: int = 1500, thr_range: int = 150, stick_range: int = 200) -> list[int]:
    """AETR channel order used by Betaflight's default map: roll, pitch, throttle, yaw, AUX1(arm)..."""
    roll = 1500 + int(cmd.lateral * stick_range)
    pitch = 1500 + int(cmd.forward * stick_range)
    thr = hover_pwm + int(cmd.throttle * thr_range) if arm else 1000
    yaw = 1500 + int(cmd.yaw * stick_range)
    aux1 = 1800 if arm else 1000
    return [max(1000, min(2000, v)) for v in (roll, pitch, thr, yaw, aux1, 1000, 1000, 1000)]


def msp_set_raw_rc(channels: list[int]) -> bytes:
    return msp_frame(MSP_SET_RAW_RC, struct.pack("<" + "H" * len(channels), *channels))


class UDPBridgeDrone(Drone):
    name = "esp32"
    has_camera = False

    def __init__(self, host: str = "192.168.4.1", port: int = 8888, listen_port: int = 8889, cells: int = 4):
        self.cells = cells
        self.addr = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("0.0.0.0", listen_port))
        self.sock.setblocking(False)
        self.seq = 0
        self.armed = False
        self._tel = Telemetry()

    def takeoff(self) -> None:
        self.armed = True
        print("ESP32 bridge: ARM sent. Use your flight controller's angle/alt-hold mode; hover_pwm must be calibrated.")

    def land(self) -> None:
        for _ in range(30):
            self.send(FlightCommand(throttle=-0.5))
            time.sleep(0.05)
        self.armed = False
        self.send(FlightCommand())

    def emergency_stop(self) -> None:
        self.armed = False
        for _ in range(5):
            self.send(FlightCommand())

    def send(self, cmd: FlightCommand) -> None:
        self.seq += 1
        self.sock.sendto(encode_packet(self.seq, self.armed, cmd), self.addr)

    def telemetry(self) -> Telemetry:
        try:
            while True:
                data, _ = self.sock.recvfrom(256)
                p = data.decode(errors="ignore").strip().split(",")
                if p[0] == "FT1" and len(p) == 4:
                    alt_cm, vbat_cv = int(p[1]), int(p[3])
                    self._tel.alt_m = alt_cm / 100.0 if alt_cm >= 0 else None  # -1 = unknown
                    self._tel.yaw_rate_dps = float(p[2])
                    if vbat_cv > 0:
                        cells = self.cells
                        self._tel.battery_pct = max(0.0, min(100.0, (vbat_cv / 100.0 / cells - 3.3) / 0.9 * 100))
        except BlockingIOError:
            pass
        self._tel.t = time.monotonic()
        self._tel.flying = self.armed
        return self._tel

    def close(self) -> None:
        self.sock.close()
