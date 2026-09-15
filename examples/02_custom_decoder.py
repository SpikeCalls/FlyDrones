"""Write your own read-out: here, forward speed from the left/right DNg02 sum,
braked by the giant fiber. Flies in the simulator."""

from flydrones.brain import Brain, load_connectome
from flydrones.config import load_config
from flydrones.drones import SimDrone
from flydrones.runtime import Pilot, run_sim

cfg = load_config(overrides={
    "decoder": {
        "axes": {
            "forward": {"gain": 0.01, "terms": {"DNg02_L": 0.5, "DNg02_R": 0.5}},
            "throttle": {"gain": 0.0, "terms": {}},
        },
        "cruise": 0.25,
    }
})
brain = Brain(load_connectome("minifly"), cfg)
pilot = Pilot(brain, SimDrone(start=(-2.0, 0.0, 0.0)), cfg)
run_sim([pilot], 12)
h = pilot.history[-1]
print(f"after 12 s: x={h['x']:.2f} y={h['y']:.2f} alt={h['alt']:.2f}, collisions={pilot.drone.collisions}")
