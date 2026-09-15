"""Hand gestures -> visual illusions for the fly.

We never send the brain a command like "climb". Instead a gesture is turned
into the optic flow a flying fly would see, and the fly's own stabilising
reflexes do the rest:

* open palm      -> the scene drifts **up** on both eyes, which is what a fly
                    sees when it sinks -> VS / DNg02 lift reflex -> the drone climbs
* fist           -> still scene -> the drone holds
* hand dropped   -> the scene drifts **down** (as if rising) -> less lift -> descends
* hand left/right-> the scene rotates -> optomotor turn toward that side
* hand rushes at the camera -> expansion on the eyes -> looming escape circuits

Backends: MediaPipe hand landmarks (best), an OpenCV skin-colour fallback, or a
scripted timeline for demos and tests.
"""

from __future__ import annotations

import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .retina import VisualFrame

MP_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"


@dataclass
class GestureState:
    present: bool = False
    openness: float = 0.0  # 0 = fist, 1 = open palm
    x: float = 0.0  # -1 left .. +1 right (as seen by the user, mirrored)
    y: float = 0.0  # -1 top .. +1 bottom
    size: float = 0.0  # fraction of the frame
    label: str = "none"

    @staticmethod
    def classify(openness: float) -> str:
        return "open" if openness > 0.6 else "fist" if openness < 0.35 else "half"


class ScriptedGestures:
    """Timeline of (seconds, GestureState) used by demos and tests."""

    def __init__(self, timeline: list[tuple[float, GestureState]], loop: bool = False):
        self.timeline = sorted(timeline, key=lambda t: t[0])
        self.loop = loop

    def read(self, t: float, frame: np.ndarray | None = None) -> GestureState:
        if self.loop and self.timeline:
            t = t % (self.timeline[-1][0] + 1e-6)
        state = GestureState()
        for ts, st in self.timeline:
            if t >= ts:
                state = st
        return state


def demo_timeline() -> list[tuple[float, GestureState]]:
    return [
        (0.0, GestureState()),
        (2.5, GestureState(True, 0.95, 0.0, 0.0, 0.20, "open palm")),
        (4.5, GestureState(True, 0.10, 0.0, 0.0, 0.15, "fist")),
        (9.5, GestureState(True, 0.10, 0.85, 0.0, 0.15, "fist, moved right")),
        (12.0, GestureState(True, 0.10, 0.0, 0.0, 0.15, "fist")),
        (13.5, GestureState(True, 0.10, 0.0, 0.0, 0.55, "hand rushes at camera")),
        (14.0, GestureState(True, 0.10, 0.0, 0.0, 0.55, "fist, close")),
        (15.5, GestureState(False, 0.0, 0.0, 1.0, 0.0, "hand dropped")),
    ]


class OpenCVHands:
    """Skin-colour + convex-hull heuristic. Works without MediaPipe, needs decent light."""

    def __init__(self):
        import cv2  # noqa: F401

        self.cv2 = cv2

    def read(self, t: float, frame: np.ndarray | None) -> GestureState:
        if frame is None:
            return GestureState()
        cv2 = self.cv2
        ycc = cv2.cvtColor(frame, cv2.COLOR_BGR2YCrCb)
        mask = cv2.inRange(ycc, (0, 135, 85), (255, 180, 135))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return GestureState()
        c = max(cnts, key=cv2.contourArea)
        area = cv2.contourArea(c)
        H, W = mask.shape
        if area < 0.02 * H * W:
            return GestureState()
        hull = cv2.convexHull(c)
        solidity = area / max(cv2.contourArea(hull), 1)
        openness = float(np.clip((0.92 - solidity) / 0.25, 0, 1))  # fingers spread -> gaps -> low solidity
        m = cv2.moments(c)
        cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
        return GestureState(True, openness, -(cx / W * 2 - 1), cy / H * 2 - 1, area / (H * W), GestureState.classify(openness))


class MediaPipeHands:
    """MediaPipe Tasks HandLandmarker. Downloads the 8 MB model on first use."""

    def __init__(self, model_path: str | Path | None = None):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

        path = Path(model_path or Path.home() / ".cache" / "flydrones" / "hand_landmarker.task")
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            print(f"downloading MediaPipe hand model -> {path}")
            urllib.request.urlretrieve(MP_MODEL_URL, path)
        opts = HandLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(path)), running_mode=RunningMode.VIDEO, num_hands=1)
        self.mp = mp
        self.detector = HandLandmarker.create_from_options(opts)
        self._t0 = time.monotonic()

    def read(self, t: float, frame: np.ndarray | None) -> GestureState:
        if frame is None:
            return GestureState()
        rgb = frame[..., ::-1].copy()  # BGR -> RGB
        img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        res = self.detector.detect_for_video(img, int((time.monotonic() - self._t0) * 1000))
        if not res.hand_landmarks:
            return GestureState()
        lm = np.array([[p.x, p.y] for p in res.hand_landmarks[0]])
        wrist, mcp_mid = lm[0], lm[9]
        palm = np.linalg.norm(mcp_mid - wrist) + 1e-6
        tips, pips = [8, 12, 16, 20], [6, 10, 14, 18]
        extended = sum(np.linalg.norm(lm[tp] - wrist) > np.linalg.norm(lm[pp] - wrist) * 1.15 for tp, pp in zip(tips, pips))
        spread = np.linalg.norm(lm[8] - lm[20]) / palm
        openness = float(np.clip(0.7 * extended / 4 + 0.3 * np.clip(spread / 1.2, 0, 1), 0, 1))
        x0, y0 = lm.min(0)
        x1, y1 = lm.max(0)
        cx, cy = lm[:, 0].mean(), lm[:, 1].mean()
        return GestureState(True, openness, -(cx * 2 - 1), cy * 2 - 1, float((x1 - x0) * (y1 - y0)), GestureState.classify(openness))


def make_gesture_source(kind: str):
    kind = (kind or "auto").lower()
    if kind == "scripted":
        return ScriptedGestures(demo_timeline())
    if kind in ("mediapipe", "auto"):
        try:
            return MediaPipeHands()
        except Exception as e:  # pragma: no cover - depends on local install
            if kind == "mediapipe":
                raise
            print(f"MediaPipe unavailable ({e.__class__.__name__}); falling back to OpenCV skin detector")
    return OpenCVHands()


class GestureIllusion:
    """Turns a GestureState into optic-flow illusions added onto the eye grids."""

    def __init__(self, strength: float = 0.5, drop_hold_s: float = 30.0, loom_growth: float = 0.03):
        self.strength = strength
        self.drop_hold_s = drop_hold_s
        self.loom_growth = loom_growth
        self._last_present_t: float | None = None
        self._prev_size = 0.0
        self._loom = 0.0  # looming illusion decays over ~0.5 s
        self.mode = "none"

    def apply(self, vision: VisualFrame, g: GestureState, t: float) -> VisualFrame:
        s = self.strength
        up = down = rot = loom = 0.0
        if g.present:
            if self._last_present_t is None or t - self._last_present_t > 0.5:
                self._prev_size = g.size  # a hand that just appeared is not an attack
            self._last_present_t = t
            if g.openness > 0.6:
                up = s * (g.openness - 0.6) / 0.4
                self.mode = "open palm -> sinking illusion"
            else:
                self.mode = "fist -> still scene"
            if abs(g.x) > 0.35:
                rot = s * np.sign(g.x) * (abs(g.x) - 0.35) / 0.65
                self.mode += " + rotate"
            growth = g.size - self._prev_size
            if growth > self.loom_growth:
                self._loom = max(self._loom, min(1.0, growth / (4 * self.loom_growth)))
            self._prev_size = g.size
        elif self._last_present_t is not None and t - self._last_present_t < self.drop_hold_s:
            down = min(1.0, s * 1.4)
            self.mode = "hand dropped -> rising illusion"
            self._prev_size = 0.0
        else:
            self.mode = "no hand"
        self._loom *= 0.85
        loom = self._loom if self._loom > 0.05 else 0.0
        if loom:
            self.mode = "hand rushing in -> looming"

        for eye in ("L", "R"):
            gr = vision.eyes[eye].grids
            gr["up"] = np.clip(gr["up"] + up, 0, 1)
            gr["down"] = np.clip(gr["down"] + down, 0, 1)
            # rightward rotation (rot > 0): back-to-front on the left eye, front-to-back on the right
            if rot > 0:
                key = "btf" if eye == "L" else "ftb"
            else:
                key = "ftb" if eye == "L" else "btf"
            gr[key] = np.clip(gr[key] + abs(rot), 0, 1)
            gr["loom"] = np.clip(gr["loom"] + loom, 0, 1)
            gr["loom_speed"] = np.clip(gr["loom_speed"] + loom, 0, 1)
        return vision
