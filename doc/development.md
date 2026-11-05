# Development

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
| `doc/` | These notes, and the images on the front page. |
| `web/test/` | JS physics tests, plus a cross-check against reference runs exported from Python. |

## Tests

```
cd python
python test_engine.py                 # Python physics tests (~30 s)

cd web
npm test                              # 70 JS tests, ~30 s
```

The JS tests:
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
- [x] Bodies made of particles: Roche breakup, comet
- [x] Flybys: rogue star, slingshot, black hole
- [x] Giant impact on the CPU: a temporary moon (a lasting one would need more physics)
- [ ] Bigger impacts on the GPU (~10,000 particles)
- [ ] Stability sliders and 4-body presets
- [ ] Drag-to-launch: place bodies and set their velocity with the mouse
- [ ] Solar system with real data and a relativity correction
- [ ] Black holes: simulated inspiral, with published fits for the merger
