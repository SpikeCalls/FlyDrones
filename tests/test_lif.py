import numpy as np
from scipy import sparse

from flydrones.brain.lif import LIFNetwork, LIFParams


def chain(n=3, w=200.0):
    rows = np.arange(1, n)
    cols = np.arange(0, n - 1)
    return sparse.csc_matrix((np.full(n - 1, w, np.float32), (rows, cols)), shape=(n, n))


def test_silent_without_input():
    net = LIFNetwork(chain(), LIFParams(noise_mv=0))
    counts, _ = net.run(200)
    assert counts.sum() == 0


def test_poisson_input_drives_spikes_and_propagates():
    net = LIFNetwork(chain(3), LIFParams(noise_mv=0), seed=1)
    net.set_input(np.array([0]), 100.0)
    counts, _ = net.run(1000)
    assert 40 < counts[0] < 160
    assert counts[1] > 0.5 * counts[0]
    assert counts[2] > 0


def test_inhibition_suppresses():
    W = sparse.csc_matrix((np.array([-500.0], np.float32), (np.array([1]), np.array([0]))), shape=(2, 2))
    net = LIFNetwork(W, LIFParams(noise_mv=0), seed=2)
    net.set_bias(np.array([1]), 12.0)  # neuron 1 fires tonically
    c_alone, _ = net.run(1000)
    net.reset()
    net.set_input(np.array([0]), 150.0)
    c_inh, _ = net.run(1000)
    assert c_alone[1] > 20
    assert c_inh[1] < 0.5 * c_alone[1]


def test_refractory_caps_rate():
    p = LIFParams(noise_mv=0)
    net = LIFNetwork(sparse.csc_matrix((1, 1), dtype=np.float32), p)
    net.set_bias(np.array([0]), 200.0)
    counts, _ = net.run(1000)
    assert counts[0] <= 1000 / (p.t_ref) + 1


def test_copy_shares_wiring_not_state():
    net = LIFNetwork(chain(), LIFParams())
    net.set_input(np.array([0]), 100.0)
    net.run(100)
    clone = net.copy(seed=5)
    assert clone.W is net.W
    assert clone.t_ms == 0.0
    assert not np.shares_memory(clone.v, net.v)


def test_delay_is_respected():
    p = LIFParams(noise_mv=0, dt=0.5, delay=2.0)
    net = LIFNetwork(chain(2, w=400.0), p)
    net.inject(np.array([0]), 400.0)
    t_spike = {}
    for _ in range(40):
        spk = net.step()
        for s in spk:
            t_spike.setdefault(int(s), net.t_ms)
    assert 1 in t_spike and 0 in t_spike
    assert t_spike[1] - t_spike[0] >= p.delay
