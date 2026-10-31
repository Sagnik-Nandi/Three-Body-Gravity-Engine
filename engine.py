"""N-body gravity engine. Pure physics: no plotting, no I/O."""
import numpy as np

# Yoshida 4th-order coefficients: three Verlet-like sub-steps, one of them
# backwards in time, arranged so the dt^2 and dt^3 errors cancel.
_CBRT2 = 2 ** (1 / 3)
_W1 = 1 / (2 - _CBRT2)
_W0 = -_CBRT2 / (2 - _CBRT2)
_DRIFT = (_W1 / 2, (_W0 + _W1) / 2, (_W0 + _W1) / 2, _W1 / 2)
_KICK = (_W1, _W0, _W1)


class System:
    """A set of point masses interacting through Newtonian gravity (2D).

    positions, velocities: arrays of shape (n, 2)
    masses: array of shape (n,)
    softening: small length added to distances so close encounters
               don't produce infinite forces.
    """

    def __init__(self, masses, positions, velocities, G=1.0, softening=0.0):
        self.masses = np.asarray(masses, dtype=float)
        self.positions = np.asarray(positions, dtype=float).copy()
        self.velocities = np.asarray(velocities, dtype=float).copy()
        self.G = G
        self.softening = softening
        self.time = 0.0

    def accelerations(self):
        # d[i, j] = vector from body i to body j
        d = self.positions[None, :, :] - self.positions[:, None, :]
        r2 = (d ** 2).sum(axis=-1) + self.softening ** 2
        np.fill_diagonal(r2, np.inf)  # a body doesn't pull on itself
        inv_r3 = r2 ** -1.5
        return self.G * (d * (self.masses[None, :] * inv_r3)[:, :, None]).sum(axis=1)

    def step(self, dt):
        """Advance one step with the Yoshida 4th-order symplectic integrator."""
        for drift, kick in zip(_DRIFT, _KICK):
            self.positions += drift * dt * self.velocities
            self.velocities += kick * dt * self.accelerations()
        self.positions += _DRIFT[3] * dt * self.velocities
        self.time += dt

    def timescale(self):
        """Shortest pairwise free-fall time sqrt(r^3 / G(mi+mj)).

        Small when two bodies are close, so steps proportional to it
        shrink automatically during close encounters.
        """
        d = self.positions[None, :, :] - self.positions[:, None, :]
        r2 = (d ** 2).sum(axis=-1) + self.softening ** 2
        np.fill_diagonal(r2, np.inf)
        m = self.masses[None, :] + self.masses[:, None]
        return np.sqrt(r2 ** 1.5 / (self.G * m)).min()

    def run(self, t_end, n_samples=2000, eta=0.01):
        """Integrate to t_end with adaptive steps dt = eta * timescale().

        Smaller eta = more accurate and slower. Records the state at
        n_samples+1 evenly spaced times (steps are shortened to land on them).
        Returns (times, positions, energies); positions has shape (n_samples+1, n, 2).
        """
        times = np.linspace(self.time, t_end, n_samples + 1)
        traj = [self.positions.copy()]
        energies = [self.energy()]
        for t_next in times[1:]:
            while self.time < t_next - 1e-12:
                self.step(min(eta * self.timescale(), t_next - self.time))
            self.time = t_next  # remove floating-point creep
            traj.append(self.positions.copy())
            energies.append(self.energy())
        return times, np.array(traj), np.array(energies)

    def kinetic_energy(self):
        return 0.5 * (self.masses * (self.velocities ** 2).sum(axis=1)).sum()

    def potential_energy(self):
        pe = 0.0
        n = len(self.masses)
        for i in range(n):
            for j in range(i + 1, n):
                r = np.sqrt(((self.positions[j] - self.positions[i]) ** 2).sum()
                            + self.softening ** 2)
                pe -= self.G * self.masses[i] * self.masses[j] / r
        return pe

    def energy(self):
        return self.kinetic_energy() + self.potential_energy()

    def momentum(self):
        return (self.masses[:, None] * self.velocities).sum(axis=0)


def two_body(m1, m2, separation, speed_factor=1.0, G=1.0):
    """Two bodies orbiting their common centre of mass (placed at the origin).

    speed_factor = 1        -> circular orbit
    0 < speed_factor < 1    -> ellipse
    speed_factor >= sqrt(2) -> escape (bodies fly apart)
    """
    M = m1 + m2
    v_rel = speed_factor * np.sqrt(G * M / separation)
    positions = [[-separation * m2 / M, 0.0], [separation * m1 / M, 0.0]]
    velocities = [[0.0, -v_rel * m2 / M], [0.0, v_rel * m1 / M]]
    return System([m1, m2], positions, velocities, G=G)
