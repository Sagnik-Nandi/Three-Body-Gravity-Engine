// Starting configurations (G = 1). JavaScript port of scenarios.py:
// each function returns an engine System.
import { System } from "./engine.js";

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

// Presets for the web page. make: builds the System; t: suggested run time;
// eta: accuracy (chaotic runs need smaller). Same as SCENARIOS in scenarios.py.
export const SCENARIOS = {
  "two-body": { make: () => twoBody(10, 1, 10), t: 100, eta: 0.01,
    about: "circular two-body orbit" },
  figure8: { make: () => figure8(), t: 3 * FIGURE8_PERIOD, eta: 0.01,
    about: "equal masses chasing each other on a figure-8 (period 6.326)" },
  lagrange: { make: () => lagrangeTriangle(), t: 4 * lagrangePeriod(), eta: 0.01,
    about: "rotating equilateral triangle, equal masses. Unstable: rounding errors alone break it after ~7 orbits" },
  trojan: { make: () => sunJupiterTrojan(), t: 25 * lagrangePeriod([1000, 1, 0], 10), eta: 0.01,
    about: "Sun-Jupiter-Trojan at 60 deg: nudged 1%, swings around L4 but stays" },
  euler: { make: () => eulerLine(), t: 8 * eulerPeriod(), eta: 0.01,
    about: "three masses in a rotating line. Unstable, but its mirror symmetry survives rounding, so it stays perfect" },
  "sun-earth-moon": { make: () => sunEarthMoon(), t: 4 * Math.PI * Math.sqrt(1000 / 1001), eta: 0.01,
    about: "star, planet, and a moon around the planet (2 years)" },
  pythagorean: { make: () => pythagorean(), t: 70, eta: 0.003,
    about: "masses 3,4,5 released from rest: chaos, then the 3 is ejected" },
};
