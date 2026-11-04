// Starting configurations (G = 1). JavaScript port of scenarios.py:
// each function returns an engine System.
import { System } from "./engine.js";
import { cometFlyby, moonInOrbit } from "./particles.js";

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

/** A moon on a very eccentric orbit, so the tides on it surge at closest approach. */
export function eccentricMoon() {
  return twoBody(100, 1, 10, 0.5, 0.05);
}

/**
 * Stable periodic orbits: equal point masses tracing clean repeating patterns.
 * All but one are from Broucke's family (Broucke 1975, Henon 1976), with numbers
 * from the Three-body Gallery, http://three-body.ipb.ac.rs/broucke.php. Moth I is
 * from Suvakov & Dmitrasinovic, PRL 110 (2013), with numbers from Hristov et al.,
 * New Astronomy 125 (2026), https://db2.fmi.uni-sofia.bg/3bodystab971/.
 * pos, vel: starting positions and velocities; T: the period.
 */
export const PATTERNS = {
  cross: { pos: [[-0.1095519101, 0.0], [1.6613533905, 0.0], [-1.5518014804, 0.0]], vel: [[0.0, 0.9913358338], [0.0, -0.1569959746], [0.0, -0.8343398592]], T: 12.055859 }, // Broucke A 7
  flower: { pos: [[0.2355245585, 0.0], [0.9712004534, 0.0], [-1.2067250118, 0.0]], vel: [[0.0, 1.2795329643], [0.0, -0.4021329019], [0.0, -0.8774000623]], T: 8.689105 }, // Broucke A 5
  rosette: { pos: [[0.0557080334, 0.0], [1.3308335036, 0.0], [-1.386541537, 0.0]], vel: [[0.0, 1.0824099428], [0.0, -0.2339059386], [0.0, -0.8485040042]], T: 20.897689 }, // Broucke A 9
  loops: { pos: [[0.8733047091, 0.0], [-0.6254030288, 0.0], [-0.2479016803, 0.0]], vel: [[0.0, 1.0107764436], [0.0, -1.6833533458], [0.0, 0.6725769022]], T: 5.395826 }, // Broucke R 4
  moth: { pos: [[-1, 0], [0, 0], [1, 0]], vel: [[0.4644451728180667, 0.39606001465281476], [-0.9288903456361334, -0.7921200293056295], [0.4644451728180667, 0.39606001465281476]], T: 14.894305175042124 }, // Moth I
};

export function periodicOrbit({ pos, vel }) {
  return makeSystem([1, 1, 1], pos, vel, 0);
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

// Presets for the web page, in menu order. label, group, about: how the menu
// shows it. make: builds the System; t: suggested run time; eta: accuracy
// (chaotic runs need smaller). Optional: chaos: opens with that comparison;
// tides: arrows on; trail: starting trail length; particles: made of particles (these
// step themselves, and can't be compared: too heavy); extent: size of the view,
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

  cross: { label: "Cross", group: "Stable patterns", make: () => periodicOrbit(PATTERNS.cross), t: 2 * PATTERNS.cross.T, eta: 0.003, trail: 3600,
    about: "A pair crosses at the centre as a third circles them." },
  flower: { label: "Flower", group: "Stable patterns", make: () => periodicOrbit(PATTERNS.flower), t: 2 * PATTERNS.flower.T, eta: 0.003, trail: 3600,
    about: "A pair draws petals inside a third body's circle." },
  rosette: { label: "Rosette", group: "Stable patterns", make: () => periodicOrbit(PATTERNS.rosette), t: 2 * PATTERNS.rosette.T, eta: 0.003, trail: 3600,
    about: "Two bodies share one star-shaped path." },
  loops: { label: "Loops", group: "Stable patterns", make: () => periodicOrbit(PATTERNS.loops), t: 3 * PATTERNS.loops.T, eta: 0.003, trail: 3600,
    about: "Two bodies loop inside a third body's big circle." },
  moth: { label: "Moth", group: "Stable patterns", make: () => periodicOrbit(PATTERNS.moth), t: 2 * PATTERNS.moth.T, eta: 0.003, trail: 3600,
    about: "Looks like a chaotic tangle, but repeats exactly." },

  "head-on": { label: "Head-on", group: "Impacts & tides", make: () => headOn(), t: 30, eta: 0.01,
    about: "Two planets collide and merge." },
  tides: { label: "Tides", group: "Impacts & tides", make: () => eccentricMoon(), t: 18, eta: 0.01, tides: true,
    about: "Tides surge at each close pass." },
  "moon-holds": { label: "Moon holds", group: "Impacts & tides", make: () => moonInOrbit({ distance: 11 }), t: 57, tides: true, particles: true,
    about: "Outside the Roche limit, gravity holds 1,000 rocks together." },
  "moon-torn": { label: "Moon torn", group: "Impacts & tides", make: () => moonInOrbit({ distance: 7 }), t: 45, tides: true, particles: true, extent: 11,
    about: "Inside the Roche limit, tides win." },
  debris: { label: "Debris disk", group: "Impacts & tides", make: () => moonInOrbit({ distance: 6 }), t: 50, particles: true, extent: 11,
    about: "A shredded moon spreads into a disk around its planet." },
  comet: { label: "Comet", group: "Impacts & tides", make: () => cometFlyby({ closest: 3.5, start: 22 }), t: 24, particles: true, extent: 16,
    about: "One close pass pulls a comet into a string." },
};
