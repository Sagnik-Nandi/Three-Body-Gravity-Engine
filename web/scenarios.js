// Starting configurations (G = 1). JavaScript port of scenarios.py:
// each function returns an engine System.
import { System } from "./engine.js";
import { cometFlyby, cometImpact, moonInOrbit } from "./particles.js";

/** Equal-density bodies: radius grows as the cube root of mass. */
export function radiusForMass(m, size = 0.1) {
  return size * Math.cbrt(m);
}

/**
 * Build a System in the centre-of-mass frame (COM at rest at the origin),
 * padding 2D vectors with z = 0.
 */
function makeSystem(masses, positions, velocities, size, G = 1) {
  const pad = (v) => [v[0], v[1], v[2] ?? 0];
  const pos = positions.map(pad);
  const vel = velocities.map(pad);
  const M = masses.reduce((a, b) => a + b, 0);
  for (const vecs of [pos, vel]) {
    for (let c = 0; c < 3; c++) {
      const mean = vecs.reduce((s, v, i) => s + masses[i] * v[c], 0) / M;
      for (const v of vecs) v[c] -= mean;
    }
  }
  return new System({
    masses, positions: pos, velocities: vel, G,
    radii: masses.map((m) => radiusForMass(m, size)),
  });
}

/**
 * Two bodies orbiting their common centre of mass.
 * speedFactor = 1 circular, <1 ellipse, 0 falls straight in, >= sqrt(2) escape.
 * size: radius of a mass-1 body; 0 makes them point masses.
 */
export function twoBody(m1, m2, separation, speedFactor = 1, size = 0.1, G = 1) {
  const vRel = speedFactor * Math.sqrt((G * (m1 + m2)) / separation);
  return makeSystem([m1, m2], [[0, 0], [separation, 0]], [[0, 0], [0, vRel]], size, G);
}

export const FIGURE8_PERIOD = 6.32591398;

/**
 * Chenciner-Montgomery figure-8: three equal masses chase each other
 * around one figure-8 curve. Returns to its start every FIGURE8_PERIOD.
 */
export function figure8(size = 0.02) {
  const x1 = [0.97000436, -0.24308753];
  const v3 = [-0.93240737, -0.86473146];
  const v1 = [-v3[0] / 2, -v3[1] / 2];
  return makeSystem([1, 1, 1], [x1, [-x1[0], -x1[1]], [0, 0]], [v1, v1, v3], size);
}

/**
 * Lagrange's solution: bodies at the corners of an equilateral triangle,
 * which rotates rigidly. Works for ANY masses, but is only stable if one
 * mass dominates (ratio > ~25:1); equal masses break up eventually.
 * kick: fractional nudge to body 3's speed, to test stability.
 */
export function lagrangeTriangle(masses = [1, 1, 1], side = 1, kick = 0, size = 0.02, G = 1) {
  const pos = [[0, 0], [side, 0], [side / 2, (side * Math.sqrt(3)) / 2]];
  const M = masses.reduce((a, b) => a + b, 0);
  for (let c = 0; c < 2; c++) {
    const mean = pos.reduce((s, p, i) => s + masses[i] * p[c], 0) / M;
    for (const p of pos) p[c] -= mean;
  }
  const omega = Math.sqrt((G * M) / side ** 3);
  const vel = pos.map(([x, y]) => [-omega * y, omega * x]); // rigid rotation
  vel[2] = vel[2].map((v) => v * (1 + kick));
  return makeSystem(masses, pos, vel, size, G);
}

export function lagrangePeriod(masses = [1, 1, 1], side = 1, G = 1) {
  return (2 * Math.PI) / Math.sqrt((G * masses.reduce((a, b) => a + b, 0)) / side ** 3);
}

/**
 * Lagrange triangle with masses 1000 : 1 : ~0 -- a Trojan asteroid
 * sitting 60 degrees ahead of Jupiter. Stable even when nudged.
 */
export function sunJupiterTrojan(kick = 0.01) {
  return lagrangeTriangle([1000, 1, 1e-6], 10, kick, 0.05);
}

/**
 * Euler's collinear solution: equal masses in a line, the middle one
 * fixed, the outer two rotating around it like a rigid stick. Unstable.
 * kick: fractional nudge to body 3's speed, to test stability.
 */
export function eulerLine(m = 1, d = 1, kick = 0, size = 0.02, G = 1) {
  const omega = Math.sqrt((5 * G * m) / (4 * d ** 3)); // pull of both others on an outer body
  return makeSystem([m, m, m], [[-d, 0], [0, 0], [d, 0]],
    [[0, -omega * d], [0, 0], [0, omega * d * (1 + kick)]], size, G);
}

export function eulerPeriod(m = 1, d = 1, G = 1) {
  return (2 * Math.PI) / Math.sqrt((5 * G * m) / (4 * d ** 3));
}

/**
 * A star (1000), a planet (1) on a circular orbit at distance 10, and a
 * moon (0.01) circling the planet at distance 0.3.
 */
export function sunEarthMoon() {
  const a = 10;
  const rMoon = 0.3;
  const vPlanet = Math.sqrt(1000 / a);
  const vMoon = Math.sqrt(1 / rMoon);
  return makeSystem([1000, 1, 0.01],
    [[0, 0], [a, 0], [a + rMoon, 0]],
    [[0, 0], [0, vPlanet], [0, vPlanet + vMoon]], 0.03);
}

/**
 * Burrau's problem: masses 3, 4, 5 released from rest at the corners of
 * a 3-4-5 right triangle (each opposite the side of its own length).
 * Chaotic; known outcome (Szebehely & Peters 1967): the lightest body is
 * flung out and the 4 and 5 leave as a tight binary. Point masses.
 */
export function pythagorean() {
  return makeSystem([3, 4, 5], [[1, 3], [-2, -1], [1, -1]], [[0, 0], [0, 0], [0, 0]], 0);
}

/**
 * Two planets on the same circular orbit, going opposite ways around a star:
 * they meet head-on, and what's left carries on in an eccentric orbit.
 */
export function headOn() {
  const [star, a, b] = [100, 1, 0.5];
  const r = 10;
  const v = Math.sqrt(star / r);
  return makeSystem([star, a, b], [[0, 0], [r, 0], [-r, 0]], [[0, 0], [0, v], [0, v]], 0.1);
}

/**
 * Periodic orbits of three equal masses (unless `masses` says otherwise). Numbers: the refined starting values from
 * Three Body Orbits, https://www.threebodyorbits.com (CC BY 4.0). Orbits: Broucke
 * (1975) and Simo (2001), plus a rosette from its catalogue. pos, vel: starting positions and velocities; T: the period.
 * Only `flower` and `rosette` are stable. The others repeat for a while, then tiny errors grow and
 * they break up: after ~8 periods for trefoil, ~10 for loops, ~1 for choreography.
 */
export const PATTERNS = {
  flower: { pos: [[0.23550991075504524, -0.000543526760802538], [0.9711393382752979, 0.0001773756774700954], [-1.206649249030343, 0.0003661510833324426]], vel: [[-0.0005903109150803246, 1.2795726489984942], [0.0008794026465458129, -0.40214513180788286], [-0.0002890917314654884, -0.8774275171906113]], T: 8.689119976290863 }, // Broucke A5
  rosette: { masses: [1.005, 0.4970167593231461, 0.995], pos: [[-0.6823331636092627, 2.947891402057799e-15], [0.7437703463399286, -1.0784404085696821e-15], [0.3176668363907373, -2.438822012138346e-15]], vel: [[-2.619864226984394e-15, -0.34906761310316886], [-7.001846054579859e-18, -1.6564924971287374], [2.649692043170495e-15, 1.180017571793684]], T: 21.203709327847847 }, // rosette 4:7
  trefoil: { pos: [[-0.5426372741754075, 0.000611838328232161], [2.527565296992829, -5.7923062901903644e-05], [-1.9849280228174218, -0.0005539152653302574]], vel: [[-0.00025260363257767775, 0.8750073506362065], [-0.00010815209443286432, -0.05269482115898142], [0.0003607557270105421, -0.8223125294772251]], T: 32.610946912739685 }, // Broucke A10
  loops: { pos: [[0.9060312861096047, -0.0002720902384283883], [-0.6909278878836602, 0.0004733055339912139], [-0.21510339822594451, -0.0002012152955628256]], vel: [[0.0003374782907750624, 0.9658857929344913], [-0.0014112698277407843, -1.6223724909372397], [0.001073791536965722, 0.6564866980027484]], T: 5.70421628566081 }, // Broucke R2
  choreography: { pos: [[-0.04242849437749801, -2.3679062677758333e-08], [0.02121436158059094, -0.20520759178859768], [0.021214132796907068, 0.20520761546766034]], vel: [[-7.435338415995941e-08, 0.13233725075756994], [2.689282219076956, -0.06616712590872742], [-2.6892821447235717, -0.06617012484884253]], T: 10.665883646896663 }, // Simo SC.87
};

export function periodicOrbit({ pos, vel, masses = [1, 1, 1] }) {
  return makeSystem(masses, pos, vel, 0);
}

/**
 * A star flies at a tight pair of stars, all of equal mass. `aim`: how far off
 * centre it comes in. With aim -2 it swaps places: it keeps body 1 as a new
 * partner and throws body 2 out.
 */
export function binaryFlyby(aim = -2) {
  const v = Math.SQRT1_2; // circular for two unit masses 1 apart
  return makeSystem([1, 1, 1], [[0.5, 0], [-0.5, 0], [-12, aim]], [[0, v], [0, -v], [1, 0]], 0.03);
}

/**
 * A Sun, a spinning planet, and an object a fifth of the planet's mass from outside
 * the system. It clips the planet and throws out a clump that orbits as a moon for a
 * while. These settings gave the longest-lived moon found, but in a scan of 84 impacts
 * none lasted: every clump's orbit dips inside the Roche limit, so it falls back.
 */
export function giantImpact() {
  const massRatio = 0.2;
  return cometImpact({ massRatio, speed: 1, spin: 0.7, closest: 0.8 * (1 + Math.cbrt(massRatio)), orbit: 40, sunMass: 30 });
}

// Presets for the web page, in menu order. label, group, about: how the menu
// shows it. make: builds the System; t: suggested run time; eta: accuracy
// (chaotic runs need smaller). Optional: chaos: opens with that comparison;
// tides: arrows on; trail: starting trail length; particles: made of particles (these
// step themselves, and can't be compared: too heavy); follow: the camera stays with the planet; extent: size of the view,
// if the starting positions don't suit. scenarios.py has the Orbits and Chaos ones.
export const SCENARIOS = {
  "two-body": { label: "Two-body", group: "Orbits", make: () => twoBody(10, 1, 10), t: 100, eta: 0.01,
    about: "One circular orbit." },
  figure8: { label: "Figure-8", group: "Orbits", make: () => figure8(), t: 3 * FIGURE8_PERIOD, eta: 0.01,
    about: "Three equal masses share one path." },
  lagrange: { label: "Triangle", group: "Orbits", make: () => lagrangeTriangle(), t: 4 * lagrangePeriod(), eta: 0.01,
    about: "A spinning triangle that eventually breaks." },
  euler: { label: "Line", group: "Orbits", make: () => eulerLine(), t: 8 * eulerPeriod(), eta: 0.01,
    about: "Three in a rotating line: perfect, but fragile." },
  trojan: { label: "Trojan", group: "Orbits", make: () => sunJupiterTrojan(), t: 25 * lagrangePeriod([1000, 1, 0], 10), eta: 0.01,
    about: "An asteroid parked 60° ahead of Jupiter." },
  "sun-earth-moon": { label: "Moon", group: "Orbits", make: () => sunEarthMoon(), t: 4 * Math.PI * Math.sqrt(1000 / 1001), eta: 0.01,
    about: "A moon circling a planet circling a star." },

  pythagorean: { label: "Pythagorean", group: "Chaos", make: () => pythagorean(), t: 70, eta: 0.003,
    about: "Three tangle, then one is thrown out." },
  butterfly: { label: "Butterfly", group: "Chaos", make: () => pythagorean(), t: 70, eta: 0.003, chaos: "cloud",
    about: "The butterfly effect: 30 almost identical copies scatter." },
  twins: { label: "Twins", group: "Chaos", make: () => pythagorean(), t: 70, eta: 0.003, chaos: "twin",
    about: "A nudged ghost copy: identical at first, then not." },

  flyby: { label: "Binary flyby", group: "Chaos", make: () => binaryFlyby(), t: 40, eta: 0.004, extent: 6,
    about: "A passing star steals one of a pair, and throws the other out." },

  flower: { label: "Flower", group: "Patterns", make: () => periodicOrbit(PATTERNS.flower), t: 2 * PATTERNS.flower.T, eta: 0.001, trail: 3600,
    about: "A pair draws petals inside a third body's circle. Stable." },
  rosette: { label: "Rosette", group: "Patterns", make: () => periodicOrbit(PATTERNS.rosette), t: PATTERNS.rosette.T, eta: 0.001, trail: 3600,
    about: "A spirograph of interwoven rings. Stable, with one lighter body." },
  trefoil: { label: "Trefoil", group: "Patterns", make: () => periodicOrbit(PATTERNS.trefoil), t: PATTERNS.trefoil.T, eta: 0.001, trail: 3600,
    about: "A three-lobed pattern. Repeats for about 2 minutes, then drifts apart." },
  loops: { label: "Loops", group: "Patterns", make: () => periodicOrbit(PATTERNS.loops), t: 2 * PATTERNS.loops.T, eta: 0.001, trail: 3600,
    about: "Two bodies loop inside a third body's circle. Repeats for about 90 s, then breaks up." },
  choreography: { label: "Choreography", group: "Patterns", make: () => periodicOrbit(PATTERNS.choreography), t: PATTERNS.choreography.T, eta: 0.001, trail: 3600, extent: 0.75,
    about: "All three share one path, for one lap. So unstable it can't last." },

  "head-on": { label: "Head-on", group: "Impacts & tides", make: () => headOn(), t: 30, eta: 0.01,
    about: "Two planets collide and merge." },
  "moon-holds": { label: "Moon holds", group: "Impacts & tides", make: () => moonInOrbit({ distance: 11 }), t: 57, tides: true, particles: true,
    about: "Outside the Roche limit, gravity holds 1,000 rocks together." },
  "moon-torn": { label: "Moon torn", group: "Impacts & tides", make: () => moonInOrbit({ distance: 7 }), t: 45, tides: true, particles: true, extent: 11,
    about: "Inside the Roche limit, tides win." },
  impact: { label: "Giant impact", group: "Impacts & tides", make: () => giantImpact(), t: 75, particles: true, extent: 7, follow: true,
    about: "A huge hit throws out a moon, but it can't last: it falls back." },
  comet: { label: "Comet", group: "Impacts & tides", make: () => cometFlyby({ closest: 3.5, start: 22 }), t: 24, particles: true, extent: 16,
    about: "One close pass pulls a comet into a string." },
};
