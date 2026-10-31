# import numpy as np
# import matplotlib.pyplot as plt
# from physics import RK4

# class Body:
#     def __init__ (self, x, y, vx, vy, m):
#         self.mass = m
#         self.pos = [x,y]
#         self.vel = [vx, vy]
#         self.state = [x,y,vx,vy]
 
# class Bodies:
#     def __init__(self, bodies, G=1.0):
#         self.bodies = bodies       # list of Body instances
#         self.G = G

#     def acceleration(self, i, positions):
#         """ Compute acceleration on body i given all positions array """
#         xi, yi = positions[2*i:2*i+2]
#         ax = ay = 0.0
#         for j, b in enumerate(self.bodies):
#             if i == j: 
#                 continue
#             xj, yj = positions[2*j:2*j+2]
#             dx, dy = xj - xi, yj - yi
#             r3 = (dx*dx + dy*dy)**1.5
#             ax += self.G * b.mass * dx / r3
#             ay += self.G * b.mass * dy / r3
#         return ax, ay

#     def derivative4rk(self, t, state):
#         """ Flattened derivative: [vx, vy, ax, ay, vx2, vy2, ax2, ay2, ...] """
#         n = len(self.bodies)
#         deriv = np.zeros_like(state)
#         # velocities → position derivatives
#         for i in range(n):
#             deriv[4*i]   = state[4*i+2]  # vx
#             deriv[4*i+1] = state[4*i+3]  # vy
#         # accelerations
#         for i in range(n):
#             ax, ay = self.acceleration(i, state[4*i:4*i+2] if n==1 else state)
#             deriv[4*i+2] = ax
#             deriv[4*i+3] = ay
#         return deriv

#     def update(self, t_end, dt, t0=0.0):
#         """ Integrate from t0 to t_end, then plot trajectories """
#         # build initial state vector [x1,y1,vx1,vy1, x2,y2,vx2,vy2, ...]
#         state = np.hstack([ [b.pos[0], b.pos[1], b.vel[0], b.vel[1]]
#                              for b in self.bodies ])
#         steps = int(np.ceil((t_end - t0)/dt))
#         traj = np.zeros((steps+1, len(state)))
#         times = np.zeros(steps+1)
        
#         # time‐stepping
#         t = t0
#         for k in range(steps+1):
#             traj[k] = state
#             times[k] = t
#             state = RK4.update(state, t, self.derivative4rk, dt)
#             t += dt

#         # unpack back into bodies (optional)
#         for i, b in enumerate(self.bodies):
#             b.pos = traj[-1, 4*i:4*i+2].tolist()
#             b.vel = traj[-1, 4*i+2:4*i+4].tolist()
        
#         # Plot 2D orbits
#         plt.figure()
#         for i, b in enumerate(self.bodies):
#             xs = traj[:, 4*i]
#             ys = traj[:, 4*i+1]
#             plt.plot(xs, ys, label=f'Body {i+1} (m={b.mass})')
#         plt.axis('equal')
#         plt.xlabel('x')
#         plt.ylabel('y')
#         plt.legend()
#         plt.title(f'Orbits over t=[{t0},{t_end}]')
#         plt.show()


# b1 = Body(0, 0, 0, 0, 1000)
# b2 = Body(10, 0, 0, 10, 1)
# sim = Bodies([b1, b2], G=1)
# sim.update(t_end=10, dt=0.01)

import numpy as np
import matplotlib.pyplot as plt
from physics import RK4

class Body:
    def __init__(self, x, y, vx, vy, m):
        self.mass = m
        self.pos = [x, y]
        self.vel = [vx, vy]
        self.state = [x, y, vx, vy]

class Bodies:
    def __init__(self, bodies, G=1.0):
        self.bodies = bodies       # list of Body instances
        self.G = G

    def acceleration(self, i, state):
        """ Compute acceleration on body i using the full state vector. """
        xi = state[4*i]
        yi = state[4*i + 1]
        ax = ay = 0.0
        for j, b in enumerate(self.bodies):
            if i == j:
                continue
            xj = state[4*j]
            yj = state[4*j + 1]
            dx = xj - xi
            dy = yj - yi
            r3 = (dx*dx + dy*dy)**1.5
            ax += self.G * b.mass * dx / r3
            ay += self.G * b.mass * dy / r3
        return ax, ay

    def derivative4rk(self, t, state):
        """Flattened derivative for RK4: [vx, vy, ax, ay, ...]"""
        n = len(self.bodies)
        deriv = np.zeros_like(state, dtype=float)
        # velocities -> position derivatives
        for i in range(n):
            deriv[4*i]   = state[4*i + 2]  # vx
            deriv[4*i+1] = state[4*i + 3]  # vy
        # accelerations
        for i in range(n):
            ax, ay = self.acceleration(i, state)
            deriv[4*i+2] = ax
            deriv[4*i+3] = ay
        return deriv

    def update(self, t_end, dt, t0=0.0):
        """Integrate from t0 to t_end, then plot trajectories"""
        # build initial state vector [x1,y1,vx1,vy1, ...]
        state = np.array([coord for b in self.bodies for coord in (*b.pos, *b.vel)], dtype=float)
        steps = int(np.ceil((t_end - t0)/dt))
        traj = np.zeros((steps+1, len(state)), dtype=float)
        times = np.zeros(steps+1, dtype=float)
        
        # time-stepping
        t = t0
        for k in range(steps+1):
            traj[k] = state
            times[k] = t
            state = RK4.update(state, t, self.derivative4rk, dt)
            t += dt

        # unpack back into bodies
        for i, b in enumerate(self.bodies):
            b.pos = traj[-1, 4*i:4*i+2].tolist()
            b.vel = traj[-1, 4*i+2:4*i+4].tolist()
        
        # Plot 2D orbits
        plt.figure()
        for i, b in enumerate(self.bodies):
            xs = traj[:, 4*i]
            ys = traj[:, 4*i+1]
            plt.plot(xs, ys, label=f'Body {i+1} (m={b.mass})')
        plt.axis('equal')
        plt.xlabel('x')
        plt.ylabel('y')
        plt.legend()
        plt.title(f'Orbits over t=[{t0},{t_end}]')
        plt.show()

# Example usage
b1 = Body(0, 0, 0, -10, 500)
b2 = Body(10, 0, 0, 10, 500)
sim = Bodies([b1, b2], G=1)
sim.update(t_end=10, dt=0.01)
