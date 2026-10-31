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

export class System {
  /**
   * A set of bodies interacting through Newtonian gravity, in 3D.
   * masses: [n]; positions, velocities: [[x, y, z], ...];
   * radii: body sizes (touching = collision, stops the run); omit for point masses.
   * softening: small length added to distances so close encounters
   *            don't produce infinite forces.
   */
  constructor({ masses, positions, velocities, radii = null, G = 1, softening = 0 }) {
    this.n = masses.length;
    this.masses = Float64Array.from(masses);
    this.pos = Float64Array.from(positions.flat());
    this.vel = Float64Array.from(velocities.flat());
    this.radii = radii ? Float64Array.from(radii) : new Float64Array(this.n);
    this.G = G;
    this.softening = softening;
    this.time = 0;
    this.collision = null; // [i, j] once two bodies have touched
    this._acc = new Float64Array(3 * this.n);
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
   * bodies collide. minScale: for point masses, a timescale below this means
   * they are about to hit (the force is blowing up) and counts as a collision.
   * Returns true if a collision happened (this.collision is then set).
   * This is what a live animation calls once per screen frame.
   */
  advanceTo(tNext, eta = 0.01, minScale = 0) {
    while (this.collision === null && this.time < tNext - 1e-12) {
      const scale = this.timescale();
      let pair = this.touchingPair();
      if (pair === null && scale < minScale) pair = this._closestPair();
      if (pair !== null) {
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

  momentum() {
    const p = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      for (let c = 0; c < 3; c++) p[c] += this.masses[i] * this.vel[3 * i + c];
    }
    return p;
  }

  /** Total L = sum m (r x v). Constant in time; perpendicular to the orbital plane. */
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
