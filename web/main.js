// 3D live view: runs the engine in real time and draws it with three.js.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { SCENARIOS } from "./scenarios.js";

const COLORS = ["#f5a623", "#4a90e2", "#d0021b", "#7ed321", "#9013fe"];
const BACKGROUND = new THREE.Color("#0b0e14");
const MAX_TRAIL = 5000; // trail points kept per body (the slider picks how many to show)
const PLAYBACK_SECONDS = 15; // at 1x speed a preset's suggested run lasts this long
// Trail points are recorded at fixed steps of simulation time (not once per
// frame), so trails are equally smooth at any speed: 3600 per suggested run.
const TRAIL_POINTS_PER_RUN = 3600;
const MAX_POINTS_PER_FRAME = 400; // keeps a frame cheap at extreme speeds
const SINGULAR_RATIO = 1e-8; // same point-mass collision cutoff as System.run
const MIN_SIZE = 0.008; // smallest drawn radius, as a fraction of the scene size

// The physics uses x-y as the orbital plane (z up); three.js has y up.
// Map physics (x, y, z) -> scene (x, z, -y) so orbits lie on the floor grid.
const toScene = (sim, i, out) =>
  out.set(sim.pos[3 * i], sim.pos[3 * i + 2], -sim.pos[3 * i + 1]);

// ---- three.js setup -----------------------------------------------------

const container = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
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

// A round dot that keeps the same size on screen at any zoom, drawn at the
// centre of every body so even point masses and tiny moons stay visible.
const dotTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(32, 32, 30, 0, 2 * Math.PI);
  g.fill();
  return new THREE.CanvasTexture(c);
})();

// ---- state ----------------------------------------------------------------

const ui = Object.fromEntries(
  ["preset", "about", "play", "reset", "speed", "speed-value", "trail", "trail-value",
    "view-angle", "view-top", "view-side", "true-size", "bodies", "time", "energy", "status"]
    .map((id) => [id, document.getElementById(id)]),
);

let sim; // engine System
let preset; // entry of SCENARIOS
let minScale; // point-mass collision cutoff for advanceTo
let e0; // starting energy
let extent; // size of the starting configuration, sets camera and drawn sizes
let playing = true;
let bodies = []; // per body: {mesh, trail: {line, points: Float32Array, count}}
let impactMarker = null;

// ---- building a preset ----------------------------------------------------

function load(name) {
  preset = SCENARIOS[name];
  sim = preset.make();
  minScale = SINGULAR_RATIO * sim.timescale();
  e0 = sim.energy();

  world.clear();
  impactMarker = null;
  const tmp = new THREE.Vector3();
  extent = 0;
  for (let i = 0; i < sim.n; i++) extent = Math.max(extent, toScene(sim, i, tmp).length());

  // Faint floor grid in the orbital plane, for a sense of depth.
  const gridSize = niceSize(extent * 3);
  const grid = new THREE.GridHelper(gridSize, 20, 0x2a3140, 0x1a1f2b);
  world.add(grid);

  bodies = [];
  for (let i = 0; i < sim.n; i++) {
    const color = new THREE.Color(COLORS[i % COLORS.length]);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 }),
    );
    world.add(mesh);
    const dot = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3)),
      new THREE.PointsMaterial({ color, size: 7, sizeAttenuation: false, map: dotTexture,
        transparent: true, alphaTest: 0.5 }),
    );
    mesh.add(dot); // rides along with the sphere

    // The trail history (points) and the drawn line (the geometry's own
    // buffer) must be separate arrays: updateScene copies the newest part of
    // the history into the line, which would otherwise overwrite the history.
    const points = new Float32Array(MAX_TRAIL * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 4), 4)); // RGBA
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    line.frustumCulled = false; // its bounding box changes every frame
    world.add(line);

    bodies.push({ mesh, color, trail: { line, points, count: 0 } });
  }
  applySizes();
  recordTrails();

  ui.about.textContent = preset.about;
  ui.bodies.innerHTML = bodies.map((b, i) =>
    `<li><span class="dot" style="background:${COLORS[i % COLORS.length]}"></span>` +
    `body ${i + 1} &nbsp;<span style="color:var(--muted)">mass ${formatNumber(sim.masses[i])}</span></li>`,
  ).join("");
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

/** Bodies are drawn at their true radius, or (unless "true sizes" is ticked)
 *  enlarged to a minimum so tiny ones like a Trojan asteroid stay visible. */
function applySizes() {
  const trueSize = ui["true-size"].checked;
  bodies.forEach((b, i) => {
    const r = trueSize ? sim.radii[i] : Math.max(sim.radii[i], MIN_SIZE * extent);
    b.mesh.scale.setScalar(Math.max(r, 1e-9)); // radius 0: only the screen-size dot shows
  });
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

/** Append each body's current position to its trail (oldest dropped when full). */
function recordTrails() {
  const tmp = new THREE.Vector3();
  bodies.forEach((b, i) => {
    const t = b.trail;
    if (t.count === MAX_TRAIL) {
      t.points.copyWithin(0, 3); // drop the oldest point
      t.count--;
    }
    toScene(sim, i, tmp).toArray(t.points, 3 * t.count);
    t.count++;
  });
}

/** Advance the physics by the sim time this frame should cover, recording a
 *  trail point every preset.t / TRAIL_POINTS_PER_RUN of simulation time. */
function advance(realSeconds) {
  const tEnd = sim.time + realSeconds * (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
  const spacing = Math.max(preset.t / TRAIL_POINTS_PER_RUN, (tEnd - sim.time) / MAX_POINTS_PER_FRAME);
  while (sim.time < tEnd) {
    const collided = sim.advanceTo(Math.min(sim.time + spacing, tEnd), preset.eta, minScale);
    recordTrails();
    if (collided) {
      onCollision();
      return;
    }
  }
}

function onCollision() {
  playing = false;
  ui.play.textContent = "Play";
  const [i, j] = sim.collision;
  setStatus(`Collision: body ${i + 1} hit body ${j + 1} at t = ${sim.time.toFixed(3)}`, true);
  const a = toScene(sim, i, new THREE.Vector3());
  const b = toScene(sim, j, new THREE.Vector3());
  impactMarker = new THREE.Mesh(
    new THREE.SphereGeometry(MIN_SIZE * extent * 4, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, wireframe: true }),
  );
  impactMarker.position.copy(a.add(b).multiplyScalar(0.5));
  world.add(impactMarker);
}

/** Copy the simulation state into the meshes and trail lines. */
function updateScene() {
  const shown = Number(ui.trail.value);
  bodies.forEach((b, i) => {
    toScene(sim, i, b.mesh.position);
    const t = b.trail;
    const n = Math.min(t.count, shown);
    const first = t.count - n;
    // Draw the newest n points, fading out by transparency with age, so
    // where trails overlap (e.g. all three share the figure-8) an old,
    // faded trail doesn't hide a fresh one underneath.
    const geometry = t.line.geometry;
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    pos.array.set(t.points.subarray(3 * first, 3 * t.count));
    for (let k = 0; k < n; k++) {
      col.array[4 * k] = b.color.r;
      col.array[4 * k + 1] = b.color.g;
      col.array[4 * k + 2] = b.color.b;
      col.array[4 * k + 3] = n > 1 ? k / (n - 1) : 1;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.setDrawRange(0, n);
  });
  if (impactMarker) impactMarker.rotation.y += 0.02;

  ui.time.textContent = sim.time.toFixed(2);
  ui.energy.textContent = Math.abs((sim.energy() - e0) / e0).toExponential(1);
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1); // don't jump ahead after a stalled tab
  if (playing && !sim.collision) advance(dt);
  updateScene();
  controls.update();
  renderer.render(scene, camera);
});

// ---- controls ---------------------------------------------------------------

function speedMultiplier() {
  return 10 ** Number(ui.speed.value);
}

function setStatus(text, alert = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle("alert", alert);
}

function togglePlay() {
  if (sim.collision) return;
  playing = !playing;
  ui.play.textContent = playing ? "Pause" : "Play";
}

for (const [name, s] of Object.entries(SCENARIOS)) {
  ui.preset.add(new Option(`${name}`, name));
}
ui.preset.addEventListener("change", () => {
  history.replaceState(null, "", `?preset=${ui.preset.value}&speed=${+speedMultiplier().toFixed(2)}`);
  restart();
});

function restart() {
  playing = true;
  ui.play.textContent = "Pause";
  load(ui.preset.value);
}

ui.play.addEventListener("click", togglePlay);
ui.reset.addEventListener("click", restart);
ui.speed.addEventListener("input", () => {
  ui["speed-value"].textContent = `${speedMultiplier().toFixed(speedMultiplier() < 1 ? 2 : 1)}×`;
});
ui.trail.addEventListener("input", () => { ui["trail-value"].textContent = ui.trail.value; });
ui["true-size"].addEventListener("change", applySizes);
ui["view-angle"].addEventListener("click", () => setView("angle"));
ui["view-top"].addEventListener("click", () => setView("top"));
ui["view-side"].addEventListener("click", () => setView("side"));
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    togglePlay();
  }
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// URL options: ?preset=pythagorean&speed=4 picks the preset and playback
// speed; &start=10 fast-forwards to simulation time 10 (replaying the same
// 60 fps steps as live play, so the view is exactly what you'd have seen);
// &paused=1 starts paused.
const params = new URLSearchParams(location.search);
const requested = params.get("preset");
ui.preset.value = requested in SCENARIOS ? requested : "figure8";
if (params.has("speed")) {
  ui.speed.value = Math.log10(Number(params.get("speed")) || 1);
  ui.speed.dispatchEvent(new Event("input"));
}
load(ui.preset.value);
const start = Number(params.get("start")) || 0;
const simPerRealSecond = (preset.t / PLAYBACK_SECONDS) * speedMultiplier();
while (sim.time < start - 1e-9 && !sim.collision) {
  advance(Math.min(1 / 60, (start - sim.time) / simPerRealSecond));
}
if (params.get("paused") === "1") togglePlay();
