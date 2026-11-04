// 3D live view: runs the engine in real time and draws it with three.js.
// Optionally runs nudged copies alongside the original to show chaos.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { stretchAxis } from "./engine.js";
import { impactOutcome } from "./particles.js";
import { SCENARIOS } from "./scenarios.js";
import { startTour } from "./tour.js";

const COLORS = ["#f5a623", "#4a90e2", "#d0021b", "#7ed321", "#9013fe"];
const BACKGROUND = new THREE.Color("#0b0e14");
const MAX_TRAIL = 5000; // trail points kept per body (the slider picks how many to show)
const DEFAULT_TRAIL = 1500; // points shown, unless a preset asks for another
const CLOUD_TRAIL = 300; // shorter trails for the many copies of the cloud
const CLOUD_SIZE = 30; // nudged copies in cloud mode
const PLAYBACK_SECONDS = 15; // at 1x speed a preset's suggested run lasts this long
// Trail points are recorded at fixed steps of simulation time (not once per
// frame), so trails are equally smooth at any speed: 3600 per suggested run.
const TRAIL_POINTS_PER_RUN = 3600;
const MAX_POINTS_PER_FRAME = 400; // keeps a frame cheap at extreme speeds
const SINGULAR_RATIO = 1e-8; // same point-mass collision cutoff as System.run
const VISIBLE_GAP = 0.01; // a gap of 1% of the system's size counts as visible
const FRAME_BUDGET_MS = 12; // particle physics gets this long per frame; slower machines run in slow motion
const FRAME_BUDGET_MAX_MS = 28; // and up to this long above 1x speed
const SLOW_READOUT_SECONDS = 0.25; // particle energy costs N^2, so it updates this often
const FOLLOW_TILT = 1; // how steeply the view looks down on a followed planet (1 is 45 degrees)
const FLASH_SECONDS = 1.2; // how long a merge's flash lasts
const FLASH_SIZE = 0.09; // its final radius, as a fraction of the scene size
const ROCK_COLORS = ["#c8ccd4", "#8d94a3"]; // moon particles: alternating wedges, so shearing shows
const ROCK_CORE = "#e8a04d"; // inner half of the moon
const ROCK_IMPACTOR = "#ff5a3c"; // the object that hits, in an impact
const ROCK_WEDGES = 8;

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
    this.limit = Infinity; // most points to draw; shrinks once the body is gone
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

  /** The body is gone: lose one point from the old end, at the pace a live
   *  trail moves on, so the trail runs out instead of staying forever. */
  shrink(shown) {
    this.limit = Math.max(Math.min(this.limit, this.count, shown) - 1, 0);
  }

  /** Draw the newest `shown` points, fading out by transparency with age, so
   *  where trails overlap (e.g. all three share the figure-8) an old, faded
   *  trail doesn't hide a fresh one underneath. */
  update(shown, dashLength) {
    const n = Math.min(this.count, shown, this.limit);
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
 * One simulation plus everything that draws it. Bodies are looked up by the id
 * they started with, since merging renumbers them. style:
 *   "solid" - lit spheres and full trails (the original, and the copy in split screen)
 *   "ghost" - see-through wireframe spheres, ring dots, dashed trails (twin overlay)
 *   "cloud" - just a small ring dot and a faint short trail (one of many copies)
 * A run made of particles draws its big bodies this way, and the rocks in `rocks`.
 */
function makeRun(sim, style) {
  const group = new THREE.Group();
  world.add(group);
  const bodies = sim.nBig ?? sim.n;
  const run = { sim, style, group, bodies, meshes: [], dots: [], trails: [],
    minScale: sim.nBig === undefined ? SINGULAR_RATIO * sim.timescale() : 0 };
  for (let i = 0; i < bodies; i++) {
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
  if (sim.nBig !== undefined) makeRocks(run);
  recordTrails(run);
  return run;
}

/** The particles of a moon, as one instanced mesh, in true size. Coloured by
 *  where each one started: a core and alternating wedges, so stretching and
 *  shearing show up as the pattern distorts. */
function makeRocks(run) {
  const { sim } = run;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.85 }), sim.startCount);
  rocks.frustumCulled = false;
  const [cx, cy, cz] = sim.cometFrom ? sim.planetCentre() : sim.particleCentre();
  run.moonSpread = sim.spread();
  run.moonRadius = sim.planetRadius ?? run.moonSpread / Math.sqrt(0.6); // rms radius of a uniform ball
  run.rockColors = [];
  for (let i = sim.nBig; i < sim.n; i++) {
    const [x, y, z] = [sim.pos[3 * i] - cx, sim.pos[3 * i + 1] - cy, sim.pos[3 * i + 2] - cz];
    const wedge = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * ROCK_WEDGES) % 2;
    const core = Math.hypot(x, y, z) < 0.5 * run.moonRadius;
    const isImpactor = sim.cometFrom && sim.ids[i] >= sim.cometFrom;
    run.rockColors.push(new THREE.Color(isImpactor ? ROCK_IMPACTOR : core ? ROCK_CORE : ROCK_COLORS[wedge]));
    rocks.setColorAt(i - sim.nBig, run.rockColors.at(-1));
  }
  rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rocks.instanceMatrix.array.fill(0);
  run.rocks = rocks;
  run.rockCount = sim.particleCount;
  run.group.add(rocks);
}

/** Copy the particles into the instanced mesh. A particle absorbed by a planet
 *  renumbers the others, so colours are redone when the count changes. */
function updateRocks(run) {
  const { sim, rocks } = run;
  const m = rocks.instanceMatrix.array;
  const count = sim.particleCount;
  for (let k = 0; k < count; k++) {
    const i = sim.nBig + k;
    const r = sim.radii[i];
    const o = 16 * k;
    m[o] = m[o + 5] = m[o + 10] = r;
    m[o + 12] = sim.pos[3 * i];
    m[o + 13] = sim.pos[3 * i + 2];
    m[o + 14] = -sim.pos[3 * i + 1];
    m[o + 15] = 1;
  }
  rocks.count = count;
  rocks.instanceMatrix.needsUpdate = true;
  if (count !== run.rockCount) {
    run.rockCount = count;
    for (let k = 0; k < count; k++) {
      rocks.setColorAt(k, run.rockColors[sim.ids[sim.nBig + k] - sim.nBig]);
    }
    rocks.instanceColor.needsUpdate = true;
  }
}

function recordTrails(run) {
  const tmp = new THREE.Vector3();
  run.trails.forEach((t, id) => {
    const i = run.sim.indexOfId(id);
    if (i >= 0) t.push(toScene(run.sim, i, tmp));
    else t.shrink(Number(ui.trail.value));
  });
}

/** Largest distance between matching bodies of two simulations (a body
 *  absorbed in a merge counts as being where its mass now is). */
function gapBetween(a, b, bodies) {
  let worst = 0;
  for (let id = 0; id < bodies; id++) {
    const [i, j] = [a.holderOf(id), b.holderOf(id)];
    worst = Math.max(worst, Math.hypot(a.pos[3 * i] - b.pos[3 * j],
      a.pos[3 * i + 1] - b.pos[3 * j + 1], a.pos[3 * i + 2] - b.pos[3 * j + 2]));
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

// ---- tide arrows ------------------------------------------------------------

const ARROW_VERTS = 10; // a shaft and two heads of two strokes, 2 ends each
const ARROW_LENGTH = 0.6; // beyond the body, at the starting strength, as a fraction of its drawn radius
const ARROW_LENGTH_MAX = 2;
const ARROW_MIN_RATIO = 0.3; // a body with a weaker tide than this (cube root of the ratio) gets no arrow
const ARROW_COLOR = new THREE.Color("#ff9d4d");

/**
 * One double-headed arrow through each body, along the axis the tide stretches
 * it. The direction is exact. The length is compressed (cube root of the
 * strength, so it goes with 1/distance), or moons would need arrows 300x longer
 * at closest approach.
 */
function makeTideArrows() {
  const verts = Math.max(main.bodies, 1) * ARROW_VERTS;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  tideLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  tideLines.frustumCulled = false;
  main.group.add(tideLines);
  // The scale is set by the strongest tide at the start.
  tideReference = Math.max(...tideSites().map((s) => tideSize(s.tensor)), 1e-300);
}

const tideSize = (T) => Math.sqrt(T.reduce((sum, v) => sum + v * v, 0));

/** Where to draw an arrow: each body, or for a particle moon its centre, feeling the big bodies. */
function tideSites() {
  const sim = main.sim;
  if (main.rocks) {
    // Once torn apart, the moon is no longer one body for a tide to act on.
    if (sim.particleCount === 0 || sim.spread() > 1.5 * main.moonSpread) return [];
    const c = sim.particleCentre();
    return [{ centre: c, tensor: sim.tidalTensor(c[0], c[1], c[2], sim.nBig), radius: main.moonRadius }];
  }
  const sites = [];
  for (let i = 0; i < sim.n; i++) {
    sites.push({ centre: sim.position(i), tensor: sim.tidalTensorOn(i), radius: sim.radii[i] });
  }
  return sites;
}

function updateTideArrows() {
  tideLines.visible = ui.tides.checked;
  if (!ui.tides.checked) return;
  const position = tideLines.geometry.attributes.position;
  const color = tideLines.geometry.attributes.color;
  let v = 0;
  const put = (x, y, z) => {
    position.setXYZ(v, x, z, -y); // physics to scene
    color.setXYZ(v, ARROW_COLOR.r, ARROW_COLOR.g, ARROW_COLOR.b);
    v++;
  };
  for (const { centre, tensor: T, radius } of tideSites()) {
    const ratio = Math.cbrt(tideSize(T) / tideReference);
    if (ratio < ARROW_MIN_RATIO) continue;
    const [cx, cy, cz] = centre;
    // Far enough out to see, however small the body or wide the view.
    const onScreen = 0.035 * camera.position.distanceTo(new THREE.Vector3(cx, cz, -cy));
    const body = Math.max(radius * 1.2, onScreen);
    const reach = body * (1 + Math.min(ARROW_LENGTH * ratio, ARROW_LENGTH_MAX));
    const [ux, uy, uz] = stretchAxis(T);
    const across = Math.hypot(ux, uy) || 1; // the heads open in the orbital plane
    const [sx, sy] = [-uy / across, ux / across];
    const head = 0.3 * body;
    put(cx - ux * reach, cy - uy * reach, cz - uz * reach);
    put(cx + ux * reach, cy + uy * reach, cz + uz * reach);
    for (const end of [-1, 1]) {
      const [tx, ty, tz] = [cx + end * ux * reach, cy + end * uy * reach, cz + end * uz * reach];
      for (const side of [-1, 1]) {
        put(tx, ty, tz);
        put(tx - end * ux * head + side * sx * 0.6 * head, ty - end * uy * head + side * sy * 0.6 * head, tz - end * uz * head);
      }
    }
  }
  tideLines.geometry.setDrawRange(0, v);
  position.needsUpdate = true;
  color.needsUpdate = true;
}

// ---- state ----------------------------------------------------------------

const ui = Object.fromEntries(
  ["presets", "intro-presets", "about", "play", "icon-play", "icon-pause", "reset", "speed", "speed-value",
    "trail", "trail-value", "view-angle", "view-top", "view-side", "bodies", "time", "energy", "status",
    "chaos", "chaos-row", "nudge", "nudge-value", "chaos-panel", "chart", "horizon", "split-labels",
    "split-right", "panel-show", "panel-hide", "intro", "intro-open", "intro-close", "tour-start",
    "tides", "heat", "heat-row", "count", "count-row", "orbiting", "orbiting-row", "inset"]
    .map((id) => [id, document.getElementById(id)]),
);

let presetName; // key of SCENARIOS
let preset; // entry of SCENARIOS
let main; // the original run
let copies = []; // nudged runs (twin/split: one; cloud: many)
let mode = "off"; // chaos comparison: off | twin | split | cloud
let nudge = 1e-4;
let e0; // starting energy
let extent; // size of the starting configuration, sets camera and drawn sizes
let playing = true;
let gapHistory = []; // [time, gap] for the chart
let horizon = null; // time the copies first visibly separated
let floor = null; // the grid in the orbital plane
let inset = null; // the markers in the small overview, if shown
const followed = new THREE.Vector3(); // where the view was last centred
const UP = new THREE.Vector3(0, 1, 0);
let sunBearing = 0; // the planet's direction from the Sun, when the camera last turned
let tideLines = null;
let tideReference = 1;
let flashes = []; // merges being shown: {mesh, age}
let mergesShown = 0;
let bodyRowsFor = null; // what the body list currently describes
let lastSlowReadout = -Infinity;

// ---- building a preset ----------------------------------------------------

function load(name) {
  presetName = name;
  preset = SCENARIOS[name];
  world.clear();
  gapHistory = [];
  horizon = null;
  flashes = [];
  mergesShown = 0;
  bodyRowsFor = null;
  lastSlowReadout = -Infinity;

  const sim = makeSim();
  e0 = sim.energyBudget();
  const tmp = new THREE.Vector3();
  extent = preset.extent ?? 0;
  if (!extent) for (let i = 0; i < sim.n; i++) extent = Math.max(extent, toScene(sim, i, tmp).length());

  // Faint floor grid in the orbital plane, for a sense of depth.
  floor = new THREE.GridHelper(niceSize(extent * 3), 20, 0x2a3140, 0x1a1f2b);
  world.add(floor);

  main = makeRun(sim, "solid");
  copies = [];
  if (mode === "twin" || mode === "split") {
    // Same nudge as visualize.py --nudge: body 1 moved by `nudge` in x.
    const twin = makeSim();
    twin.pos[0] += nudge;
    copies.push(makeRun(twin, mode === "split" ? "solid" : "ghost"));
  } else if (mode === "cloud") {
    // Every body of every copy moved by `nudge` in a random direction in
    // the orbital plane.
    const random = seededRandom(1);
    for (let c = 0; c < CLOUD_SIZE; c++) {
      const copy = makeSim();
      for (let i = 0; i < copy.n; i++) {
        const angle = 2 * Math.PI * random();
        copy.pos[3 * i] += nudge * Math.cos(angle);
        copy.pos[3 * i + 1] += nudge * Math.sin(angle);
      }
      copies.push(makeRun(copy, "cloud"));
    }
  }
  makeTideArrows();
  inset = preset.follow ? makeInset(main) : null;
  ui.inset.hidden = !inset;
  recordGap();

  ui.about.textContent = preset.about;
  for (const chip of ui.presets.querySelectorAll(".chip")) {
    chip.classList.toggle("active", chip.dataset.preset === name);
  }
  ui.chaos.value = mode;
  ui["chaos-row"].hidden = Boolean(preset.particles);
  ui["chaos-panel"].hidden = mode === "off";
  ui["split-labels"].hidden = mode !== "split";
  ui["split-right"].textContent = `Nudged by ${formatNudge(nudge)}`;
  ui["count-row"].hidden = !preset.particles;
  ui["orbiting-row"].hidden = !preset.follow;
  ui["heat-row"].hidden = true;
  ui.status.textContent = "";
  setView("angle");
  updateFollow();
  updateScene();
}

/** A preset's simulation, with collisions merging bodies instead of ending the run. */
function makeSim() {
  const sim = preset.make();
  sim.merge = true;
  return sim;
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

// ---- camera ---------------------------------------------------------------

function setView(kind) {
  const d = preset.viewDistance ?? extent * 3.2;
  const directions = { angle: [0, 0.75, 1], top: [0, 1, 1e-4], side: [0, 0.02, 1] };
  const centre = followPoint();
  camera.position.set(...directions[kind]);
  // A followed planet is seen from its far side, so the Sun sits at the top edge.
  if (preset.follow) {
    const out = centre.clone().sub(sunPoint()).setY(0).normalize();
    if (kind === "angle") camera.position.set(out.x, FOLLOW_TILT, out.z);
    if (kind === "side") camera.position.set(out.x, 0.02, out.z);
    if (kind === "top") camera.position.set(out.x * 1e-4, 1, out.z * 1e-4);
  }
  camera.position.normalize().multiplyScalar(d).add(centre);
  controls.target.copy(centre);
  controls.update();
  followed.copy(centre);
  sunBearing = bearingFromSun(centre);
}

/** The Sun, in scene coordinates. */
function sunPoint() {
  return toScene(main.sim, 0, new THREE.Vector3());
}

/** The direction from the Sun to a point, as an angle around the vertical. */
function bearingFromSun(point) {
  const sun = sunPoint();
  return Math.atan2(point.x - sun.x, point.z - sun.z);
}

/** The point the view stays on: the planet, for a preset that follows it. */
function followPoint() {
  if (!preset.follow) return new THREE.Vector3();
  const [x, y, z] = main.sim.planetCentre();
  return new THREE.Vector3(x, z, -y);
}

/** Move the camera and the floor grid along with the planet. */
function updateFollow() {
  if (!preset.follow) return;
  const centre = followPoint();
  // Carry the camera along and turn it with the orbit, so the Sun stays where it is on screen.
  const bearing = bearingFromSun(centre);
  const offset = camera.position.clone().sub(controls.target).applyAxisAngle(UP, bearing - sunBearing);
  sunBearing = bearing;
  controls.target.copy(centre);
  camera.position.copy(centre).add(offset);
  floor.position.set(centre.x, 0, centre.z);
  floor.rotation.y = bearing;
  followed.copy(centre);
  updateInset(centre);
}

// ---- inset: the whole system from above, for a preset that follows the planet -------

const INSET_LAYER = 1; // things only the inset's camera draws
const INSET_MARGIN = 12;
const INSET_SIZE = 210; // on screen, at most
const INSET_ROOM = 1.3; // the view's half-width, in orbit radii
const insetCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1e4);
insetCamera.layers.set(INSET_LAYER);
insetCamera.up.set(0, 0, -1);
insetCamera.position.set(0, 1000, 0);
insetCamera.lookAt(0, 0, 0);
scene.children.filter((c) => c.isLight).forEach((light) => light.layers.enable(INSET_LAYER));

/** Markers for the inset: the Sun itself, dots for the planet and the impactor
 *  (too small to see at this scale), and the path the planet has taken. */
function makeInset(run) {
  run.meshes[0].traverse((part) => part.layers.enable(INSET_LAYER));
  const dot = (color) => {
    const d = screenDot(new THREE.Color(color), DOT, 6);
    d.layers.set(INSET_LAYER);
    d.frustumCulled = false;
    run.group.add(d);
    return d;
  };
  const trail = new Trail(new THREE.Color("#8d94a3"), MAX_TRAIL);
  trail.line.layers.set(INSET_LAYER);
  run.group.add(trail.line);
  const room = INSET_ROOM * followPoint().length();
  insetCamera.left = insetCamera.bottom = -room;
  insetCamera.right = insetCamera.top = room;
  insetCamera.updateProjectionMatrix();
  return { planet: dot("#c8ccd4"), impactor: dot(ROCK_IMPACTOR), trail };
}

function updateInset(centre) {
  if (!inset) return;
  inset.planet.position.copy(centre);
  const sim = main.sim;
  inset.impactor.visible = sim.time < sim.contactTime;
  if (inset.impactor.visible) {
    const [x, y, z] = sim.cometCentre();
    inset.impactor.position.set(x, z, -y);
  }
  inset.trail.push(centre);
  inset.trail.update(MAX_TRAIL, 0);
}

/** Draw the inset in the top right corner of the window. */
function renderInset() {
  const { width, height } = viewArea();
  const size = Math.min(INSET_SIZE, Math.floor(0.3 * Math.min(width, height)));
  const x = window.innerWidth - size - INSET_MARGIN;
  renderer.setViewport(x, height - size - INSET_MARGIN, size, size);
  renderer.setScissor(x, height - size - INSET_MARGIN, size, size);
  renderer.render(scene, insetCamera);
  Object.assign(ui.inset.style, { left: `${x}px`, top: `${INSET_MARGIN}px`, width: `${size}px`, height: `${size}px` });
}

// ---- simulation loop --------------------------------------------------------

/** Advance every run by the sim time this frame should cover, recording a
 *  trail point every preset.t / TRAIL_POINTS_PER_RUN of simulation time.
 *  The copies follow the original's clock. */
function advance(realSeconds) {
  const sim = main.sim;
  const simDt = realSeconds * (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
  if (preset.particles) {
    // Above 1x, trade some frame rate for speed. The label shows the speed asked for,
    // even when this budget means a preset can't quite reach it (see README).
    const speed = speedMultiplier();
    sim.advanceBy(simDt, speed > 1 ? Math.min(FRAME_BUDGET_MS * speed, FRAME_BUDGET_MAX_MS) : FRAME_BUDGET_MS);
    recordTrails(main);
    return;
  }
  const tEnd = sim.time + simDt;
  const spacing = Math.max(preset.t / TRAIL_POINTS_PER_RUN, simDt / MAX_POINTS_PER_FRAME);
  while (sim.time < tEnd) {
    const target = Math.min(sim.time + spacing, tEnd);
    for (const run of copies) {
      run.sim.advanceTo(target, preset.eta, run.minScale);
      recordTrails(run);
    }
    sim.advanceTo(target, preset.eta, main.minScale);
    recordTrails(main);
  }
  recordGap();
}

/** Note how far the copies have drifted from the original (worst copy). */
function recordGap() {
  if (!copies.length) return;
  const gap = Math.max(...copies.map((run) => gapBetween(main.sim, run.sim, main.bodies)));
  gapHistory.push([main.sim.time, gap]);
  if (gapHistory.length > 4000) gapHistory = gapHistory.filter((_, k) => k % 2 === 0);
  if (horizon === null && gap > VISIBLE_GAP * extent) horizon = main.sim.time;
}

/** A flash where each new merge happened, and a line saying what merged. */
function showMerges(dt) {
  const { merges } = main.sim;
  for (; mergesShown < merges.length; mergesShown++) {
    const { position: [x, y, z], survivor, absorbed } = merges[mergesShown];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, depthWrite: false }));
    mesh.position.set(x, z, -y);
    main.group.add(mesh);
    flashes.push({ mesh, age: 0 });
    ui.status.textContent = `Body ${absorbed + 1} merged into body ${survivor + 1}`;
  }
  flashes = flashes.filter((flash) => {
    flash.age += dt;
    const k = flash.age / FLASH_SECONDS;
    flash.mesh.scale.setScalar(Math.max(k * FLASH_SIZE * extent, 1e-9));
    flash.mesh.material.opacity = Math.max(1 - k, 0) * 0.7;
    if (k < 1) return true;
    main.group.remove(flash.mesh);
    return false;
  });
}

/** The list of bodies and masses; rewritten only when it changes. */
function updateBodyList() {
  const sim = main.sim;
  const key = `${sim.n}`;
  if (key === bodyRowsFor) return;
  bodyRowsFor = key;
  const rows = [];
  for (let id = 0; id < main.bodies; id++) {
    const i = sim.indexOfId(id);
    const dot = `<span class="dot" style="background:${COLORS[id % COLORS.length]};${i < 0 ? "opacity:0.3" : ""}"></span>`;
    const name = sim.cometFrom ? "Sun" : `body ${id + 1}`;
    rows.push(`<li>${dot}${name}, ${i < 0 ? "merged" : `mass ${formatNumber(sim.masses[i])}`}</li>`);
  }
  if (main.rocks) {
    // By where the rocks started, in the colour they have on screen.
    const groups = sim.cometFrom
      ? [{ name: "Planet", color: ROCK_COLORS[0], count: 0, mass: 0 }, { name: "Impactor", color: ROCK_IMPACTOR, count: 0, mass: 0 }]
      : [{ name: preset.rocks ?? "Moon", color: ROCK_COLORS[0], count: 0, mass: 0 }];
    for (let i = sim.nBig; i < sim.n; i++) {
      const group = groups[sim.cometFrom && sim.ids[i] >= sim.cometFrom ? 1 : 0];
      group.count++;
      group.mass += sim.masses[i];
    }
    for (const { name, color, count, mass } of groups) {
      rows.push(`<li><span class="dot" style="background:${color}"></span>${name}, ${count} rocks, mass ${formatNumber(mass)}</li>`);
    }
  }
  ui.bodies.innerHTML = rows.join("");
}

/** Copy the simulation state into the meshes and trail lines. */
function updateScene(dt = 0) {
  const shown = Number(ui.trail.value);
  const dash = extent * 0.02;
  for (const run of [main, ...copies]) {
    run.meshes.forEach((mesh, id) => {
      const i = run.sim.indexOfId(id);
      mesh.visible = i >= 0;
      if (i < 0) return;
      toScene(run.sim, i, mesh.position);
      // True radius, so touching on screen means touching in the physics.
      // Tiny bodies stay visible through their screen-size dot.
      mesh.scale.setScalar(Math.max(run.sim.radii[i], 1e-9));
    });
    run.dots.forEach((dot, id) => {
      const i = run.sim.indexOfId(id);
      dot.visible = i >= 0;
      if (i >= 0) toScene(run.sim, i, dot.position);
    });
    run.trails.forEach((t) => t.update(shown, dash));
    if (run.rocks) updateRocks(run);
  }
  showMerges(dt);
  updateTideArrows();
  updateBodyList();

  const sim = main.sim;
  ui.time.textContent = sim.time.toFixed(2);
  // A particle system's energy costs N^2, so it needn't update every frame.
  const now = performance.now() / 1000;
  if (!preset.particles || now - lastSlowReadout >= SLOW_READOUT_SECONDS) {
    lastSlowReadout = now;
    ui.energy.textContent = Math.abs((sim.energyBudget() - e0) / e0).toExponential(1);
    ui["heat-row"].hidden = sim.heat <= 0;
    ui.heat.textContent = formatNumber(sim.heat);
    if (preset.follow) ui.orbiting.textContent = impactOutcome(sim).orbiting;
  }
  if (preset.particles) ui.count.textContent = sim.particleCount;
  if (copies.length) {
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
  if (playing) advance(dt);
  updateFollow();
  updateScene(dt);
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
  if (inset) renderInset();
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

function formatSpeed(multiplier) {
  return `${multiplier.toFixed(multiplier < 1 ? 2 : 1)}×`;
}

function setSpeed(multiplier) {
  ui.speed.value = Math.log10(multiplier);
  ui["speed-value"].textContent = formatSpeed(speedMultiplier());
}

function setTrail(points) {
  ui.trail.value = points;
  ui["trail-value"].textContent = ui.trail.value;
}

function setPlaying(value) {
  playing = value;
  // SVG elements have no .hidden property, so set the attribute itself.
  ui["icon-pause"].toggleAttribute("hidden", !playing);
  ui["icon-play"].toggleAttribute("hidden", playing);
  const label = playing ? "Pause" : "Play";
  ui.play.title = `${label} (Space)`;
  ui.play.setAttribute("aria-label", label);
}

/** Keep the page address in step with the settings, so it can be shared. */
function updateUrl() {
  const p = new URLSearchParams({ preset: presetName, speed: +speedMultiplier().toPrecision(2) });
  if (mode !== "off" || preset.chaos) p.set("chaos", mode);
  if (mode !== "off") p.set("nudge", formatNudge(nudge));
  if (ui.tides.checked !== Boolean(preset.tides)) p.set("tides", ui.tides.checked ? "1" : "0");
  history.replaceState(null, "", `?${p}`);
}

/** Start the current preset over, keeping the current settings. */
function restart() {
  setPlaying(true);
  load(presetName);
  updateUrl();
}

/** Switch to a preset, with the settings it's meant to be seen with. */
function selectPreset(name) {
  const next = SCENARIOS[name];
  mode = next.chaos ?? "off";
  setSpeed(1);
  setTrail(next.trail ?? DEFAULT_TRAIL);
  ui.tides.checked = Boolean(next.tides);
  setPlaying(true);
  load(name);
  updateUrl();
}

/** The preset menus, grouped in the order of SCENARIOS. `button` makes one entry. */
function buildMenu(menu, listClass, button) {
  const groups = new Set(Object.values(SCENARIOS).map((p) => p.group));
  for (const group of groups) {
    const block = document.createElement("div");
    block.dataset.group = group;
    const heading = document.createElement("div");
    heading.className = "group-name";
    heading.textContent = group;
    const list = document.createElement("div");
    list.className = listClass;
    for (const [name, p] of Object.entries(SCENARIOS)) {
      if (p.group === group) list.append(button(name, p));
    }
    block.append(heading, list);
    menu.append(block);
  }
}

buildMenu(ui.presets, "chips", (name, p) => {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.dataset.preset = name;
  chip.title = p.about;
  chip.textContent = p.label;
  chip.addEventListener("click", () => selectPreset(name));
  return chip;
});
buildMenu(ui["intro-presets"], "tiles", (name, p) => {
  const tile = document.createElement("button");
  tile.className = "tile";
  const strong = document.createElement("strong");
  strong.textContent = p.label;
  const span = document.createElement("span");
  span.textContent = p.about;
  tile.append(strong, span);
  tile.addEventListener("click", () => {
    setIntroVisible(false);
    selectPreset(name);
  });
  return tile;
});

ui.play.addEventListener("click", () => setPlaying(!playing));
ui.reset.addEventListener("click", restart);
ui.speed.addEventListener("input", () => setSpeed(speedMultiplier()));
ui.speed.addEventListener("change", updateUrl);
ui.trail.addEventListener("input", () => setTrail(ui.trail.value));
ui.tides.addEventListener("change", updateUrl);
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

const presetGroup = (group) => () => ui.presets.querySelector(`[data-group="${group}"]`);
const TOUR_STEPS = [
  { target: () => ui.presets, title: "Start here",
    text: "Each button is a different experiment." },
  { target: presetGroup("Orbits"), enter: () => selectPreset("figure8"), title: "Orbits",
    text: "Patterns that repeat. Here, three masses share one path." },
  { target: presetGroup("Chaos"), enter: () => selectPreset("butterfly"), title: "Chaos",
    text: "These 30 copies start almost identical. Watch them scatter." },
  { target: presetGroup("Impacts & tides"), enter: () => selectPreset("moon-torn"), title: "Impacts & tides",
    text: "Bodies collide and merge. This moon is 1,000 rocks, and tides are tearing it apart." },
  { target: () => { const a = viewArea(); return new DOMRect(a.left, 0, a.width, a.height); },
    title: "Look around",
    text: "Drag to rotate, scroll to zoom. <kbd>Space</kbd> pauses, <kbd>R</kbd> restarts, <kbd>H</kbd> hides the panel." },
];

function setIntroVisible(visible) {
  ui.intro.hidden = !visible;
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
ui["panel-show"].addEventListener("click", () => setPanelVisible(true));
window.addEventListener("keydown", (e) => {
  if (!ui.intro.hidden) {
    if (e.code === "Escape") setIntroVisible(false);
    return; // keys don't reach the simulation while the intro is open
  }
  if (e.target.tagName === "SELECT") return;
  if (e.code === "Space") {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey) { // Ctrl+R still reloads the page
    restart();
  } else if (e.code === "KeyH") {
    setPanelVisible(document.getElementById("panel").hidden);
  }
});
window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));

// URL options: ?preset=pythagorean&speed=4 picks the preset and playback
// speed; &chaos=off|twin|split|cloud&nudge=1e-4 sets the chaos comparison;
// &tides=0|1 the tide arrows; &start=10 fast-forwards to simulation time 10
// (replaying the same 60 fps steps as live play, so the view is exactly what
// you'd have seen); &paused=1 starts paused; &panel=0 starts with the controls
// hidden; &intro=1 opens the welcome overlay; &tour=1 starts the tour.
const params = new URLSearchParams(location.search);
const requested = params.get("preset");
const startName = requested in SCENARIOS ? requested : "figure8";
const startPreset = SCENARIOS[startName];
setSpeed(Number(params.get("speed")) || 1);
setTrail(startPreset.trail ?? DEFAULT_TRAIL);
ui.tides.checked = params.has("tides") ? params.get("tides") === "1" : Boolean(startPreset.tides);
mode = startPreset.chaos ?? "off";
if (["off", "twin", "split", "cloud"].includes(params.get("chaos"))) mode = params.get("chaos");
if (startPreset.particles) mode = "off";
if (Number(params.get("nudge")) > 0) {
  nudge = 10 ** Math.round(Math.log10(Number(params.get("nudge"))));
  ui.nudge.value = Math.log10(nudge);
}
ui["nudge-value"].textContent = formatNudge(nudge);
load(startName);
const start = Number(params.get("start")) || 0;
const simPerRealSecond = (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
while (main.sim.time < start - 1e-9) {
  advance(Math.min(1 / 60, (start - main.sim.time) / simPerRealSecond));
}
if (params.get("paused") === "1") setPlaying(false);
if (params.get("panel") === "0") setPanelVisible(false);
// The plain address is the landing page: it always opens with the presets.
// Links with options go straight to the simulation.
if (params.get("intro") === "1" || !location.search) setIntroVisible(true);
if (params.get("tour") === "1") startTour(TOUR_STEPS);
