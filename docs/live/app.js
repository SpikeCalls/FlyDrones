import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pilot, DEMO_TIMELINE, ROOM } from "./engine.js";

const qs = new URLSearchParams(location.search);
const RECORD = qs.has("record");
const $ = (id) => document.getElementById(id);
const net = await (await fetch(new URL("./minifly.json", import.meta.url))).json();

// ================================================================== state
let pilot, autoplay = qs.get("autoplay") !== "0", scenario = "gestures", schedule = [], webcam = null;
const trail = [];
let toastUntil = -1, prevPos = null, curPos = null, prevYaw = 0, curYaw = 0, acc = 0, spikeRate = 0, lastEscapes = 0, simSpeed = NaN;

function newPilot(kind = "gestures") {
  scenario = kind;
  pilot = kind === "chair" ? new Pilot(net, { start: [-0.9, 0.05, 0], cruise: 0.35, seed: 3 }) : new Pilot(net, { start: [-1.5, 0, 0], seed: 0 });
  trail.length = 0; prevPos = curPos = [...pilot.drone.pos]; prevYaw = curYaw = pilot.drone.yaw;
  lastEscapes = 0; schedule = []; toastUntil = -1;
  brainAct.fill(0); edgePulses.length = 0;
  rasterCtx.clearRect(0, 0, raster.width, raster.height);
}

// ================================================================== three.js scene
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: RECORD });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060a);
scene.fog = new THREE.Fog(0x04060a, 9, 20);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
camera.position.set(-6.2, 5.2, 6.4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.autoRotate = !RECORD; controls.autoRotateSpeed = 0.35;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 2.5; controls.maxDistance = 14;
controls.target.set(-1, 1, 0);

const V = (x, y, z) => new THREE.Vector3(x, z, -y); // sim (z up) -> three (y up)

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  return t;
}
// room: back-face box so the near walls disappear from the orbiting camera
const floorTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#0a0e14"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#121925"; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
  g.strokeStyle = "rgba(76,201,240,.22)"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
}, ROOM.sx / 0.7, ROOM.sy / 0.7);
const wallTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#0b1017"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#101824"; g.fillRect(0, 0, w / 2, h);
  g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(0, h / 2, w, h / 2);
}, ROOM.sx / 0.6, ROOM.h / 0.9);
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, side: THREE.BackSide, roughness: 0.9 });
const room = new THREE.Mesh(new THREE.BoxGeometry(ROOM.sx, ROOM.h, ROOM.sy), [
  wallMat, wallMat,
  new THREE.MeshStandardMaterial({ color: 0x06080c, side: THREE.BackSide }),
  new THREE.MeshStandardMaterial({ map: floorTex, side: THREE.BackSide, roughness: 0.7, metalness: 0.1 }),
  wallMat, wallMat,
]);
room.position.y = ROOM.h / 2;
scene.add(room);
// glowing floor edge
const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(ROOM.sx, 0.001, ROOM.sy)), new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.5 }));
edge.position.y = 0.002; scene.add(edge);

scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x0a0a12, 0.55));
const key = new THREE.PointLight(0x9fd8ff, 18, 14, 1.6); key.position.set(0, 2.5, 0); scene.add(key);
const rim = new THREE.PointLight(0xff4d8d, 10, 10, 1.8); rim.position.set(2.6, 1.8, 2.4); scene.add(rim);

const furniture = {};
const neon = { chair: 0x4cc9f0, bed: 0xa78bfa, wardrobe: 0xffb020 };
for (const b of ROOM.boxes) {
  const size = [b.hi[0] - b.lo[0], b.hi[2] - b.lo[2], b.hi[1] - b.lo[1]];
  const geo = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x151b24, roughness: 0.8 }));
  const c = V((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2);
  mesh.position.copy(c);
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: neon[b.name], transparent: true, opacity: 0.9 }));
  lines.position.copy(c);
  scene.add(mesh, lines);
  const label = makeLabel(b.name.toUpperCase(), neon[b.name]);
  label.position.copy(V((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, b.hi[2] + 0.22));
  scene.add(label);
  furniture[b.name] = { mesh, lines };
}
function makeLabel(text, color) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "700 30px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "#" + color.toString(16).padStart(6, "0"); g.globalAlpha = 0.85; g.fillText(text, 128, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(0.8, 0.2, 1);
  return s;
}

// drone
const drone = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b222d, metalness: 0.6, roughness: 0.35 });
const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.16), bodyMat); drone.add(body);
const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0e1117, metalness: 0.8, roughness: 0.2 }));
canopy.position.y = 0.03; drone.add(canopy);
const ledMat = new THREE.MeshBasicMaterial({ color: 0x39ff88 });
const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.12), ledMat); led.position.set(0.101, 0.0, 0); drone.add(led);
const lens = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4cc9f0 })); lens.position.set(0.105, -0.012, 0); drone.add(lens);
const rotors = [];
for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.014, 0.018), bodyMat);
  arm.position.set(sx * 0.1, 0, sz * 0.08); arm.rotation.y = Math.atan2(-sz * 0.8, sx); drone.add(arm);
  const hub = new THREE.Group(); hub.position.set(sx * 0.19, 0.02, sz * 0.16);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 8, 40), new THREE.MeshBasicMaterial({ color: 0x4cc9f0 }));
  ring.rotation.x = Math.PI / 2; hub.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.08, 32), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; hub.add(disc);
  const blades = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.003, 0.014), new THREE.MeshStandardMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.4 }));
  hub.add(blades); rotors.push({ blades, dir: sx * sz }); drone.add(hub);
}
drone.scale.setScalar(1.8);
scene.add(drone);
const underGlow = new THREE.PointLight(0x39ff88, 2.5, 2.2, 2); underGlow.position.y = -0.05; drone.add(underGlow);
// fly-eye field of view wedge
const fov = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.35 }));
{
  const d = 0.5, tx = Math.tan((82 * Math.PI) / 360), ty = tx * 0.75, o = [0.14, -0.015, 0];
  const c = [[d, ty * d, tx * d], [d, ty * d, -tx * d], [d, -ty * d, -tx * d], [d, -ty * d, tx * d]];
  const pts = [];
  for (const p of c) pts.push(...o, p[0], p[1], p[2]);
  for (let i = 0; i < 4; i++) pts.push(...c[i], ...c[(i + 1) % 4]);
  fov.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}
drone.add(fov);
// shadow + trail
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; scene.add(shadow);
const TRAIL_N = 260;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
trailGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
scene.add(trailLine);
// escape shockwave
const wave = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 64), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
wave.rotation.x = -Math.PI / 2; scene.add(wave);
let waveT = 9;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.45, 0.18);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ================================================================== HUD canvases
const eyes = $("eyes"), eyesCtx = eyes.getContext("2d");
const brainC = $("brain"), brainCtx = brainC.getContext("2d");
const raster = $("raster"), rasterCtx = raster.getContext("2d");
const motor = $("motor"), motorCtx = motor.getContext("2d");
const camImg = document.createElement("canvas"); camImg.width = 96; camImg.height = 72;
const camCtx = camImg.getContext("2d"); const camData = camCtx.createImageData(96, 72);

// brain layout: populations placed like a fly head seen from the front
const LAYOUT = {
  "R1-R6": [0.05, 0.40, 0.03, 0.22], T4a: [0.12, 0.26, 0.025, 0.07], T4b: [0.12, 0.44, 0.025, 0.07], T4c: [0.17, 0.30, 0.025, 0.07],
  T4d: [0.17, 0.50, 0.025, 0.07], LPi_h: [0.225, 0.30, 0.02, 0.04], LPi_v: [0.225, 0.46, 0.02, 0.04], HS: [0.265, 0.27, 0.012, 0.03],
  VS: [0.265, 0.43, 0.012, 0.04], LPLC2: [0.25, 0.62, 0.03, 0.04], LC4: [0.29, 0.70, 0.02, 0.03], PVLP: [0.35, 0.55, 0.03, 0.05],
  PVLP_inh: [0.40, 0.64, 0.02, 0.03], LAL_inh: [0.41, 0.36, 0.025, 0.05], DNg02: [0.445, 0.80, 0.02, 0.05], DNp03: [0.465, 0.91, 0.008, 0.01],
  DNp01: [0.48, 0.955, 0.004, 0.004], haltere: [0.36, 0.95, 0.03, 0.02],
};
const nodes = new Float32Array(net.n * 2);
{
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const [type, side, start, count] of net.pops) {
    const L = LAYOUT[type] || [0.45, 0.2, 0.03, 0.03];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      let x = L[0] + Math.cos(a) * r * L[2], y = L[1] + Math.sin(a) * r * L[3];
      if (side === "R") x = 1 - x;
      nodes[(start + i) * 2] = x; nodes[(start + i) * 2 + 1] = y;
    }
  }
}
const brainAct = new Float32Array(net.n);
const edgePulses = [];
const edgeLayer = document.createElement("canvas"); edgeLayer.width = brainC.width; edgeLayer.height = brainC.height;
{
  const g = edgeLayer.getContext("2d"), W = brainC.width, H = brainC.height;
  g.fillStyle = "rgba(76,201,240,0.03)";
  g.beginPath(); g.ellipse(W * 0.16, H * 0.45, W * 0.15, H * 0.33, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(W * 0.84, H * 0.45, W * 0.15, H * 0.33, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(57,255,136,0.025)"; g.beginPath(); g.ellipse(W * 0.5, H * 0.5, W * 0.2, H * 0.3, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 1;
  for (let pre = 0; pre < net.n; pre++) {
    for (let k = net.indptr[pre]; k < net.indptr[pre + 1]; k++) {
      const post = net.indices[k];
      g.strokeStyle = net.data[k] > 0 ? "rgba(57,255,136,0.035)" : "rgba(255,77,141,0.035)";
      g.beginPath(); g.moveTo(nodes[pre * 2] * W, nodes[pre * 2 + 1] * H); g.lineTo(nodes[post * 2] * W, nodes[post * 2 + 1] * H); g.stroke();
    }
  }
  g.font = "600 17px ui-monospace, Menlo, Consolas, monospace"; g.fillStyle = "rgba(138,152,168,.75)"; g.textAlign = "center";
  g.fillText("optic lobe L", W * 0.16, H * 0.07); g.fillText("optic lobe R", W * 0.84, H * 0.07); g.fillText("central brain", W * 0.5, H * 0.2);
  g.fillText("descending neurons", W * 0.5, H * 0.69);
}
const ROLE_COL = ["57,255,136", "76,201,240", "255,77,141"];

function drawBrain(rates) {
  const g = brainCtx, W = brainC.width, H = brainC.height;
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, W, H); g.drawImage(edgeLayer, 0, 0);
  g.globalCompositeOperation = "lighter";
  g.lineWidth = 1.2;
  for (const [pre, life] of edgePulses) {
    const a = 0.22 * life;
    for (let k = net.indptr[pre]; k < net.indptr[pre + 1]; k++) {
      const post = net.indices[k];
      g.strokeStyle = net.data[k] > 0 ? `rgba(57,255,136,${a})` : `rgba(255,77,141,${a})`;
      g.beginPath(); g.moveTo(nodes[pre * 2] * W, nodes[pre * 2 + 1] * H); g.lineTo(nodes[post * 2] * W, nodes[post * 2 + 1] * H); g.stroke();
    }
  }
  const role = pilot.brain.role;
  for (let i = 0; i < net.n; i++) {
    const a = brainAct[i], x = nodes[i * 2] * W, y = nodes[i * 2 + 1] * H, col = ROLE_COL[role[i]];
    const big = role[i] === 2 ? 2.2 : 1;
    g.fillStyle = `rgba(${col},${0.25 + 0.75 * a})`;
    g.beginPath(); g.arc(x, y, (1.6 + 2.2 * a) * big, 0, Math.PI * 2); g.fill();
    if (a > 0.3) { g.fillStyle = `rgba(${col},${0.18 * a})`; g.beginPath(); g.arc(x, y, (7 + 6 * a) * big, 0, Math.PI * 2); g.fill(); }
  }
  g.globalCompositeOperation = "source-over";
  g.font = "700 15px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "center";
  const dn = [["DNg02", 0.445, 0.80], ["DNp03", 0.465, 0.91], ["DNp01", 0.48, 0.955]];
  for (const [name, x, y] of dn) {
    for (const side of ["L", "R"]) {
      const hz = rates[`${name}_${side}`] || 0, xx = side === "L" ? x : 1 - x;
      g.fillStyle = hz > 5 ? "#ff8fb8" : "rgba(138,152,168,.8)";
      g.fillText(`${hz.toFixed(0)}`, (side === "L" ? xx - 0.11 : xx + 0.11) * W, y * H + 5);
    }
  }
}

function drawEyes(last) {
  const g = eyesCtx, W = eyes.width, H = eyes.height;
  const px = camData.data;
  for (let k = 0; k < 96 * 72; k++) {
    const v = last.gray[k] * 255;
    px[k * 4] = v * 0.62; px[k * 4 + 1] = v * 0.9; px[k * 4 + 2] = v; px[k * 4 + 3] = 255;
  }
  camCtx.putImageData(camData, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(camImg, 0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 0, W, H);
  const { vx, vy, tex, rows, ncols, loomLevel } = last.vision;
  const cw = W / ncols, ch = H / rows;
  g.strokeStyle = "rgba(76,201,240,.16)"; g.lineWidth = 1;
  for (let c = 1; c < ncols; c++) { g.beginPath(); g.moveTo(c * cw, 0); g.lineTo(c * cw, H); g.stroke(); }
  for (let r = 1; r < rows; r++) { g.beginPath(); g.moveTo(0, r * ch); g.lineTo(W, r * ch); g.stroke(); }
  g.strokeStyle = "rgba(76,201,240,.7)"; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  // flow arrows (real camera flow + injected illusion)
  const il = pilot.illusion, gest = pilot.gesture, t = pilot.t;
  let ilx = 0, ily = 0;
  if (pilot.phase === "flight") {
    if (il.mode.startsWith("open palm")) ily = -1.2;
    if (il.mode.startsWith("hand dropped")) ily = 1.2;
    if (il.mode.includes("rotate")) ilx = 1.2 * Math.sign(gest.x);
  }
  g.lineWidth = 2.2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < ncols; c++) {
    const k = r * ncols + c, cx = (c + 0.5) * cw, cy = (r + 0.5) * ch;
    const fx = vx[k] + ilx, fy = vy[k] + ily, m = Math.hypot(fx, fy);
    if (m < 0.08) continue;
    const s = Math.min(1, m / 1.5), L = Math.min(cw * 0.45, 8 + 16 * s);
    const ux = fx / m, uy = fy / m;
    g.strokeStyle = `rgba(${57 + 198 * s * 0},${255},${136 + 60 * s},${0.35 + 0.6 * s})`;
    g.beginPath(); g.moveTo(cx - ux * L, cy - uy * L); g.lineTo(cx + ux * L, cy + uy * L);
    g.lineTo(cx + ux * L - (ux * 6 - uy * 5), cy + uy * L - (uy * 6 + ux * 5));
    g.moveTo(cx + ux * L, cy + uy * L); g.lineTo(cx + ux * L - (ux * 6 + uy * 5), cy + uy * L - (uy * 6 - ux * 5)); g.stroke();
  }
  const loom = Math.max(loomLevel, pilot.illusion.loom > 0.05 ? pilot.illusion.loom : 0);
  if (loom > 0.15) {
    g.strokeStyle = `rgba(255,120,40,${0.4 + 0.6 * loom})`; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
    g.font = "900 30px ui-monospace, Menlo, Consolas, monospace"; g.fillStyle = "#ffb020"; g.textAlign = "center";
    g.fillText("LOOMING", W / 2, H / 2 + 10);
  }
  g.font = "700 20px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "left"; g.fillStyle = "rgba(232,238,245,.85)";
  g.fillText("L eye", 10, H - 12); g.textAlign = "right"; g.fillText("R eye", W - 10, H - 12);
  $("loomTag").textContent = loom > 0.15 ? "LOOMING" : "T4/T5 · LPLC2";
  $("loomTag").style.color = loom > 0.15 ? "#ffb020" : "";
}

const rowOf = new Int32Array(net.n);
{
  const role = new Uint8Array(net.n);
  for (const k of Object.keys(net.config.inputs)) for (const i of net.groups[k] || []) role[i] = 1;
  for (const k of Object.keys(net.config.outputs)) for (const i of net.groups[k] || []) role[i] = 2;
  const rank = { 2: 0, 0: 1, 1: 2 }; // descending on top, then interneurons, then inputs
  const order = [...Array(net.n).keys()].sort((a, b) => rank[role[a]] - rank[role[b]] || a - b);
  order.forEach((i, row) => (rowOf[i] = row));
}
function drawRaster(spikes) {
  const g = rasterCtx, W = raster.width, H = raster.height, step = 8;
  g.globalCompositeOperation = "copy"; g.drawImage(raster, -step, 0);
  g.globalCompositeOperation = "source-over";
  const role = pilot.brain.role;
  for (const [f, i] of spikes) {
    g.fillStyle = `rgb(${ROLE_COL[role[i]]})`;
    g.fillRect(W - step + f * step, (rowOf[i] / net.n) * H, 1.5, 2);
  }
}

function drawMotor(last) {
  const g = motorCtx, W = motor.width, H = motor.height, r = last.rates, c = last.cmd;
  g.clearRect(0, 0, W, H);
  const names = ["DNg02_L", "DNg02_R", "DNp03_L", "DNp03_R", "DNp01_L", "DNp01_R"];
  const x0 = 0, span = 560, bw = span / names.length, top = 8, bh = 128;
  g.font = "700 22px ui-monospace, Menlo, Consolas, monospace"; g.textAlign = "center";
  names.forEach((n, i) => {
    const hz = r[n] || 0, v = Math.min(1, hz / 100), x = x0 + i * bw + 8, w = bw - 16, h = v * bh;
    const grad = g.createLinearGradient(0, top + bh, 0, top);
    grad.addColorStop(0, "#5a1a35"); grad.addColorStop(1, n.includes("p01") ? "#ffb020" : "#ff4d8d");
    g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(x, top, w, bh);
    g.fillStyle = grad; g.fillRect(x, top + bh - h, w, h);
    g.fillStyle = "#e8eef5"; g.fillText(hz.toFixed(0), x + w / 2, Math.max(top + 24, top + bh - h - 6));
    g.fillStyle = "#8a98a8"; g.font = "600 19px ui-monospace, Menlo, Consolas, monospace";
    g.fillText(n.replace("_", " "), x + w / 2, top + bh + 26); g.font = "700 22px ui-monospace, Menlo, Consolas, monospace";
  });
  const axes = [["THROTTLE", c.throttle], ["YAW", c.yaw], ["FORWARD", c.forward]];
  axes.forEach(([label, v], i) => {
    const y = 14 + i * 46, lx = 600, bx = 740, w = W - bx - 8, mid = bx + w / 2;
    g.textAlign = "left"; g.fillStyle = "#8a98a8"; g.font = "700 20px ui-monospace, Menlo, Consolas, monospace"; g.fillText(label, lx, y + 22);
    g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(bx, y + 4, w, 24);
    g.fillStyle = v >= 0 ? "#39ff88" : "#4cc9f0"; g.fillRect(Math.min(mid, mid + (v * w) / 2), y + 4, Math.abs((v * w) / 2), 24);
    g.fillStyle = "rgba(232,238,245,.6)"; g.fillRect(mid - 1, y, 2, 32);
  });
  g.textAlign = "left"; g.font = "900 22px ui-monospace, Menlo, Consolas, monospace";
  if (c.escape) { g.fillStyle = "#ffb020"; g.fillText("GIANT FIBER ESCAPE", 600, 176); }
  else { g.fillStyle = "#8a98a8"; g.font = "600 18px ui-monospace, Menlo, Consolas, monospace"; g.fillText(last.cmd.note ? last.cmd.note.slice(0, 40) : "after safety governor", 600, 176); }
}

// ================================================================== gestures, scenarios, webcam
const PRESET = {
  palm: { present: true, openness: 0.95, x: 0, y: 0, size: 0.2, label: "open palm" },
  fist: { present: true, openness: 0.1, x: 0, y: 0, size: 0.15, label: "fist" },
  left: { present: true, openness: 0.1, x: -0.85, y: 0, size: 0.15, label: "hand left" },
  right: { present: true, openness: 0.1, x: 0.85, y: 0, size: 0.15, label: "hand right" },
  drop: { present: false, openness: 0, x: 0, y: 1, size: 0, label: "hand dropped" },
};
function setGesture(name) {
  if (scenario !== "gestures") newPilot("gestures");
  autoplay = false; $("bAuto").classList.remove("on");
  if (name === "rush") {
    pilot.gesture = { ...PRESET.fist }; schedule = [[pilot.t + 0.1, { ...PRESET.fist, size: 0.6, label: "hand rushes at camera" }], [pilot.t + 1.4, { ...PRESET.fist, label: "fist" }]];
  } else { pilot.gesture = { ...PRESET[name] }; schedule = []; }
  document.querySelectorAll("[data-g]").forEach((b) => b.classList.toggle("on", b.dataset.g === name));
}
document.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => setGesture(b.dataset.g)));
$("bAuto").onclick = () => { newPilot("gestures"); autoplay = true; $("bAuto").classList.add("on"); $("bChair").classList.remove("on"); document.querySelectorAll("[data-g]").forEach((b) => b.classList.remove("on")); };
$("bChair").onclick = () => { newPilot("chair"); autoplay = false; $("bAuto").classList.remove("on"); $("bChair").classList.add("on"); };
$("bReset").onclick = () => $("bAuto").onclick();
window.addEventListener("keydown", (e) => {
  const map = { 1: "palm", 2: "fist", 3: "left", 4: "right", 5: "rush", 6: "drop" };
  if (map[e.key]) setGesture(map[e.key]);
  if (e.key === " ") { e.preventDefault(); $("bAuto").onclick(); }
  if (e.key === "r" || e.key === "R") $("bReset").onclick();
});
$("bCam").onclick = async () => {
  if (webcam) return;
  $("bCam").textContent = "LOADING…";
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    const hands = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" },
      runningMode: "VIDEO", numHands: 1,
    });
    const video = $("cam");
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    await video.play(); video.style.display = "block";
    webcam = { hands, video };
    if (scenario !== "gestures") newPilot("gestures");
    autoplay = false; $("bAuto").classList.remove("on"); $("bCam").classList.add("on"); $("bCam").textContent = "HAND ON";
  } catch (err) {
    console.warn(err); $("bCam").textContent = "NO CAMERA"; setTimeout(() => ($("bCam").textContent = "USE MY HAND"), 2500);
  }
};
function readWebcam() {
  const res = webcam.hands.detectForVideo(webcam.video, performance.now());
  if (!res.landmarks || !res.landmarks.length) return { present: false, openness: 0, x: 0, y: 0, size: 0, label: "no hand" };
  const lm = res.landmarks[0], d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const palm = d(lm[9], lm[0]) + 1e-6;
  let ext = 0;
  for (const [tp, pp] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(lm[tp], lm[0]) > d(lm[pp], lm[0]) * 1.15) ext++;
  const spread = d(lm[8], lm[20]) / palm;
  const open = Math.min(1, Math.max(0, 0.7 * (ext / 4) + 0.3 * Math.min(1, spread / 1.2)));
  const xs = lm.map((p) => p.x), ys = lm.map((p) => p.y);
  const cx = xs.reduce((a, b) => a + b) / xs.length, cy = ys.reduce((a, b) => a + b) / ys.length;
  const size = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return { present: true, openness: open, x: -(cx * 2 - 1), y: cy * 2 - 1, size, label: open > 0.6 ? "open palm" : open < 0.35 ? "fist" : "half open" };
}

// ================================================================== simulation step + UI
function simTick() {
  if (autoplay && scenario === "gestures" && pilot.phase === "flight") {
    let gst = DEMO_TIMELINE[0][1];
    for (const [ts, st] of DEMO_TIMELINE) if (pilot.t >= ts) gst = st;
    pilot.gesture = gst;
    if (pilot.t > 23.5) newPilot("gestures");
  } else if (webcam && pilot.phase === "flight") {
    pilot.gesture = readWebcam();
  }
  while (schedule.length && pilot.t >= schedule[0][0]) pilot.gesture = schedule.shift()[1];
  if (scenario === "chair" && pilot.t > 18) newPilot("chair");

  prevPos = curPos; prevYaw = curYaw;
  const t0 = performance.now();
  const last = pilot.tick();
  const wall = performance.now() - t0;
  simSpeed = isNaN(simSpeed) ? 50 / wall : 0.9 * simSpeed + 0.1 * (50 / Math.max(wall, 0.01));
  curPos = [...pilot.drone.pos]; curYaw = pilot.drone.yaw;
  trail.push([...curPos]); if (trail.length > TRAIL_N) trail.shift();

  for (let i = 0; i < net.n; i++) brainAct[i] *= 0.72;
  for (const [, i] of last.spikes) brainAct[i] = 1;
  for (const p of edgePulses) p[1] *= 0.5;
  while (edgePulses.length && edgePulses[0][1] < 0.1) edgePulses.shift();
  const seen = new Set();
  for (const [, i] of last.spikes) { if (seen.size > 120) break; if (pilot.brain.role[i] !== 1 || Math.random() < 0.08) seen.add(i); }
  for (const i of seen) edgePulses.push([i, 1]);
  spikeRate = 0.85 * spikeRate + 0.15 * (last.spikes.length * 20);

  drawRaster(last.spikes);
  drawEyes(last); drawBrain(last.rates); drawMotor(last);
  $("sSpikes").textContent = Math.round(spikeRate).toLocaleString("en-US");
  $("sAlt").textContent = last.tel.alt.toFixed(2);
  $("tclock").textContent = pilot.phase === "flight" ? `sim t ${pilot.t.toFixed(1)} s` : "warm-up";
  $("rtf").textContent = isFinite(simSpeed) ? `${simSpeed.toFixed(0)}× real time` : "";

  const warm = pilot.phase === "warmup";
  $("warm").style.opacity = warm ? 1 : 0;
  $("warmbar").style.width = `${Math.min(100, (1 + pilot.t / (pilot.decoder.settle + 0.1)) * 100)}%`;
  if (warm) { $("gname").innerHTML = 'WARMING UP<small>brain settles on the ground</small>'; $("chain").textContent = "measuring resting firing rates of the descending neurons"; }
  else {
    const il = pilot.illusion;
    const label = scenario === "chair" ? "CHAIR RUN" : (pilot.gesture.label || "no hand").toUpperCase();
    const sub = scenario === "chair" ? "cruise forward, the brain brakes and dodges" : autoplay ? "autoplay" : webcam ? "your hand" : "manual";
    $("gname").innerHTML = `${label}<small>${sub}</small>`;
    $("chain").textContent = last.cmd.escape ? "LPLC2 + LC4 -> giant fiber DNp01 -> escape climb" : scenario === "chair" ? (pilot.decoder.brake > 0.2 ? "looming -> DNp03 / DNp01 -> brake + saccade" : "optic flow -> T4/T5 -> HS/VS -> DNg02 -> steady flight") : il.channel;
  }
  if (pilot.decoder.escapes > lastEscapes) { lastEscapes = pilot.decoder.escapes; toastUntil = pilot.t + 1.1; waveT = 0; }
  const showToast = pilot.t < toastUntil;
  $("toast").classList.toggle("on", showToast); $("flash").classList.toggle("on", showToast && pilot.t < toastUntil - 0.6);
  return last;
}

let lastEsc = false;
function updateScene(alpha, dtReal) {
  const p = prevPos.map((v, i) => v + (curPos[i] - v) * alpha);
  const yaw = prevYaw + (curYaw - prevYaw) * alpha;
  drone.position.copy(V(p[0], p[1], p[2] + 0.04));
  drone.rotation.set(0, yaw, 0);
  const c = pilot.last ? pilot.last.cmd : { forward: 0, lateral: 0, yaw: 0, escape: false };
  drone.rotation.z = -c.forward * 0.25; drone.rotation.x = c.yaw * 0.12;
  const spin = pilot.drone.flying ? 1 : 0.05;
  for (const r of rotors) r.blades.rotation.y += r.dir * dtReal * 60 * spin;
  const esc = !!c.escape;
  ledMat.color.set(esc ? 0xffb020 : 0x39ff88);
  underGlow.color.set(esc ? 0xffb020 : 0x39ff88);
  underGlow.intensity = pilot.drone.flying ? 2.5 : 0.6;
  shadow.position.set(p[0], 0.004, -p[1]);
  shadow.scale.setScalar(1 + p[2] * 0.5);
  shadow.material.opacity = 0.5 / (1 + p[2]);
  const pos = trailGeo.attributes.position.array, col = trailGeo.attributes.color.array;
  for (let i = 0; i < TRAIL_N; i++) {
    const q = trail[Math.max(0, trail.length - TRAIL_N + i)] || curPos, f = trail.length ? i / TRAIL_N : 0;
    pos[i * 3] = q[0]; pos[i * 3 + 1] = q[2] + 0.04; pos[i * 3 + 2] = -q[1];
    col[i * 3] = 0.22 * f; col[i * 3 + 1] = 1.0 * f; col[i * 3 + 2] = 0.53 * f;
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
  trailGeo.setDrawRange(Math.max(0, TRAIL_N - trail.length), TRAIL_N);
  waveT += dtReal;
  wave.position.set(p[0], Math.max(0.01, p[2] - 0.05), -p[1]);
  wave.scale.setScalar(1 + waveT * 6); wave.material.opacity = Math.max(0, 0.9 - waveT * 1.3);
  const loom = pilot.last ? pilot.last.vision.loomLevel : 0;
  furniture.chair.lines.material.opacity = 0.6 + 0.4 * Math.min(1, loom * 3);
  furniture.chair.lines.material.color.set(loom > 0.2 ? 0xffb020 : 0x4cc9f0);
  controls.target.lerp(new THREE.Vector3(p[0] * 0.6, Math.max(0.8, p[2]), -p[1] * 0.6), 0.04);
  lastEsc = esc;
}

// ================================================================== loop / record API
newPilot("gestures");
resize();
if (RECORD) {
  document.body.classList.add("rec");
  let simT = 0;
  window.FD = {
    advance(seconds) { const n = Math.round(seconds * 20); for (let i = 0; i < n; i++) { simTick(); simT += 0.05; } },
    frame() {
      updateScene(1, 0.05);
      const ang = 2.25 + simT * 0.03, rad = 7.2;
      camera.position.set(Math.cos(ang) * rad, 4.6, Math.sin(ang) * rad);
      controls.target.set(-0.2, 0.7, 0); camera.lookAt(controls.target);
      composer.render();
    },
    ready: true,
  };
} else {
  let prevT = performance.now(), slow = 0, lowQuality = false;
  const loop = (now) => {
    const dtReal = Math.min(0.1, (now - prevT) / 1000); prevT = now;
    // adaptive quality: drop bloom and resolution on slow machines
    slow = 0.95 * slow + 0.05 * (dtReal > 0.045 ? 1 : 0);
    if (!lowQuality && slow > 0.6 && now > 8000) { lowQuality = true; bloom.enabled = false; renderer.setPixelRatio(1); resize(); }
    acc += dtReal; let n = 0;
    while (acc >= 0.05 && n < 3) { simTick(); acc -= 0.05; n++; }
    if (n === 3) acc = 0;
    updateScene(Math.min(1, acc / 0.05), dtReal);
    controls.update();
    composer.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
