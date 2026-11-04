# Three-Body Gravity Engine

A gravity simulation engine, built step by step toward an interactive
three-body simulator: an accurate N-body physics engine in Python, a
JavaScript port checked against it, and a live 3D web view where you can
watch classic three-body solutions, see chaos for yourself, crash planets
together and tear moons apart with tides.

**Try it online: https://sagnik-nandi.github.io/Three-Body-Gravity-Engine/**

## Quick start

### 3D web view

The live version above is published automatically from `web/` by
`.github/workflows/pages.yml` on every push to `main` (after the JS tests pass).
Each deploy stamps the commit ID into the script addresses, so browsers never
mix a new page with old cached scripts.
To run it locally instead, you need [Node.js](https://nodejs.org) (no packages to install):

```
cd web
npm start
```

Then open **http://localhost:8000** in your browser; stop the server with Ctrl+C.
Opening `index.html` directly as a file does not work (browsers only load
JavaScript modules over http). Three.js is loaded from a CDN, so the first
load needs an internet connection.

### Python version (matplotlib)

Requires Python 3.10+ with `numpy` and `matplotlib`.

```
pip install numpy matplotlib
cd python
python visualize.py figure8
```

## Project layout

| Path | Purpose |
|---|---|
| `python/engine.py` | Pure physics: the `System` class (3D, any number of bodies). No plotting. |
| `python/scenarios.py` | Starting setups (`two_body`, `figure8`, `pythagorean`, ...) and the presets list. |
| `python/visualize.py` | Runs a preset and animates it (top view, x-y plane) with matplotlib, plus the energy error. |
| `python/test_engine.py` | Checks each scenario against its known behaviour (see below). |
| `python/archive/` | Earlier attempts, kept for reference. |
| `web/index.html`, `web/main.js`, `web/tour.js` | The 3D page: runs the JS engine live and draws it with Three.js. |
| `web/engine.js`, `web/scenarios.js` | JavaScript port of the engine and scenarios, plus merging collisions and tides. |
| `web/particles.js` | Bodies made of particles: rubble piles with contact forces (web only). |
| `web/serve.js` | Tiny local web server for the page (`npm start`). |
| `web/test/` | JS physics tests, plus a cross-check against reference runs exported from Python. |

## Presets

| Preset | What you should see | What the test checks |
|---|---|---|
| `two-body` | A circular two-body orbit | Radius stays constant; energy, momentum and angular momentum conserved |
| `figure8` | Three equal masses chasing each other along one figure-8 | Returns to its start after one period (6.326) within 1e-6 |
| `lagrange` | Rigidly rotating equilateral triangle that eventually falls apart | Stays equilateral for a period; a 1e-6 nudge breaks it |
| `euler` | Three masses in a rotating line | Middle body stays still, line keeps length; a 1e-6 nudge breaks it |
| `trojan` | Asteroid 60° ahead of Jupiter, staying there | Same Lagrange triangle with masses 1000:1:0 is *stable*: a 1% nudge swings it 39°–88° but it never leaves |
| `sun-earth-moon` | A moon wobbling around a planet's orbit | Moon stays ~0.3 from the planet for 2 years |
| `pythagorean` | Masses 3, 4, 5 dropped from rest: chaos, then the 3 is thrown out | Matches the known outcome (Szebehely & Peters 1967): 3 ejected, 4+5 leave as a binary |

The web view adds more (see [Impacts and tides](#impacts-and-tides)):

| Preset | What you should see | What the test checks |
|---|---|---|
| `butterfly`, `twins` | `lagrange` as a cloud of nudged copies; `pythagorean` in split screen | Same as those presets |
| `head-on` | Two planets meet head-on and merge; the survivor swings around the star | One merge; momentum and energy budget balance |
| `tides` | Tide arrows on a moon, surging at each close pass | Arrows use the tidal tensor, checked against the real difference in gravity |
| `moon-holds` | 1,000 rocks stay a moon, outside the Roche limit | Keeps its shape over 3 orbits |
| `moon-torn` | The same moon closer in: stretched into a spiral | Comes apart between the rigid and fluid limits |
| `debris` | A shredded moon spreads into a flat, wide disk | Conserves momentum and angular momentum to ~1e-15 |
| `comet` | One close pass pulls a comet into a string, and some of it hits the planet | Intact if the pass is distant, torn if close |

`lagrange` and `euler` are exact but *unstable* solutions, like a pencil
balanced on its tip: any imperfection grows instead of being corrected. Even
floating-point rounding (~1e-16) grows ~85x per orbit in the Lagrange triangle
and breaks it after ~7 orbits (the Python preset runs only 4, still perfect to
~1e-8; the web view keeps going, so you can watch it break). The Euler line's
symmetry survives rounding exactly, so it stays perfect indefinitely until nudged.

## 3D web view

- **Presets** are always on show, in three groups: Orbits, Chaos, and Impacts & tides.
  The plain address opens with all of them and a line about each; click one to run it.
  **Quick tour** (also under **?**) walks through the groups in five short steps, loading a
  preset for each. Shared links with options skip the welcome screen.
- **Play/pause** (or the space bar), **restart**, and **speed** from 0.1x to 10x. At 1x a preset's
  suggested run lasts ~15 s, then it keeps going. Particle presets run as fast as your
  machine allows, so high speeds may not go any faster.
- **✕** (or the H key) hides the controls so the view fills the window; **☰** brings them back.
  While shown, the view (and split screen) uses the space beside them.
- **Tide arrows**: how the tide pushes each spot around a body, relative to its centre.
- **More** folds away the trail length, the Tilted/Top/Side camera views and the list of masses.
- **Camera**: drag to rotate, scroll to zoom, right-drag to pan. The orbital plane (x-y) is
  drawn as the floor grid; z is up.
- Bodies are drawn at their true size. Each also has a dot that keeps the same size on
  screen, so tiny ones (a Trojan asteroid, a moon, point masses) stay visible at any zoom.
- **Version**: the bottom of the panel shows which build you are running (the commit
  ID on the live site, "local" when served with `npm start`).
- **Chaos comparison** (see [Chaos](#chaos)):
  - *Twin*: a copy with body 1 moved by the nudge, drawn as see-through ghosts with dashed trails.
  - *Split screen*: original on the left, nudged copy on the right, one shared camera.
  - *Cloud*: 30 copies, every body nudged in a random direction. Stable orbits stay a
    tight bundle; chaotic ones spray apart.
  - *Nudge size* from 1e-12 to 1e-1, a log-scale chart of the gap between original
    and copies, and the time they become visibly apart (gap > 1% of the system's size).
    Changing the comparison or the nudge restarts the run. Particle presets have no comparison: too heavy.
- Readout: simulation time, the energy error, and once there are collisions, the heat they made.

Link options, e.g. `http://localhost:8000/?preset=lagrange&chaos=cloud&nudge=1e-9`:

| Option | Effect |
|---|---|
| `preset=pythagorean` | Which preset to open |
| `speed=4` | Playback speed |
| `chaos=off\|twin\|split\|cloud`, `nudge=1e-6` | Chaos comparison |
| `tides=0\|1` | Tide arrows off or on |
| `start=10` | Fast-forward to simulation time 10 (same steps as live play) |
| `paused=1` | Start paused |
| `panel=0` | Start with the controls hidden |
| `intro=1` | Open the welcome screen |
| `tour=1` | Start the tour |

## Python version

Run these from the `python` folder:

```
python visualize.py --help                # list presets and options
python visualize.py figure8               # any preset from the table above
python visualize.py                       # two-body circular orbit (animated)
python visualize.py --speed 0.7           # two-body: ellipse
python visualize.py --speed 1.5           # two-body: escape
python visualize.py --m1 5 --m2 5         # two-body: equal masses
python visualize.py --speed 0             # two-body: fall straight in and collide
python visualize.py --size 0              # two-body: point masses (no size)
python visualize.py --eta 0.003           # smaller eta = smaller steps = more accurate
python visualize.py --duration 5          # play the whole run in 5 seconds (default 10)
python visualize.py --save orbit.png      # save a still image instead of animating
```

`--speed` is a multiple of circular-orbit speed: `1` circular, `<1` ellipse,
`>= sqrt(2) ≈ 1.414` the bodies escape each other.

The right-hand plot shows the *numerical* energy error `(E - E0)/|E0|` from
taking finite steps. Typical values: ~1e-14 (circular, i.e. floating-point
rounding), ~1e-7 for very eccentric orbits. Lower `--eta` to reduce it.
Real total energy is exactly constant.

## Chaos

```
python visualize.py pythagorean --nudge 1e-9   # chaotic: the gap grows ~10x every 6-7 time units
python visualize.py figure8 --nudge 1e-9       # stable: the gap stays ~1e-8
```

`--nudge` (and the web view's chaos comparison) runs a second copy with body 1
moved by the given distance, and plots the distance between the two runs on a
log scale. The simulation is deterministic (identical inputs give bit-identical
results); chaos means tiny differences in the input grow exponentially, so the
long-term future is unpredictable in practice.

The Pythagorean problem is chaotic: with `--eta 0.01` the run is accurate
early on but diverges later and gives a different outcome. Its preset uses
`eta = 0.003`, where the result has converged (the same at 0.001).

## Impacts and tides

Web view only; the Python engine still stops a run at a collision.

**Merges.** In the web view, a collision no longer ends the run: the two bodies
become one, conserving mass, momentum and volume. Their relative kinetic energy
becomes **heat**, and the orbital energy that disappears is kept in a running total,
so "energy error" still measures only numerical error, not real energy lost in the crash.

**Tides** come from gravity pulling harder on a body's near side than its far side:
a mass M at distance r stretches a body by 2GM/r³ along the line between them and
squeezes it by GM/r³ across. The arrows show the exact direction, with their length
compressed (cube root of the strength), since the true range is too wide to draw.

**Bodies made of particles** (`web/particles.js`). A moon of ~1,000 rocks held
together only by its own gravity, each rock a sphere that can push on its neighbours
but not pull. A point can't feel a tide, but a pile can: the outer rocks feel the
planet's gravity differently from the inner ones, so **tides need no code of their own**.
The Roche limit emerges by itself: our moon holds at distance 8.5 and breaks at 8,
which is 2.1 radii of an equal-density planet, between the theoretical limits for a
rigid moon (1.26) and a fluid one (2.44). Rocks that touch a planet are absorbed by it.

This is a different method from the rest of the engine, because many bodies need it:

- **Softened gravity** between rocks, since each stands for a chunk of material.
- **A fixed step.** The adaptive step shrinks for everyone when any one pair is close, and
  stalls with this many bodies (500 unsoftened particles reached only t = 0.37 in 40 s).
- **Leapfrog**: one gravity calculation per step instead of Yoshida's three.
- **Two speeds**: contacts and the planet's gravity are cheap and fast-changing, so they get
  8 substeps for each N² calculation of gravity between rocks.
- **Contacts** are a spring and a dashpot along the line between two rocks, so momentum and
  angular momentum stay exact (~1e-15). The dashpot's energy becomes heat. It ignores
  relative motion too small to be real (what one gravity kick leaves behind), or a pile at
  rest would endlessly count that as heat.

Expect an energy error around 1e-4 for a moon that holds, and up to ~5e-3 for a violent
breakup with many impacts. The results are **qualitatively right but not predictive**:
1,000 rocks are coarse, there is no friction or material strength, and impacts don't melt
or vaporise anything. Exact fragments would differ with a different number of rocks.

The debris disk is flat but wide rather than a thin ring. Sharpening it into a ring would
take far more collisions than 1,000 rocks make in a few orbits.

## Tests

```
cd python
python test_engine.py                 # Python physics tests (~30 s)

cd web
npm test                              # 51 JS tests, ~15 s
```

The JS tests are of two kinds:
- `test/engine.test.js`: the same physics checks as `test_engine.py`.
- `test/collisions.test.js`, `test/particles.test.js`: merges, tides, contacts, the Roche limit.
- `test/crosscheck.test.js`: runs every scenario and compares positions and
  energy with the Python engine's output in `test/reference.json`, to 1e-7.
  The chaotic Pythagorean case is compared only up to t = 10: the two languages
  round differently in the last digit, and chaos amplifies that (exactly equal
  until the first close pass at t ≈ 2, then ~10x per few time units).

After changing the Python physics, regenerate the reference (from the project root):

```
python web/test/make_reference.py
```

## Numerical method

- **Units:** `G = 1`. Masses, distances and times are dimensionless; only their ratios matter.
- **Integrator: Yoshida 4th order.** A symplectic method (like velocity Verlet,
  but three sub-steps per step) so energy errors stay bounded instead of
  accumulating; error shrinks as `dt⁴`.
- **Adaptive time step:** `dt = eta × min over pairs of sqrt(r³ / G(mᵢ+mⱼ))`.
  Like driving: slow down on sharp bends, speed up on straight roads. When two
  bodies are far apart, gravity changes slowly and big steps are accurate. When
  they pass close, forces change violently and steps shrink automatically
  (≈1% of the remaining distance per step), so close encounters stay accurate.
- **Collisions:** each body has radius `size × mass^(1/3)` (equal density).
  When two surfaces touch, the run stops and the impact is marked.
  Point masses (size 0) can't touch, so the run stops only if the pair's
  timescale falls below 1e-8 of its starting value (~1/200,000 of the distance),
  meaning they are heading into a true singularity. Near-misses like the
  Pythagorean problem's (4e-4 apart) pass through untouched.
- `run()` lands exactly on evenly spaced sample times, so animations play at a
  uniform speed regardless of the step size; the web view calls `advanceTo(t)`
  once per screen frame instead.

## Roadmap

- [x] N-body engine (3D, Yoshida 4th order, adaptive time step) with tests
- [x] 2D animation (matplotlib) with a live energy-error plot, to test the physics visually
- [x] Collisions
- [x] Classic three-body solutions: figure-8, Lagrange, Euler, Trojan, Sun-Earth-Moon, Pythagorean
- [x] JavaScript port, cross-checked against Python
- [x] 3D web view with live simulation and camera controls
- [x] Chaos comparison: twin, split screen, cloud of nudged copies
- [x] Welcome page with presets up front, and a short guided tour
- [x] Merging collisions and tide arrows
- [x] Bodies made of particles: Roche breakup, comet, debris disk
- [ ] Particle impacts on the GPU (~10,000 particles)
- [ ] Stability sliders and 4-body presets
- [ ] Drag-to-launch: place bodies and set their velocity with the mouse
- [ ] Solar system with real data and a relativity correction
- [ ] Black holes: simulated inspiral, with published fits for the merger
