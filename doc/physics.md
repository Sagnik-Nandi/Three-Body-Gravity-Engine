# Physics

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
  When two surfaces touch, the Python run stops and the impact is marked; the web view merges
  them and carries on (see [Impacts and tides](#impacts-and-tides)).
  Point masses (size 0) can't touch, so this happens only if the pair's
  timescale falls below 1e-8 of its starting value (~1/200,000 of the distance),
  meaning they are heading into a true singularity. Near-misses like the
  Pythagorean problem's (4e-4 apart) pass through untouched.
- `run()` lands exactly on evenly spaced sample times, so animations play at a
  uniform speed regardless of the step size; the web view calls `advanceTo(t)`
  once per screen frame instead.

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
squeezes it by GM/r³ across. The arrow shows the exact stretch axis, with its length
compressed (cube root of the strength), since the true range is too wide to draw.

**Bodies made of particles** (`web/particles.js`). A moon of ~1,000 rocks held
together only by its own gravity, each rock a sphere that can push on its neighbours
but not pull. A point can't feel a tide, but a pile can: the outer rocks feel the
planet's gravity differently from the inner ones, so **tides need no code of their own**.
The Roche limit emerges by itself: our moon holds at distance 9 and breaks at 8.5,
which is 2.2 radii of an equal-density planet, between the theoretical limits for a
rigid moon (1.26) and a fluid one (2.44). Rocks that touch a planet are absorbed by it.

This is a different method from the rest of the engine, because many bodies need it:

- **Softened gravity** between rocks, since each stands for a chunk of material.
- **A fixed step.** The adaptive step shrinks for everyone when any one pair is close, and
  stalls with this many bodies (500 unsoftened particles reached only t = 0.37 in 40 s).
- **Leapfrog**: one gravity calculation per step instead of Yoshida's three.
- **Two speeds**: contacts and the planet's gravity are cheap and fast-changing, so they get
  8 substeps for each N² calculation of gravity between rocks.
- **Contacts** are a spring and a dashpot along the line between two rocks, so momentum and
  angular momentum stay exact (~1e-15). They are soft, squashing up to 30% of a rock's radius
  at the centre of a moon, because softer contacts allow a longer step, which keeps these fast. The dashpot's energy becomes heat. It ignores
  relative motion too small to be real (what one gravity kick leaves behind), or a pile at
  rest would endlessly count that as heat.

Expect an energy error around 1e-4 for a moon that holds, and around 1e-3 for a violent
breakup or impact. The results are **qualitatively right but not predictive**:
1,000 rocks are coarse, there is no friction or material strength, and impacts don't melt
or vaporise anything. Exact fragments would differ with a different number of rocks.

**Giant impact.** The planet and impactor are both rocks, and the Sun is a point. The contact
is set first, then run backwards, so the impactor really arrives from deep space. It throws out a
clump that orbits as a moon, but no lasting moon or disk formed in a scan of 92 impacts: each
clump's orbit dips inside the Roche limit, so it is shredded or falls back. Real moon-forming
impacts have melt and vapour pressure, which can push debris onto wider orbits; these rocks have
neither. These runs are very sensitive: softening the contacts changed the moon's fate, so the
preset's aim was retuned to keep a large moon that falls back. The main view stays on the planet, seen
from its far side with the Sun at the top edge; the inset shows the whole system from above, with the
planet's path around the Sun. The hit changes that path: the orbit becomes eccentric.
