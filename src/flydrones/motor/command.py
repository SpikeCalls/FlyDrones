"""Normalised flight command shared by every drone backend."""

from __future__ import annotations

from dataclasses import asdict, dataclass

AXES = ("throttle", "yaw", "forward", "lateral")


@dataclass
class FlightCommand:
    throttle: float = 0.0  # vertical speed, -1 (down) .. +1 (up)
    yaw: float = 0.0  # yaw rate, -1 (left) .. +1 (right)
    forward: float = 0.0  # -1 (back) .. +1 (forward)
    lateral: float = 0.0  # -1 (left) .. +1 (right)
    escape: bool = False
    note: str = ""

    def clipped(self, limit: float = 1.0) -> FlightCommand:
        c = lambda v: max(-limit, min(limit, float(v)))  # noqa: E731
        return FlightCommand(c(self.throttle), c(self.yaw), c(self.forward), c(self.lateral), self.escape, self.note)

    def as_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def hover(note: str = "hover") -> FlightCommand:
        return FlightCommand(note=note)
