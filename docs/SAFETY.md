# Safety

FlyDrones puts a research model in charge of a machine with spinning blades. Treat it like any
experimental autopilot.

## Layers

1. **Dry run by default.** Hardware commands are only sent with `--send`.
2. **Brain warm-up on the ground.** Resting firing rates are measured before takeoff.
3. **Safety governor** ([`safety.py`](../src/flydrones/safety.py)), independent of the brain:
   - per-axis limits (`max_throttle`, `max_yaw`, `max_forward`, `max_lateral`)
   - slew-rate limit (commands can drop to zero instantly, but ramp up slowly)
   - ceiling: climbing fades out 30 cm below `max_alt_m` and reverses above it
   - floor: no descent command below `min_alt_m` while flying
   - geofence on drones that report position
   - brain watchdog: hover if the brain output is older than `brain_timeout_s`
   - land on low battery or after `max_flight_s`
4. **Ctrl+C / `q` lands** and closes the connection.
5. **Drone-side failsafes** you must configure: Tello and Crazyflie land on link loss; ArduPilot/PX4
   need GCS/RC failsafe set; Betaflight needs RX-loss failsafe (the ESP32 bridge deliberately goes silent).

## Checklist before the first real flight

- [ ] `pytest -q` passes, `flydrones demo` behaves in the simulator
- [ ] same config file flown in `--drone sim` first
- [ ] dry run on the real drone shows sensible commands for each gesture
- [ ] props off (FPV / ArduPilot): motors respond in the right direction
- [ ] prop guards on, battery charged, 3 × 3 m clear space, nobody in front
- [ ] vendor app / RC transmitter / second laptop ready to land or disarm
- [ ] start with `safety.max_throttle: 0.3` and `--seconds 30`

## Do not

- fly over people, animals, roads, or outdoors where regulations forbid it
- fly FPV quads with this code without a physical kill switch
- present a simulated result as a real flight (label your videos)
