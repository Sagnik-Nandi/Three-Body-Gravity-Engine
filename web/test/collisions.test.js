// Merging collisions and tidal forces.
import { test } from "node:test";
import assert from "node:assert/strict";

import { System } from "../engine.js";

const close = (a, b, tol, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tol ${tol})`);

/** Two bodies flying at each other along x, plus a far-away third body. */
const headOn = (merge = true) => new System({
  masses: [3, 1, 2],
  positions: [[-1, 0, 0], [1, 0.05, 0], [0, 40, 0]],
  velocities: [[0.5, 0, 0], [-1.5, 0, 0], [0, 0, 0]],
  radii: [0.2, 0.1, 0.1],
  merge,
});

const total = (s) => {
  const L = s.angularMomentum();
  return { mass: s.masses.reduce((a, b) => a + b, 0), p: s.momentum(),
    L: L.map((x, c) => x + s.spinL[c]), budget: s.energyBudget() };
};

test("without merge on, a collision still stops the run", () => {
  const s = headOn(false);
  assert.equal(s.advanceTo(50), true);
  assert.deepEqual(s.collision, [0, 1]);
  assert.equal(s.n, 3);
});

test("a merge conserves mass, momentum, angular momentum and the energy budget", () => {
  const s = headOn();
  const t0 = total(s);
  s.advanceTo(5, 0.0025); // small steps: the drift left over is integrator error, ~eta^4
  assert.equal(s.merges.length, 1);
  assert.equal(s.n, 2);
  const t1 = total(s);
  close(t1.mass, t0.mass, 1e-12, "mass");
  t1.p.forEach((p, c) => close(p, t0.p[c], 1e-10, "momentum"));
  t1.L.forEach((L, c) => close(L, t0.L[c], 1e-9, "angular momentum"));
  close(t1.budget, t0.budget, 1e-8 * Math.abs(t0.budget), "energy budget");
});

test("merging moves real energy out of the orbits, into heat", () => {
  // Much faster than escape speed: the pair's orbital energy is ~1/2 mu v^2 = 24.
  const s = new System({ masses: [3, 1], positions: [[-2, 0, 0], [2, 0.05, 0]],
    velocities: [[2, 0, 0], [-6, 0, 0]], radii: [0.2, 0.1], merge: true });
  const e0 = s.energy();
  s.advanceTo(2, 0.0025);
  assert.equal(s.n, 1);
  // Impact heat is the relative kinetic energy at contact (gravity sped them up).
  assert.ok(s.heat > 24 && s.heat < 40, `heat ${s.heat}`);
  close(s.heat, s.merges[0].heat, 1e-15);
  assert.ok(e0 - s.energy() > 20, "orbit energy really fell");
  close(s.energyBudget(), e0, 1e-7 * Math.abs(e0), "budget still balances");
});

test("the merged body keeps the combined volume, and the heavier body's identity", () => {
  const s = headOn();
  s.advanceTo(5);
  const i = s.indexOfId(0);
  assert.equal(s.masses[i], 4);
  close(s.radii[i], Math.cbrt(0.2 ** 3 + 0.1 ** 3), 1e-12, "radius");
  assert.equal(s.indexOfId(1), -1);
  assert.equal(s.holderOf(1), i);
  assert.equal(s.merges[0].absorbed, 1);
});

test("merged velocity is the momentum-weighted average", () => {
  const s = new System({ masses: [3, 1], positions: [[0, 0, 0], [0.1, 0, 0]],
    velocities: [[1, 0, 0], [-1, 0, 0]], radii: [0.2, 0.2], merge: true });
  s.mergeBodies(0, 1);
  close(s.vel[0], 0.5, 1e-14, "velocity");
  close(s.pos[0], 0.025, 1e-14, "position at centre of mass");
});

test("a chain of merges: ids follow to the final holder, and the run continues", () => {
  const s = new System({
    masses: [1, 2, 4],
    positions: [[0, 0, 0], [1, 0, 0], [3, 0, 0]],
    velocities: [[0, 0, 0], [-0.5, 0, 0], [-0.5, 0, 0]],
    radii: [0.1, 0.1, 0.1], merge: true,
  });
  const before = total(s);
  assert.equal(s.advanceTo(40, 0.0025), false);
  assert.equal(s.n, 1);
  assert.equal(s.ids[0], 2, "heaviest survives");
  for (const id of [0, 1, 2]) assert.equal(s.holderOf(id), 0);
  close(s.masses[0], 7, 1e-12, "all mass");
  close(s.time, 40, 1e-9, "a lone body keeps flying");
  const after = total(s);
  close(after.budget, before.budget, 1e-7 * Math.abs(before.budget), "energy budget");
});

test("point masses merge at the singular cutoff instead of blowing up", () => {
  const s = new System({ masses: [1, 1], positions: [[0, 0, 0], [1, 0, 0]],
    velocities: [[0, 0, 0], [0, 0, 0]], merge: true });
  const minScale = 1e-8 * s.timescale();
  s.advanceTo(5, 0.01, minScale);
  assert.equal(s.n, 1);
  assert.ok(Number.isFinite(s.pos[0]) && Number.isFinite(s.energyBudget()));
});

// ---- tides ---------------------------------------------------------------

test("tide of a point mass: stretches 2GM/r^3 along, squeezes GM/r^3 across", () => {
  const s = new System({ masses: [8, 1], positions: [[0, 0, 0], [2, 0, 0]],
    velocities: [[0, 0, 0], [0, 0, 0]], G: 1.5 });
  const T = s.tidalTensorOn(1);
  const base = (1.5 * 8) / 2 ** 3;
  close(T[0], 2 * base, 1e-12, "along");
  close(T[4], -base, 1e-12, "across");
  close(T[8], -base, 1e-12, "across");
  close(T[0] + T[4] + T[8], 0, 1e-12, "trace (vacuum gravity is volume-preserving)");
});

test("tidal tensor matches the real difference in gravity across a body", () => {
  const s = new System({
    masses: [5, 3, 1],
    positions: [[1, 2, -1], [-3, 1, 2], [0.5, -2, 1]],
    velocities: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    softening: 0.1,
  });
  const T = s.tidalTensorOn(2);
  const pull = (x, y, z) => {
    const a = [0, 0, 0];
    for (const j of [0, 1]) {
      const d = [s.pos[3 * j] - x, s.pos[3 * j + 1] - y, s.pos[3 * j + 2] - z];
      const r2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 + s.softening ** 2;
      d.forEach((v, c) => { a[c] += (s.masses[j] * v) / (r2 * Math.sqrt(r2)); });
    }
    return a;
  };
  const h = 1e-5;
  const [x, y, z] = s.position(2);
  for (let col = 0; col < 3; col++) {
    const off = [0, 0, 0];
    off[col] = h;
    const plus = pull(x + off[0], y + off[1], z + off[2]);
    const minus = pull(x - off[0], y - off[1], z - off[2]);
    for (let row = 0; row < 3; row++) {
      close(T[3 * row + col], (plus[row] - minus[row]) / (2 * h), 1e-7, `T[${row}][${col}]`);
    }
  }
});

test("tides grow as 1/r^3", () => {
  const at = (r) => new System({ masses: [10, 1], positions: [[0, 0, 0], [r, 0, 0]],
    velocities: [[0, 0, 0], [0, 0, 0]] }).tidalTensorOn(1)[0];
  close(at(2) / at(4), 8, 1e-12);
});
