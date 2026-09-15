from .base import Drone, DryRunDrone
from .sim import Box, Room, SimDrone


def make_drone(kind: str, **kw) -> Drone:
    kind = kind.lower()
    if kind == "sim":
        return SimDrone(**kw)
    if kind == "tello":
        from .tello import TelloDrone

        return TelloDrone(**kw)
    if kind == "crazyflie":
        from .crazyflie import CrazyflieDrone

        return CrazyflieDrone(**kw)
    if kind == "mavlink":
        from .mavlink import MavlinkDrone

        return MavlinkDrone(**kw)
    if kind in ("esp32", "udp", "betaflight"):
        from .udp_bridge import UDPBridgeDrone

        return UDPBridgeDrone(**kw)
    raise ValueError(f"unknown drone backend: {kind}")


__all__ = ["Box", "Drone", "DryRunDrone", "Room", "SimDrone", "make_drone"]
