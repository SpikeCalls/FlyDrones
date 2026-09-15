"""Live / recorded dashboard: camera | brain | drone.

Renders with matplotlib's Agg backend into numpy images, so the same code
makes a live OpenCV window, a GIF for the README, or PNG snapshots.
"""

from __future__ import annotations

from collections import deque

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

BG = "#07090d"
PANEL = "#0d1117"
GRID = "#1f2630"
TEXT = "#d7e0ea"
MUTED = "#7d8a99"
SPIKE = "#39ff88"
INPUT = "#4cc9f0"
OUTPUT = "#ff4d8d"
WARN = "#ffb020"


class Dashboard:
    def __init__(self, brain, pilots: list, title: str = "FlyDrones", history_s: float = 2.0, width_in: float = 12.8, height_in: float = 5.4):
        self.brain = brain
        self.pilots = pilots
        self.title = title
        self.history_s = history_s
        self.raster: deque = deque()
        self.trails = [deque(maxlen=400) for _ in pilots]
        self.alts = [deque(maxlen=200) for _ in pilots]
        c = brain.connectome
        rec = brain.record
        roles = np.zeros(rec.size, dtype=int)  # 0 hidden, 1 input, 2 output
        for name in brain.input_specs:
            roles[np.isin(rec, c.group(name))] = 1
        for name in brain.output_specs:
            roles[np.isin(rec, c.group(name))] = 2
        order = np.argsort(roles, kind="stable")
        self.row_of = np.empty_like(order)
        self.row_of[order] = np.arange(order.size)
        self.roles = roles
        self.fig = plt.figure(figsize=(width_in, height_in), dpi=100, facecolor=BG)

    # ------------------------------------------------------------------
    def _style(self, ax, title: str) -> None:
        ax.set_facecolor(PANEL)
        for s in ax.spines.values():
            s.set_color(GRID)
        ax.tick_params(colors=MUTED, labelsize=7)
        ax.set_title(title, color=TEXT, fontsize=9, loc="left", pad=4, fontfamily="monospace")

    def push(self, infos: list) -> None:
        """Collect spikes and trajectories from a tick without drawing."""
        info = infos[0]
        t = info.t
        for tt, pos in info.raster:
            self.raster.append((t + (tt - info.brain_ms) / 1000.0, pos))
        while self.raster and self.raster[0][0] < t - self.history_s:
            self.raster.popleft()
        for i, inf in enumerate(infos):
            if inf.tel.x_m is not None:
                self.trails[i].append((inf.tel.x_m, inf.tel.y_m))
            self.alts[i].append((inf.t, inf.tel.alt_m or 0.0))

    def render(self, infos: list, push: bool = True) -> np.ndarray:
        if push:
            self.push(infos)
        info = infos[0]
        t = info.t
        fig = self.fig
        fig.clf()
        gs = fig.add_gridspec(3, 3, width_ratios=[1.0, 1.35, 1.0], height_ratios=[1, 1, 0.8], left=0.035, right=0.985, top=0.86, bottom=0.07, wspace=0.18, hspace=0.45)
        n = self.brain.n_neurons
        syn = self.brain.connectome.n_connections
        fig.text(0.035, 0.945, self.title, color=TEXT, fontsize=15, fontweight="bold", fontfamily="monospace")
        fig.text(0.035, 0.905, f"{n:,} neurons · {syn:,} connections · {self.brain.connectome.name}", color=MUTED, fontsize=9, fontfamily="monospace")
        fig.text(0.985, 0.945, f"t = {t:5.1f} s", color=SPIKE, fontsize=12, ha="right", fontfamily="monospace")
        rtf = info.rtf
        fig.text(0.985, 0.905, f"brain speed {rtf:4.1f}x real time" if np.isfinite(rtf) else "", color=MUTED, fontsize=9, ha="right", fontfamily="monospace")

        # camera
        ax = fig.add_subplot(gs[0:2, 0])
        self._style(ax, "EYES  (camera -> ommatidia grid)")
        if info.frame is not None:
            img = info.frame[..., ::-1] if info.frame.ndim == 3 else info.frame
            ax.imshow(img, cmap="gray", aspect="auto")
            h, w = img.shape[:2]
            ax.axvline(w / 2 - 0.5, color=INPUT, lw=0.8, alpha=0.6)
            for k in range(1, 6):
                ax.axhline(h * k / 6, color=INPUT, lw=0.3, alpha=0.25)
            for k in range(1, 16):
                ax.axvline(w * k / 16, color=INPUT, lw=0.3, alpha=0.25)
        ax.set_xticks([])
        ax.set_yticks([])
        label = info.illusion if info.gesture is not None else "optic flow from the drone camera"
        ax.text(0.02, 0.03, label, transform=ax.transAxes, color=WARN if "loom" in label else TEXT, fontsize=8, fontfamily="monospace",
                bbox={"facecolor": BG, "alpha": 0.7, "edgecolor": "none"})

        # raster
        ax = fig.add_subplot(gs[0:2, 1])
        self._style(ax, "BRAIN  (live spikes: inputs / interneurons / descending)")
        if self.raster:
            ts = np.concatenate([np.full(p.size, tt) for tt, p in self.raster])
            ps = np.concatenate([p for _, p in self.raster])
            rows = self.row_of[ps]
            cols = np.where(self.roles[ps] == 1, INPUT, np.where(self.roles[ps] == 2, OUTPUT, SPIKE))
            ax.scatter(ts, rows, s=1.2, c=cols, marker="|", linewidths=0.6)
        ax.set_xlim(t - self.history_s, t + 0.02)
        ax.set_ylim(-2, self.roles.size + 2)
        ax.set_yticks([])
        ax.set_xlabel("seconds", color=MUTED, fontsize=7)

        # descending neuron rates
        ax = fig.add_subplot(gs[2, 1])
        self._style(ax, "DESCENDING NEURONS  (Hz)")
        names = [k for k in self.brain.output_specs]
        vals = [info.rates.get(k, 0.0) for k in names]
        ax.bar(range(len(names)), vals, color=[OUTPUT if "p01" in k else "#ff8fb8" if "p03" in k else "#ff4d8d" for k in names], width=0.7)
        ax.set_xticks(range(len(names)))
        ax.set_xticklabels(names, fontsize=7, color=TEXT, fontfamily="monospace")
        ax.set_ylim(0, max(100, max(vals) * 1.1))
        ax.grid(axis="y", color=GRID, lw=0.5)

        # map
        ax = fig.add_subplot(gs[0:2, 2])
        self._style(ax, "ROOM  (top view)")
        p0 = self.pilots[0]
        room = getattr(p0.drone, "room", None)
        if room is not None:
            ax.add_patch(Rectangle((-room.size_x / 2, -room.size_y / 2), room.size_x, room.size_y, fill=False, ec=GRID, lw=1))
            for b in room.boxes:
                ax.add_patch(Rectangle((b.lo[0], b.lo[1]), b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], color="#2a3442"))
                ax.text((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, b.name, color=MUTED, fontsize=6, ha="center", va="center")
            ax.set_xlim(-room.size_x / 2 - 0.1, room.size_x / 2 + 0.1)
            ax.set_ylim(-room.size_y / 2 - 0.1, room.size_y / 2 + 0.1)
        palette = [SPIKE, INPUT, WARN, OUTPUT]
        for i, inf in enumerate(infos):
            col = palette[i % len(palette)]
            tr = np.array(self.trails[i]) if self.trails[i] else None
            if tr is not None and len(tr) > 1:
                ax.plot(tr[:, 0], tr[:, 1], color=col, lw=1, alpha=0.6)
            if inf.tel.x_m is not None:
                yaw = np.radians(inf.tel.yaw_deg or 0)
                ax.plot(inf.tel.x_m, inf.tel.y_m, "o", color=col, ms=5)
                ax.arrow(inf.tel.x_m, inf.tel.y_m, 0.35 * np.cos(yaw), 0.35 * np.sin(yaw), color=col, width=0.02, head_width=0.12, length_includes_head=True)
                ax.text(inf.tel.x_m + 0.15, inf.tel.y_m + 0.15, f"{self.pilots[i].name} {inf.tel.alt_m:.2f} m", color=col, fontsize=7, fontfamily="monospace")
        ax.set_aspect("equal")
        ax.set_xticks([])
        ax.set_yticks([])

        # commands
        ax = fig.add_subplot(gs[2, 2])
        self._style(ax, "COMMANDS  (after safety governor)")
        c = info.cmd
        axes = ["throttle", "yaw", "forward"]
        vals = [c.throttle, c.yaw, c.forward]
        ax.barh(range(3), vals, color=[SPIKE if v >= 0 else INPUT for v in vals], height=0.6)
        ax.set_yticks(range(3))
        ax.set_yticklabels(axes, fontsize=7, color=TEXT, fontfamily="monospace")
        ax.set_xlim(-1, 1)
        ax.axvline(0, color=GRID)
        if c.escape:
            ax.text(0.98, 0.1, "GIANT FIBER ESCAPE", transform=ax.transAxes, ha="right", color=WARN, fontsize=8, fontweight="bold", fontfamily="monospace")

        # altitude
        ax = fig.add_subplot(gs[2, 0])
        self._style(ax, "ALTITUDE  (m)")
        for i in range(len(infos)):
            if self.alts[i]:
                a = np.array(self.alts[i])
                ax.plot(a[:, 0], a[:, 1], color=palette[i % len(palette)], lw=1.2)
        ax.set_ylim(0, 2.6)
        ax.set_xlim(max(0, t - 10), max(10, t))
        ax.grid(color=GRID, lw=0.5)

        fig.canvas.draw()
        buf = np.asarray(fig.canvas.buffer_rgba())[..., :3]
        return buf.copy()

    def close(self) -> None:
        plt.close(self.fig)


def save_gif(frames: list[np.ndarray], path: str, fps: int = 10, scale: float = 0.62) -> None:
    from PIL import Image

    imgs = []
    for f in frames:
        im = Image.fromarray(f)
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        imgs.append(im.convert("P", palette=Image.ADAPTIVE, colors=128))
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=int(1000 / fps), loop=0, optimize=True)


class LiveWindow:
    """Shows dashboard frames in an OpenCV window if available. Returns False when 'q' is pressed."""

    def __init__(self, name: str = "FlyDrones"):
        try:
            import cv2

            self.cv2 = cv2
        except ImportError:
            self.cv2 = None
            print("OpenCV not installed: no live window (pip install 'flydrones[vision]')")
        self.name = name

    def show(self, rgb: np.ndarray) -> bool:
        if self.cv2 is None:
            return True
        self.cv2.imshow(self.name, rgb[..., ::-1])
        key = self.cv2.waitKey(1) & 0xFF
        return key != ord("q")

    def close(self) -> None:
        if self.cv2 is not None:
            self.cv2.destroyAllWindows()
