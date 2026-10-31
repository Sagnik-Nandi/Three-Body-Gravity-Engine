"""Animate a simulation from engine.py (top view: the x-y plane).

Usage:
    python visualize.py                     # two-body circular orbit
    python visualize.py figure8             # any preset from scenarios.py
    python visualize.py --speed 0.7         # two-body options: elliptical orbit
    python visualize.py pythagorean --nudge 1e-9  # chaos: compare with a nudged copy
    python visualize.py figure8 --save out.png  # save a still image instead
    python visualize.py --help              # list all presets
"""
import argparse

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation
from matplotlib.gridspec import GridSpec
from matplotlib.lines import Line2D
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
    p.add_argument("--nudge", type=float,
                   help="also run a copy with body 1 moved this far in x (e.g. 1e-9), "
                        "drawn dashed, to show how fast the two runs drift apart")
    p.add_argument("--save", help="save a still image to this path instead of animating")
    args = p.parse_args()

    preset = SCENARIOS[args.scenario]

    def make_sim():
        if args.scenario == "two-body":
            return two_body(args.m1, args.m2, args.sep, args.speed, size=args.size)
        return preset["make"]()

    if args.scenario == "two-body":
        title = f"m1={args.m1:g}, m2={args.m2:g}, speed factor={args.speed:g}"
    else:
        title = f"{args.scenario}: {preset['about']}"

    # runs[0] is the original; runs[1] (with --nudge) the copy with body 1 moved.
    runs = []
    for nudge in [0.0] + ([args.nudge] if args.nudge else []):
        sim = make_sim()
        sim.positions[0, 0] += nudge
        # The engine steps adaptively; we only record a few thousand samples
        # because more is invisible on screen and just slows drawing.
        times, traj, energies = sim.run(args.t or preset["t"], preset["samples"],
                                        args.eta or preset["eta"])
        runs.append(dict(sim=sim, times=times, traj=traj,
                         drift=(energies - energies[0]) / abs(energies[0])))
    sim = runs[0]["sim"]

    fig = plt.figure(figsize=(12, 6))
    grid = GridSpec(2, 2, figure=fig, width_ratios=[1.2, 1])
    ax = fig.add_subplot(grid[:, 0])
    ax_e = fig.add_subplot(grid[0, 1] if args.nudge else grid[:, 1])
    ax.set_aspect("equal")
    for run, which in zip(runs, ["", " (nudged copy)"]):
        if run["sim"].collision:
            i, j = run["sim"].collision
            title += f"\nCOLLISION{which}: body {i + 1} hit body {j + 1} at t={run['times'][-1]:.3f}"
    ax.set_title(title, fontsize=10)
    every = np.concatenate([run["traj"][:, :, :2].reshape(-1, 2) for run in runs])
    lo = every.min(axis=0) - sim.radii.max()
    hi = every.max(axis=0) + sim.radii.max()
    centre, half = (lo + hi) / 2, (hi - lo).max() / 2 * 1.1
    ax.set_xlim(centre[0] - half, centre[0] + half)
    ax.set_ylim(centre[1] - half, centre[1] + half)
    ax.plot(0, 0, "k+", label="centre of mass")

    worst = max(np.abs(run["drift"]).max() for run in runs)
    ax_e.set_title(f"Numerical energy error (E - E0)/|E0|   [max {worst:.1e}]", fontsize=10)
    ax_e.axhline(0, color="k", lw=0.5)
    for run, ls in zip(runs, ["-", "--"]):
        ax_e.plot(run["times"], run["drift"], ls, color="gray")
    ax_e.ticklabel_format(axis="y", style="sci", scilimits=(0, 0))
    ax_e.set_xlabel("time")

    cursor = None
    if args.nudge:
        # How far apart the two runs are: the largest position difference of any body.
        n = min(len(run["traj"]) for run in runs)
        gap = np.linalg.norm(runs[0]["traj"][:n] - runs[1]["traj"][:n], axis=-1).max(axis=1)
        ax_d = fig.add_subplot(grid[1, 1])
        ax_d.semilogy(runs[0]["times"][:n], np.maximum(gap, 1e-300), color="#9013fe")
        ax_d.axhline(half, color="k", lw=0.5, ls=":")
        ax_d.text(runs[0]["times"][0], half, " size of the system", va="bottom", fontsize=8)
        ax_d.set_title(f"Distance between original and copy nudged by {args.nudge:g}",
                       fontsize=10)
        ax_d.set_xlabel("time")
        ax_e.set_xlabel("")
        cursor = ax_d.axvline(0, color="k", lw=0.8)

    masses = sim.masses
    # Each run gets trails, bodies at their true radius (touching on screen =
    # touching in the physics), small centre dots that stay visible when zoomed
    # out, and an impact star. The nudged copy is drawn dashed and hollow.
    drawn = []
    for r, run in enumerate(runs):
        ghost = r == 1
        trails = [ax.plot([], [], "--" if ghost else "-", lw=1, color=COLORS[i], alpha=0.6)[0]
                  for i in range(len(masses))]
        bodies = [ax.add_patch(Circle((0, 0), sim.radii[i], ec=COLORS[i],
                                      fc="none" if ghost else COLORS[i], lw=1.5,
                                      label=None if ghost else f"body {i + 1} (m={masses[i]:g})"))
                  for i in range(len(masses))]
        centres = [ax.plot([], [], "o", ms=3, mec=COLORS[i],
                           mfc="white" if ghost else COLORS[i])[0]
                   for i in range(len(masses))]
        impact = ax.plot([], [], "*", ms=22, color="#d0021b", mec="k", visible=False)[0]
        if run["sim"].collision:
            i, j = run["sim"].collision
            impact.set_data([run["traj"][-1, [i, j], 0].mean()],
                            [run["traj"][-1, [i, j], 1].mean()])
        drawn.append((run, trails, bodies, centres, impact))
    handles, _ = ax.get_legend_handles_labels()
    if args.nudge:
        handles.append(Line2D([], [], ls="--", color="gray", label="nudged copy (dashed, hollow)"))
    ax.legend(handles=handles, loc="upper right", fontsize=8)

    n_samples = max(len(run["traj"]) for run in runs)

    def draw_upto(k):
        artists = []
        for run, trails, bodies, centres, impact in drawn:
            traj = run["traj"]
            kk = min(k, len(traj) - 1)  # a run that collided stays frozen at impact
            for i in range(len(masses)):
                trails[i].set_data(traj[:kk + 1, i, 0], traj[:kk + 1, i, 1])
                bodies[i].center = (traj[kk, i, 0], traj[kk, i, 1])
                centres[i].set_data([traj[kk, i, 0]], [traj[kk, i, 1]])
            impact.set_visible(run["sim"].collision is not None and kk == len(traj) - 1)
            artists += trails + bodies + centres + [impact]
        if cursor is not None:
            t = runs[0]["times"][min(k, len(runs[0]["times"]) - 1)]
            cursor.set_xdata([t, t])
            artists.append(cursor)
        return artists

    if args.save:
        draw_upto(n_samples - 1)
        fig.tight_layout()
        fig.savefig(args.save, dpi=110)
        print(f"saved {args.save}")
        return

    # Playback speed is set by --duration, independent of step size: each frame
    # jumps ahead as many simulation steps as needed.
    n_frames = int(args.duration * args.fps)
    frame_idx = np.linspace(0, n_samples - 1, n_frames).astype(int)

    def update(frame):
        return draw_upto(frame_idx[frame])

    anim = FuncAnimation(fig, update, frames=n_frames,
                         interval=1000 / args.fps, blit=True)
    fig.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
