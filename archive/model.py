from physics import RK4
import numpy as np
import matplotlib.pyplot as plt


class Body:
    def __init__ (self, x, y, vx, vy, m):
        self.mass = m
        self.pos = [x,y]
        self.vel = [vx, vy]
        self.state = [x,y,vx,vy]
    
    def __eq__(self, other):
        return (self.mass==other.mass and self.pos==other.pos and self.vel==other.vel)
    
    def update(self, s):
        self.state = s
        self.pos = [s[0], s[1]]
        self.vel = [s[2], s[3]]

class Bodies(Body):
    def __init__(self, n, bodies, G=1):
        self.n = n
        self.bodies = bodies
        self.g = G

    def acceleration(self, x, y):
        ax, ay = 0, 0
        for b in self.bodies:
            if not (x==b.x and y==b.y) :
                r = np.sqrt((b.x-x)**2 + (b.y-y)**2)
                ax += self.g *b.mass *(b.x-x)/r**3 
                ay += self.g *b.mass *(b.y-y)/r**3
        return ax, ay
    
    def derivative4rk(self, t, x):
        return [x[2], x[3], self.acceleration(x[0], x[1])]

    def update(self, t, dt):
        for t_n in range(0, t, dt):
            for b in self.bodies:
                x_n = b.state
                x_n = RK4.update(x_n, t_n, self.derivative4rk, dt)
                b.update(x_n)


b1 = Body(0, 0, 0, 0, 1000)
b2 = Body(10,0,0,10,1)
bodies = Bodies(2, [b1, b2], G=1)
bodies.update(10, 0.1)