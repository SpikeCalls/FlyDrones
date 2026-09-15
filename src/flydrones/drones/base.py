"""Drone interface. Every backend speaks normalised FlightCommands."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod

import numpy as np

from ..motor.command import FlightCommand
from ..safety import Telemetry


class Drone(ABC):
    name = "drone"
    has_camera = False

    def connect(self) -> None:  # noqa: B027 - optional hook
        pass

    @abstractmethod
    def takeoff(self) -> None: ...

    @abstractmethod
    def land(self) -> None: ...

    @abstractmethod
    def send(self, cmd: FlightCommand) -> None: ...

    @abstractmethod
    def telemetry(self) -> Telemetry: ...

    def frame(self) -> np.ndarray | None:
        """Latest camera frame as BGR uint8, or None if the drone has no camera."""
        return None

    def emergency_stop(self) -> None:
        """Cut motors immediately. Drone WILL fall. Default: land."""
        self.land()

    def close(self) -> None:  # noqa: B027 - optional hook
        pass


class DryRunDrone(Drone):
    """Wraps a real backend and only prints what would be sent (default for hardware)."""

    def __init__(self, inner: Drone, every: int = 10):
        self.inner = inner
        self.name = f"dry-run({inner.name})"
        self.has_camera = inner.has_camera
        self._n = 0
        self.every = every

    def connect(self) -> None:
        print(f"[dry-run] would connect to {self.inner.name}. Add --send to really fly.")

    def takeoff(self) -> None:
        print("[dry-run] takeoff")

    def land(self) -> None:
        print("[dry-run] land")

    def send(self, cmd: FlightCommand) -> None:
        self._n += 1
        if self._n % self.every == 0:
            print(f"[dry-run] thr={cmd.throttle:+.2f} yaw={cmd.yaw:+.2f} fwd={cmd.forward:+.2f} lat={cmd.lateral:+.2f} {cmd.note}")

    def telemetry(self) -> Telemetry:
        return Telemetry(t=time.monotonic(), alt_m=1.0, flying=True)

    def frame(self) -> np.ndarray | None:
        return None
