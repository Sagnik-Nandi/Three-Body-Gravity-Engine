import matplotlib.pyplot as plt

class RK4:
    def update(x_n, t_n, dxdt, dt):
        k1 = dxdt(t_n, x_n)
        k2 = dxdt(t_n + dt/2, x_n + k1*dt/2)
        k3 = dxdt(t_n + dt/2, x_n + k2*dt/2)
        k4 = dxdt(t_n + dt, x_n + k3*dt)
        return x_n + dt*(k1 + 2*k2 + 2*k3 + k4)/6
    
    def compute(t, x_0, dxdt, dt, t_0=0):
        n = (t-t_0)/dt
        x_n = x_0
        x_list = [x_0]
        t_list = [t_0]
        for i in range(int(n)):
            t_n = t_0 + i*dt
            x_n = RK4.update(x_n, t_n, dxdt, dt)
            print(f"x{i+1} = {x_n:.3f}, t{i+1} = {t_n:.2f}")
            x_list.append(x_n)
            t_list.append(t_n+dt)
        plt.plot(t_list, x_list)
        plt.show()
        return x_n

def d(t, x):
    return -t

# print("Starting run")
# print("t = 10, x0 = 0.5, t0 = 0, step size = 0.1")
# RK4.compute(10, 10, d, 0.05)
