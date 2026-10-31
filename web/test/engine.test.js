// Physics checks for the JS engine, mirroring test_engine.py.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIGURE8_PERIOD, eulerLine, eulerPeriod, figure8, lagrangePeriod, lagrangeTriangle,
  pythagorean, sunEarthMoon, sunJupiterTrojan, twoBody,
} from "../scenarios.js";

const maxRelEnergyError = (energies, upto = energies.length) =>
  Math.max(...energies.slice(0, upto).map((e) => Math.abs((e - energies[0]) / energies[0])));

/** Distance between bodies i and j in each recorded sample. */
const dist = (positions, i, j) =>
  positions.map((p) => Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1],
    p[3 * i + 2] - p[3 * j + 2]));

const norm = (v) => Math.hypot(...v);

// ---- two bodies ---------------------------------------------------------

test("circular orbit keeps its radius", () => {
  const { positions } = twoBody(10, 1, 10).run(100);
  for (const d of dist(positions, 0, 1)) assert.ok(Math.abs(d - 10) < 1e-5);
});

test("energy, momentum and angular momentum are conserved", () => {
  const sim = twoBody(10, 1, 10, 0.7);
  const p0 = sim.momentum();
  const L0 = sim.angularMomentum();
  const { energies } = sim.run(100);
  assert.ok(maxRelEnergyError(energies) < 1e-7);
  sim.momentum().forEach((p, c) => assert.ok(Math.abs(p - p0[c]) < 1e-10));
  sim.angularMomentum().forEach((L, c) => assert.ok(Math.abs(L - L0[c]) < 1e-10 * norm(L0)));
});

test("tilted orbit stays in its plane", () => {
  const sim = twoBody(10, 1, 10, 0.7);
  const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  for (const arr of [sim.pos, sim.vel]) {
    for (let i = 0; i < sim.n; i++) {
      const [y, z] = [arr[3 * i + 1], arr[3 * i + 2]];
      arr[3 * i + 1] = c * y - s * z;
      arr[3 * i + 2] = s * y + c * z;
    }
  }
  const L = sim.angularMomentum();
  const normal = L.map((x) => x / norm(L));
  const { positions } = sim.run(100);
  let maxZ = 0;
  let maxOff = 0;
  for (const p of positions) {
    for (let i = 0; i < sim.n; i++) {
      maxZ = Math.max(maxZ, Math.abs(p[3 * i + 2]));
      maxOff = Math.max(maxOff, Math.abs(p[3 * i] * normal[0] + p[3 * i + 1] * normal[1] + p[3 * i + 2] * normal[2]));
    }
  }
  assert.ok(maxZ > 1, "really moves in z");
  assert.ok(maxOff < 1e-10, "never leaves its plane");
});

test("head-on fall collides at contact", () => {
  const sim = twoBody(10, 1, 10, 0);
  const { times, positions } = sim.run(100);
  assert.deepEqual(sim.collision, [0, 1]);
  const contact = sim.radii[0] + sim.radii[1];
  const gap = dist(positions, 0, 1).at(-1) - contact;
  assert.ok(gap <= 0 && gap > -0.01 * contact);
  assert.ok(times.at(-1) < (Math.PI / 2) * Math.sqrt(1000 / 22));
});

test("point masses collide without NaN, at the exact free-fall time", () => {
  const sim = twoBody(10, 1, 10, 0, 0);
  const { times, positions, energies } = sim.run(100);
  assert.deepEqual(sim.collision, [0, 1]);
  assert.ok(positions.every((p) => p.every(Number.isFinite)));
  assert.ok(Math.abs(times.at(-1) - (Math.PI / 2) * Math.sqrt(1000 / 22)) < 1e-3);
  assert.ok(maxRelEnergyError(energies, energies.length - 1) < 1e-6);
});

test("escape speed unbinds", () => {
  const sim = twoBody(10, 1, 10, 1.5);
  assert.ok(sim.energy() > 0);
  const { positions } = sim.run(100);
  assert.ok(dist(positions, 0, 1).at(-1) > 50);
});

// ---- three bodies -------------------------------------------------------

test("figure-8 returns to its start after one period", () => {
  const sim = figure8();
  const [p0, v0] = [sim.pos.slice(), sim.vel.slice()];
  const { energies } = sim.run(FIGURE8_PERIOD, 200);
  sim.pos.forEach((x, k) => assert.ok(Math.abs(x - p0[k]) < 1e-6));
  sim.vel.forEach((v, k) => assert.ok(Math.abs(v - v0[k]) < 1e-6));
  assert.ok(maxRelEnergyError(energies) < 1e-8);
});

test("Lagrange triangle rotates rigidly", () => {
  const { positions } = lagrangeTriangle().run(lagrangePeriod(), 200);
  for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
    for (const d of dist(positions, i, j)) assert.ok(Math.abs(d - 1) < 1e-6);
  }
});

test("equal-mass Lagrange triangle is unstable", () => {
  const { positions } = lagrangeTriangle([1, 1, 1], 1, 1e-6).run(8 * lagrangePeriod(), 800);
  assert.ok(Math.max(...dist(positions, 0, 1).map((d) => Math.abs(d - 1))) > 0.1);
});

test("Trojan swings around 60 degrees but stays", () => {
  const { positions } = sunJupiterTrojan(0.01).run(50 * lagrangePeriod([1000, 1, 0], 10), 2000);
  const angles = positions.map((p) => {
    const j = [p[3] - p[0], p[4] - p[1]];
    const a = [p[6] - p[0], p[7] - p[1]];
    return (Math.atan2(j[0] * a[1] - j[1] * a[0], j[0] * a[0] + j[1] * a[1]) * 180) / Math.PI;
  });
  const [lo, hi] = [Math.min(...angles), Math.max(...angles)];
  assert.ok(lo > 30 && hi < 95, `angle ${lo.toFixed(1)}..${hi.toFixed(1)}`);
  assert.ok(hi - lo > 20, "visibly swings");
});

test("Euler line rotates, then breaks when nudged", () => {
  let { positions } = eulerLine().run(eulerPeriod(), 200);
  for (const p of positions) assert.ok(Math.hypot(p[3], p[4], p[5]) < 1e-10);
  ({ positions } = eulerLine(1, 1, 1e-6).run(4 * eulerPeriod(), 400));
  assert.ok(Math.max(...positions.map((p) => Math.hypot(p[3], p[4], p[5]))) > 0.1);
});

test("moon stays with its planet", () => {
  const { positions, energies } = sunEarthMoon().run(4 * Math.PI * Math.sqrt(1000 / 1001), 2000);
  const moon = dist(positions, 1, 2);
  assert.ok(Math.min(...moon) > 0.2 && Math.max(...moon) < 0.4);
  for (const d of dist(positions, 0, 1)) assert.ok(Math.abs(d - 10) < 0.1);
  assert.ok(maxRelEnergyError(energies) < 1e-8);
});

test("Pythagorean problem ejects the lightest body", () => {
  const sim = pythagorean();
  const { positions, energies } = sim.run(70, 700, 0.003);
  assert.equal(sim.collision, null, "close passes are near-misses, not hits");
  const last = positions.at(-1);
  assert.ok(Math.hypot(last[0], last[1], last[2]) > 10, "mass 3 flung out");
  assert.ok(dist(positions, 1, 2).at(-1) < 3, "masses 4 and 5 left as a binary");
  const outward = sim.pos[0] * sim.vel[0] + sim.pos[1] * sim.vel[1] + sim.pos[2] * sim.vel[2];
  assert.ok(outward > 0, "still moving away");
  assert.ok(maxRelEnergyError(energies) < 1e-6);
});
