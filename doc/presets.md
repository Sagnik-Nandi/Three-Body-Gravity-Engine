# Presets

| Preset | What you should see | What the test checks |
|---|---|---|
| `two-body` | A circular two-body orbit | Radius stays constant; energy, momentum and angular momentum conserved |
| `figure8` | Three equal masses chasing each other along one figure-8 | Returns to its start after one period (6.326) within 1e-6 |
| `lagrange` | Rigidly rotating equilateral triangle that eventually falls apart | Stays equilateral for a period; a 1e-6 nudge breaks it |
| `euler` | Three masses in a rotating line | Middle body stays still, line keeps length; a 1e-6 nudge breaks it |
| `trojan` | Asteroid 60° ahead of Jupiter, staying there | Same Lagrange triangle with masses 1000:1:0 is *stable*: a 1% nudge swings it 39°–88° but it never leaves |
| `sun-earth-moon` | A moon wobbling around a planet's orbit | Moon stays ~0.3 from the planet for 2 years |
| `pythagorean` | Masses 3, 4, 5 dropped from rest: chaos, then the 3 is thrown out | Matches the known outcome (Szebehely & Peters 1967): 3 ejected, 4+5 leave as a binary |

The web view adds more (see [Impacts and tides](physics.md#impacts-and-tides)):

| Preset | What you should see | What the test checks |
|---|---|---|
| `butterfly`, `twins` | `pythagorean` as a cloud of 30 nudged copies, and with one nudged ghost copy | Same as `pythagorean` |
| `flower`, `rosette`, `trefoil`, `loops`, `choreography` | Clean repeating patterns; only `flower` and `rosette` are stable | All return to the start after one period; `flower` and `rosette` survive a nudge; `choreography` leaves its path within 5 periods |
| `flyby` | A star passes a tight pair, keeps one as a new partner and throws the other out | The new pair stays together; the old partner leaves |
| `rogue-star` | A second star passes a Sun with three planets. The view stays on the Sun, which gets kicked away | Inner planet stays, middle one is free, outer one leaves with the star |
| `slingshot` | A probe on a closed orbit passes behind a planet, gains speed and leaves | Starts bound to the Sun, ends free, misses the planet |
| `black-hole` | The Hills mechanism: a black hole splits a pair of stars, keeping one and flinging the other out. Newtonian gravity only | One star bound, one free and fast |
| `head-on` | Two planets meet head-on and merge; the survivor swings around the star | One merge; momentum and energy budget balance |
| `moon-holds` | 1,000 rocks stay a moon, outside the Roche limit | Keeps its shape over 3 orbits |
| `moon-torn` | The same moon closer in: stretched into a spiral | Comes apart between the rigid and fluid limits |
| `impact` | A Sun, a planet, and an object that clips it, throwing out a temporary moon | The contact happens when set; momentum and angular momentum exact; a clump forms in orbit |
| `comet` | One close pass pulls a comet into a string, and some of it hits the planet | Intact if the pass is distant, torn if close |

`lagrange` and `euler` are exact but *unstable* solutions, like a pencil
balanced on its tip: any imperfection grows instead of being corrected. Even
floating-point rounding (~1e-16) grows ~85x per orbit in the Lagrange triangle
and breaks it after ~7 orbits (the Python preset runs only 4, still perfect to
~1e-8; the web view keeps going, so you can watch it break). The Euler line's
symmetry survives rounding exactly, so it stays perfect indefinitely until nudged.

## Patterns

Periodic orbits from Broucke (1975), Simó (2001) and the Three Body Orbits rosette family, all with
equal masses except `rosette` (1.005, 0.497, 0.995). The starting values
are from [Three Body Orbits](https://www.threebodyorbits.com), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Periodic doesn't mean stable. Measured on this engine, here is how long each holds its pattern:

| Preset | Orbit | Holds for | At 1x |
|---|---|---|---|
| `flower` | Broucke A5 | Stable | Indefinitely |
| `rosette` | Rosette 4:7 | Stable | Indefinitely |
| `trefoil` | Broucke A10 | ~8-11 periods | ~2 minutes |
| `loops` | Broucke R2 | ~10-13 periods | ~90 s |
| `choreography` | Simó SC.87 | ~1 period | ~15-20 s |

The unstable ones can't be saved by finer steps: rounding in the last digit is enough to
grow until the pattern breaks.
