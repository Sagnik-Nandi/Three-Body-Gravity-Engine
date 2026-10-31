"""Sanity checks for engine.py. Run: python test_engine.py"""
import numpy as np

from engine import two_body


def periapsis_angle(sim):
    """Direction of closest approach (Laplace-Runge-Lenz vector), in degrees."""
    r = sim.positions[1] - sim.positions[0]
    v = sim.velocities[1] - sim.velocities[0]
    h = r[0] * v[1] - r[1] * v[0]
    e = np.array([v[1] * h, -v[0] * h]) / (sim.G * sim.masses.sum()) - r / np.linalg.norm(r)
    return np.degrees(np.arctan2(e[1], e[0]))


def test_circular_orbit_keeps_radius():
    sim = two_body(10, 1, separation=10)
    _, traj, _ = sim.run(t_end=100)
    dist = np.linalg.norm(traj[:, 1] - traj[:, 0], axis=1)
    assert np.allclose(dist, 10, rtol=1e-6), (dist.min(), dist.max())


def test_energy_and_momentum_conserved():
    sim = two_body(10, 1, separation=10, speed_factor=0.7)  # ellipse
    p0 = sim.momentum()
    _, _, energies = sim.run(t_end=100)
    assert np.abs((energies - energies[0]) / energies[0]).max() < 1e-7
    assert np.allclose(sim.momentum(), p0, atol=1e-10)


def test_eccentric_orbit_does_not_precess():
    # Very close passes: fixed-step Verlet lost ~100% of the energy here.
    sim = two_body(10, 1, separation=10, speed_factor=0.15)
    a0 = periapsis_angle(sim)
    _, _, energies = sim.run(t_end=200)
    assert np.abs((energies - energies[0]) / energies[0]).max() < 1e-5
    assert abs((periapsis_angle(sim) - a0 + 180) % 360 - 180) < 1e-4


def test_escape_speed_unbinds():
    sim = two_body(10, 1, separation=10, speed_factor=1.5)
    assert sim.energy() > 0
    _, traj, _ = sim.run(t_end=100)
    assert np.linalg.norm(traj[-1, 1] - traj[-1, 0]) > 50


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"PASS {name}")
