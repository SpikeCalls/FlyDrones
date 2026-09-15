# Contributing

Thanks for helping the fly fly.

## Setup

```bash
pip install -e ".[dev,vision]"
ruff check .
pytest -q
flydrones demo --seconds 5
```

## Most wanted

- **Real flight logs.** Fly a Tello / Crazyflie / SITL vehicle with `--log flight.csv`, open an issue with the
  log, the config you used and a short video.
- **Better MaleCNS group definitions** (cell-type regexes for halteres, ocelli, more flight DNs), backed by a
  paper or neuPrint query.
- **Retinotopy** from optic-lobe hex coordinates.
- **GPU backend** (PyTorch sparse / CUDA) with the same `LIFNetwork` API.
- **New drone backends**: ROS 2, DJI Mobile SDK, PX4 via MAVSDK, Parrot Olympe.

## Rules

- Keep the brain honest: engineering choices go in config with a comment, biology claims need a reference.
- Every hardware path must default to dry run and pass through `SafetyGovernor`.
- Add or update tests. CI runs ruff and pytest.
- Be kind in issues and reviews.
