// N-body gravity engine. Pure physics: no drawing, no DOM.
// JavaScript port of engine.py; test/crosscheck.test.js checks the two agree.
//
// State is kept in flat Float64Arrays for speed: body i's position is
// pos[3*i], pos[3*i+1], pos[3*i+2] (x, y, z), and likewise for vel.

// Yoshida 4th-order coefficients: three Verlet-like sub-steps, one of them
// backwards in time, arranged so the dt^2 and dt^3 errors cancel.
const CBRT2 = 2 ** (1 / 3);
const W1 = 1 / (2 - CBRT2);
const W0 = -CBRT2 / (2 - CBRT2);
const DRIFT = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2];
const KICK = [W1, W0, W1];

/**
 * The axis along which a tidal tensor (see System.tidalTensor) stretches most,
 * as a unit vector: the eigenvector of its largest eigenvalue. Found by power
 * iteration, with T shifted by its size so every eigenvalue is positive.
 */
export function stretchAxis(T) {
  const shift = Math.sqrt(T.reduce((sum, v) => sum + v * v, 0));
  if (shift === 0) return [1, 0, 0];
  let [x, y, z] = [0.8, 0.5, 0.3]; // not along any axis a symmetric setup would pick
  for (let k = 0; k < 40; k++) {
    const nx = T[0] * x + T[1] * y + T[2] * z + shift * x;
    const ny = T[3] * x + T[4] * y + T[5] * z + shift * y;
    const nz = T[6] * x + T[7] * y + T[8] * z + shift * z;
    const size = Math.hypot(nx, ny, nz);
    [x, y, z] = [nx / size, ny / size, nz / size];
  }
  return [x, y, z];
}

export class System {
  /**
   * A set of bodies interacting through Newtonian gravity, in 3D.
   * masses: [n]; positions, velocities: [[x, y, z], ...];
   * radii: body sizes (touching = collision); omit for point masses.
   * softening: small length added to distances so close encounters
   *            don't produce infinite forces.
   * merge: what a collision does. false: the run stops (this.collision is set).
   *        true: the two bodies become one and the run goes on.
   */
  constructor({ masses, positions, velocities, radii = null, G = 1, softening = 0, merge = false }) {
    this.n = masses.length;
    this.masses = Float64Array.from(masses);
    this.pos = Float64Array.from(positions.flat());
    this.vel = Float64Array.from(velocities.flat());
    this.radii = radii ? Float64Array.from(radii) : new Float64Array(this.n);
    this.G = G;
    this.softening = softening;
    this.time = 0;
    this.collision = null; // [i, j] once two bodies have touched
    this.merge = merge;
    // Merging renumbers bodies, so each keeps the id it started with.
    this.ids = Int32Array.from({ length: this.n }, (_, i) => i);
    this.mergedInto = new Map(); // id of an absorbed body -> id that absorbed it
    this.merges = []; // {time, survivor, absorbed, position, heat}, in order
    this.heat = 0; // kinetic energy of the bodies' collisions, turned into heat
    this.internalEnergy = 0; // all energy that left the orbits; see energyBudget()
    this.spinL = [0, 0, 0]; // orbital angular momentum turned into the bodies' spin
    this._acc = new Float64Array(3 * this.n);
  }

  /** Current index of a body by its starting id; -1 if it has been absorbed. */
  indexOfId(id) {
    return this.ids.indexOf(id);
  }

  /** Current index of the body now holding id's mass (follows merges). */
  holderOf(id) {
    while (this.mergedInto.has(id)) id = this.mergedInto.get(id);
    return this.ids.indexOf(id);
  }

  /**
   * Bodies i and j become one (the heavier keeps its identity). Conserves mass,
   * momentum and volume; the merged body sits at their centre of mass. Their
   * relative kinetic energy becomes heat, and their relative angular momentum
   * becomes spin (tracked as a total, since bodies here are points).
   */
  mergeBodies(i, j) {
    const { masses, pos, vel, radii } = this;
    if (masses[j] > masses[i]) [i, j] = [j, i];
    const before = this.energy();
    const [mi, mj] = [masses[i], masses[j]];
    const M = mi + mj;
    const reduced = (mi * mj) / M;
    const d = [0, 1, 2].map((c) => pos[3 * j + c] - pos[3 * i + c]);
    const v = [0, 1, 2].map((c) => vel[3 * j + c] - vel[3 * i + c]);
    this.spinL[0] += reduced * (d[1] * v[2] - d[2] * v[1]);
    this.spinL[1] += reduced * (d[2] * v[0] - d[0] * v[2]);
    this.spinL[2] += reduced * (d[0] * v[1] - d[1] * v[0]);
    const heat = 0.5 * reduced * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    for (let c = 0; c < 3; c++) {
      pos[3 * i + c] = (mi * pos[3 * i + c] + mj * pos[3 * j + c]) / M;
      vel[3 * i + c] = (mi * vel[3 * i + c] + mj * vel[3 * j + c]) / M;
    }
    masses[i] = M;
    radii[i] = Math.cbrt(radii[i] ** 3 + radii[j] ** 3);
    const [survivor, absorbed] = [this.ids[i], this.ids[j]];
    this.mergedInto.set(absorbed, survivor);

    // Remove body j from every array.
    const without = (a, size) => {
      const out = new a.constructor(a.length - size);
      out.set(a.subarray(0, size * j));
      out.set(a.subarray(size * (j + 1)), size * j);
      return out;
    };
    this.masses = without(masses, 1);
    this.radii = without(radii, 1);
    this.ids = without(this.ids, 1);
    this.pos = without(pos, 3);
    this.vel = without(vel, 3);
    this.n -= 1;
    this._acc = new Float64Array(3 * this.n);

    this.heat += heat;
    this.internalEnergy += before - this.energy();
    const k = this.ids.indexOf(survivor);
    this.merges.push({ time: this.time, survivor, absorbed, position: this.position(k), heat });
  }

  /** Position of body i as [x, y, z]. */
  position(i) {
    return [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]];
  }

  /** Squared (softened) distance between bodies i and j. */
  _r2(i, j) {
    const dx = this.pos[3 * j] - this.pos[3 * i];
    const dy = this.pos[3 * j + 1] - this.pos[3 * i + 1];
    const dz = this.pos[3 * j + 2] - this.pos[3 * i + 2];
    return dx * dx + dy * dy + dz * dz + this.softening ** 2;
  }

  /** Gravitational acceleration of every body, written into this._acc. */
  accelerations() {
    const { n, pos, masses, G } = this;
    const acc = this._acc.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Each pair once: equal and opposite pulls (Newton's third law).
        const dx = pos[3 * j] - pos[3 * i];
        const dy = pos[3 * j + 1] - pos[3 * i + 1];
        const dz = pos[3 * j + 2] - pos[3 * i + 2];
        const r2 = dx * dx + dy * dy + dz * dz + this.softening ** 2;
        const invR3 = G / (r2 * Math.sqrt(r2));
        acc[3 * i] += masses[j] * dx * invR3;
        acc[3 * i + 1] += masses[j] * dy * invR3;
        acc[3 * i + 2] += masses[j] * dz * invR3;
        acc[3 * j] -= masses[i] * dx * invR3;
        acc[3 * j + 1] -= masses[i] * dy * invR3;
        acc[3 * j + 2] -= masses[i] * dz * invR3;
      }
    }
    return acc;
  }

  /** Advance one step with the Yoshida 4th-order symplectic integrator. */
  step(dt) {
    const { pos, vel } = this;
    for (let s = 0; s < 3; s++) {
      for (let k = 0; k < pos.length; k++) pos[k] += DRIFT[s] * dt * vel[k];
      const acc = this.accelerations();
      for (let k = 0; k < vel.length; k++) vel[k] += KICK[s] * dt * acc[k];
    }
    for (let k = 0; k < pos.length; k++) pos[k] += DRIFT[3] * dt * vel[k];
    this.time += dt;
  }

  /**
   * Shortest pairwise free-fall time sqrt(r^3 / G(mi+mj)).
   * Small when two bodies are close, so steps proportional to it
   * shrink automatically during close encounters.
   */
  timescale() {
    let best = Infinity;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const r2 = this._r2(i, j);
        best = Math.min(best, Math.sqrt(r2 ** 1.5 / (this.G * (this.masses[i] + this.masses[j]))));
      }
    }
    return best;
  }

  /** [i, j] of the two bodies whose surfaces touch or overlap most, else null. */
  touchingPair() {
    let best = Infinity;
    let pair = null;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const gap = Math.sqrt(this._r2(i, j)) - (this.radii[i] + this.radii[j]);
        if (gap < best) [best, pair] = [gap, [i, j]];
      }
    }
    return best <= 0 ? pair : null;
  }

  /** [i, j] of the closest pair. */
  _closestPair() {
    let best = Infinity;
    let pair = null;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const r2 = this._r2(i, j);
        if (r2 < best) [best, pair] = [r2, [i, j]];
      }
    }
    return pair;
  }

  /**
   * Step adaptively (dt = eta * timescale()) until time tNext, or until two
   * bodies collide (with merge on: merging them and carrying on). minScale: for
   * point masses, a timescale below this means they are about to hit (the force
   * is blowing up) and counts as a collision.
   * Returns true if the run stopped on a collision (this.collision is then set).
   * This is what a live animation calls once per screen frame.
   */
  advanceTo(tNext, eta = 0.01, minScale = 0) {
    while (this.collision === null && this.time < tNext - 1e-12) {
      const scale = this.timescale();
      let pair = this.touchingPair();
      if (pair === null && scale < minScale) pair = this._closestPair();
      if (pair !== null) {
        if (this.merge) {
          this.mergeBodies(...pair);
          continue;
        }
        this.collision = pair;
        break;
      }
      this.step(Math.min(eta * scale, tNext - this.time));
    }
    if (this.collision === null) this.time = tNext; // remove floating-point creep
    return this.collision !== null;
  }

  /**
   * Integrate to tEnd, recording the state at nSamples+1 evenly spaced times
   * (steps are shortened to land on them). Stops early on a collision; for
   * point masses that means the timescale fell below singularRatio x its
   * starting value. Same algorithm as engine.py's System.run.
   * Returns {times, positions, energies}; positions[k] is a Float64Array(3n).
   */
  run(tEnd, nSamples = 2000, eta = 0.01, singularRatio = 1e-8) {
    const times = [this.time];
    const positions = [this.pos.slice()];
    const energies = [this.energy()];
    const minScale = singularRatio * this.timescale();
    const t0 = this.time;
    for (let k = 1; k <= nSamples; k++) {
      const collided = this.advanceTo(t0 + ((tEnd - t0) * k) / nSamples, eta, minScale);
      times.push(this.time);
      positions.push(this.pos.slice());
      energies.push(this.energy());
      if (collided) break;
    }
    return { times, positions, energies };
  }

  kineticEnergy() {
    let ke = 0;
    for (let i = 0; i < this.n; i++) {
      const v = this.vel;
      ke += 0.5 * this.masses[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
    }
    return ke;
  }

  potentialEnergy() {
    let pe = 0;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        pe -= (this.G * this.masses[i] * this.masses[j]) / Math.sqrt(this._r2(i, j));
      }
    }
    return pe;
  }

  energy() {
    return this.kineticEnergy() + this.potentialEnergy();
  }

  /**
   * Energy of the orbits plus what collisions moved inside bodies. Unlike
   * energy(), which really drops at a collision, this stays constant, so its
   * drift measures numerical error alone.
   */
  energyBudget() {
    return this.energy() + this.internalEnergy;
  }

  /**
   * Tidal tensor at point (x, y, z): T such that a spot displaced by d feels
   * T*d more than the point itself, from the first `count` bodies except `skip`.
   * Returned as the 9 entries of a symmetric 3x3 matrix, row by row. A mass M at
   * distance r stretches by 2GM/r^3 along the line to it and squeezes by GM/r^3
   * across it. Use tidalTensorOn(i) for a body.
   */
  tidalTensor(x, y, z, count = this.n, skip = -1) {
    const T = new Array(9).fill(0);
    const e2 = this.softening ** 2;
    for (let j = 0; j < count; j++) {
      if (j === skip) continue;
      const d = [this.pos[3 * j] - x, this.pos[3 * j + 1] - y, this.pos[3 * j + 2] - z];
      const s2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] + e2;
      const s = Math.sqrt(s2);
      const a = (this.G * this.masses[j]) / (s2 * s);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          T[3 * row + col] += (3 * a * d[row] * d[col]) / s2 - (row === col ? a : 0);
        }
      }
    }
    return T;
  }

  /** Tidal tensor on body i from all the others. */
  tidalTensorOn(i) {
    return this.tidalTensor(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2], this.n, i);
  }

  momentum() {
    const p = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      for (let c = 0; c < 3; c++) p[c] += this.masses[i] * this.vel[3 * i + c];
    }
    return p;
  }

  /** Total L = sum m (r x v). Constant in time, until a merge moves part of it
   *  into spinL; perpendicular to the orbital plane. */
  angularMomentum() {
    const L = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      const [x, y, z] = this.position(i);
      const [vx, vy, vz] = [this.vel[3 * i], this.vel[3 * i + 1], this.vel[3 * i + 2]];
      const m = this.masses[i];
      L[0] += m * (y * vz - z * vy);
      L[1] += m * (z * vx - x * vz);
      L[2] += m * (x * vy - y * vx);
    }
    return L;
  }
}
