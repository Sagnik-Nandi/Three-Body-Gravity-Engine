# Python version

The first version of the engine, now mainly the reference the JavaScript engine is checked against
(`web/test/reference.json`). It has the Orbits and Chaos presets, with no merges or particles.

Requires Python 3.10+ with `numpy` and `matplotlib`.

```
pip install numpy matplotlib
cd python
python visualize.py figure8
```

Run these from the `python` folder:

```
python visualize.py --help                # list presets and options
python visualize.py figure8               # any Orbits or Chaos preset from presets.md
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
