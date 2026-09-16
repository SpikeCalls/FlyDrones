# Guide: connect a fruit fly brain to a drone

This is the long version of the README, step by step, from zero to a drone in the air.

- [Try it in the browser first](#try-it-in-the-browser-first)
- [0. The idea in one minute](#0-the-idea-in-one-minute)
- [1. Install](#1-install)
- [2. Fly in the simulator](#2-fly-in-the-simulator)
- [3. Look inside the brain](#3-look-inside-the-brain)
- [4. Load the real connectome](#4-load-the-real-connectome)
- [5. Calibrate the read-out](#5-calibrate-the-read-out)
- [6. Pick a drone](#6-pick-a-drone)
- [7. First real flight (Tello)](#7-first-real-flight-tello)
- [8. Record a video for social media](#8-record-a-video-for-social-media)
- [9. Tuning cheat-sheet](#9-tuning-cheat-sheet)

## Try it in the browser first

Open **[spikecalls.github.io/FlyDrones](https://spikecalls.github.io/FlyDrones/)**. Press `S` to swing a fly swatter at the drone and see whether the giant fiber reacts in time, click any neuron group in the Brain panel to stimulate it, keys `1`-`6` are gestures, **USE MY HAND** turns on webcam hand tracking, **CHAIR RUN** flies at an obstacle, `N` switches day and night, `C` cycles camera views. The browser runs MiniFly with a JavaScript port of the same engine (`docs/live/engine.js`), checked against the Python package in CI.

## 0. The idea in one minute

A fly does not have a "flight controller". It has two compound eyes (roughly 750-800 ommatidia each), motion-sensing neurons,
and a few hundred **descending neurons** that carry decisions from the brain down to the wing motor in the thorax.

FlyDrones rebuilds that chain on a computer:

```
camera frame ─► optic flow per eye cell ─► spikes on T4/T5, LPLC2, LC4, R1-R6
                                             │
                          connectome (signed synapse counts) + LIF neurons
                                             │
      spikes on DNg02 (wing stroke), DNp03 (saccade), DNp01 (giant fiber escape)
                                             │
             firing rate − resting rate ─► throttle, yaw, forward ─► safety ─► drone
```

The drone's own flight controller keeps it level. The fly brain decides where to go.

## 1. Install

Python 3.10 or newer.

```bash
git clone https://github.com/SpikeCalls/FlyDrones.git
cd FlyDrones
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell
.venv\Scripts\Activate.ps1

pip install -e ".[vision]"         # core + OpenCV window
pip install -e ".[all,dev]"        # everything: gestures, data, all drones, tests
```

Check it: `flydrones --version` and `pytest -q`.

## 2. Fly in the simulator

```bash
flydrones demo --live
```

A window opens with four panels: the drone camera with the fly-eye grid, a live spike raster, the room seen
from above, and the commands after the safety governor. The demo uses a scripted hand: open palm, fist, move
right, rush at the camera, drop.

Save a GIF instead of a window: `flydrones demo --record demo.gif`. Save a flight log: `--log flight.csv`.

Other simulator runs:

```bash
flydrones swarm --live                                   # 3 drones, 3 copies of one brain
flydrones fly --drone sim --input camera --seconds 30 --live   # no hand, pure optic flow
```

## 3. Look inside the brain

```bash
flydrones inspect
```

prints every input and output group, how many neurons it matched, and then stimulates each input group for
500 ms and shows how the descending neurons respond. This is the fastest way to see whether your wiring makes
sense. Examples:

- `T4c_L` (upward motion, left eye) should raise **DNg02** (more lift).
- `LPLC2_L` (looming on the left) should fire **DNp01_L** (giant fiber) and **DNp03_L** (turn away).

Write your own experiments with [`examples/01_poke_neurons.py`](../examples/01_poke_neurons.py).

## 4. Load the real connectome

```bash
pip install -e ".[data]"
flydrones download malecns          # 3 files, ~1.2 GB, resumable
flydrones build-brain --out data/malecns_brain.npz
```

`build-brain`:

1. reads cell annotations and drops glia / unannotated bodies,
2. signs every neuron by predicted neurotransmitter (acetylcholine +, GABA / glutamate / histamine −),
3. streams the 1.1 GB weights table and keeps pairs with ≥ 3 synapses,
4. matches the groups from `defaults.yaml` by cell type and side,
5. saves a compact `.npz`.

You need ~6 GB of free RAM while building. After that the `.npz` loads in seconds.
Too slow for real time on your machine? Build a sensorimotor core:

```bash
flydrones build-brain --core-hops 3 --out data/malecns_core3.npz
flydrones bench --brain data/malecns_core3.npz
```

Details: [CONNECTOME_DATA.md](CONNECTOME_DATA.md).

## 5. Calibrate the read-out

The real connectome does not come with labels like "this neuron means climb". Calibration shows the brain
seven visual situations (rest, sinking, rising, rotating left/right, looming left/right), records the
descending neurons and fits a small linear read-out:

```bash
flydrones calibrate --brain data/malecns_brain.npz --out readout_malecns.json
```

It prints R² for throttle and yaw. Then fly with it:

```bash
flydrones demo --config configs/malecns.yaml
```

Only the read-out is fitted. The connectome is never changed.

If DNg02 is silent or saturated, adjust `brain.bias` in `configs/malecns.yaml` (tonic flight drive, in mV)
and re-run `inspect`.

## 6. Pick a drone

| | Tello | Crazyflie 2.1 + Flow deck | ArduPilot / PX4 | Betaflight + ESP32 |
|---|---|---|---|---|
| price (approx.) | low | medium | medium-high | low-medium |
| camera for the fly | yes (Wi-Fi video) | no (use webcam hand) | optional | no (use webcam hand) |
| altitude hold | yes | yes | yes | no (angle mode only) |
| difficulty | easiest | easy | medium | hardest |
| indoor safe | yes, with guards | yes | no, outdoors | cage / net |

Start with **Tello** if you want the "camera → fly eyes" story, or **Crazyflie** for the smallest, safest
indoor drone. Full setup for each: [HARDWARE.md](HARDWARE.md).

## 7. First real flight (Tello)

1. Charge the battery, fit prop guards, clear a 3 × 3 m space.
2. `pip install -e ".[tello,gestures]"`
3. Connect your computer to the `TELLO-XXXXXX` Wi-Fi.
4. Dry run, nothing is sent:
   `flydrones fly --drone tello --config configs/tello.yaml --input both --live`
   (the dry run does not connect to the drone; it shows the brain and the commands it would send)
5. Real flight:
   `flydrones fly --drone tello --config configs/tello.yaml --input both --live --send --seconds 60`
6. The drone takes off after the brain warm-up (it measures resting firing rates while still on the ground).
7. Hand gestures in front of the laptop webcam: open palm → climb, fist → hold, drop hand → descend.
8. **Ctrl+C** or `q` in the window lands. Low battery, 3 minutes, or a brain stall also land or hover.

## 8. Record a video for social media

- Screen-record the `--live` dashboard and film the drone with a phone at the same time. Put them side by side.
- Or record the dashboard as a GIF: `flydrones demo --record out.gif --every 2`.
- Show the numbers honestly: the title bar of the dashboard prints neuron count, connection count, brain name
  and how fast the brain runs compared to real time.

## 9. Tuning cheat-sheet

| symptom | knob (YAML) |
|---|---|
| drone drifts up / down at rest | `decoder.settle_s` longer, or `brain.bias` for DNg02 |
| climbs too fast with open palm | `decoder.axes.throttle.gain` lower, `safety.max_throttle` lower |
| yaw wobbles | `decoder.smoothing` lower, `decoder.axes.yaw.gain` lower, `imu.yaw_saturation_dps` higher |
| escapes too often | `decoder.escape.threshold_hz` higher, `vision.loom_floor` higher |
| never escapes | `vision.loom_gain` higher, `inputs.LPLC2_*.max_hz` higher |
| optic flow too noisy (real camera) | `vision.blur` 2, `vision.flow_gain` higher |
| brain slower than real time | `build-brain --core-hops 3`, `brain.lif.dt` 1.0, fewer `record_neurons` |
