// Bodies made of particles: a rubble pile held together only by its own
// gravity, with contact forces so the particles can't pass through each other.
// Tides need no code of their own here: they come from the outer particles
// feeling a big body's gravity differently from the inner ones.
//
// The method suits many particles rather than a few bodies:
// - softened gravity between particles, since each stands for a chunk of rock;
// - a fixed step, because the adaptive one stalls on any single close pair;
// - leapfrog, which needs one gravity calculation per step instead of three;
// - two speeds: contacts and big-body gravity change fast and are cheap, while
//   gravity between particles changes slowly and costs N^2, so it runs once
//   per `substeps` of the rest.
import { System } from "./engine.js";

/** How far particles may overlap under the body's own weight, as a fraction of their radius. */
const MAX_OVERLAP = 0.05;
const STEPS_PER_CONTACT = 16; // substeps during one bounce between two particles
const SUBSTEPS = 8; // contact substeps per gravity calculation
const CLEAR_OF_PLANET = 1.6; // rocks nearer than this, in planet radii, may be its bulge
const DAMPING_RATIO = 0.3; // how much of a bounce's energy goes to heat

/** A cell and half of its 26 neighbours, so each neighbouring pair is seen once. Own cell first. */
const HALF_STENCIL = (() => {
  const out = [0, 0, 0];
  for (let z = -1; z <= 1; z++) {
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        if (z > 0 || (z === 0 && (y > 0 || (y === 0 && x > 0)))) out.push(x, y, z);
      }
    }
  }
  return out;
})();

const cellHash = (x, y, z) =>
  Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);

export class ParticleSystem extends System {
  /**
   * The first nBig bodies are big: single points with a surface. The rest are
   * particles of radius radii[i], which contact each other, and which a big
   * body absorbs on touching it.
   * softening: gravity softening length between particles.
   * stiffness, damping: of the contact spring and dashpot.
   * stillSpeed: the dashpot ignores slower relative motion (see _contactForces).
   * dt: step for gravity between particles; substeps: steps of the rest in each.
   */
  constructor({ nBig, softening, stiffness, damping, stillSpeed = 0, dt, substeps = SUBSTEPS, ...bodies }) {
    super(bodies);
    this.nBig = nBig;
    this.particleSoftening = softening;
    this.stiffness = stiffness;
    this.damping = damping;
    this.stillSpeed = stillSpeed;
    this.dt = dt;
    this.substeps = substeps;
    this.startCount = this.n - nBig;
    this.cellSize = 2 * (this.n > nBig ? this.radii[nBig] : 1);
    this._slow = new Float64Array(3 * this.n); // acceleration from gravity between particles
    this._slowReady = false;
    this._debt = 0; // simulation time asked for by advanceBy, not yet stepped
    this._hits = []; // [big, particle] pairs touching, absorbed after the substep
    // Hash grid for finding touching particles without testing every pair.
    const size = 2 ** Math.ceil(Math.log2(Math.max(this.n, 1) * 2));
    this._head = new Int32Array(size);
    this._next = new Int32Array(this.n);
    this._cell = new Int32Array(3 * this.n);
  }

  get particleCount() {
    return this.n - this.nBig;
  }

  /** Gravity between particles only, softened. */
  _selfGravity() {
    const { n, nBig, pos, masses, G } = this;
    const a = this._slow.fill(0);
    const e2 = this.particleSoftening ** 2;
    for (let i = nBig; i < n; i++) {
      const xi = pos[3 * i];
      const yi = pos[3 * i + 1];
      const zi = pos[3 * i + 2];
      const mi = masses[i];
      let ax = a[3 * i];
      let ay = a[3 * i + 1];
      let az = a[3 * i + 2];
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * j] - xi;
        const dy = pos[3 * j + 1] - yi;
        const dz = pos[3 * j + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + e2;
        const f = G / (r2 * Math.sqrt(r2));
        const fj = masses[j] * f;
        ax += fj * dx;
        ay += fj * dy;
        az += fj * dz;
        const fi = mi * f;
        a[3 * j] -= fi * dx;
        a[3 * j + 1] -= fi * dy;
        a[3 * j + 2] -= fi * dz;
      }
      a[3 * i] = ax;
      a[3 * i + 1] = ay;
      a[3 * i + 2] = az;
    }
  }

  /** Gravity of the big bodies on everything; notes particles touching a big body. */
  _bigGravity(acc) {
    const { n, nBig, pos, masses, radii, G } = this;
    for (let b = 0; b < nBig; b++) {
      for (let j = b + 1; j < n; j++) {
        const dx = pos[3 * j] - pos[3 * b];
        const dy = pos[3 * j + 1] - pos[3 * b + 1];
        const dz = pos[3 * j + 2] - pos[3 * b + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (j >= nBig && r2 < (radii[b] + radii[j]) ** 2) this._hits.push([b, j]);
        const f = G / (r2 * Math.sqrt(r2));
        acc[3 * b] += masses[j] * f * dx;
        acc[3 * b + 1] += masses[j] * f * dy;
        acc[3 * b + 2] += masses[j] * f * dz;
        acc[3 * j] -= masses[b] * f * dx;
        acc[3 * j + 1] -= masses[b] * f * dy;
        acc[3 * j + 2] -= masses[b] * f * dz;
      }
    }
  }

  /** Sort the particles into hash-grid cells. */
  _buildGrid() {
    const { n, nBig, pos, cellSize, _cell: cell, _next: next } = this;
    const head = this._head.fill(-1);
    const mask = head.length - 1;
    for (let i = nBig; i < n; i++) {
      const cx = Math.floor(pos[3 * i] / cellSize);
      const cy = Math.floor(pos[3 * i + 1] / cellSize);
      const cz = Math.floor(pos[3 * i + 2] / cellSize);
      cell[3 * i] = cx;
      cell[3 * i + 1] = cy;
      cell[3 * i + 2] = cz;
      const h = cellHash(cx, cy, cz) & mask;
      next[i] = head[h];
      head[h] = i;
    }
  }

  /** Call visit(i, j, dx, dy, dz, r, reach) once for each pair of touching particles. */
  _forEachContact(visit) {
    this._buildGrid();
    const { n, nBig, pos, radii, _head: head, _next: next, _cell: cell } = this;
    const mask = head.length - 1;
    for (let i = nBig; i < n; i++) {
      const cx = cell[3 * i];
      const cy = cell[3 * i + 1];
      const cz = cell[3 * i + 2];
      for (let s = 0; s < HALF_STENCIL.length; s += 3) {
        const nx = cx + HALF_STENCIL[s];
        const ny = cy + HALF_STENCIL[s + 1];
        const nz = cz + HALF_STENCIL[s + 2];
        for (let j = head[cellHash(nx, ny, nz) & mask]; j !== -1; j = next[j]) {
          if (s === 0 && j <= i) continue; // within a cell, each pair once
          // Different cells can share a bucket: check it's really that cell.
          if (cell[3 * j] !== nx || cell[3 * j + 1] !== ny || cell[3 * j + 2] !== nz) continue;
          const dx = pos[3 * j] - pos[3 * i];
          const dy = pos[3 * j + 1] - pos[3 * i + 1];
          const dz = pos[3 * j + 2] - pos[3 * i + 2];
          const reach = radii[i] + radii[j];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < reach * reach && r2 > 0) visit(i, j, dx, dy, dz, Math.sqrt(r2), reach);
        }
      }
    }
  }

  /**
   * Spring and dashpot along the line between touching particles: only ever
   * pushes apart, and acts along the line of centres, so momentum and angular
   * momentum are conserved exactly. Energy the dashpot takes becomes heat.
   *
   * Gravity between particles arrives as a kick once per step, which leaves
   * neighbours with a tiny sawtooth in their relative speed even in a pile at
   * rest. The dashpot ignores motion that small (stillSpeed): otherwise it would
   * endlessly count that sawtooth as heat, though the pile's energy isn't changing.
   */
  _contactForces(acc, h) {
    const { vel, masses, stiffness: k, damping: c, stillSpeed } = this;
    this._forEachContact((i, j, dx, dy, dz, r, reach) => {
      const nx = dx / r;
      const ny = dy / r;
      const nz = dz / r;
      let vn = (vel[3 * j] - vel[3 * i]) * nx + (vel[3 * j + 1] - vel[3 * i + 1]) * ny
        + (vel[3 * j + 2] - vel[3 * i + 2]) * nz;
      if (Math.abs(vn) < stillSpeed) vn = 0;
      const spring = k * (reach - r);
      const force = Math.max(spring - c * vn, 0);
      const ai = force / masses[i];
      const aj = force / masses[j];
      // Work done against the dashpot, with the speed halfway through this kick.
      const lost = (spring - force) * (vn + 0.5 * h * (ai + aj)) * h;
      this.internalEnergy += lost;
      this.heat += lost;
      acc[3 * i] -= ai * nx;
      acc[3 * i + 1] -= ai * ny;
      acc[3 * i + 2] -= ai * nz;
      acc[3 * j] += aj * nx;
      acc[3 * j + 1] += aj * ny;
      acc[3 * j + 2] += aj * nz;
    });
  }

  /** One leapfrog substep of contacts and big-body gravity. */
  _substep(h) {
    const { pos, vel, n } = this;
    const count = 3 * n;
    for (let k = 0; k < count; k++) pos[k] += 0.5 * h * vel[k];
    const acc = this._acc.fill(0);
    this._bigGravity(acc);
    this._contactForces(acc, h);
    for (let k = 0; k < count; k++) {
      vel[k] += h * acc[k];
      pos[k] += 0.5 * h * vel[k];
    }
    if (this._hits.length) this._absorbHits();
  }

  /** One full step: half a kick of slow gravity, the fast substeps, half a kick. */
  step() {
    if (!this._slowReady) this._selfGravity();
    this._slowReady = true;
    const half = 0.5 * this.dt;
    const kick = () => {
      const { vel, _slow: a, n } = this;
      for (let k = 0; k < 3 * n; k++) vel[k] += half * a[k];
    };
    kick();
    for (let s = 0; s < this.substeps; s++) this._substep(this.dt / this.substeps);
    this._selfGravity(); // reused for the first half-kick of the next step
    kick();
    this.time += this.dt;
  }

  /** Step until at least tNext. */
  advanceTo(tNext) {
    while (this.time < tNext - 1e-12) this.step();
    return false;
  }

  /**
   * Advance by simDt, for a live view: leftovers smaller than a step carry over
   * to the next call, and if stepping takes over maxMs the rest is dropped, so a
   * slow machine gets a slower simulation rather than a frozen page.
   */
  advanceBy(simDt, maxMs = Infinity) {
    this._debt += simDt;
    const start = performance.now();
    while (this._debt >= this.dt) {
      this.step();
      this._debt -= this.dt;
      if (performance.now() - start > maxMs) {
        this._debt = 0;
        break;
      }
    }
  }

  /** Particles that touched a big body become part of it. Conserves mass and momentum. */
  _absorbHits() {
    const before = this.energy();
    const seen = new Set();
    // From the highest index down, so filling a gap with the last particle
    // can't move one that's still waiting to be absorbed.
    this._hits.sort((a, b) => b[1] - a[1]);
    for (const [b, i] of this._hits) {
      if (seen.has(i)) continue; // touching two big bodies: the first takes it
      seen.add(i);
      this._absorb(b, i);
    }
    this._hits.length = 0;
    this.internalEnergy += before - this.energy();
  }

  _absorb(b, i) {
    const { masses, pos, vel, radii, ids } = this;
    const mb = masses[b];
    const mi = masses[i];
    const M = mb + mi;
    const reduced = (mb * mi) / M;
    const d = [0, 1, 2].map((c) => pos[3 * i + c] - pos[3 * b + c]);
    const v = [0, 1, 2].map((c) => vel[3 * i + c] - vel[3 * b + c]);
    this.spinL[0] += reduced * (d[1] * v[2] - d[2] * v[1]);
    this.spinL[1] += reduced * (d[2] * v[0] - d[0] * v[2]);
    this.spinL[2] += reduced * (d[0] * v[1] - d[1] * v[0]);
    this.heat += 0.5 * reduced * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    for (let c = 0; c < 3; c++) {
      pos[3 * b + c] = (mb * pos[3 * b + c] + mi * pos[3 * i + c]) / M;
      vel[3 * b + c] = (mb * vel[3 * b + c] + mi * vel[3 * i + c]) / M;
    }
    masses[b] = M;
    radii[b] = Math.cbrt(radii[b] ** 3 + radii[i] ** 3);
    this.mergedInto.set(ids[i], ids[b]);
    // Fill the gap with the last particle.
    const last = this.n - 1;
    masses[i] = masses[last];
    radii[i] = radii[last];
    ids[i] = ids[last];
    ids[last] = -1;
    for (let c = 0; c < 3; c++) {
      pos[3 * i + c] = pos[3 * last + c];
      vel[3 * i + c] = vel[3 * last + c];
    }
    this.n = last;
  }

  /** Gravity, softened between particles, plus the energy stored in squeezed contacts. */
  potentialEnergy() {
    const { n, nBig, pos, masses, G } = this;
    const e2 = this.particleSoftening ** 2;
    let pe = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * j] - pos[3 * i];
        const dy = pos[3 * j + 1] - pos[3 * i + 1];
        const dz = pos[3 * j + 2] - pos[3 * i + 2];
        const r2 = dx * dx + dy * dy + dz * dz + (i >= nBig ? e2 : 0);
        pe -= (G * masses[i] * masses[j]) / Math.sqrt(r2);
      }
    }
    this._forEachContact((i, j, dx, dy, dz, r, reach) => {
      pe += 0.5 * this.stiffness * (reach - r) ** 2;
    });
    return pe;
  }

  /** Centre of mass of the particles, as [x, y, z]. */
  particleCentre() {
    const c = [0, 0, 0];
    let M = 0;
    for (let i = this.nBig; i < this.n; i++) {
      M += this.masses[i];
      for (let k = 0; k < 3; k++) c[k] += this.masses[i] * this.pos[3 * i + k];
    }
    return M > 0 ? c.map((x) => x / M) : c;
  }

  /** Centre of the rocks that started in the planet, in an impact. */
  planetCentre() {
    const c = [0, 0, 0];
    let count = 0;
    for (let i = this.nBig; i < this.n; i++) {
      if (this.ids[i] < this.cometFrom) {
        count++;
        for (let k = 0; k < 3; k++) c[k] += this.pos[3 * i + k];
      }
    }
    return c.map((x) => x / (count || 1));
  }

  /** Root-mean-square distance of the particles from their centre: how spread out they are. */
  spread() {
    const c = this.particleCentre();
    let sum = 0;
    for (let i = this.nBig; i < this.n; i++) {
      for (let k = 0; k < 3; k++) sum += (this.pos[3 * i + k] - c[k]) ** 2;
    }
    return Math.sqrt(sum / Math.max(this.particleCount, 1));
  }
}

/**
 * Points of a slightly shaken close-packed lattice filling a sphere, about n of
 * them. Returns {points, spacing}; the points touch when particles have a
 * radius of spacing / 2. Shaken so the pile isn't a perfect, rigid crystal.
 */
export function packedSphere(n, radius, seed = 1) {
  // Close packing has one point per spacing^3 / sqrt(2).
  const spacing = radius * Math.cbrt(((4 / 3) * Math.PI * Math.SQRT2) / n);
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shake = () => 0.02 * spacing * (random() - 0.5);
  const points = [];
  const m = Math.ceil(radius / spacing) + 2;
  const dy = (spacing * Math.sqrt(3)) / 2;
  const dz = spacing * Math.sqrt(2 / 3);
  for (let k = -m; k <= m; k++) {
    for (let j = -m; j <= m; j++) {
      for (let i = -m; i <= m; i++) {
        const x = spacing * (i + (j & 1) / 2 + (k & 1) / 2);
        const y = dy * (j + (k & 1) / 3);
        const z = dz * k;
        if (x * x + y * y + z * z <= radius * radius) {
          points.push([x + shake(), y + shake(), z + shake()]);
        }
      }
    }
  }
  return { points, spacing };
}

/**
 * A rubble-pile moon plus big bodies, in the centre-of-mass frame.
 * bigs: [{mass, radius, position, velocity}].
 * moon: {n, mass, radius, position, velocity, spin (radians per time, about z)}.
 * The contact stiffness comes from the moon's own weight, so it barely
 * squashes (MAX_OVERLAP), and the time step from the stiffness.
 */
export function rubbleSystem({ bigs, moon, G = 1 }) {
  const { points, spacing } = packedSphere(moon.n, moon.radius);
  const a = spacing / 2;
  const m = moon.mass / points.length;
  // Pressure at the centre of a uniform ball, over the area one particle fills.
  const pressure = ((3 / (8 * Math.PI)) * G * moon.mass ** 2) / moon.radius ** 4;
  const stiffness = (pressure * 4 * a * a) / (MAX_OVERLAP * a);
  const reduced = m / 2;
  const contactTime = Math.PI * Math.sqrt(reduced / stiffness);
  const damping = 2 * DAMPING_RATIO * Math.sqrt(stiffness * reduced);
  const dt = SUBSTEPS * (contactTime / STEPS_PER_CONTACT);
  // Twice the difference one gravity kick makes between neighbouring particles.
  const stillSpeed = 2 * ((G * moon.mass) / moon.radius ** 2) * dt * ((2 * a) / moon.radius);

  const masses = bigs.map((b) => b.mass);
  const radii = bigs.map((b) => b.radius);
  const positions = bigs.map((b) => [...b.position]);
  const velocities = bigs.map((b) => [...b.velocity]);
  const spin = moon.spin ?? 0;
  for (const [x, y, z] of points) {
    masses.push(m);
    radii.push(a);
    positions.push([moon.position[0] + x, moon.position[1] + y, moon.position[2] + z]);
    velocities.push([moon.velocity[0] - spin * y, moon.velocity[1] + spin * x, moon.velocity[2]]);
  }
  const M = masses.reduce((s, v) => s + v, 0);
  for (const vectors of [positions, velocities]) {
    for (let c = 0; c < 3; c++) {
      const mean = vectors.reduce((s, v, i) => s + masses[i] * v[c], 0) / M;
      for (const v of vectors) v[c] -= mean;
    }
  }
  return new ParticleSystem({
    masses, positions, velocities, radii, G,
    nBig: bigs.length,
    softening: a,
    stiffness,
    damping,
    stillSpeed,
    dt,
    substeps: SUBSTEPS,
  });
}

/**
 * A moon on a circular orbit of radius `distance` around a planet, turning once
 * per orbit (tidally locked), as moons really do.
 */
export function moonInOrbit({ distance, planetMass = 64, planetRadius = 2.5, moonMass = 1, moonRadius = 1, n = 1000, G = 1 }) {
  const speed = Math.sqrt((G * (planetMass + moonMass)) / distance);
  return rubbleSystem({
    G,
    bigs: [{ mass: planetMass, radius: planetRadius, position: [0, 0, 0], velocity: [0, 0, 0] }],
    moon: { n, mass: moonMass, radius: moonRadius, position: [distance, 0, 0],
      velocity: [0, speed, 0], spin: speed / distance },
  });
}

/**
 * A rubble-pile comet falling past a planet on a parabola, closest approach
 * `closest`, starting `start` away from the planet on the way in.
 */
export function cometFlyby({ closest, start, planetMass = 64, planetRadius = 2.5, cometMass = 1, cometRadius = 1, n = 1000, G = 1 }) {
  const mu = G * (planetMass + cometMass);
  // Parabola r = 2q / (1 + cos f): find where it is `start` away, inbound.
  const f = -Math.acos((2 * closest) / start - 1);
  const speed = Math.sqrt((2 * mu) / start);
  const h = Math.sqrt(2 * mu * closest); // angular momentum per mass
  const radial = (mu / h) * Math.sin(f); // negative: falling in
  const across = h / start;
  const [c, s] = [Math.cos(f), Math.sin(f)];
  return rubbleSystem({
    G,
    bigs: [{ mass: planetMass, radius: planetRadius, position: [0, 0, 0], velocity: [0, 0, 0] }],
    moon: { n, mass: cometMass, radius: cometRadius,
      position: [start * c, start * s, 0],
      velocity: [radial * c - across * s, radial * s + across * c, 0] },
  });
}

/**
 * A Sun (a single point with a surface), a rubble-pile planet orbiting it, and a
 * rubble-pile comet from outside the system that hits the planet.
 * n: rocks in total. massRatio: comet's mass / planet's mass.
 * speed: relative speed at contact, as a multiple of their mutual escape speed.
 * offset: impact parameter at contact, 0 head-on, 1 a grazing hit.
 * approach: how long before contact the run starts. The contact is set first and
 * the three bodies are run backwards from it, so the comet really does arrive.
 * closest: instead of offset, the distance between centres at the closest point of
 * the path; just over the sum of their radii is a near miss, and speed is then
 * measured there. A grazing pass lets tides tear the comet up.
 * spin: the planet's spin (radians per time, about z), 1 being about where a same-size
 * planet of mass 1 would fly apart.
 */
export function cometImpact({ n = 1000, massRatio = 0.1, speed = 1.2, offset = 0.7, angle = 2.4, approach = 8, spin = 0, closest = null,
  sunMass = 30, orbit = 15, planetMass = 1, planetRadius = 1, dampingRatio = DAMPING_RATIO, G = 1 }) {
  const fraction = massRatio / (1 + massRatio);
  const { points: planet, spacing } = packedSphere(Math.round(n * (1 - fraction)), planetRadius);
  const cometRadius = planetRadius * Math.cbrt(massRatio);
  const { points: comet } = packedSphere(Math.round(n * fraction), cometRadius, 2);
  const a = spacing / 2;
  const m = planetMass / planet.length;
  const cometMass = m * comet.length;

  const pressure = ((3 / (8 * Math.PI)) * G * planetMass ** 2) / planetRadius ** 4;
  const stiffness = (pressure * 4 * a * a) / (MAX_OVERLAP * a);
  const reduced = m / 2;
  const contactTime = Math.PI * Math.sqrt(reduced / stiffness);
  const damping = 2 * dampingRatio * Math.sqrt(stiffness * reduced);
  const dt = SUBSTEPS * (contactTime / STEPS_PER_CONTACT);
  const stillSpeed = 2 * ((G * planetMass) / planetRadius ** 2) * dt * ((2 * a) / planetRadius);

  // The moment of contact, with the planet on a circular orbit.
  const contact = closest ?? planetRadius + cometRadius;
  const vContact = speed * Math.sqrt((2 * G * (planetMass + cometMass)) / contact);
  const vOrbit = Math.sqrt((G * (sunMass + planetMass)) / orbit);
  const [cx, cy] = [Math.cos(angle), Math.sin(angle)]; // where on the planet it lands
  const across = closest === null ? offset : 1; // at the closest point, it's all sideways
  const radial = -Math.sqrt(1 - across ** 2); // towards the planet
  const contactState = {
    masses: [sunMass, planetMass, cometMass],
    positions: [[0, 0, 0], [orbit, 0, 0], [orbit + contact * cx, contact * cy, 0]],
    velocities: [[0, 0, 0], [0, vOrbit, 0],
      [vContact * (radial * cx - across * cy), vOrbit + vContact * (radial * cy + across * cx), 0]],
  };
  // Back to the start: flip the velocities, run forward, flip them again.
  const back = new System({ ...contactState, G,
    velocities: contactState.velocities.map(([x, y, z]) => [-x, -y, -z]) });
  back.advanceTo(approach, 0.002);
  const at = (i) => ({ p: back.position(i), v: [-back.vel[3 * i], -back.vel[3 * i + 1], -back.vel[3 * i + 2]] });
  const [sunStart, planetStart, cometStart] = [at(0), at(1), at(2)];

  const masses = [sunMass];
  const radii = [planetRadius * Math.cbrt(sunMass / planetMass)];
  const positions = [sunStart.p];
  const velocities = [sunStart.v];
  const addRocks = (points, { p, v }, turn = 0) => {
    for (const [x, y, z] of points) {
      masses.push(m);
      radii.push(a);
      positions.push([p[0] + x, p[1] + y, p[2] + z]);
      velocities.push([v[0] - turn * y, v[1] + turn * x, v[2]]);
    }
  };
  addRocks(planet, planetStart, spin);
  addRocks(comet, cometStart);
  const M = masses.reduce((sum, v) => sum + v, 0);
  for (const vectors of [positions, velocities]) {
    for (let c = 0; c < 3; c++) {
      const mean = vectors.reduce((sum, v, i) => sum + masses[i] * v[c], 0) / M;
      for (const v of vectors) v[c] -= mean;
    }
  }
  const sim = new ParticleSystem({ masses, positions, velocities, radii, G, nBig: 1,
    softening: a, stiffness, damping, stillSpeed, dt, substeps: SUBSTEPS });
  sim.cometFrom = 1 + planet.length; // rocks with this id or higher began in the comet
  sim.planetRadius = planetRadius;
  sim.hillRadius = orbit * Math.cbrt(planetMass / (3 * sunMass)); // beyond this, the Sun wins
  return sim;
}

/**
 * What an impact left behind. The planet is the dense core, found by repeatedly
 * averaging the rocks near the centre of those that started in it. Every other
 * rock's orbit around the core is then: escaping (unbound, or reaching so far the
 * Sun would take it), falling back (the orbit dips below the surface), or truly in
 * orbit, which also means clear of the planet right now, since a spinning planet
 * bulges and its surface rocks would otherwise count.
 * clump: the most rocks in one touching cluster in orbit (a forming moon).
 */
export function impactOutcome(sim) {
  const { n, nBig, pos, vel, masses, G } = sim;
  let c = sim.planetCentre();
  let keep = [];
  for (let pass = 0; pass < 8; pass++) {
    keep = [];
    for (let i = nBig; i < n; i++) {
      if (Math.hypot(pos[3 * i] - c[0], pos[3 * i + 1] - c[1], pos[3 * i + 2] - c[2]) < 1.3 * sim.planetRadius) keep.push(i);
    }
    if (!keep.length) break;
    const next = [0, 0, 0];
    for (const i of keep) for (let k = 0; k < 3; k++) next[k] += pos[3 * i + k] / keep.length;
    c = next;
  }
  const v = [0, 0, 0];
  let M = 0;
  for (const i of keep) {
    M += masses[i];
    for (let k = 0; k < 3; k++) v[k] += masses[i] * vel[3 * i + k];
  }
  for (let k = 0; k < 3; k++) v[k] /= M || 1;
  const inCore = new Set(keep);
  const surface = 1.1 * sim.planetRadius;
  const orbiting = [];
  const distances = [];
  let escaped = 0;
  let falling = 0;
  for (let i = nBig; i < n; i++) {
    if (inCore.has(i)) continue;
    const d = [0, 1, 2].map((k) => pos[3 * i + k] - c[k]);
    const u = [0, 1, 2].map((k) => vel[3 * i + k] - v[k]);
    const r = Math.hypot(...d);
    const energy = 0.5 * (u[0] ** 2 + u[1] ** 2 + u[2] ** 2) - (G * M) / r;
    if (energy >= 0) { escaped++; continue; }
    const h = Math.hypot(d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]);
    const semi = (-G * M) / (2 * energy);
    const e = Math.sqrt(Math.max(1 - (h * h) / (G * M * semi), 0));
    if (semi * (1 + e) > sim.hillRadius) escaped++;
    else if (semi * (1 - e) < surface) falling++;
    else if (r < CLEAR_OF_PLANET * sim.planetRadius) falling++;
    else { orbiting.push(i); distances.push(r); }
  }
  const parent = new Map(orbiting.map((i) => [i, i]));
  const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
  const reach = 2.6 * sim.radii[nBig];
  for (let p = 0; p < orbiting.length; p++) {
    for (let q = p + 1; q < orbiting.length; q++) {
      const [i, j] = [orbiting[p], orbiting[q]];
      if (Math.hypot(pos[3 * i] - pos[3 * j], pos[3 * i + 1] - pos[3 * j + 1], pos[3 * i + 2] - pos[3 * j + 2]) < reach) parent.set(find(i), find(j));
    }
  }
  const sizes = new Map();
  for (const i of orbiting) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  distances.sort((p, q) => p - q);
  return { core: keep.length, orbiting: orbiting.length, escaped, falling, clump: Math.max(0, ...sizes.values()),
    rMedian: distances[Math.floor(distances.length / 2)] ?? 0, rMax: distances.at(-1) ?? 0 };
}
