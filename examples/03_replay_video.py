"""Feed a recorded drone video (or any video) to the fly's eyes, offline.
Prints what the descending neurons would have commanded, frame by frame.

    pip install opencv-python
    python examples/03_replay_video.py my_flight.mp4
"""

import sys

import cv2

from flydrones.brain import Brain, load_connectome
from flydrones.config import load_config
from flydrones.motor import MotorDecoder
from flydrones.senses import InputEncoder, Retina

cfg = load_config()
brain = Brain(load_connectome(cfg["brain"]["source"]), cfg)
retina, enc, dec = Retina.from_config(cfg), InputEncoder(brain.connectome, cfg), MotorDecoder(cfg)
cap = cv2.VideoCapture(sys.argv[1])
fps = cap.get(cv2.CAP_PROP_FPS) or 30
dt = 1.0 / fps
k = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    rates = brain.tick(enc.encode(retina.encode(frame)), dt * 1000)
    cmd = dec.update(rates, dt)
    if k % int(fps // 4 or 1) == 0:
        print(f"{k * dt:6.2f}s thr={cmd.throttle:+.2f} yaw={cmd.yaw:+.2f} escape={cmd.escape} DNg02 L/R={rates['DNg02_L']:.0f}/{rates['DNg02_R']:.0f}")
    k += 1
