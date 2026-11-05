# 3D web view

- **Presets** are always on show, in groups: Orbits, Chaos, Patterns, Flybys, and Impacts & tides.
  The list scrolls when the window is short. The plain address opens with all of them, and a
  line about the one under the pointer; click one to run it.
  **Quick tour** (green, on that screen) walks through the groups in five short steps, loading a
  preset for each. Shared links with options skip the welcome screen.
- **Play/pause** (or the space bar), **restart** (or the R key), and **speed** from 0.1x to 10x. At 1x a preset's
  suggested run lasts ~15 s, then it keeps going. The label always shows the speed you set,
  but particle presets are limited by the machine: on our test laptop Giant impact and Moon holds
  top out at about 2.5-4x however high the slider goes, and Moon torn and Comet at about 6-7x.
- **✕** (or the H key) hides the controls so the view fills the window; **☰** brings them back.
  While shown, the view (and split screen) uses the space beside them.
- **Tide arrows**: one arrow through each strongly affected body, along the axis the tide stretches it.
- **More** folds away the trail length, the Tilted/Top/Side camera views and the list of masses.
- **Camera**: drag to rotate, scroll to zoom, right-drag to pan. The orbital plane (x-y) is
  drawn as the floor grid; z is up.
- Bodies are drawn at their true size. Each also has a dot that keeps the same size on
  screen, so tiny ones (a Trojan asteroid, a moon, point masses) stay visible at any zoom.
- **Version**: the bottom of the panel shows which build you are running (the commit
  ID on the live site, "local" when served with `npm start`).
- **Chaos comparison** (see [Chaos](physics.md#chaos)):
  - *Twin*: a copy with body 1 moved by the nudge, drawn as see-through ghosts with dashed trails.
  - *Split screen*: original on the left, nudged copy on the right, one shared camera.
  - *Cloud*: 30 copies, every body nudged in a random direction. Stable orbits stay a
    tight bundle; chaotic ones spray apart.
  - *Nudge size* from 1e-12 to 1e-1 (default 1e-4: chaotic presets visibly split within
    seconds, while stable ones stay together), a log-scale chart of the gap between original
    and copies, and the time they become visibly apart (gap > 1% of the system's size).
    Changing the comparison or the nudge restarts the run. Particle presets have no comparison: too heavy.
- Readout: simulation time, the energy error, and once there are collisions, the heat they made.
  Particle presets also count their rocks, and Giant impact counts those in orbit.

Link options, e.g. `http://localhost:8000/?preset=lagrange&chaos=cloud&nudge=1e-4`:

| Option | Effect |
|---|---|
| `preset=pythagorean` | Which preset to open |
| `speed=4` | Playback speed |
| `chaos=off\|twin\|split\|cloud`, `nudge=1e-6` | Chaos comparison |
| `tides=0\|1` | Tide arrows off or on |
| `start=10` | Fast-forward to simulation time 10 (same steps as live play) |
| `paused=1` | Start paused |
| `panel=0` | Start with the controls hidden |
| `intro=1` | Open the welcome screen |
| `tour=1` | Start the tour |

## Running and deploying

The live version is published automatically from `web/` by
`.github/workflows/pages.yml` on every push to `main` (after the JS tests pass).
Each deploy stamps the commit ID into the script addresses, so browsers never
mix a new page with old cached scripts.
To run it locally instead, you need [Node.js](https://nodejs.org) (no packages to install):

```
cd web
npm start
```

Then open **http://localhost:8000** in your browser; stop the server with Ctrl+C.
Opening `index.html` directly as a file does not work (browsers only load
JavaScript modules over http). Three.js is loaded from a CDN, so the first
load needs an internet connection.
