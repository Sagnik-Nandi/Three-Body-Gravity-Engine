// Does the JS engine reproduce the Python engine? Compares against
// reference.json, exported by make_reference.py (rerun it after changing
// the Python physics).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FIGURE8_PERIOD, eulerLine, eulerPeriod, figure8, lagrangePeriod, lagrangeTriangle,
  pythagorean, sunEarthMoon, sunJupiterTrojan, twoBody,
} from "../scenarios.js";

// Must match CASES in make_reference.py.
const CASES = {
  "two-body circular": () => twoBody(10, 1, 10),
  "two-body ellipse": () => twoBody(10, 1, 10, 0.7),
  "two-body eccentric point masses": () => twoBody(10, 1, 10, 0.15, 0),
  "two-body head-on": () => twoBody(10, 1, 10, 0),
  figure8: () => figure8(),
  lagrange: () => lagrangeTriangle(),
  "lagrange nudged": () => lagrangeTriangle([1, 1, 1], 1, 1e-6),
  trojan: () => sunJupiterTrojan(),
  euler: () => eulerLine(),
  "sun-earth-moon": () => sunEarthMoon(),
  "pythagorean (t<10)": () => pythagorean(),
};

const reference = JSON.parse(readFileSync(new URL("./reference.json", import.meta.url)));

// Same maths, but the two languages round differently in the last digit
// (~1e-16); unstable orbits amplify that, so allow a small tolerance.
const TOLERANCE = 1e-7;

for (const [name, ref] of Object.entries(reference)) {
  test(`matches Python: ${name}`, () => {
    assert.ok(CASES[name], `no JS factory for reference case "${name}"`);
    const sim = CASES[name]();
    const { times, positions, energies } = sim.run(ref.t, ref.samples, ref.eta);

    assert.deepEqual(sim.collision, ref.collision);
    assert.equal(times.length, ref.times.length);
    let worst = 0;
    for (let k = 0; k < times.length; k++) {
      assert.ok(Math.abs(times[k] - ref.times[k]) < 1e-9, `time ${k}`);
      for (let c = 0; c < positions[k].length; c++) {
        worst = Math.max(worst, Math.abs(positions[k][c] - ref.positions[k][c]));
      }
      assert.ok(Math.abs((energies[k] - ref.energies[k]) / ref.energies[k]) < TOLERANCE);
    }
    assert.ok(worst < TOLERANCE, `positions differ by up to ${worst.toExponential(1)}`);
  });
}

test("reference covers every case", () => {
  assert.deepEqual(Object.keys(reference).sort(), Object.keys(CASES).sort());
});

// Make sure the factory list really mirrors the Python presets.
test("periods match the Python constants", () => {
  assert.equal(FIGURE8_PERIOD, 6.32591398);
  assert.ok(Math.abs(lagrangePeriod() - 2 * Math.PI / Math.sqrt(3)) < 1e-15);
  assert.ok(Math.abs(eulerPeriod() - 2 * Math.PI / Math.sqrt(1.25)) < 1e-15);
});
