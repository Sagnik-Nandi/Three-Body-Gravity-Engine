"""Sanity checks for engine.py. Run: python test_engine.py"""
import numpy as np

from engine import two_body


def test_circular_orbit_keeps_radius():
    sim = two_body(10, 1, separation=10)
    _, traj = sim.run(t_end=100, dt=0.01)
    dist = np.linalg.norm(traj[:, 1] - traj[:, 0], axis=1)
    assert np.allclose(dist, 10, rtol=1e-3), (dist.min(), dist.max())


def test_energy_and_momentum_conserved():
    sim = two_body(10, 1, separation=10, speed_factor=0.7)  # ellipse
    e0, p0 = sim.energy(), sim.momentum()
    sim.run(t_end=100, dt=0.01)
    assert abs((sim.energy() - e0) / e0) < 1e-4
    assert np.allclose(sim.momentum(), p0, atol=1e-10)


def test_escape_speed_unbinds():
    sim = two_body(10, 1, separation=10, speed_factor=1.5)
    assert sim.energy() > 0
    _, traj = sim.run(t_end=100, dt=0.01)
    assert np.linalg.norm(traj[-1, 1] - traj[-1, 0]) > 50


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
