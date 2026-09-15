# Roadmap

## 0.1 (this release)
- [x] Event-driven LIF simulator (Shiu et al. parameters), MaleCNS v1.0 builder, MiniFly
- [x] Numpy optic flow, looming, gesture illusions, haltere feedback
- [x] Sim, Tello, Crazyflie, MAVLink, ESP32/MSP backends, safety governor
- [x] Dashboard, GIF recorder, swarm mode, read-out calibration, CLI, tests

## 0.2
- [ ] First real Tello and Crazyflie flights, published with logs and unedited video
- [ ] MaleCNS group presets verified against neuPrint (haltere, ocelli, more flight DNs)
- [ ] Retinotopic mapping from optic-lobe column coordinates
- [ ] Record/replay: rerun a flight log through a different brain

## 0.3
- [ ] PyTorch / CUDA backend, full MaleCNS in real time on a laptop GPU
- [ ] Dopamine (PPL1) punishment on collisions, KC→MBON plasticity
- [ ] Drive early vision (L1-L3, Mi1, Tm3) from pixels instead of software optic flow

## Later
- [ ] ROS 2 node and Gazebo world
- [ ] Brain core onboard a Raspberry Pi 5 or Jetson carried by the drone
- [ ] Multi-drone swarm with inter-drone looming (each fly sees the others)
