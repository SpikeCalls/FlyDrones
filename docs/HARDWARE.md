# Hardware

FlyDrones talks to every drone through one small interface ([`drones/base.py`](../src/flydrones/drones/base.py)):
`takeoff()`, `send(FlightCommand)`, `telemetry()`, `frame()`, `land()`. A `FlightCommand` has
`throttle` (vertical speed), `yaw` (yaw rate), `forward`, `lateral`, each in −1..1. The drone's own
flight controller turns that into motor speeds and keeps the airframe level.

> Status: the simulator path is tested end to end. The Tello, Crazyflie, MAVLink and ESP32 adapters follow
> the official SDKs but have **not been flight-tested by the authors yet**. Please open an issue with logs
> (`--log flight.csv`) when you try one.

## DJI / Ryze Tello (recommended first drone)

- **Why:** built-in altitude hold and optical-flow positioning, Wi-Fi video, prop guards, 80 g.
- **Install:** `pip install -e ".[tello,gestures]"`
- **Connect:** join the `TELLO-XXXXXX` Wi-Fi network from your laptop.
- **Run:** `flydrones fly --drone tello --config configs/tello.yaml --input both --live --send`
- **Mapping:** `send_rc_control(lateral, forward, throttle, yaw)` scaled to ±60 % stick by default.
- **Eyes:** the Tello video feed goes into the retina (optic flow and looming). Your hand in front of the
  laptop webcam adds illusions. `--input camera` uses only the drone camera, `--input gesture` only the hand.
- **Kill switch:** Ctrl+C lands. `TelloDrone.emergency_stop()` cuts motors (the drone falls).
- **Tip:** Tello needs light and a textured floor to hold position. Video over Wi-Fi lags 100-200 ms,
  which slows the looming reflex.

## Bitcraze Crazyflie 2.1 (+ Flow deck v2)

- **Why:** 27 g, open firmware, safest indoor platform.
- **Install:** `pip install -e ".[crazyflie,gestures]"` and a Crazyradio PA/2.0 dongle.
- **Run:** `flydrones fly --drone crazyflie --uri radio://0/80/2M/E7E7E7E7E7 --config configs/crazyflie.yaml --input gesture --send`
- **Mapping:** hover setpoints `(vx, vy, yaw_rate, z)`. The brain's throttle is integrated into a height
  target, so the Crazyflie's estimator holds altitude between decisions.
- **Eyes:** no video camera. Use the webcam hand (or add an AI deck and write a `frame()` method).
- **Arming:** newer firmware needs an arming request, the adapter sends it.

## ArduPilot / PX4 (MAVLink)

- **Start in SITL.** ArduPilot: `sim_vehicle.py -v ArduCopter --console --map`. PX4: `make px4_sitl gz_x500`.
- **Install:** `pip install -e ".[mavlink]"`
- **Run:** `flydrones fly --drone mavlink --mavlink udpin:0.0.0.0:14550 --autopilot ardupilot --config configs/mavlink_sitl.yaml --input gesture --send`
- **Serial telemetry radio:** `--mavlink COM5,57600` (Windows) or `/dev/ttyUSB0,57600`.
- **Mapping:** `SET_POSITION_TARGET_LOCAL_NED` in body frame, velocity + yaw rate
  (`type_mask = 1479`). ArduPilot uses GUIDED, PX4 uses OFFBOARD (a setpoint stream is sent before switching).
- **Telemetry used:** `LOCAL_POSITION_NED` (altitude, geofence), `ATTITUDE` (yaw rate → halteres), `SYS_STATUS` (battery).
- **Outdoors only**, with a real RC transmitter able to switch to LOITER/LAND at any time.

## Betaflight / INAV quad via ESP32 bridge

For FPV-style quads without a companion computer.

```
laptop (fly brain) ──Wi-Fi UDP──► ESP32 ──UART MSP──► flight controller ──► ESCs
```

- **Parts:** any ESP32 dev board (or M5Stack Atom), 3 wires, a Betaflight/INAV FC with a free UART.
- **Firmware:** open [`firmware/esp32_msp_bridge/esp32_msp_bridge.ino`](../firmware/esp32_msp_bridge/esp32_msp_bridge.ino)
  in Arduino IDE (ESP32 core ≥ 2.0), change `AP_PASS`, flash.
- **Wiring:** ESP32 GPIO17 → FC RX, GPIO16 ← FC TX, GND ↔ GND.
- **Betaflight Configurator:** Ports → MSP on that UART. Receiver → "MSP RX input". Modes → ARM on AUX1,
  ANGLE always on. Failsafe → stage 2 "Land".
- **Laptop:** join `FlyDrones-Bridge` Wi-Fi, then `flydrones fly --drone esp32 --config configs/esp32_betaflight.yaml --input gesture --send`.
- **Protocol:** `FD1,seq,arm,thr,yaw,pitch,roll` at up to 50 Hz, values −1000..1000. The ESP32 stops
  sending RC frames after 300 ms without a packet, so the FC's own RX-loss failsafe takes over.
- **Warning:** Betaflight has no altitude hold. Throttle here is a stick offset around `HOVER_PWM`, which
  you must calibrate. This is the hardest and most dangerous path. Props off until everything is verified,
  then fly in a cage or over a net.

## Your own drone

Subclass `Drone`:

```python
from flydrones.drones.base import Drone
from flydrones.safety import Telemetry

class MyDrone(Drone):
    name = "mine"
    has_camera = False
    def takeoff(self): ...
    def land(self): ...
    def send(self, cmd): ...          # cmd.throttle, cmd.yaw, cmd.forward, cmd.lateral in -1..1
    def telemetry(self): return Telemetry(alt_m=..., yaw_rate_dps=..., battery_pct=..., flying=True)
```

Then run it with `flydrones.runtime.run_realtime(Pilot(brain, MyDrone(), cfg))`.

## Laptop

- Any 4-core CPU from the last few years runs MiniFly and sensorimotor cores in real time.
- The full MaleCNS brain needs 8 GB RAM. Speed depends on the CPU; check with `flydrones bench --brain ...`.
- A webcam for gestures; good, even lighting helps both MediaPipe and the OpenCV fallback.
