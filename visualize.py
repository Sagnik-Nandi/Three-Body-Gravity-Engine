"""Animate a simulation from engine.py.

Usage:
    python visualize.py                 # live animation window
    python visualize.py --speed 0.7     # elliptical orbit
    python visualize.py --save out.png  # save a still image instead
"""
import argparse

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation

from engine import two_body

COLORS = ["#f5a623", "#4a90e2", "#d0021b"]
MAX_SAMPLES = 2000


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--m1", type=float, default=10.0)
    p.add_argument("--m2", type=float, default=1.0)
    p.add_argument("--sep", type=float, default=10.0, help="initial separation")
    p.add_argument("--speed", type=float, default=1.0,
                   help="1 = circular, <1 = ellipse, >=1.414 = escape")
    p.add_argument("--t", type=float, default=100.0, help="simulated time")
    p.add_argument("--eta", type=float, default=0.01,
                   help="accuracy: step size as a fraction of the shortest orbital timescale")
    p.add_argument("--duration", type=float, default=10.0,
                   help="real-world seconds the animation takes to play")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--save", help="save a still image to this path instead of animating")
    args = p.parse_args()

    sim = two_body(args.m1, args.m2, args.sep, args.speed)
    # The engine steps adaptively; we only record MAX_SAMPLES points because
    # more than that is invisible on screen and just slows drawing.
    times, traj, energies = sim.run(args.t, MAX_SAMPLES, args.eta)
    drift = (energies - energies[0]) / abs(energies[0])

    fig, (ax, ax_e) = plt.subplots(1, 2, figsize=(12, 5.5),
                                   gridspec_kw={"width_ratios": [1.2, 1]})
    ax.set_aspect("equal")
    ax.set_title(f"m1={args.m1:g}, m2={args.m2:g}, speed factor={args.speed:g}")
    lim = np.abs(traj).max() * 1.1
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.plot(0, 0, "k+", label="centre of mass")

    ax_e.set_title(f"Numerical energy error (E - E0)/|E0|   [max {np.abs(drift).max():.1e}]")
    ax_e.set_xlabel("time")
    ax_e.axhline(0, color="k", lw=0.5)
    ax_e.plot(times, drift, color="gray")
    ax_e.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))

    masses = sim.masses
    sizes = 6 + 14 * np.sqrt(masses / masses.max())
    trails = [ax.plot([], [], "-", lw=1, color=COLORS[i], alpha=0.6)[0]
              for i in range(len(masses))]
    dots = [ax.plot([], [], "o", ms=sizes[i], color=COLORS[i],
                    label=f"body {i + 1} (m={masses[i]:g})")[0]
            for i in range(len(masses))]
    ax.legend(loc="upper right", fontsize=8)

    if args.save:
        for i in range(len(masses)):
            trails[i].set_data(traj[:, i, 0], traj[:, i, 1])
            dots[i].set_data([traj[-1, i, 0]], [traj[-1, i, 1]])
        fig.tight_layout()
        fig.savefig(args.save, dpi=110)
        print(f"saved {args.save}")
        return

    # Playback speed is set by --duration, independent of dt: each frame
    # jumps ahead as many simulation steps as needed.
    n_frames = int(args.duration * args.fps)
    frame_idx = np.linspace(0, len(traj) - 1, n_frames).astype(int)

    def update(frame):
        k = frame_idx[frame]
        for i in range(len(masses)):
            trails[i].set_data(traj[:k + 1, i, 0], traj[:k + 1, i, 1])
            dots[i].set_data([traj[k, i, 0]], [traj[k, i, 1]])
        return trails + dots

    anim = FuncAnimation(fig, update, frames=n_frames,
                         interval=1000 / args.fps, blit=True)
    fig.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
