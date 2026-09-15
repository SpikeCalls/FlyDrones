# Architecture

![architecture](../assets/architecture.svg)

## One control tick (default 20 Hz)

```python
frame   = drone.frame()                          # BGR image or None
vision  = retina.encode(frame)                   # per-eye grids: brightness, ftb, btf, up, down, loom, loom_speed
vision  = illusion.apply(vision, gesture, t)     # optional hand -> optic-flow illusion
tel     = drone.telemetry()                      # altitude, yaw rate, battery, position
inputs  = encoder.encode(vision, tel.yaw_rate)   # {group: Hz per neuron}
rates   = brain.tick(inputs, ms=dt*1000)         # run the connectome for one tick, mean Hz per group
cmd     = decoder.update(rates, dt)              # linear read-out + escape reflex
cmd     = safety.filter(cmd, tel, dt)            # limits always win
drone.send(cmd)
```

Code: [`runtime.py`](../src/flydrones/runtime.py).

## Modules

| module | responsibility | key classes |
|---|---|---|
| `brain/connectome.py` | signed synapse matrix, cell-type labels, group selection by regex + side, save/load `.npz`, sensorimotor subgraph, MaleCNS feather builder | `Connectome`, `GroupSpec`, `build_malecns` |
| `brain/lif.py` | event-driven LIF simulation, delays, refractoriness, Poisson input, tonic bias, cheap copies | `LIFNetwork`, `LIFParams` |
| `brain/brain.py` | ties connectome + LIF + config groups; `tick()` returns group rates; `copy()` for swarms | `Brain` |
| `brain/synthetic.py` | MiniFly | `build_minifly` |
| `senses/retina.py` | numpy optic flow per grid cell, affine looming estimate | `Retina`, `VisualFrame` |
| `senses/gestures.py` | MediaPipe / OpenCV / scripted hands, illusions | `GestureIllusion`, `MediaPipeHands`, `OpenCVHands` |
| `senses/encoder.py` | features → Poisson rates per input neuron | `InputEncoder` |
| `motor/decoder.py` | descending-neuron rates → `FlightCommand`, baselines, escape, cruise braking | `MotorDecoder` |
| `safety.py` | clamps, slew rate, ceiling fade, floor, geofence, watchdog, battery, flight time | `SafetyGovernor`, `Telemetry` |
| `drones/*` | backends | `SimDrone`, `TelloDrone`, `CrazyflieDrone`, `MavlinkDrone`, `UDPBridgeDrone` |
| `calibrate.py` | stimulus battery + ridge regression read-out | `calibrate` |
| `viz/dashboard.py` | matplotlib dashboard, OpenCV window, GIF writer | `Dashboard` |

## The simulator core

Connectivity is a CSC matrix `W[post, pre]` of signed synapse counts. When neurons spike, their columns are
gathered with one vectorised `np.repeat` / `np.bincount` pass, so cost scales with **spikes × out-degree**,
not with the total number of synapses. Arriving input sits in a ring buffer for `delay / dt` steps.
Membrane updates are in-place numpy operations over all neurons; refractory neurons are tracked as a short
index list. For very dense bursts it falls back to a sparse matrix-vector product.

## Configuration

Everything lives in YAML: [`src/flydrones/defaults.yaml`](../src/flydrones/defaults.yaml) is the full
reference, files in [`configs/`](../configs) override parts of it (`--config`). Dictionaries merge deeply,
except `terms` blocks, which replace.

## Adding things

- **New sensory channel:** compute a grid or scalar feature, add a group in `inputs:` with `feature: <name>`
  (scalar features can be passed through `InputEncoder.encode(..., extra={...})`).
- **New motor read-out:** add a group in `outputs:` and a term in `decoder.axes`.
- **New drone:** subclass `Drone` ([HARDWARE.md](HARDWARE.md#your-own-drone)).
- **New connectome** (FlyWire, BANC...): produce a `Connectome` with `weights`, `types`, `sides` and save it.

## Browser port

`docs/index.html` + `docs/live/` is the GitHub Pages demo. `engine.js` is a line-by-line JavaScript port of the
LIF simulator, retina, encoder, gesture illusions, decoder, safety governor and simulated drone.
`tools/export_web_brain.py` writes MiniFly and the default config to `docs/live/minifly.json`, and CI runs
`node tools/check_web_engine.mjs` to make sure the browser version still climbs, holds, escapes and descends like
the Python one. Rendering uses a vendored copy of three.js (MIT, `docs/vendor/`).
