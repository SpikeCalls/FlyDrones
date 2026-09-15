"""Laptop / USB webcam via OpenCV."""

from __future__ import annotations

import numpy as np


class Webcam:
    def __init__(self, index: int | str = 0, width: int = 640, height: int = 480, mirror: bool = True):
        try:
            import cv2
        except ImportError as e:  # pragma: no cover
            raise SystemExit("OpenCV missing: pip install 'flydrones[vision]'") from e
        self.cv2 = cv2
        self.cap = cv2.VideoCapture(int(index) if str(index).isdigit() else index)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.mirror = mirror
        if not self.cap.isOpened():
            raise SystemExit(f"cannot open camera {index}")

    def read(self) -> np.ndarray | None:
        ok, frame = self.cap.read()
        if not ok:
            return None
        return self.cv2.flip(frame, 1) if self.mirror else frame

    def close(self) -> None:
        self.cap.release()
