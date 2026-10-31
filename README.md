# Three Body

A gravity simulation engine, built up step by step toward an interactive
three-body simulator with a web interface (adjustable masses, velocities, etc.).

## Status

- [x] N-body engine (2D Newtonian gravity, velocity Verlet integrator)
- [x] Two-body orbits with animated visualization and energy check
- [ ] Three bodies + figure-8 test case
- [ ] Web interface with sliders

## Files

| File | Purpose |
|---|---|
| `engine.py` | Pure physics: the `System` class and scenario helpers like `two_body`. No plotting. |
| `visualize.py` | Runs a scenario and animates it with matplotlib, plus a plot of the energy error. |
| `test_engine.py` | Sanity checks: circular orbit keeps its radius, energy/momentum conserved, escape works. |
| `archive/` | Earlier attempts, kept for reference. |

## Requirements

Python 3.10+, `numpy`, `matplotlib`.

```
pip install numpy matplotlib
```

## Usage

```
python visualize.py                       # circular orbit (animated)
python visualize.py --speed 0.7           # ellipse
python visualize.py --speed 1.5           # escape
python visualize.py --m1 5 --m2 5         # equal masses
python visualize.py --dt 0.001            # smaller time step = smaller energy error
python visualize.py --save orbit.png      # save a still image instead of animating
```

`--speed` is a multiple of circular-orbit speed: `1` circular, `<1` ellipse,
`>= sqrt(2) ≈ 1.414` the bodies escape each other.

Run the tests:

```
python test_engine.py
```

## Units

Simulation units with `G = 1`. Masses, distances and times are dimensionless;
only their ratios matter.

## About the energy plot

Real total energy is exactly constant. The plot shows the *numerical* error
`(E - E0)/|E0|` introduced by taking finite time steps. With velocity Verlet this
error oscillates (largest at closest approach, where forces change fastest) but
does not grow over time, and it shrinks as `dt²`: 10× smaller `dt` → 100× smaller error.
