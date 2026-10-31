"""Starting configurations. Each function returns an engine.System (G = 1)."""
import numpy as np

from engine import System


def radius_for_mass(m, size=0.1):
    """Equal-density bodies: radius grows as the cube root of mass."""
    return size * np.cbrt(m)


def _system(masses, positions, velocities, size, G=1.0):
    """Build a System in the centre-of-mass frame (COM at rest at the origin),
    padding 2D vectors with z = 0."""
    m = np.asarray(masses, dtype=float)
    pos = np.zeros((len(m), 3))
    vel = np.zeros((len(m), 3))
    pos[:, :np.shape(positions)[1]] = positions
    vel[:, :np.shape(velocities)[1]] = velocities
    pos -= (m[:, None] * pos).sum(axis=0) / m.sum()
    vel -= (m[:, None] * vel).sum(axis=0) / m.sum()
    return System(m, pos, vel, radii=radius_for_mass(m, size), G=G)


def two_body(m1, m2, separation, speed_factor=1.0, size=0.1, G=1.0):
    """Two bodies orbiting their common centre of mass.

    speed_factor = 1        -> circular orbit
    0 < speed_factor < 1    -> ellipse (collides if the closest approach is too close)
    speed_factor = 0        -> falls straight in and collides
    speed_factor >= sqrt(2) -> escape (bodies fly apart)
    size: radius of a mass-1 body; 0 makes them point masses.
    """
    v_rel = speed_factor * np.sqrt(G * (m1 + m2) / separation)
    return _system([m1, m2], [[0, 0], [separation, 0]], [[0, 0], [0, v_rel]], size, G)


FIGURE8_PERIOD = 6.32591398


def figure8(size=0.02):
    """Chenciner-Montgomery figure-8: three equal masses chase each other
    around one figure-8 curve. Returns to its start every FIGURE8_PERIOD."""
    x1 = [0.97000436, -0.24308753]
    v3 = [-0.93240737, -0.86473146]
    v1 = [-v3[0] / 2, -v3[1] / 2]
    return _system([1, 1, 1], [x1, [-x1[0], -x1[1]], [0, 0]], [v1, v1, v3], size)


def lagrange_triangle(masses=(1, 1, 1), side=1.0, kick=0.0, size=0.02, G=1.0):
    """Lagrange's solution: bodies at the corners of an equilateral triangle,
    which rotates rigidly. Works for ANY masses, but is only stable if one
    mass dominates (ratio > ~25:1) -- equal masses break up eventually.
    kick: fractional nudge to body 3's speed, to test stability."""
    pos = np.array([[0, 0], [side, 0], [side / 2, side * np.sqrt(3) / 2]])
    m = np.asarray(masses, dtype=float)
    pos -= (m[:, None] * pos).sum(axis=0) / m.sum()
    omega = np.sqrt(G * m.sum() / side ** 3)
    vel = omega * np.stack([-pos[:, 1], pos[:, 0]], axis=1)  # rigid rotation
    vel[2] *= 1 + kick
    return _system(m, pos, vel, size, G)


def lagrange_period(masses=(1, 1, 1), side=1.0, G=1.0):
    return 2 * np.pi / np.sqrt(G * sum(masses) / side ** 3)


def sun_jupiter_trojan(kick=0.01):
    """Lagrange triangle with masses 1000 : 1 : ~0 -- a Trojan asteroid
    sitting 60 degrees ahead of Jupiter. Stable even when nudged."""
    return lagrange_triangle((1000, 1, 1e-6), side=10, kick=kick, size=0.05)


def euler_line(m=1.0, d=1.0, kick=0.0, size=0.02, G=1.0):
    """Euler's collinear solution: equal masses in a line, the middle one
    fixed, the outer two rotating around it like a rigid stick. Unstable.
    kick: fractional nudge to body 3's speed, to test stability."""
    omega = np.sqrt(5 * G * m / (4 * d ** 3))  # pull of both others on an outer body
    return _system([m, m, m], [[-d, 0], [0, 0], [d, 0]],
                   [[0, -omega * d], [0, 0], [0, omega * d * (1 + kick)]], size, G)


def euler_period(m=1.0, d=1.0, G=1.0):
    return 2 * np.pi / np.sqrt(5 * G * m / (4 * d ** 3))


def sun_earth_moon():
    """A star (1000), a planet (1) on a circular orbit at distance 10, and a
    moon (0.01) circling the planet at distance 0.3."""
    a, r_moon = 10.0, 0.3
    v_planet = np.sqrt(1000 / a)
    v_moon = np.sqrt(1 / r_moon)
    return _system([1000, 1, 0.01],
                   [[0, 0], [a, 0], [a + r_moon, 0]],
                   [[0, 0], [0, v_planet], [0, v_planet + v_moon]], size=0.03)


def pythagorean():
    """Burrau's problem: masses 3, 4, 5 released from rest at the corners of
    a 3-4-5 right triangle (each opposite the side of its own length).
    Chaotic; known outcome (Szebehely & Peters 1967): the lightest body is
    flung out and the 4 and 5 leave as a tight binary. Point masses."""
    return _system([3, 4, 5], [[1, 3], [-2, -1], [1, -1]], np.zeros((3, 2)), size=0)


# Presets for visualize.py. make: builds the System; t: run time;
# samples: recorded frames; eta: accuracy (chaotic runs need smaller).
SCENARIOS = {
    "two-body": dict(make=lambda: two_body(10, 1, 10), t=100, samples=2000, eta=0.01,
                     about="circular two-body orbit"),
    "figure8": dict(make=figure8, t=3 * FIGURE8_PERIOD, samples=2000, eta=0.01,
                    about="equal masses chasing each other on a figure-8 (period 6.326)"),
    # Unstable: rounding errors alone grow ~85x per orbit and break it after
    # ~7 orbits, so run 4 (still perfect to ~1e-8). Use --nudge to break it.
    "lagrange": dict(make=lagrange_triangle, t=4 * lagrange_period(),
                     samples=2000, eta=0.01,
                     about="rotating equilateral triangle, equal masses (try --nudge 1e-6)"),
    "trojan": dict(make=sun_jupiter_trojan, t=25 * lagrange_period((1000, 1, 0), 10),
                   samples=4000, eta=0.01,
                   about="Sun-Jupiter-Trojan at 60 deg: nudged 1%, swings around L4 but stays"),
    "euler": dict(make=euler_line, t=8 * euler_period(), samples=3000, eta=0.01,
                  about="three masses in a rotating line (try --nudge 1e-6)"),
    "sun-earth-moon": dict(make=sun_earth_moon, t=2 * 2 * np.pi * np.sqrt(1000 / 1001),
                           samples=6000, eta=0.01,
                           about="star, planet, and a moon around the planet (2 years)"),
    "pythagorean": dict(make=pythagorean, t=70, samples=4000, eta=0.003,
                        about="masses 3,4,5 released from rest: chaos, then the 3 is ejected"),
}
