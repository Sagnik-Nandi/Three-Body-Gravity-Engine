# Three Body

A gravity simulation engine, built up step by step toward an interactive
three-body simulator with a web interface (adjustable masses, velocities, etc.).

## Status

- [x] N-body engine (3D Newtonian gravity, Yoshida 4th-order integrator, adaptive time step)
- [x] Two-body orbits with animated visualization and energy check
- [x] Collisions: bodies have a size; the run stops when two touch
- [x] Three bodies: figure-8, Lagrange, Euler, Trojan, Sun-Earth-Moon, Pythagorean
- [x] Port engine to JavaScript, checked against the Python engine
- [x] 3D web view (Three.js), live simulation, camera controls
- [ ] Web interface with sliders

## Files

| File | Purpose |
|---|---|
| `engine.py` | Pure physics: the `System` class (works in 3D). No plotting. |
| `scenarios.py` | Starting setups (`two_body`, `figure8`, `pythagorean`, ...) and the presets list. |
| `visualize.py` | Runs a preset and animates it (top view, x-y plane) with matplotlib, plus the energy error. |
| `test_engine.py` | Checks each scenario against its known behaviour (see below). |
| `web/index.html`, `web/main.js` | The 3D page: runs the JS engine live and draws it with Three.js. |
| `web/serve.js` | Tiny local web server for the page (`npm start`). |
| `web/engine.js`, `web/scenarios.js` | JavaScript port of the engine and scenarios, for the browser. |
| `web/test/` | JS physics tests, plus a cross-check against reference runs exported from Python. |
| `archive/` | Earlier attempts, kept for reference. |

## Requirements

Python 3.10+, `numpy`, `matplotlib`.

```
pip install numpy matplotlib
```

## Usage

```
python visualize.py --help                # list presets
python visualize.py figure8               # any three-body preset (see below)
python visualize.py                       # two-body circular orbit (animated)
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

### Three-body presets

| Preset | What you should see | What the test checks |
|---|---|---|
| `figure8` | Three equal masses chasing each other along one figure-8 | Returns to its start after one period (6.326) within 1e-6 |
| `lagrange` | Rigidly rotating equilateral triangle, perfect for 4 orbits. Add `--nudge 1e-6` to watch it fall apart | Stays equilateral for a period; a 1e-6 nudge breaks it |
| `euler` | Three masses in a rotating line, perfect. Add `--nudge 1e-6` to watch it fall apart | Middle body stays still, line keeps length; a 1e-6 nudge breaks it |
| `trojan` | Asteroid 60° ahead of Jupiter, staying there | Same Lagrange triangle with masses 1000:1:0 is *stable*: a 1% nudge swings it 39°–88° but it never leaves |
| `sun-earth-moon` | A moon wobbling around a planet's orbit | Moon stays ~0.3 from the planet for 2 years |
| `pythagorean` | Masses 3, 4, 5 dropped from rest: chaos, then the 3 is thrown out | Matches the known outcome (Szebehely & Peters 1967): 3 ejected, 4+5 leave as a binary |

`lagrange` and `euler` are exact but *unstable* solutions, like a pencil
balanced on its tip: any imperfection grows instead of being corrected. Even
floating-point rounding (~1e-16) grows ~85x per orbit in the Lagrange triangle
and breaks it after ~7 orbits, which is why its preset runs only 4 (still
perfect to ~1e-8). The Euler line's symmetry survives rounding exactly, so it
stays perfect indefinitely until nudged.

### Chaos: `--nudge`

```
python visualize.py pythagorean --nudge 1e-9   # chaotic: the gap grows ~10x every 6-7 time units
python visualize.py figure8 --nudge 1e-9       # stable: the gap stays ~1e-8
```

Runs a second copy with body 1 moved by the given distance, drawn dashed and
hollow, and plots the distance between the two runs on a log scale. The
simulation is deterministic (identical inputs give bit-identical results);
chaos means tiny differences in the input grow exponentially.

The Pythagorean problem is chaotic: with `--eta 0.01` the run is accurate
early on but diverges later and gives a different outcome. Its preset uses
`eta = 0.003`, where the result has converged (the same at 0.001).

Run the tests:

```
python test_engine.py
```

## 3D web view

Requires [Node.js](https://nodejs.org). In a terminal (PowerShell is fine):

```
cd web
npm start
```

then open **http://localhost:8000** in your browser. Stop the server with Ctrl+C.
(Opening `index.html` directly as a file does not work: browsers only load
JavaScript modules over http.) Three.js is loaded from a CDN, so the first
load needs an internet connection.

- **Preset** menu; **Play/Pause** (or the space bar); **Reset**.
- **Speed**: 0.1x to 10x. At 1x a preset's suggested run lasts ~15 s, then it keeps going.
- **Trail length**: how much history each body leaves behind (fades with age).
- **Camera**: drag to rotate, scroll to zoom, right-drag to pan; or Tilted/Top/Side buttons.
- **True body sizes**: off by default, so tiny bodies (a Trojan asteroid, a moon,
  point masses) are drawn enlarged; every body also has a dot that stays visible at any zoom.
- Readout: simulation time and the energy error. A collision pauses the run
  and marks the impact.
- Links: `http://localhost:8000/?preset=pythagorean&speed=4` opens a preset at a speed.

The physics' orbital plane (x-y) is drawn as the floor grid; z is up.

## JavaScript engine (`web/`)

The browser version needs the physics in JavaScript, so `web/engine.js` is a
line-by-line port of `engine.py` (same Yoshida integrator, adaptive step and
collision rules), and `web/scenarios.js` of `scenarios.py`. It also has
`advanceTo(t)`, which a live animation calls once per screen frame.

Requires [Node.js](https://nodejs.org) (for running the tests only; the page
itself will run in any browser). No packages to install.

```
cd web
npm test                              # 26 tests, ~1 s
```

Two kinds of tests:
- `test/engine.test.js`: the same physics checks as `test_engine.py`.
- `test/crosscheck.test.js`: runs every scenario and compares positions and
  energy with the Python engine's output in `test/reference.json`, to 1e-7.
  The chaotic Pythagorean case is compared only up to t = 10: the two languages
  round differently in the last digit, and chaos amplifies that (exactly equal
  until the first close pass at t ≈ 2, then ~10x per few time units).

After changing the Python physics, regenerate the reference:

```
python web/test/make_reference.py
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
  Point masses (size 0) can't touch, so the run stops only if the pair's
  timescale falls below 1e-8 of its starting value (~1/200,000 of the distance),
  meaning they are heading into a true singularity. Near-misses like the
  Pythagorean problem's (4e-4 apart) pass through untouched.
- `run()` lands exactly on evenly spaced sample times, so the animation plays
  at a uniform speed regardless of the step size.

## About the energy plot

The plot shows the *numerical* error
`(E - E0)/|E0|` from taking finite steps. Typical values: ~1e-14 (circular, i.e.
floating-point rounding), ~1e-7 for very eccentric orbits. Lower `--eta` to reduce it.
Real total energy is exactly constant. 