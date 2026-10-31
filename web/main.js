// 3D live view: runs the engine in real time and draws it with three.js.
// Optionally runs nudged copies alongside the original to show chaos.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SCENARIOS } from "./scenarios.js";
import { startTour } from "./tour.js";

const COLORS = ["#f5a623", "#4a90e2", "#d0021b", "#7ed321", "#9013fe"];
const BACKGROUND = new THREE.Color("#0b0e14");
const MAX_TRAIL = 5000; // trail points kept per body (the slider picks how many to show)
const CLOUD_TRAIL = 300; // shorter trails for the many copies of the cloud
const CLOUD_SIZE = 30; // nudged copies in cloud mode
const PLAYBACK_SECONDS = 15; // at 1x speed a preset's suggested run lasts this long
// Trail points are recorded at fixed steps of simulation time (not once per
// frame), so trails are equally smooth at any speed: 3600 per suggested run.
const TRAIL_POINTS_PER_RUN = 3600;
const MAX_POINTS_PER_FRAME = 400; // keeps a frame cheap at extreme speeds
const SINGULAR_RATIO = 1e-8; // same point-mass collision cutoff as System.run
const MIN_SIZE = 0.008; // smallest drawn radius, as a fraction of the scene size
const VISIBLE_GAP = 0.01; // a gap of 1% of the system's size counts as visible

// The physics uses x-y as the orbital plane (z up); three.js has y up.
// Map physics (x, y, z) -> scene (x, z, -y) so orbits lie on the floor grid.
const toScene = (sim, i, out) =>
  out.set(sim.pos[3 * i], sim.pos[3 * i + 2], -sim.pos[3 * i + 1]);

// ---- three.js setup -----------------------------------------------------

const container = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(BACKGROUND);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = BACKGROUND;
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sunlight = new THREE.DirectionalLight(0xffffff, 1.6);
sunlight.position.set(1, 2, 1.5);
scene.add(sunlight);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 1e5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Everything belonging to the current preset lives in this group, so a
// reset just empties it.
const world = new THREE.Group();
scene.add(world);

/** A round sprite texture: filled for real bodies, a ring for nudged copies. */
function dotTexture(ring) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(32, 32, ring ? 24 : 30, 0, 2 * Math.PI);
  if (ring) {
    g.strokeStyle = "#fff";
    g.lineWidth = 10;
    g.stroke();
  } else {
    g.fillStyle = "#fff";
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}
const DOT = dotTexture(false);
const RING = dotTexture(true);

/** A sprite that keeps the same size on screen at any zoom, so even point
 *  masses and tiny moons stay visible. */
function screenDot(color, map, size = 7) {
  return new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map, transparent: true, alphaTest: 0.5 }),
  );
}

// ---- trails -----------------------------------------------------------------

/** The recent path of one body, drawn as a line that fades out with age. */
class Trail {
  constructor(color, max, { dashed = false, opacity = 1 } = {}) {
    this.color = color;
    this.max = max;
    this.opacity = opacity;
    this.dashed = dashed;
    // The history (points) and the drawn line (the geometry's own buffer)
    // must be separate arrays: update() copies the newest part of the
    // history into the line, which would otherwise overwrite the history.
    this.points = new Float32Array(max * 3);
    this.count = 0;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(max * 4), 4)); // RGBA
    geometry.setDrawRange(0, 0);
    const options = { vertexColors: true, transparent: true, depthWrite: false };
    const material = dashed
      ? new THREE.LineDashedMaterial({ ...options, dashSize: 1, gapSize: 1 })
      : new THREE.LineBasicMaterial(options);
    this.line = new THREE.Line(geometry, material);
    this.line.frustumCulled = false; // its bounding box changes every frame
  }

  /** Append a point (oldest dropped when full). */
  push(v) {
    if (this.count === this.max) {
      this.points.copyWithin(0, 3);
      this.count--;
    }
    v.toArray(this.points, 3 * this.count);
    this.count++;
  }

  /** Draw the newest `shown` points, fading out by transparency with age, so
   *  where trails overlap (e.g. all three share the figure-8) an old, faded
   *  trail doesn't hide a fresh one underneath. */
  update(shown, dashLength) {
    const n = Math.min(this.count, shown);
    const geometry = this.line.geometry;
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    pos.array.set(this.points.subarray(3 * (this.count - n), 3 * this.count));
    for (let k = 0; k < n; k++) {
      col.array[4 * k] = this.color.r;
      col.array[4 * k + 1] = this.color.g;
      col.array[4 * k + 2] = this.color.b;
      col.array[4 * k + 3] = this.opacity * (n > 1 ? k / (n - 1) : 1);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.setDrawRange(0, n);
    if (this.dashed) {
      this.line.material.dashSize = this.line.material.gapSize = dashLength;
      this.line.computeLineDistances();
    }
  }
}

// ---- runs: the original simulation and its nudged copies ----------------------

/**
 * One simulation plus everything that draws it. style:
 *   "solid" - lit spheres and full trails (the original, and the copy in split screen)
 *   "ghost" - see-through wireframe spheres, ring dots, dashed trails (twin overlay)
 *   "cloud" - just a small ring dot and a faint short trail (one of many copies)
 */
function makeRun(sim, style) {
  const group = new THREE.Group();
  world.add(group);
  const run = { sim, style, group, minScale: SINGULAR_RATIO * sim.timescale(), meshes: [], dots: [], trails: [] };
  for (let i = 0; i < sim.n; i++) {
    const color = new THREE.Color(COLORS[i % COLORS.length]);
    if (style !== "cloud") {
      const material = style === "solid"
        ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 })
        : new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.6 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, style === "solid" ? 32 : 12, style === "solid" ? 16 : 8), material);
      mesh.add(screenDot(color, style === "solid" ? DOT : RING, style === "solid" ? 7 : 11));
      group.add(mesh);
      run.meshes.push(mesh);
    } else {
      const dot = screenDot(color, RING, 6);
      group.add(dot);
      run.dots.push(dot);
    }
    const trail = style === "cloud"
      ? new Trail(color, CLOUD_TRAIL, { opacity: 0.35 })
      : new Trail(color, MAX_TRAIL, { dashed: style === "ghost", opacity: style === "ghost" ? 0.8 : 1 });
    group.add(trail.line);
    run.trails.push(trail);
  }
  recordTrails(run);
  return run;
}

function recordTrails(run) {
  const tmp = new THREE.Vector3();
  run.trails.forEach((t, i) => t.push(toScene(run.sim, i, tmp)));
}

/** Largest distance between matching bodies of two simulations. */
function gapBetween(a, b) {
  let worst = 0;
  for (let i = 0; i < a.n; i++) {
    worst = Math.max(worst, Math.hypot(a.pos[3 * i] - b.pos[3 * i],
      a.pos[3 * i + 1] - b.pos[3 * i + 1], a.pos[3 * i + 2] - b.pos[3 * i + 2]));
  }
  return worst;
}

/** Small seeded random generator, so a cloud looks the same on every reload. */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- state ----------------------------------------------------------------

const ui = Object.fromEntries(
  ["preset", "about", "play", "reset", "speed", "speed-value", "trail", "trail-value",
    "view-angle", "view-top", "view-side", "true-size", "bodies", "time", "energy", "status",
    "chaos", "nudge", "nudge-value", "chaos-panel", "chart", "gap", "horizon", "split-labels",
    "split-right", "panel-show", "panel-hide", "intro", "intro-open", "intro-close", "tour-start"]
    .map((id) => [id, document.getElementById(id)]),
);

let preset; // entry of SCENARIOS
let main; // the original run
let copies = []; // nudged runs (twin/split: one; cloud: many)
let mode = "off"; // chaos comparison: off | twin | split | cloud
let nudge = 1e-9;
let e0; // starting energy
let extent; // size of the starting configuration, sets camera and drawn sizes
let playing = true;
let impactMarker = null;
let gapHistory = []; // [time, gap] for the chart
let horizon = null; // time the copies first visibly separated

// ---- building a preset ----------------------------------------------------

function load(name) {
  preset = SCENARIOS[name];
  world.clear();
  impactMarker = null;
  gapHistory = [];
  horizon = null;

  const sim = preset.make();
  e0 = sim.energy();
  const tmp = new THREE.Vector3();
  extent = 0;
  for (let i = 0; i < sim.n; i++) extent = Math.max(extent, toScene(sim, i, tmp).length());

  // Faint floor grid in the orbital plane, for a sense of depth.
  world.add(new THREE.GridHelper(niceSize(extent * 3), 20, 0x2a3140, 0x1a1f2b));

  main = makeRun(sim, "solid");
  copies = [];
  if (mode === "twin" || mode === "split") {
    // Same nudge as visualize.py --nudge: body 1 moved by `nudge` in x.
    const twin = preset.make();
    twin.pos[0] += nudge;
    copies.push(makeRun(twin, mode === "split" ? "solid" : "ghost"));
  } else if (mode === "cloud") {
    // Every body of every copy moved by `nudge` in a random direction in
    // the orbital plane.
    const random = seededRandom(1);
    for (let c = 0; c < CLOUD_SIZE; c++) {
      const copy = preset.make();
      for (let i = 0; i < copy.n; i++) {
        const angle = 2 * Math.PI * random();
        copy.pos[3 * i] += nudge * Math.cos(angle);
        copy.pos[3 * i + 1] += nudge * Math.sin(angle);
      }
      copies.push(makeRun(copy, "cloud"));
    }
  }
  applySizes();
  recordGap();

  ui.about.textContent = preset.about;
  ui.bodies.innerHTML = Array.from(sim.masses, (m, i) =>
    `<li><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>` +
    `body ${i + 1} &nbsp;<span style="color:var(--muted)">mass ${formatNumber(m)}</span></li>`,
  ).join("");
  ui["chaos-panel"].hidden = mode === "off";
  ui["split-labels"].hidden = mode !== "split";
  ui["split-right"].textContent = `Nudged by ${formatNudge(nudge)}`;
  setStatus("");
  setView("angle");
  updateScene();
}

/** Round a length up to 1, 2 or 5 times a power of ten, for a tidy grid. */
function niceSize(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= x);
}

function formatNumber(x) {
  return x >= 1e-3 && x < 1e5 ? String(+x.toPrecision(4)) : x.toExponential(0);
}

function formatNudge(x) {
  return `1e${Math.round(Math.log10(x))}`;
}

/** Bodies are drawn at their true radius, or (unless "true sizes" is ticked)
 *  enlarged to a minimum so tiny ones like a Trojan asteroid stay visible. */
function applySizes() {
  const trueSize = ui["true-size"].checked;
  for (const run of [main, ...copies]) {
    run.meshes.forEach((mesh, i) => {
      const r = trueSize ? run.sim.radii[i] : Math.max(run.sim.radii[i], MIN_SIZE * extent);
      mesh.scale.setScalar(Math.max(r, 1e-9)); // radius 0: only the screen-size dot shows
    });
  }
}

// ---- camera ---------------------------------------------------------------

function setView(kind) {
  const d = extent * 3.2;
  const directions = { angle: [0, 0.75, 1], top: [0, 1, 1e-4], side: [0, 0.02, 1] };
  camera.position.set(...directions[kind]).normalize().multiplyScalar(d);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ---- simulation loop --------------------------------------------------------

/** Advance every run by the sim time this frame should cover, recording a
 *  trail point every preset.t / TRAIL_POINTS_PER_RUN of simulation time.
 *  The copies follow the original's clock; a copy that collides freezes. */
function advance(realSeconds) {
  const sim = main.sim;
  const tEnd = sim.time + realSeconds * (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
  const spacing = Math.max(preset.t / TRAIL_POINTS_PER_RUN, (tEnd - sim.time) / MAX_POINTS_PER_FRAME);
  while (sim.time < tEnd) {
    const target = Math.min(sim.time + spacing, tEnd);
    for (const run of copies) {
      if (!run.sim.collision) {
        run.sim.advanceTo(target, preset.eta, run.minScale);
        recordTrails(run);
      }
    }
    const collided = sim.advanceTo(target, preset.eta, main.minScale);
    recordTrails(main);
    if (collided) {
      onCollision();
      break;
    }
  }
  recordGap();
}

function onCollision() {
  playing = false;
  ui.play.textContent = "Play";
  const sim = main.sim;
  const [i, j] = sim.collision;
  setStatus(`Collision: body ${i + 1} hit body ${j + 1} at t = ${sim.time.toFixed(3)}`, true);
  const a = toScene(sim, i, new THREE.Vector3());
  const b = toScene(sim, j, new THREE.Vector3());
  impactMarker = new THREE.Mesh(
    new THREE.SphereGeometry(MIN_SIZE * extent * 4, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, wireframe: true }),
  );
  impactMarker.position.copy(a.add(b).multiplyScalar(0.5));
  main.group.add(impactMarker);
}

/** Note how far the copies have drifted from the original (worst copy). */
function recordGap() {
  if (!copies.length) return;
  const gap = Math.max(...copies.map((run) => gapBetween(main.sim, run.sim)));
  gapHistory.push([main.sim.time, gap]);
  if (gapHistory.length > 4000) gapHistory = gapHistory.filter((_, k) => k % 2 === 0);
  if (horizon === null && gap > VISIBLE_GAP * extent) horizon = main.sim.time;
}

/** Copy the simulation state into the meshes and trail lines. */
function updateScene() {
  const shown = Number(ui.trail.value);
  const dash = extent * 0.02;
  for (const run of [main, ...copies]) {
    run.meshes.forEach((mesh, i) => toScene(run.sim, i, mesh.position));
    run.dots.forEach((dot, i) => toScene(run.sim, i, dot.position));
    run.trails.forEach((t) => t.update(shown, dash));
  }
  if (impactMarker) impactMarker.rotation.y += 0.02;

  ui.time.textContent = main.sim.time.toFixed(2);
  ui.energy.textContent = Math.abs((main.sim.energy() - e0) / e0).toExponential(1);
  if (copies.length) {
    ui.gap.textContent = gapHistory.at(-1)[1].toExponential(1);
    ui.horizon.textContent = horizon === null ? "not yet" : `t = ${horizon.toFixed(2)}`;
    drawChart();
  }
}

/** Log-scale chart of the gap between original and copies over time. */
function drawChart() {
  const canvas = ui.chart;
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * ratio) {
    canvas.width = w * ratio;
    canvas.height = h * ratio;
  }
  const g = canvas.getContext("2d");
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, w, h);

  const lo = Math.log10(nudge) - 1;
  const hi = Math.log10(extent) + 1;
  const tMax = Math.max(preset.t, main.sim.time);
  const x = (t) => 4 + (t / tMax) * (w - 8);
  const y = (gap) => h - 4 - ((Math.log10(Math.max(gap, 1e-300)) - lo) / (hi - lo)) * (h - 8);

  // Reference lines: the nudge you started with, and the size of the system.
  g.font = "10px system-ui, sans-serif";
  g.fillStyle = "#8b95a7";
  g.strokeStyle = "#2a3140";
  for (const [value, label] of [[nudge, "nudge"], [extent, "size of system"]]) {
    g.beginPath();
    g.moveTo(0, y(value));
    g.lineTo(w, y(value));
    g.stroke();
    g.fillText(label, 6, y(value) - 3);
  }
  g.strokeStyle = "#b07cff";
  g.lineWidth = 1.5;
  g.beginPath();
  gapHistory.forEach(([t, gap], k) => (k ? g.lineTo(x(t), y(gap)) : g.moveTo(x(t), y(gap))));
  g.stroke();
  g.lineWidth = 1;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1); // don't jump ahead after a stalled tab
  if (playing && !main.sim.collision) advance(dt);
  updateScene();
  controls.update();
  render();
});

/** The part of the window the 3D view uses: everything right of the control
 *  panel while it is open (on wide screens; on phones it sits at the bottom
 *  and the view stays full width), or the whole window once it is hidden. */
function viewArea() {
  const panel = document.getElementById("panel");
  const sideBySide = !panel.hidden && window.innerWidth > 600;
  const left = sideBySide ? Math.round(panel.getBoundingClientRect().right + 12) : 0;
  return { left, width: window.innerWidth - left, height: window.innerHeight };
}

/** Draw the scene; in split screen, the original on the left half of the
 *  view area and the nudged copy on the right half, through the same camera. */
function render() {
  const { left, width, height } = viewArea();
  const halves = mode === "split"
    ? [[left, Math.floor(width / 2), main, copies[0]], [left + Math.floor(width / 2), Math.ceil(width / 2), copies[0], main]]
    : [[left, width, main, null]];
  renderer.setScissorTest(true);
  renderer.setScissor(0, 0, window.innerWidth, height); // clear the strip behind the panel too
  renderer.clear();
  for (const [x, w, shownRun, hiddenRun] of halves) {
    camera.aspect = w / height;
    camera.updateProjectionMatrix();
    shownRun.group.visible = true;
    if (hiddenRun) hiddenRun.group.visible = false;
    renderer.setViewport(x, 0, w, height);
    renderer.setScissor(x, 0, w, height);
    renderer.render(scene, camera);
  }
  for (const run of [main, ...copies]) run.group.visible = true;
  if (mode === "split") placeSplitLabels(left, width);
}

/** Centre the "Original" / "Nudged" labels over their halves, divider between. */
function placeSplitLabels(left, width) {
  const labels = ui["split-labels"];
  labels.querySelector(".left").style.left = `${left + width / 4}px`;
  labels.querySelector(".right").style.left = `${left + (3 * width) / 4}px`;
  labels.querySelector(".divider").style.left = `${left + Math.floor(width / 2)}px`;
}

function setPanelVisible(visible) {
  document.getElementById("panel").hidden = !visible;
  ui["panel-show"].hidden = visible;
}

// ---- controls ---------------------------------------------------------------

function speedMultiplier() {
  return 10 ** Number(ui.speed.value);
}

function setStatus(text, alert = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("alert", alert);
}

function togglePlay() {
  if (main.sim.collision) return;
  playing = !playing;
  ui.play.textContent = playing ? "Pause" : "Play";
}

/** Keep the page address in step with the settings, so it can be shared. */
function updateUrl() {
  const p = new URLSearchParams({ preset: ui.preset.value, speed: +speedMultiplier().toFixed(2) });
  if (mode !== "off") {
    p.set("chaos", mode);
    p.set("nudge", formatNudge(nudge));
  }
  history.replaceState(null, "", `?${p}`);
}

function restart() {
  playing = true;
  ui.play.textContent = "Pause";
  load(ui.preset.value);
  updateUrl();
}

for (const name of Object.keys(SCENARIOS)) ui.preset.add(new Option(name, name));
ui.preset.addEventListener("change", restart);
ui.play.addEventListener("click", togglePlay);
ui.reset.addEventListener("click", restart);
ui.speed.addEventListener("input", () => {
  ui["speed-value"].textContent = `${speedMultiplier().toFixed(speedMultiplier() < 1 ? 2 : 1)}×`;
});
ui.speed.addEventListener("change", updateUrl);
ui.trail.addEventListener("input", () => { ui["trail-value"].textContent = ui.trail.value; });
ui["true-size"].addEventListener("change", applySizes);
ui["view-angle"].addEventListener("click", () => setView("angle"));
ui["view-top"].addEventListener("click", () => setView("top"));
ui["view-side"].addEventListener("click", () => setView("side"));
// Changing the comparison or the nudge starts over: the copies must be
// nudged at time 0 to show how the difference grows.
ui.chaos.addEventListener("change", () => {
  mode = ui.chaos.value;
  restart();
});
ui.nudge.addEventListener("input", () => {
  ui["nudge-value"].textContent = formatNudge(10 ** Number(ui.nudge.value));
});
ui.nudge.addEventListener("change", () => {
  nudge = 10 ** Number(ui.nudge.value);
  restart();
});
ui["panel-hide"].addEventListener("click", () => setPanelVisible(false));

// ---- welcome overlay and tour ---------------------------------------------------

const part = (name) => () => document.querySelector(`[data-tour="${name}"]`);
const TOUR_STEPS = [
  { target: () => { const a = viewArea(); return new DOMRect(a.left, 0, a.width, a.height); },
    title: "The simulation",
    text: "Bodies pulling on each other with Newton's gravity, computed live. " +
      "<b>Drag</b> to rotate, <b>scroll</b> to zoom, <b>right-drag</b> to pan." },
  { target: part("preset"), title: "Presets",
    text: "Pick a starting setup: famous orbits (figure-8, Lagrange triangle, Euler line), " +
      "a Trojan asteroid, a moon around a planet, or the chaotic Pythagorean problem." },
  { target: part("play"), title: "Play and reset",
    text: "Pause and resume (or press <kbd>Space</kbd>). Reset starts the preset over." },
  { target: part("speed"), title: "Speed", text: "Run the simulation from 0.1× to 10× speed." },
  { target: part("trail"), title: "Trails",
    text: "How much of each body's path stays visible behind it. Older parts fade out." },
  { target: part("camera"), title: "Camera views",
    text: "Jump to a tilted, top-down or side view. The orbits lie on the floor grid." },
  { target: part("size"), title: "True body sizes",
    text: "Tiny bodies (an asteroid, a moon) are drawn bigger so you can see them. " +
      "Tick this to see their real sizes." },
  { target: part("chaos"), title: "Chaos comparison",
    text: "Run copies of the system nudged by as little as a billionth: a ghost twin, a split " +
      "screen, or a cloud of 30. In chaotic systems they soon go completely different ways." },
  { target: part("chart"), title: "How fast they drift apart",
    text: "The gap between the original and its copies, on a log scale. A straight rising " +
      "line means exponential growth: the signature of chaos." },
  { target: part("bodies"), title: "The bodies", text: "Each body's colour and mass." },
  { target: part("readout"), title: "Readout",
    text: "Simulation time, and the energy error. Real energy never changes, so this shows " +
      "how accurate the simulation is: smaller is better." },
  { target: part("head"), title: "Help and full screen",
    text: "<b>?</b> brings back the welcome page and this tour. <b>Hide</b> (or <kbd>H</kbd>) " +
      "hides the controls so the simulation fills the screen. Enjoy!" },
];

const INTRO_SEEN = "threebody.introSeen";

function setIntroVisible(visible) {
  ui.intro.hidden = !visible;
  if (visible) ui["intro-close"].focus({ preventScroll: true });
  else {
    try {
      localStorage.setItem(INTRO_SEEN, "1");
    } catch {
      // storage blocked (private window etc.): the intro just shows again next time
    }
  }
}

ui["intro-open"].addEventListener("click", () => setIntroVisible(true));
ui["tour-start"].addEventListener("click", () => {
  setIntroVisible(false);
  setPanelVisible(true);
  startTour(TOUR_STEPS);
});
ui["intro-close"].addEventListener("click", () => setIntroVisible(false));
ui.intro.addEventListener("click", (e) => {
  if (e.target === ui.intro) setIntroVisible(false); // click outside the card
});
for (const demo of ui.intro.querySelectorAll(".demo")) {
  demo.addEventListener("click", () => {
    setIntroVisible(false);
    location.search = demo.dataset.link;
  });
}
ui["panel-show"].addEventListener("click", () => setPanelVisible(true));
window.addEventListener("keydown", (e) => {
  if (!ui.intro.hidden) {
    if (e.code === "Escape") setIntroVisible(false);
    return; // keys don't reach the simulation while the intro is open
  }
  if (e.target.tagName === "SELECT") return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "KeyH") {
    setPanelVisible(document.getElementById("panel").hidden);
  }
});
window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));

// URL options: ?preset=pythagorean&speed=4 picks the preset and playback
// speed; &chaos=twin|split|cloud&nudge=1e-9 turns on a chaos comparison;
// &start=10 fast-forwards to simulation time 10 (replaying the same 60 fps
// steps as live play, so the view is exactly what you'd have seen);
// &paused=1 starts paused; &panel=0 starts with the controls hidden;
// &intro=1 opens the welcome overlay; &tour=1 starts the tour.
const params = new URLSearchParams(location.search);
const requested = params.get("preset");
ui.preset.value = requested in SCENARIOS ? requested : "figure8";
if (params.has("speed")) {
  ui.speed.value = Math.log10(Number(params.get("speed")) || 1);
  ui.speed.dispatchEvent(new Event("input"));
}
if (["twin", "split", "cloud"].includes(params.get("chaos"))) mode = ui.chaos.value = params.get("chaos");
if (Number(params.get("nudge")) > 0) {
  nudge = 10 ** Math.round(Math.log10(Number(params.get("nudge"))));
  ui.nudge.value = Math.log10(nudge);
}
ui["nudge-value"].textContent = formatNudge(nudge);
load(ui.preset.value);
const start = Number(params.get("start")) || 0;
const simPerRealSecond = (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
while (main.sim.time < start - 1e-9 && !main.sim.collision) {
  advance(Math.min(1 / 60, (start - main.sim.time) / simPerRealSecond));
}
if (params.get("paused") === "1") togglePlay();
if (params.get("panel") === "0") setPanelVisible(false);
// First visit to the plain address: show the welcome overlay. Shared links
// with options (e.g. ?preset=...) go straight to the simulation.
let introSeen = false;
try {
  introSeen = localStorage.getItem(INTRO_SEEN) === "1";
} catch {
  // storage blocked: treat as a first visit
}
if (params.get("intro") === "1" || (!introSeen && !location.search)) setIntroVisible(true);
if (params.get("tour") === "1") startTour(TOUR_STEPS);
