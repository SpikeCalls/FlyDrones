import numpy as np

from flydrones.drones import SimDrone
from flydrones.motor import FlightCommand
from flydrones.senses import GestureIllusion, GestureState, Retina
from flydrones.senses.retina import box_blur


def shifted(tex, dx, dy, scale=1.0):
    H, W = 72, 96
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sx = 100 + (xx - W / 2) / scale + W / 2 + dx
    sy = 60 + (yy - H / 2) / scale + H / 2 + dy
    return (tex[np.clip(sy.astype(int), 0, 199), np.clip(sx.astype(int), 0, 299)] * 255).astype(np.uint8)


def texture():
    return box_blur(np.random.default_rng(0).random((200, 300)).astype(np.float32), 3)


def test_rightward_motion_channels():
    tex, r = texture(), Retina()
    r.encode(shifted(tex, 0, 0))
    v = r.encode(shifted(tex, -1, 0))  # content moves right
    assert v.eyes["L"].grids["btf"].mean() > 0.4 and v.eyes["L"].grids["ftb"].mean() < 0.1
    assert v.eyes["R"].grids["ftb"].mean() > 0.4 and v.eyes["R"].grids["btf"].mean() < 0.1


def test_upward_motion_channels():
    tex, r = texture(), Retina()
    r.encode(shifted(tex, 0, 0))
    v = r.encode(shifted(tex, 0, 1))
    assert v.eyes["L"].grids["up"].mean() > 0.4 and v.eyes["L"].grids["down"].mean() < 0.1


def test_rotation_is_not_looming_but_approach_is():
    d = SimDrone(start=(0, 0, 1.0), wind=0.0)
    d.flying = True
    d.send(FlightCommand(yaw=0.5))
    r = Retina()
    rot = []
    for _ in range(30):
        for _ in range(4):
            d.step(0.0125)
        rot.append(r.encode(d.frame()).eyes["L"].grids["loom"].max())
    d = SimDrone(start=(0.2, 1.0, 1.5), yaw_deg=90, wind=0.0)
    d.flying = True
    d.send(FlightCommand(forward=0.8))
    r = Retina()
    app = []
    for _ in range(45):
        for _ in range(4):
            d.step(0.0125)
        app.append(r.encode(d.frame()).eyes["L"].grids["loom"].max())
    assert max(rot) < 0.2
    assert max(app[-15:]) > 0.5


def test_gesture_illusions():
    ill = GestureIllusion()
    r = Retina()
    v = ill.apply(r.encode(None), GestureState(True, 1.0, 0, 0, 0.2), t=0.0)
    assert v.eyes["L"].grids["up"].mean() > 0.3
    v = ill.apply(r.encode(None), GestureState(False), t=1.0)
    assert v.eyes["R"].grids["down"].mean() > 0.3
