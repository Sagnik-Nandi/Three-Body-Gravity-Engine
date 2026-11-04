// Bodies made of particles: contacts, conservation, and the Roche limit.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ParticleSystem, cometFlyby, cometImpact, impactOutcome, moonInOrbit, packedSphere, rubbleSystem } from "../particles.js";
import { PATTERNS, SCENARIOS, binaryFlyby, giantImpact, headOn, periodicOrbit } from "../scenarios.js";

const close = (a, b, tol, what = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b} (tol ${tol})`);

const lonePile = (n = 300) => rubbleSystem({
  bigs: [],
  moon: { n, mass: 1, radius: 1, position: [0, 0, 0], velocity: [0, 0, 0] },
});

/** Every touching pair, the slow and certain way. */
function bruteContacts(s) {
  const pairs = new Set();
  for (let i = s.nBig; i < s.n; i++) {
    for (let j = i + 1; j < s.n; j++) {
      const d = Math.hypot(s.pos[3 * j] - s.pos[3 * i], s.pos[3 * j + 1] - s.pos[3 * i + 1], s.pos[3 * j + 2] - s.pos[3 * i + 2]);
      if (d < s.radii[i] + s.radii[j]) pairs.add(`${i}-${j}`);
    }
  }
  return pairs;
}

test("packing gives about the requested count, touching but not piled up", () => {
  const { points, spacing } = packedSphere(1000, 1);
  assert.ok(points.length > 900 && points.length < 1100, `${points.length} points`);
  let nearest = Infinity;
  for (let j = 1; j < points.length; j++) {
    nearest = Math.min(nearest, Math.hypot(points[0][0] - points[j][0], points[0][1] - points[j][1], points[0][2] - points[j][2]));
  }
  close(nearest, spacing, 0.05 * spacing, "nearest neighbour");
});

test("the grid finds exactly the touching pairs, each once", () => {
  const s = moonInOrbit({ distance: 7, n: 300 });
  for (const [t, atLeast] of [[0, 500], [12, 20]]) { // a neat pile, then scattered
    s.advanceTo(t);
    const found = new Set();
    s._forEachContact((i, j) => {
      const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
      assert.ok(!found.has(key), `pair ${key} visited twice`);
      found.add(key);
    });
    assert.ok(found.size >= atLeast, `only ${found.size} contacts at t=${t}`);
    assert.deepEqual([...found].sort(), [...bruteContacts(s)].sort());
  }
});

test("contacts really stop particles passing through each other", () => {
  const two = (stiffness) => new ParticleSystem({
    nBig: 0, softening: 0.01, stiffness, damping: 0, dt: 0.001, substeps: 2,
    masses: [1, 1], radii: [0.1, 0.1], positions: [[-0.5, 0, 0], [0.5, 0, 0]],
    velocities: [[1, 0, 0], [-1, 0, 0]], G: 0,
  });
  const bounced = two(5000);
  bounced.advanceTo(1);
  assert.ok(bounced.pos[0] < bounced.pos[3], "still on their own sides");
  assert.ok(bounced.vel[0] < 0 && bounced.vel[3] > 0, "and heading back");
  close(bounced.vel[0], -1, 1e-3, "no damping: bounces at the same speed");
  const ghosts = two(0);
  ghosts.advanceTo(1);
  assert.ok(ghosts.pos[0] > ghosts.pos[3], "without contacts they pass through");
});

test("the dashpot turns a bounce's energy into heat, and only pushes", () => {
  const s = new ParticleSystem({
    nBig: 0, softening: 0.01, stiffness: 5000, damping: 20, dt: 0.0005, substeps: 2,
    masses: [1, 1], radii: [0.1, 0.1], positions: [[-0.5, 0, 0], [0.5, 0, 0]],
    velocities: [[1, 0, 0], [-1, 0, 0]], G: 0,
  });
  const e0 = s.energy();
  s.advanceTo(1);
  const speed = Math.abs(s.vel[0]);
  assert.ok(speed < 0.9 && speed > 0.1, `slower after the bounce: ${speed}`);
  assert.ok(s.heat > 0, "made heat");
  close(s.energy() + s.heat, e0, 1e-3 * e0, "energy went to heat");
  assert.ok(s.pos[0] < s.pos[3] && s.vel[0] < 0, "pushed apart, never pulled together");
});

test("a pile holds its shape under its own gravity, and settles", () => {
  const s = lonePile();
  const size = s.spread();
  const e0 = s.energy();
  s.advanceTo(20);
  close(s.spread(), size, 0.03 * size, "size"); // soft contacts: it settles a little
  assert.ok(s.kineticEnergy() < 2e-3 * Math.abs(e0), `KE ${s.kineticEnergy()}`); // soft contacts settle slowly
  close(s.energyBudget(), e0, 2e-3 * Math.abs(e0), "budget");
  const settled = s.energyBudget();
  s.advanceTo(40);
  close(s.energyBudget(), settled, 5e-4 * Math.abs(e0), "no steady heat from a pile at rest");
});

test("without contacts, a cold pile collapses", () => {
  const s = lonePile();
  const size = s.spread();
  s.stiffness = 0;
  s.damping = 0;
  s.advanceTo(1);
  assert.ok(s.spread() < 0.7 * size, `spread ${s.spread()} vs ${size}`);
});

test("momentum and angular momentum are conserved exactly through a breakup", () => {
  const s = moonInOrbit({ distance: 6, n: 300, planetRadius: 0.5 }); // nothing absorbed
  const p0 = s.momentum();
  const L0 = s.angularMomentum();
  s.advanceTo(30);
  assert.equal(s.particleCount, s.startCount);
  s.momentum().forEach((p, c) => close(p, p0[c], 1e-11, "momentum"));
  const L = s.angularMomentum();
  L.forEach((v, c) => close(v, L0[c], 1e-10 * Math.hypot(...L0), "angular momentum"));
});

test("energy balances through a breakup, once heat is counted", () => {
  const s = moonInOrbit({ distance: 6, n: 300, planetRadius: 0.5 });
  const e0 = s.energy();
  s.advanceTo(30);
  assert.ok(s.heat > 0.05, `heat ${s.heat}`);
  close(s.energyBudget(), e0, 1e-2 * Math.abs(e0), "budget");
});

test("a big body absorbs particles that touch it, conserving mass and momentum", () => {
  const s = moonInOrbit({ distance: 3.8, n: 300 }); // inner edge almost at the surface
  const mass0 = s.masses.slice(0, s.n).reduce((a, b) => a + b, 0);
  const p0 = s.momentum();
  const L0 = s.angularMomentum();
  const radius0 = s.radii[0];
  s.advanceTo(10);
  const absorbed = s.startCount - s.particleCount;
  assert.ok(absorbed > 10, `absorbed ${absorbed}`);
  close(s.masses.slice(0, s.n).reduce((a, b) => a + b, 0), mass0, 1e-10, "mass");
  s.momentum().forEach((p, c) => close(p, p0[c], 1e-10, "momentum"));
  const L = s.angularMomentum();
  L.forEach((v, c) => close(v + s.spinL[c], L0[c], 1e-9 * Math.hypot(...L0), "L + spin"));
  assert.ok(s.radii[0] > radius0, "the planet grew");
  assert.equal(new Set(s.ids.slice(0, s.n)).size, s.n, "ids stay unique");
  for (const v of s.pos.subarray(0, 3 * s.n)) assert.ok(Number.isFinite(v));
});

test("Roche limit: a moon holds far away and comes apart close in", () => {
  // Same masses as the presets, so an equal-density planet would have radius 4.
  // Theory: 1.26 x 4 = 5 for a rigid moon, 2.44 x 4 = 9.8 for a fluid one.
  const spreadAfter = (distance) => {
    const s = moonInOrbit({ distance, n: 300 });
    const size = s.spread();
    s.advanceTo(3 * 2 * Math.PI * Math.sqrt(distance ** 3 / 65));
    return s.spread() / size;
  };
  assert.ok(spreadAfter(10) < 1.1, "holds outside the fluid limit");
  assert.ok(spreadAfter(7) > 3, "comes apart between the limits");
  assert.ok(spreadAfter(5) > 3, "comes apart at the rigid limit");
});

test("a moon stays on its orbit, at the right speed", () => {
  const s = moonInOrbit({ distance: 12, n: 300 });
  const P = 2 * Math.PI * Math.sqrt(12 ** 3 / 65);
  s.advanceTo(P);
  const c = s.particleCentre();
  close(Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1]), 12, 0.2, "orbit radius");
  assert.ok(c[0] > 11 && Math.abs(c[1]) < 1.5, `one period later, back at the start: ${c}`);
});

test("a comet comes apart only if it passes close", () => {
  const after = (closest) => {
    const s = cometFlyby({ closest, start: 22, n: 300 });
    const size = s.spread();
    s.advanceTo(16);
    return s.spread() / size;
  };
  assert.ok(after(12) < 1.2, "distant pass: intact");
  assert.ok(after(4) > 3, "close pass: torn apart");
});

test("advanceBy keeps leftovers, and drops the rest when out of time", () => {
  const s = lonePile(100);
  s.advanceBy(s.dt * 0.6);
  assert.equal(s.time, 0);
  s.advanceBy(s.dt * 0.6);
  close(s.time, s.dt, 1e-12, "the two parts added up to a step");
  const t = s.time;
  s.advanceBy(s.dt * 1000, -1); // no time at all: one step, then gives up
  close(s.time, t + s.dt, 1e-12, "always makes progress");
  assert.equal(s._debt, 0);
});

// ---- presets ---------------------------------------------------------------

test("head-on preset: the planets merge, the star doesn't, the survivor orbits on", () => {
  const s = headOn();
  s.merge = true;
  s.advanceTo(SCENARIOS["head-on"].t);
  assert.equal(s.merges.length, 1);
  assert.equal(s.n, 2);
  assert.deepEqual([s.merges[0].survivor, s.merges[0].absorbed], [1, 2]);
  assert.ok(s.heat > 1);
});

test("every preset runs without NaN", () => {
  for (const [name, preset] of Object.entries(SCENARIOS)) {
    const s = preset.make();
    s.merge = true;
    assert.ok(preset.label && preset.group && preset.about, `${name} has menu text`);
    if (preset.particles) {
      assert.ok(s instanceof ParticleSystem, name);
      for (let k = 0; k < 20; k++) s.step();
    } else {
      s.advanceTo(preset.t, preset.eta, 1e-8 * s.timescale());
    }
    assert.ok(Number.isFinite(s.energyBudget()), `${name} energy`);
    for (const v of s.pos.subarray(0, 3 * s.n)) assert.ok(Number.isFinite(v), name);
  }
});

for (const [name, orbit] of Object.entries(PATTERNS)) {
  test(`${name} returns to its start after one period`, () => {
    const s = periodicOrbit(orbit);
    const start = s.pos.slice();
    s.advanceTo(orbit.T, 0.001);
    s.pos.forEach((x, k) => close(x, start[k], 1e-3, `coordinate ${k}`));
  });
}

for (const name of ["flower", "rosette"]) {
  test(`${name} is stable: it survives a nudge, keeping its size`, () => {
    const s = periodicOrbit(PATTERNS[name]);
    const clean = periodicOrbit(PATTERNS[name]);
    const reach = (sim) => Math.max(...[0, 1, 2].map((i) => Math.hypot(sim.pos[3 * i], sim.pos[3 * i + 1])));
    let size = 0;
    for (let k = 1; k <= 40; k++) { clean.advanceTo((k / 40) * PATTERNS[name].T, 0.003); size = Math.max(size, reach(clean)); }
    s.pos[0] += 1e-4;
    s.merge = true;
    const minScale = 1e-8 * s.timescale();
    for (let t = 1; t <= 100; t++) {
      s.advanceTo(t, 0.003, minScale);
      assert.equal(s.n, 3, "no collision");
      assert.ok(reach(s) < 1.3 * size, `t=${t}: reach ${reach(s)} vs ${size}`);
    }
  });
}

test("the choreography is unstable: within a few periods it has left its path", () => {
  const { choreography: orbit } = PATTERNS;
  const s = periodicOrbit(orbit);
  const start = s.pos.slice();
  s.merge = true;
  const minScale = 1e-8 * s.timescale();
  s.advanceTo(orbit.T, 0.001, minScale);
  const firstLap = Math.max(...start.map((x, k) => Math.abs(s.pos[k] - x)));
  assert.ok(firstLap < 1e-3, `closes on the first lap: ${firstLap}`);
  s.advanceTo(5 * orbit.T, 0.001, minScale);
  const later = s.n < 3 ? Infinity : Math.max(...start.map((x, k) => Math.abs(s.pos[k] - x)));
  assert.ok(later > 0.05, `gone by 5 periods: ${later}`);
});

test("binary flyby: the passing star keeps one partner and throws the other out", () => {
  const s = binaryFlyby();
  s.merge = true;
  s.advanceTo(60, 0.004);
  assert.equal(s.n, 3, "no collision");
  const d = (i, j) => Math.hypot(s.pos[3 * i] - s.pos[3 * j], s.pos[3 * i + 1] - s.pos[3 * j + 1]);
  assert.ok(d(0, 2) < 3, `new pair: distance ${d(0, 2)}`);
  assert.ok(d(1, 0) > 15 && d(1, 2) > 15, `old partner thrown out: ${d(1, 0)}`);
});

test("the comet arrives: run back from contact, it hits at the time set", () => {
  const s = cometImpact({ n: 300, massRatio: 0.1, offset: 0.7, speed: 1.2, approach: 8, orbit: 40 });
  const gap = () => {
    const [p, q] = [[0, 0, 0], [0, 0, 0]];
    const count = [0, 0];
    for (let i = s.nBig; i < s.n; i++) {
      const g = s.ids[i] >= s.cometFrom ? 1 : 0;
      count[g]++;
      for (let k = 0; k < 3; k++) (g ? q : p)[k] += s.pos[3 * i + k];
    }
    return Math.hypot(...[0, 1, 2].map((k) => p[k] / count[0] - q[k] / count[1]));
  };
  const contact = 1 + Math.cbrt(0.1);
  assert.ok(gap() > 3 * contact, `starts far off: ${gap()}`);
  s.advanceTo(8);
  close(gap(), contact, 0.1, "touching at t = 8");
});

test("an impact conserves momentum and angular momentum exactly", () => {
  const s = cometImpact({ n: 300, massRatio: 0.3, offset: 0.7, speed: 1.1, orbit: 40 });
  const p0 = s.momentum();
  const L0 = s.angularMomentum();
  const size = Math.hypot(...L0);
  s.advanceTo(15);
  assert.equal(s.particleCount, s.startCount, "nothing reached the Sun");
  s.momentum().forEach((p, c) => close(p, p0[c], 1e-10, "momentum"));
  s.angularMomentum().forEach((L, c) => close(L, L0[c], 1e-10 * size, "angular momentum"));
  assert.ok(s.heat > 0.01, `the crash made heat: ${s.heat}`);
});

test("impact outcome: sorts rocks into the planet, in orbit, falling back and escaping", () => {
  const s = cometImpact({ n: 300, massRatio: 0.1, orbit: 400 });
  // Move the comet's rocks by hand; the planet is centred where it is.
  const c = s.planetCentre();
  const rocks = [];
  for (let i = s.nBig; i < s.n; i++) if (s.ids[i] >= s.cometFrom) rocks.push(i);
  let vx = 0, vy = 0, count = 0;
  for (let i = s.nBig; i < s.n; i++) if (s.ids[i] < s.cometFrom) { vx += s.vel[3 * i]; vy += s.vel[3 * i + 1]; count++; }
  [vx, vy] = [vx / count, vy / count];
  const place = (i, r, along, across) => {
    s.pos.set([c[0] + r, c[1], c[2]], 3 * i);
    s.vel.set([vx + along, vy + across, 0], 3 * i);
  };
  const [orbiter, faller, escaper] = rocks;
  place(orbiter, 3, 0, Math.sqrt(1 / 3)); // circular
  place(faller, 3, 0, 0); // straight down
  place(escaper, 3, 0, 2);
  for (const [k, i] of rocks.slice(3).entries()) place(i, 40 + k, 0, 5); // out of the way, leaving
  const o = impactOutcome(s);
  assert.equal(o.orbiting, 1);
  assert.equal(o.falling, 1);
  assert.equal(o.escaped, rocks.length - 2);
  assert.equal(o.clump, 1);
});

test("giant impact preset: a moon forms in orbit, then doesn't last", () => {
  const s = giantImpact();
  s.advanceTo(45);
  const moon = impactOutcome(s);
  assert.ok(moon.clump >= 30, `clump of ${moon.clump}`);
  assert.ok(moon.rMedian > 1.6, `off the surface: ${moon.rMedian}`);
  assert.equal(s.particleCount, s.startCount, "none in the Sun");
  s.advanceTo(120);
  const later = impactOutcome(s);
  assert.ok(later.clump < moon.clump / 3, `gone by t = 120: clump of ${later.clump}`);
});
