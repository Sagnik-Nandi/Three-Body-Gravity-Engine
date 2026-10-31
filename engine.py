"""N-body gravity engine. Pure physics: no plotting, no I/O."""
import numpy as np


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
        self._acc = self.accelerations()

    def accelerations(self):
        # d[i, j] = vector from body i to body j
        d = self.positions[None, :, :] - self.positions[:, None, :]
        r2 = (d ** 2).sum(axis=-1) + self.softening ** 2
        np.fill_diagonal(r2, np.inf)  # a body doesn't pull on itself
        inv_r3 = r2 ** -1.5
        return self.G * (d * (self.masses[None, :] * inv_r3)[:, :, None]).sum(axis=1)

    def step(self, dt):
        """Advance one step with velocity Verlet (keeps energy stable long-term)."""
        self.velocities += 0.5 * dt * self._acc
        self.positions += dt * self.velocities
        self._acc = self.accelerations()
        self.velocities += 0.5 * dt * self._acc
        self.time += dt

    def run(self, t_end, dt):
        """Step until t_end; return (times, positions) where positions is (steps+1, n, 2)."""
        steps = int(round(t_end / dt))
        times = [self.time]
        traj = [self.positions.copy()]
        for _ in range(steps):
            self.step(dt)
            times.append(self.time)
            traj.append(self.positions.copy())
        return np.array(times), np.array(traj)

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
