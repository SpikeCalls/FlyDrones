"""Camera frames -> fly-eye features.

The frame is split into a left and a right "eye". Each eye is a grid of
ommatidia-like cells. For every cell we compute:

* ``brightness``  mean luminance (drives R1-R6 photoreceptors)
* ``ftb`` / ``btf``  front-to-back / back-to-front motion (T4a/T5a, T4b/T5b)
* ``up`` / ``down``  scene moving up / down (T4c/T5c, T4d/T5d)
* ``loom``        the flow field expands on both axes - something is approaching (LPLC2)
* ``loom_speed``  how fast looming grows (LC4)

Motion is estimated with a tiny per-cell Lucas-Kanade solve in pure numpy, so
no OpenCV is required. All features are normalised to 0..1.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FEATURES = ("brightness", "ftb", "btf", "up", "down", "loom", "loom_speed")


@dataclass
class EyeFeatures:
    grids: dict[str, np.ndarray] = field(default_factory=dict)  # feature -> (rows, cols)

    def get(self, name: str) -> np.ndarray:
        return self.grids[name]


@dataclass
class VisualFrame:
    eyes: dict[str, EyeFeatures]
    expansion: float = 0.0
    rotation: float = 0.0  # + = scene moves right (drone yawing left)
    vertical: float = 0.0  # + = scene moves up (drone sinking)

    def scalars(self) -> dict[str, float]:
        return {"expansion": self.expansion, "rotation": self.rotation, "vertical": self.vertical}


def to_gray(frame: np.ndarray) -> np.ndarray:
    f = np.asarray(frame)
    if f.ndim == 3:
        f = f[..., :3].astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    return f.astype(np.float32) / (255.0 if f.max() > 1.5 else 1.0)


def resize(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Area-average resize without OpenCV."""
    H, W = img.shape
    ys = (np.arange(h + 1) * H / h).astype(int)
    xs = (np.arange(w + 1) * W / w).astype(int)
    c = np.cumsum(np.cumsum(np.pad(img, ((1, 0), (1, 0))), axis=0), axis=1)
    y0, y1 = ys[:-1], np.maximum(ys[1:], ys[:-1] + 1)
    x0, x1 = xs[:-1], np.maximum(xs[1:], xs[:-1] + 1)
    s = c[np.ix_(y1, x1)] - c[np.ix_(y0, x1)] - c[np.ix_(y1, x0)] + c[np.ix_(y0, x0)]
    area = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    return (s / area).astype(np.float32)


def box_blur(img: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return img
    k = 2 * r + 1
    p = np.pad(img, r, mode="edge")
    c = np.cumsum(np.cumsum(np.pad(p, ((1, 0), (1, 0))), axis=0), axis=1)
    return ((c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)).astype(np.float32)


class Retina:
    def __init__(self, width: int = 96, height: int = 72, grid: tuple[int, int] = (6, 8), flow_gain: float = 1.2,
                 loom_gain: float = 5.0, blur: int = 1, loom_floor: float = 0.05):
        self.w, self.h = int(width) // 2 * 2, int(height)
        self.rows, self.cols = int(grid[0]), int(grid[1])
        self.flow_gain = float(flow_gain)
        self.loom_gain = float(loom_gain)
        self.loom_floor = float(loom_floor)
        self.blur = int(blur)
        self.prev: np.ndarray | None = None
        self.prev_exp = {"L": 0.0, "R": 0.0}
        self._loom_ema: float | None = None

    @classmethod
    def from_config(cls, cfg: dict) -> Retina:
        v = cfg.get("vision", {})
        return cls(v.get("width", 96), v.get("height", 72), tuple(v.get("grid", (6, 8))), v.get("flow_gain", 1.2),
                   v.get("loom_gain", 5.0), v.get("blur", 1), v.get("loom_floor", 0.05))

    def reset(self) -> None:
        self.prev = None
        self._loom_ema = None

    def encode(self, frame: np.ndarray | None) -> VisualFrame:
        if frame is None:
            zero = np.zeros((self.rows, self.cols), np.float32)
            return VisualFrame({e: EyeFeatures({f: zero for f in FEATURES}) for e in "LR"})
        img = box_blur(resize(to_gray(frame), self.w, self.h), self.blur)
        prev = self.prev if self.prev is not None and self.prev.shape == img.shape else img
        self.prev = img

        Iy, Ix = np.gradient((img + prev) * 0.5)
        It = img - prev
        full_w = (self.w // 2) * 2
        ncols = self.cols * 2  # both eyes side by side

        rh, cw = self.h // self.rows, full_w // ncols

        def cells(a: np.ndarray) -> np.ndarray:
            a = a[: rh * self.rows, : cw * ncols]
            return a.reshape(self.rows, rh, ncols, cw).transpose(0, 2, 1, 3).reshape(self.rows, ncols, -1)

        ix, iy, it = cells(Ix), cells(Iy), cells(It)
        sxx = (ix * ix).sum(-1) + 1e-4
        syy = (iy * iy).sum(-1) + 1e-4
        sxy = (ix * iy).sum(-1)
        sxt = (ix * it).sum(-1)
        syt = (iy * it).sum(-1)
        det = sxx * syy - sxy**2
        vx = (-syy * sxt + sxy * syt) / det
        vy = (sxy * sxt - sxx * syt) / det
        energy = sxx + syy
        texture = np.clip(energy / (np.median(energy) + 1e-6), 0, 1)
        vx, vy = np.clip(vx, -3, 3) * texture, np.clip(vy, -3, 3) * texture
        # Looming = expansion of the flow field. Fit vx = a + ex*x and vy = b + ey*y
        # (texture-weighted least squares). Rotation only shifts (a), climbing only
        # stretches one axis, an approaching object stretches both: loom = min(ex, ey).
        exp_all = _expansion(vx, vy, texture)
        exp_l = _expansion(vx[:, : self.cols], vy[:, : self.cols], texture[:, : self.cols])
        exp_r = _expansion(vx[:, self.cols :], vy[:, self.cols :], texture[:, self.cols :])
        self._loom_ema = exp_all if self._loom_ema is None else 0.5 * self._loom_ema + 0.5 * exp_all
        loom_level = float(np.clip((self._loom_ema - self.loom_floor) * self.loom_gain, 0, 1))
        side_l = float(np.clip(0.5 + (exp_l - exp_r) * 2.0, 0.0, 1.0))
        loom_by_eye = {"L": loom_level * min(1.0, 2 * side_l), "R": loom_level * min(1.0, 2 * (1 - side_l))}
        bright = cells(img).mean(-1)

        eyes: dict[str, EyeFeatures] = {}
        g = self.flow_gain
        for eye, sl in (("L", slice(0, self.cols)), ("R", slice(self.cols, ncols))):
            ex, ey = vx[:, sl], vy[:, sl]
            ftb_sign = -1.0 if eye == "L" else 1.0  # front-to-back = away from the midline
            grids = {
                "brightness": bright[:, sl],
                "ftb": np.clip(ftb_sign * ex / g, 0, 1),
                "btf": np.clip(-ftb_sign * ex / g, 0, 1),
                "up": np.clip(-ey / g, 0, 1),
                "down": np.clip(ey / g, 0, 1),
                "loom": np.full(ex.shape, loom_by_eye[eye], dtype=np.float32),
            }
            lv = loom_by_eye[eye]
            grids["loom_speed"] = np.full_like(grids["loom"], np.clip((lv - self.prev_exp[eye]) * 3, 0, 1))
            self.prev_exp[eye] = 0.7 * self.prev_exp[eye] + 0.3 * lv
            eyes[eye] = EyeFeatures({k: v.astype(np.float32) for k, v in grids.items()})
        exp_total = float(self._loom_ema)
        rot_total = float(vx.mean())
        vert_total = float(-vy.mean())
        return VisualFrame(eyes, expansion=exp_total, rotation=rot_total, vertical=vert_total)


def _expansion(vx: np.ndarray, vy: np.ndarray, w: np.ndarray) -> float:
    """min(horizontal stretch, vertical stretch) of a flow grid, in px/frame per cell."""
    rows, cols = vx.shape
    xx = np.arange(cols, dtype=np.float32) - (cols - 1) / 2
    yy = np.arange(rows, dtype=np.float32) - (rows - 1) / 2
    X = np.broadcast_to(xx[None, :], vx.shape)
    Y = np.broadcast_to(yy[:, None], vy.shape)

    def slope(v: np.ndarray, c: np.ndarray) -> float:
        sw = w.sum() + 1e-6
        cm = (w * c).sum() / sw
        vm = (w * v).sum() / sw
        var = (w * (c - cm) ** 2).sum()
        return float((w * (c - cm) * (v - vm)).sum() / (var + 1e-6))

    return min(slope(vx, X), slope(vy, Y))
