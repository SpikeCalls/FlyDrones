<p align="center">
  <img src="assets/banner.svg" alt="FlyDrones: a fruit fly connectome as a drone pilot" width="100%">
</p>

<p align="center">
  <a href="https://spikecalls.github.io/FlyDrones/"><img alt="Fly it in your browser" src="https://img.shields.io/badge/%E2%96%B6%20FLY%20IT%20IN%20YOUR%20BROWSER-39ff88?style=for-the-badge&labelColor=0d1117"></a>
  &nbsp;
  <a href="#quick-start"><img alt="Quick start" src="https://img.shields.io/badge/QUICK%20START-4cc9f0?style=for-the-badge&labelColor=0d1117"></a>
  &nbsp;
  <a href="docs/GUIDE.md"><img alt="Guide" src="https://img.shields.io/badge/GUIDE-ff4d8d?style=for-the-badge&labelColor=0d1117"></a>
</p>

<p align="center">
  <img alt="python" src="https://img.shields.io/badge/python-3.10%2B-39ff88?style=flat-square&labelColor=0d1117">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-4cc9f0?style=flat-square&labelColor=0d1117"></a>
  <a href="https://github.com/SpikeCalls/FlyDrones/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/SpikeCalls/FlyDrones/actions/workflows/ci.yml/badge.svg"></a>
</p>

<h2 align="center">A fruit fly's wiring diagram is flying this drone.</h2>

<p align="center">
  <a href="https://spikecalls.github.io/FlyDrones/"><img src="assets/hero.gif" alt="FlyDrones Live: a 3D drone flown by a spiking fly brain model, with fly-eye optic flow, every neuron firing, and a giant fiber escape" width="100%"></a>
  <br><sub>Recorded from the <a href="https://spikecalls.github.io/FlyDrones/">live browser demo</a>: the swat game. Simulation running MiniFly, see <a href="#the-honest-part">the honest part</a>.</sub>
</p>

<table align="center">
  <tr>
    <td align="center"><h3>166k</h3><sub>neurons in the MaleCNS<br>connectome it loads</sub></td>
    <td align="center"><h3>~25M</h3><sub>neuron-to-neuron connections<br>after typical filtering</sub></td>
    <td align="center"><h3>6</h3><sub>descending neurons<br>read as stick commands</sub></td>
    <td align="center"><h3>4</h3><sub>drone platforms<br>+ simulator</sub></td>
    <td align="center"><h3>0</h3><sub>lines of flight code<br>inside the brain</sub></td>
  </tr>
</table>

<p align="center">
<b>Open palm</b>, it climbs. <b>Fist</b>, it holds. <b>Drop your hand</b>, it comes down. <b>Rush at the camera</b>, the giant fiber fires and it escapes.<br>
The brain never gets a "climb" command. It gets an <b>optic-flow illusion</b>, and its own reflexes do the rest.
</p>

---

In 2026 the complete central nervous system of a male fruit fly was published: **MaleCNS v1.0**, about **166,000 neurons** reconstructed by HHMI Janelia, Cambridge, MRC LMB and Google Research, free under CC-BY. People have plugged it into DOOM, Mario, trading bots and walking robots.

**FlyDrones gives it wings.** It turns a drone camera (or your hand in front of a webcam) into activity on the fly's own visual neurons, runs the connectome as a spiking network, and reads out the descending neurons a real fly uses to steer its wings as flight commands for a real drone.

## Try it in 10 seconds

**[spikecalls.github.io/FlyDrones](https://spikecalls.github.io/FlyDrones/)**. No install. A 3D bedroom, a blue quadcopter with a fly riding on top, and the whole loop running live in your browser: a ray-cast drone camera, per-cell optic flow, 850 spiking neurons, the descending-neuron read-out, the safety governor and the drone physics.

**Play**

| | what you do | what happens inside |
|---|---|---|
| `S` | **SWAT IT**: swing a fly swatter at the drone | the swatter expands on the camera → **LPLC2 + LC4 → giant fiber DNp01** fires → the drone jumps. Too fast and it gets swatted. Every dodge makes the next swing faster |
| click | **the Brain panel**: stimulate any neuron group | poke `DNg02 L` and watch it yaw, poke `LPLC2` and watch it escape |
| click | **the fly** | it buzzes (it is only the mascot, the pilot is the simulated brain) |
| `1`-`6` | hand gestures: palm, fist, left, right, rush, drop | optic-flow illusions, see below |
| | **USE MY HAND** | your webcam and MediaPipe hand tracking drive the same illusions |
| | **CHAIR RUN** | the drone cruises at a chair, looming makes it brake and dodge |
| `N` `C` `M` | day / night, orbit / chase / drone camera, sound | |

| key | gesture | what the fly sees | what the brain does |
|---|---|---|---|
| `1` | open palm | scene drifts **up**, as if sinking | T4c → VS → **DNg02** L+R up → climb |
| `2` | fist | still scene | DNg02 back to rest → hold |
| `3` `4` | hand left / right | scene rotates | HS → DNg02 L vs R → optomotor turn |
| `5` | rush at it | expansion on both eyes | **LPLC2 + LC4 → giant fiber DNp01** → escape |
| `6` | drop hand | scene drifts **down**, as if rising | T4d → LPi ⊣ DNg02 → descend |

When the drone really climbs, its camera sees real downward flow, which cancels the illusion, so the loop settles on its own.

<details>
<summary><b>The Python dashboard</b> (same loop, <code>flydrones demo --record</code>)</summary>
<p align="center">
  <img src="assets/demo.gif" alt="FlyDrones Python dashboard: simulated drone controlled by a fly brain model through hand-gesture illusions" width="100%">
</p>

| time | hand | what the brain does | drone |
|---|---|---|---|
| 2.5 s | open palm | VS → **DNg02** L+R up | climbs 1.0 → 1.7 m |
| 4.5 s | fist | DNg02 back to rest | holds ~1.8 m |
| 9.5 s | fist moved right | right DNg02 > left (optomotor) | yaws right |
| 13.5 s | hand rushes in | **LPLC2/LC4 → giant fiber DNp01** + DNp03 | escape burst |
| 15.5 s | hand dropped | DNg02 drops | descends |
</details>

## The honest part

- **This is a computational model, not a living or resurrected fly.** The wiring is biological (synapse counts from electron microscopy). The dynamics are a standard leaky integrate-and-fire model ([Shiu et al., *Nature* 2024](https://www.nature.com/articles/s41586-024-07763-9)) using their published parameters.
- **The bridge is engineered.** Which camera features feed which neurons, the tonic "I am flying" drive, and the linear read-out from descending neurons to stick commands were designed by us. Each choice is written down in [`defaults.yaml`](src/flydrones/defaults.yaml) and [docs/SCIENCE.md](docs/SCIENCE.md), with the paper it leans on.
- **The drone's own flight controller keeps it level.** FlyDrones sends high-level stick commands (vertical speed, yaw rate, forward), like a pilot with a remote. A **safety governor** outside the brain always has the last word.
- **The browser demo and the GIFs use MiniFly**, an 850-neuron, hand-wired stand-in with real fly cell-type names, so it runs anywhere in seconds. It is not the real connectome. The fly sitting on the 3D drone is a mascot; the pilot is the simulated brain. In the swat game the giant fiber triggers a short jump (a stand-in for a fly's takeoff jump) instead of the gentle climb used for real drones. The real 166k MaleCNS connectome loads with two commands ([below](#use-the-real-connectome)), and you calibrate its read-out with `flydrones calibrate`.
- **Hardware adapters are written against the official SDKs but have not been flight-tested by us yet.** Start in the simulator, then props-off, then a net or an empty room.

## Quick start

```bash
git clone https://github.com/SpikeCalls/FlyDrones.git
cd FlyDrones
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[vision]"

flydrones demo --live                 # simulated room + scripted hand, live dashboard
flydrones demo --record my_demo.gif   # or save it
flydrones swarm --live                # one connectome, three pilots
flydrones inspect                     # poke every input group, watch the motor neurons
```

No camera, drone or GPU needed for any of the above.

## How it works

<p align="center"><img src="assets/architecture.svg" alt="Architecture diagram" width="100%"></p>

| stage | neurons (cell types) | role in the real fly | FlyDrones signal |
|---|---|---|---|
| eyes | **R1-R6** | photoreceptors | brightness per ommatidium cell |
| motion | **T4a/T5a · T4b/T5b · T4c/T5c · T4d/T5d** | direction-selective cells: front-to-back, back-to-front, up, down ([Maisak et al. 2013](https://www.nature.com/articles/nature12320)) | per-cell optic flow (numpy Lucas-Kanade) |
| looming | **LPLC2**, **LC4** | detect approaching objects, drive the giant fiber ([Ache et al. 2019](https://www.sciencedirect.com/science/article/pii/S0960982219301381)) | expansion of the flow field |
| balance | **haltere** afferents | gyroscope organs | drone IMU yaw rate |
| lift & steering | **DNg02** L/R | population that sets wing-stroke amplitude; left/right act independently ([Namiki et al. 2022](https://www.cell.com/current-biology/fulltext/S0960-9822(22)00019-7)) | throttle = L+R, yaw = R−L |
| evasive turns | **DNp03** L/R | looming-evoked flight saccades ([Curr. Biol. 2025](https://www.cell.com/current-biology/fulltext/S0960-9822(25)01542-8)) | yaw away from the threat, brakes cruise |
| escape | **DNp01** (giant fiber) | escape takeoff | short climb / drop / brake reflex |

The simulator is event-driven: each step only touches the synapses of neurons that actually spiked. Details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Gestures

| gesture | illusion | expected response |
|---|---|---|
| open palm | scene drifts up | climb |
| fist | still scene | hold |
| hand dropped / gone | scene drifts down | descend to the safety floor and hold |
| hand left / right | scene rotates | turn toward it |
| hand rushes at the camera | expansion | giant-fiber escape |

Hand tracking uses MediaPipe if installed (`pip install -e ".[gestures]"`), otherwise an OpenCV skin-colour detector.

## Plug in a real drone

Everything below is a **dry run** (commands printed, nothing sent) until you add `--send`.

| drone | install | run | notes |
|---|---|---|---|
| **DJI / Ryze Tello** | `pip install -e ".[tello,gestures]"` | `flydrones fly --drone tello --input both --live` | easiest start; its camera becomes the fly's eyes |
| **Crazyflie 2.x + Flow deck** | `pip install -e ".[crazyflie,gestures]"` | `flydrones fly --drone crazyflie --input gesture` | 27 g; webcam hand as the eyes |
| **ArduPilot / PX4** (real or SITL) | `pip install -e ".[mavlink]"` | `flydrones fly --drone mavlink --mavlink udpin:0.0.0.0:14550` | GUIDED / OFFBOARD velocity setpoints |
| **Betaflight / INAV quad** | flash [`firmware/esp32_msp_bridge`](firmware/esp32_msp_bridge) | `flydrones fly --drone esp32 --input gesture` | ESP32 Wi-Fi → MSP RC override |

Setup and wiring for each drone: [docs/HARDWARE.md](docs/HARDWARE.md). Step-by-step guide: [docs/GUIDE.md](docs/GUIDE.md).

## Use the real connectome

```bash
pip install -e ".[data]"
flydrones download malecns                   # ~1.2 GB from Janelia's public bucket (CC-BY)
flydrones build-brain --out data/malecns_brain.npz
flydrones inspect   --brain data/malecns_brain.npz
flydrones calibrate --brain data/malecns_brain.npz --out readout_malecns.json
flydrones demo      --brain data/malecns_brain.npz --config configs/malecns.yaml
```

`build-brain` keeps connections with ≥ 3 synapses, signs them by predicted neurotransmitter and resolves every input/output group by cell type and side. Exact counts depend on the filters. For reference, [DOOMFLY](https://github.com/nftechie/doomfly) reports **166,700 neurons and 25,582,938 directed connections** after its own filtering.

For a faster model, keep only neurons within a few synapses of both the eyes and the descending neurons: `flydrones build-brain --core-hops 3`.

## One fly, three pilots

<p align="center"><img src="assets/swarm.gif" alt="Three simulated drones flown by three copies of the same connectome" width="100%"></p>

`flydrones swarm` copies one connectome into three independent brains: same wiring, separate spikes. We give each drone a different job, and the brain decides the rest. Output of the run above:

```
fly-1  hover job        -> holds ~1.0 m, 0 collisions
fly-2  cruise at chair  -> 2 giant-fiber escapes, gets past the chair, 0 collisions
fly-3  hand dropped     -> descends to the 0.3 m safety floor and holds
```

## Performance

| brain | neurons | connections | speed (2-vCPU cloud VM, numpy) |
|---|---|---|---|
| MiniFly (synthetic) | 850 | 4,928 | 6-11× real time with camera + dashboard |
| same size as MaleCNS (random graph benchmark) | 166,700 | 25.6 M | 0.62× real time, dt = 0.5 ms |

A desktop CPU is faster. The control loop adapts `dt` to wall time and warns if the brain falls behind. Use `--core-hops` or run on a faster machine for real-time full-brain flight. Measure yours with `flydrones bench --brain ...`.

## Repository map

```
src/flydrones/
  brain/       connectome.py (MaleCNS loader, groups, subgraphs) · lif.py (simulator) · synthetic.py (MiniFly)
  senses/      retina.py (optic flow, looming) · gestures.py (hand -> illusions) · encoder.py · webcam.py
  motor/       decoder.py (descending neurons -> commands) · command.py
  drones/      sim.py · tello.py · crazyflie.py · mavlink.py · udp_bridge.py (ESP32/MSP)
  safety.py    limits, ceiling, floor, geofence, watchdog, battery
  runtime.py   the closed loop
  calibrate.py fit the read-out on your connectome
  viz/         live dashboard and GIF recorder
  cli.py       `flydrones ...`
docs/index.html + docs/live/     the browser demo (three.js, JS port of the engine)
firmware/esp32_msp_bridge/   Arduino sketch: UDP -> MSP_SET_RAW_RC
configs/     tello, crazyflie, mavlink SITL, esp32, malecns
docs/        GUIDE · HARDWARE · SCIENCE · ARCHITECTURE · CONNECTOME_DATA · SAFETY · FAQ
examples/    small scripts to poke neurons, write your own decoder, replay a video
tests/       pytest suite (simulator, retina, decoder, safety, protocol, MaleCNS loader)
tools/       export the browser brain, check the JS engine against Python
```

## Safety

Drones cut fingers. The brain is a research model and can do unexpected things.

- Every hardware command is a dry run until `--send`.
- The safety governor clamps speed, fades out climbing near the ceiling, blocks descent below the floor, hovers if the brain stalls, lands on low battery or after `max_flight_s`.
- **Ctrl+C lands.** Keep the vendor app or a second remote ready as a kill switch.
- Props off for the first bench test. Fly indoors only with prop guards, over soft ground, away from people and pets.

Read [docs/SAFETY.md](docs/SAFETY.md) before the first real flight.

## Roadmap

- [x] Event-driven LIF simulator, MaleCNS v1.0 loader, MiniFly
- [x] Optic flow, looming, gesture illusions, haltere feedback
- [x] Tello, Crazyflie, MAVLink, ESP32/Betaflight adapters, safety governor
- [x] Live dashboard, GIF recorder, swarm mode, read-out calibration
- [x] Browser demo on GitHub Pages: 3D room, swat game, clickable neurons, webcam hand tracking
- [ ] First real Tello flight video with the full MaleCNS brain
- [ ] Retinotopy from MaleCNS optic-lobe hex coordinates
- [ ] PyTorch / CUDA backend for full-brain real time on a laptop GPU
- [ ] Dopamine (PPL1) reinforcement on crashes, like DOOMFLY
- [ ] ROS 2 node
- [ ] Onboard: brain core on a Raspberry Pi 5 carried by the drone

See [ROADMAP.md](ROADMAP.md). Ideas and PRs are welcome: [CONTRIBUTING.md](CONTRIBUTING.md).

## Science and credits

- **MaleCNS v1.0 connectome**: HHMI Janelia FlyEM, University of Cambridge, MRC LMB, Google Research. [male-cns.janelia.org](https://male-cns.janelia.org/) · data CC-BY 4.0 · paper in *Cell* (2026).
- **LIF whole-brain model**: Shiu P.K. et al., *A Drosophila computational brain model reveals sensorimotor processing*, *Nature* 2024. [code](https://github.com/philshiu/Drosophila_brain_model)
- **Flight circuitry**: Namiki et al. (DNg02), Ache et al. 2019 (LPLC2/LC4 → giant fiber), DNp03 flight-saccade papers in *Current Biology* 2024-2025, Maisak et al. 2013 (T4/T5 directions).
- Full reference list and what is literature vs. engineering: [docs/SCIENCE.md](docs/SCIENCE.md). Data licences: [THIRD_PARTY.md](THIRD_PARTY.md).

**Related projects that inspired this one:** [DOOMFLY](https://github.com/nftechie/doomfly) (MaleCNS plays DOOM) · [flybrain](https://github.com/dylankainth/flybrain) (FlyWire on a Tello) · [flybrain-robot-bridge](https://github.com/Frankweb33/flybrain-robot-bridge) · [Eon fly-brain](https://github.com/eonsystemspbc/fly-brain) · [NeuroMechFly / FlyGym](https://github.com/NeLy-EPFL/flygym) · [flybody](https://github.com/TuragaLab/flybody) · [awesome-fly](https://github.com/cobanov/awesome-fly).

## Contributors

<table>
  <tr>
    <td align="center"><a href="https://github.com/SpikeCalls"><b>SpikeCalls</b></a><br>idea, direction, flights</td>
    <td align="center"><b>Claude</b> (Anthropic)<br>code, docs, simulations</td>
  </tr>
</table>

## License

Code: [MIT](LICENSE). Connectome data keeps its own licence (MaleCNS: CC-BY 4.0), see [THIRD_PARTY.md](THIRD_PARTY.md). If you use FlyDrones in a paper or video, please credit the connectome authors and [cite this repo](CITATION.cff).

<p align="center"><sub>The fly is a model. The drone is real. Fly carefully.</sub></p>
