"""Animate a simulation from engine.py (top view: the x-y plane).

Usage:
    python visualize.py                     # two-body circular orbit
    python visualize.py figure8             # any preset from scenarios.py
    python visualize.py --speed 0.7         # two-body options: elliptical orbit
    python visualize.py figure8 --save out.png  # save a still image instead
    python visualize.py --help              # list all presets
"""
import argparse

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation
from matplotlib.patches import Circle

from scenarios import SCENARIOS, two_body

COLORS = ["#f5a623", "#4a90e2", "#d0021b", "#7ed321", "#9013fe"]


def main():
    p = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="presets:\n" + "\n".join(f"  {k:15s} {v['about']}" for k, v in SCENARIOS.items()))
    p.add_argument("scenario", nargs="?", default="two-body", choices=SCENARIOS,
                   metavar="scenario", help="preset to run (default: two-body)")
    p.add_argument("--m1", type=float, default=10.0)
    p.add_argument("--m2", type=float, default=1.0)
    p.add_argument("--sep", type=float, default=10.0, help="initial separation")
    p.add_argument("--speed", type=float, default=1.0,
                   help="1 = circular, <1 = ellipse, >=1.414 = escape")
    p.add_argument("--t", type=float, help="simulated time (default: preset's)")
    p.add_argument("--eta", type=float,
                   help="accuracy: step size as a fraction of the shortest orbital timescale "
                        "(default: preset's)")
    p.add_argument("--duration", type=float, default=10.0,
                   help="real-world seconds the animation takes to play")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--size", type=float, default=0.1,
                   help="two-body only: radius of a mass-1 body (grows as mass^(1/3)); 0 = point masses")
    p.add_argument("--save", help="save a still image to this path instead of animating")
    args = p.parse_args()

    preset = SCENARIOS[args.scenario]
    if args.scenario == "two-body":
        sim = two_body(args.m1, args.m2, args.sep, args.speed, size=args.size)
        title = f"m1={args.m1:g}, m2={args.m2:g}, speed factor={args.speed:g}"
    else:
        sim = preset["make"]()
        title = f"{args.scenario}: {preset['about']}"
    # The engine steps adaptively; we only record a few thousand samples
    # because more is invisible on screen and just slows drawing.
    times, traj, energies = sim.run(args.t or preset["t"], preset["samples"],
                                    args.eta or preset["eta"])
    drift = (energies - energies[0]) / abs(energies[0])

    fig, (ax, ax_e) = plt.subplots(1, 2, figsize=(12, 5.5),
                                   gridspec_kw={"width_ratios": [1.2, 1]})
    ax.set_aspect("equal")
    if sim.collision:
        i, j = sim.collision
        title += f"\nCOLLISION: body {i + 1} hit body {j + 1} at t={times[-1]:.3f}"
    ax.set_title(title, fontsize=10)
    lo = traj[:, :, :2].min(axis=(0, 1)) - sim.radii.max()
    hi = traj[:, :, :2].max(axis=(0, 1)) + sim.radii.max()
    centre, half = (lo + hi) / 2, (hi - lo).max() / 2 * 1.1
    ax.set_xlim(centre[0] - half, centre[0] + half)
    ax.set_ylim(centre[1] - half, centre[1] + half)
    ax.plot(0, 0, "k+", label="centre of mass")

    ax_e.set_title(f"Numerical energy error (E - E0)/|E0|   [max {np.abs(drift).max():.1e}]")
    ax_e.set_xlabel("time")
    ax_e.axhline(0, color="k", lw=0.5)
    ax_e.plot(times, drift, color="gray")
    ax_e.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))

    masses = sim.masses
    trails = [ax.plot([], [], "-", lw=1, color=COLORS[i], alpha=0.6)[0]
              for i in range(len(masses))]
    # Bodies drawn at their true radius, so touching on screen = touching in
    # the physics. The small centre dot keeps them visible when zoomed out.
    bodies = [ax.add_patch(Circle((0, 0), sim.radii[i], color=COLORS[i],
                                  label=f"body {i + 1} (m={masses[i]:g})"))
              for i in range(len(masses))]
    centres = [ax.plot([], [], "o", ms=3, color=COLORS[i])[0] for i in range(len(masses))]
    impact = ax.plot([], [], "*", ms=22, color="#d0021b", mec="k", visible=False)[0]
    if sim.collision:
        i, j = sim.collision
        impact.set_data([traj[-1, [i, j], 0].mean()], [traj[-1, [i, j], 1].mean()])
    ax.legend(loc="upper right", fontsize=8)

    def draw_upto(k):
        for i in range(len(masses)):
            trails[i].set_data(traj[:k + 1, i, 0], traj[:k + 1, i, 1])
            bodies[i].center = (traj[k, i, 0], traj[k, i, 1])
            centres[i].set_data([traj[k, i, 0]], [traj[k, i, 1]])
        impact.set_visible(sim.collision is not None and k == len(traj) - 1)
        return trails + bodies + centres + [impact]

    if args.save:
        draw_upto(len(traj) - 1)
        fig.tight_layout()
        fig.savefig(args.save, dpi=110)
        print(f"saved {args.save}")
        return

    # Playback speed is set by --duration, independent of step size: each frame
    # jumps ahead as many simulation steps as needed.
    n_frames = int(args.duration * args.fps)
    frame_idx = np.linspace(0, len(traj) - 1, n_frames).astype(int)

    def update(frame):
        return draw_upto(frame_idx[frame])

    anim = FuncAnimation(fig, update, frames=n_frames,
                         interval=1000 / args.fps, blit=True)
    fig.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
