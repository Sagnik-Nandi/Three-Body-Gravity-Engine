"""Export reference runs from the Python engine for the JS cross-check.

Run from the project root:  python web/test/make_reference.py
Writes web/test/reference.json, read by crosscheck.test.js. Each case name
must match a factory in CASES of crosscheck.test.js.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, ROOT)

import numpy as np  # noqa: E402

from scenarios import (FIGURE8_PERIOD, euler_line, euler_period, figure8,  # noqa: E402
                       lagrange_period, lagrange_triangle, pythagorean,
                       sun_earth_moon, sun_jupiter_trojan, two_body)

# name -> (factory, t_end, samples, eta)
CASES = {
    "two-body circular": (lambda: two_body(10, 1, 10), 100, 20, 0.01),
    "two-body ellipse": (lambda: two_body(10, 1, 10, 0.7), 100, 20, 0.01),
    "two-body eccentric point masses": (lambda: two_body(10, 1, 10, 0.15, size=0), 50, 20, 0.01),
    "two-body head-on": (lambda: two_body(10, 1, 10, 0), 20, 20, 0.01),
    "figure8": (figure8, 3 * FIGURE8_PERIOD, 20, 0.01),
    "lagrange": (lagrange_triangle, 4 * lagrange_period(), 20, 0.01),
    "lagrange nudged": (lambda: lagrange_triangle(kick=1e-6), 4 * lagrange_period(), 20, 0.01),
    "trojan": (sun_jupiter_trojan, 5 * lagrange_period((1000, 1, 0), 10), 20, 0.01),
    "euler": (euler_line, 4 * euler_period(), 20, 0.01),
    "sun-earth-moon": (sun_earth_moon, 4 * np.pi * np.sqrt(1000 / 1001), 20, 0.01),
    # Chaotic: only compare the early part, before rounding differences
    # between the two languages have had time to grow.
    "pythagorean (t<10)": (pythagorean, 10, 20, 0.003),
}


def main():
    out = {}
    for name, (make, t_end, samples, eta) in CASES.items():
        sim = make()
        times, traj, energies = sim.run(t_end, samples, eta)
        out[name] = dict(t=t_end, samples=samples, eta=eta,
                         times=times.tolist(),
                         positions=[p.ravel().tolist() for p in traj],
                         energies=energies.tolist(),
                         collision=list(sim.collision) if sim.collision else None)
        print(f"{name:35s} {len(times):3d} samples, collision={sim.collision}")
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference.json")
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
