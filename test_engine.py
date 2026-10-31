"""Sanity checks for engine.py and scenarios.py. Run: python test_engine.py"""
import time

import numpy as np

from scenarios import (FIGURE8_PERIOD, euler_line, euler_period, figure8,
                       lagrange_period, lagrange_triangle, pythagorean,
                       sun_earth_moon, sun_jupiter_trojan, two_body)


def max_rel_energy_error(energies):
    return np.abs((energies - energies[0]) / energies[0]).max()


def dist(traj, i, j):
    return np.linalg.norm(traj[:, i] - traj[:, j], axis=1)


def periapsis_angle(sim):
    """Direction of closest approach (Laplace-Runge-Lenz vector), in degrees."""
    r = sim.positions[1] - sim.positions[0]
    v = sim.velocities[1] - sim.velocities[0]
    e = np.cross(v, np.cross(r, v)) / (sim.G * sim.masses.sum()) - r / np.linalg.norm(r)
    return np.degrees(np.arctan2(e[1], e[0]))


# ---- two bodies ---------------------------------------------------------

def test_circular_orbit_keeps_radius():
    sim = two_body(10, 1, separation=10)
    _, traj, _ = sim.run(t_end=100)
    assert np.allclose(dist(traj, 0, 1), 10, rtol=1e-6)


def test_energy_and_momentum_conserved():
    sim = two_body(10, 1, separation=10, speed_factor=0.7)  # ellipse
    p0, L0 = sim.momentum(), sim.angular_momentum()
    _, _, energies = sim.run(t_end=100)
    assert max_rel_energy_error(energies) < 1e-7
    assert np.allclose(sim.momentum(), p0, atol=1e-10)
    assert np.allclose(sim.angular_momentum(), L0, rtol=1e-10)


def test_eccentric_orbit_does_not_precess():
    # Very close passes: fixed-step Verlet lost ~100% of the energy here.
    # Point masses (size=0), otherwise the bodies would touch at closest approach.
    sim = two_body(10, 1, separation=10, speed_factor=0.15, size=0)
    a0 = periapsis_angle(sim)
    _, _, energies = sim.run(t_end=200)
    assert max_rel_energy_error(energies) < 1e-5
    assert abs((periapsis_angle(sim) - a0 + 180) % 360 - 180) < 1e-4


def test_tilted_orbit_stays_in_its_plane():
    # Rotate an elliptical orbit 30 degrees out of the x-y plane: real 3D motion.
    sim = two_body(10, 1, separation=10, speed_factor=0.7)
    c, s = np.cos(np.radians(30)), np.sin(np.radians(30))
    tilt = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    sim.positions = sim.positions @ tilt.T
    sim.velocities = sim.velocities @ tilt.T
    normal = sim.angular_momentum() / np.linalg.norm(sim.angular_momentum())
    _, traj, _ = sim.run(t_end=100)
    assert np.abs(traj[:, :, 2]).max() > 1  # it really moves in z
    assert np.abs(traj @ normal).max() < 1e-10  # but never leaves its plane


def test_head_on_fall_collides():
    # Free-fall time for two masses released at rest: pi/2 * sqrt(r^3 / 2GM).
    sim = two_body(10, 1, separation=10, speed_factor=0)
    times, traj, _ = sim.run(t_end=100)
    assert sim.collision == (0, 1)
    gap = dist(traj, 0, 1)[-1] - sim.radii.sum()
    assert -0.01 * sim.radii.sum() < gap <= 0  # stopped within one small step of contact
    assert times[-1] < np.pi / 2 * np.sqrt(1000 / 22)


def test_point_masses_collide_without_nan():
    sim = two_body(10, 1, separation=10, speed_factor=0, size=0)
    times, traj, energies = sim.run(t_end=100)
    assert sim.collision == (0, 1)
    assert np.isfinite(traj).all()
    assert abs(times[-1] - np.pi / 2 * np.sqrt(1000 / 22)) < 1e-3
    # Accurate all the way in; only the impact sample itself sits at the singularity.
    assert max_rel_energy_error(energies[:-1]) < 1e-6


def test_escape_speed_unbinds():
    sim = two_body(10, 1, separation=10, speed_factor=1.5)
    assert sim.energy() > 0
    _, traj, _ = sim.run(t_end=100)
    assert dist(traj, 0, 1)[-1] > 50


# ---- three bodies -------------------------------------------------------

def test_figure8_returns_to_start():
    sim = figure8()
    p0, v0 = sim.positions.copy(), sim.velocities.copy()
    _, traj, energies = sim.run(t_end=FIGURE8_PERIOD, n_samples=200)
    assert np.abs(sim.positions - p0).max() < 1e-6
    assert np.abs(sim.velocities - v0).max() < 1e-6
    assert dist(traj, 0, 1).min() > 0.3  # no near-collisions along the way
    assert max_rel_energy_error(energies) < 1e-8


def test_lagrange_triangle_rotates_rigidly():
    sim = lagrange_triangle()
    _, traj, _ = sim.run(t_end=lagrange_period(), n_samples=200)
    for i, j in ((0, 1), (1, 2), (0, 2)):
        assert np.allclose(dist(traj, i, j), 1, atol=1e-6)


def test_equal_mass_lagrange_is_unstable():
    # Nudge one body by one part in a million: the triangle falls apart.
    sim = lagrange_triangle(kick=1e-6)
    _, traj, _ = sim.run(t_end=8 * lagrange_period(), n_samples=800)
    assert np.abs(dist(traj, 0, 1) - 1).max() > 0.1


def trojan_angle(traj):
    """How far ahead of Jupiter (body 1) the asteroid (body 2) is, seen from the Sun."""
    j, a = traj[:, 1] - traj[:, 0], traj[:, 2] - traj[:, 0]
    return np.degrees(np.arctan2(np.cross(j, a)[:, 2], (j * a).sum(axis=1)))


def test_trojan_is_stable():
    # Same Lagrange solution, but Sun:Jupiter = 1000:1 makes it stable.
    # A 1% nudge makes the asteroid swing around the 60-degree point, not escape.
    sim = sun_jupiter_trojan(kick=0.01)
    _, traj, _ = sim.run(t_end=50 * lagrange_period((1000, 1, 0), 10), n_samples=2000)
    angle = trojan_angle(traj)
    assert 30 < angle.min() and angle.max() < 95
    assert angle.max() - angle.min() > 20  # it does visibly swing


def test_euler_line_rotates_then_breaks():
    sim = euler_line()
    _, traj, _ = sim.run(t_end=euler_period(), n_samples=200)
    assert np.abs(traj[:, 1]).max() < 1e-10  # middle body stays put
    assert np.allclose(dist(traj, 0, 2), 2, atol=1e-6)  # stick keeps its length

    sim = euler_line(kick=1e-6)
    _, traj, _ = sim.run(t_end=4 * euler_period(), n_samples=400)
    assert np.abs(traj[:, 1]).max() > 0.1


def test_moon_stays_with_planet():
    sim = sun_earth_moon()
    _, traj, energies = sim.run(t_end=4 * np.pi * np.sqrt(1000 / 1001), n_samples=2000)
    moon = dist(traj, 1, 2)
    assert 0.2 < moon.min() and moon.max() < 0.4  # orbits the planet at ~0.3
    assert np.allclose(dist(traj, 0, 1), 10, rtol=0.01)  # planet stays on its orbit
    assert max_rel_energy_error(energies) < 1e-8


def test_pythagorean_ejects_lightest_body():
    sim = pythagorean()
    _, traj, energies = sim.run(t_end=70, n_samples=700, eta=0.003)
    assert sim.collision is None  # close passes (~4e-4) are near-misses, not hits
    assert np.linalg.norm(traj[-1, 0]) > 10  # mass 3 flung out
    assert dist(traj, 1, 2)[-1] < 3  # masses 4 and 5 left as a binary
    assert np.dot(sim.velocities[0], sim.positions[0]) > 0  # and still moving away
    assert max_rel_energy_error(energies) < 1e-6


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            t0 = time.perf_counter()
            fn()
            print(f"PASS {name} ({time.perf_counter() - t0:.1f}s)")
