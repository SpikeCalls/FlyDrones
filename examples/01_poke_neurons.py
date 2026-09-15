"""Stimulate any cell type and watch the flight descending neurons respond.

    python examples/01_poke_neurons.py                         # MiniFly
    python examples/01_poke_neurons.py data/malecns_brain.npz  # real connectome
"""

import sys

from flydrones.brain import Brain, GroupSpec, load_connectome
from flydrones.config import load_config

source = sys.argv[1] if len(sys.argv) > 1 else "minifly"
cfg = load_config(overrides={"brain": {"source": source}})
brain = Brain(load_connectome(source), cfg)
c = brain.connectome
print(c.summary())

# add any group you like by cell-type regex
c.resolve_groups({"my_LPLC2_both": GroupSpec("my_LPLC2_both", ["^LPLC2$"])})

brain.tick({}, 500)
for group, hz in [("T4c_L", 100), ("T4c_R", 100), ("my_LPLC2_both", 150), ("HAL_R", 80)]:
    rates = brain.stimulate(group, hz, 500)
    dns = "  ".join(f"{k}={rates[k]:5.1f}" for k in brain.output_specs)
    print(f"{group:15s} @ {hz:3d} Hz -> {dns}")
    brain.tick({}, 300)
