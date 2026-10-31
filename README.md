# Three Body

A gravity simulation engine, built up step by step toward an interactive
three-body simulator with a web interface (adjustable masses, velocities, etc.).

## Status

- [x] N-body engine (2D Newtonian gravity, Yoshida 4th-order integrator, adaptive time step)
- [x] Two-body orbits with animated visualization and energy check
- [x] Collisions: bodies have a size; the run stops when two touch
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
python visualize.py --speed 0             # fall straight in and collide
python visualize.py --size 0              # point masses (no size)
python visualize.py --eta 0.003           # smaller eta = smaller steps = more accurate
python visualize.py --duration 5         # play the whole run in 5 seconds (default 10)
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

## Numerical method

- **Integrator: Yoshida 4th order.** A symplectic method (like velocity Verlet,
  but three sub-steps per step) so energy errors stay bounded instead of
  accumulating; error shrinks as `dt⁴`.
- **Adaptive time step:** `dt = eta × min over pairs of sqrt(r³ / G(mᵢ+mⱼ))`.
  Like driving: slow down on sharp bends, speed up on straight roads. When two
  bodies are far apart, gravity changes slowly and big steps are accurate. When
  they pass close, forces change violently and steps shrink automatically
  (≈1% of the remaining distance per step), so close encounters stay accurate.
- **Collisions:** each body has radius `size × mass^(1/3)` (equal density).
  When two surfaces touch, the run stops and the plot marks the impact.
  With `--size 0` (point masses) the run stops when the bodies are ~1/2000 of
  their starting distance apart, since the force is heading to infinity.
- `run()` lands exactly on evenly spaced sample times, so the animation plays
  at a uniform speed regardless of the step size.

## About the energy plot

The plot shows the *numerical* error
`(E - E0)/|E0|` from taking finite steps. Typical values: ~1e-14 (circular, i.e.
floating-point rounding), ~1e-7 for very eccentric orbits. Lower `--eta` to reduce it.
Real total energy is exactly constant. 