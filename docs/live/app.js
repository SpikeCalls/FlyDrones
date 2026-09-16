import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Pilot, DEMO_TIMELINE } from "./engine.js";
import { createDrone, createFly, createSwatter } from "./models.js";
import { createRoom } from "./room.js";

const qs = new URLSearchParams(location.search);
const RECORD = qs.has("record");
const $ = (id) => document.getElementById(id);
const net = await (await fetch(new URL("./minifly.json", import.meta.url))).json();

// ================================================================== state
let pilot, autoplay = qs.get("autoplay") !== "0", scenario = "gestures", schedule = [], webcam = null;
const trail = [];
let toastUntil = -1, prevPos = null, curPos = null, prevYaw = 0, curYaw = 0, acc = 0, spikeRate = 0, lastEscapes = 0, simSpeed = NaN;
let theme = qs.get("theme") === "night" ? "night" : "day";
let view = "orbit";

function newPilot(kind = "gestures") {
  endRound(true);
  scenario = kind;
  pilot = kind === "chair" ? new Pilot(net, { start: [-0.9, 0.05, 0], cruise: 0.35, seed: 3 })
    : kind === "game" ? new Pilot(net, { start: [-1.9, -0.3, 0], seed: 5 })
    : new Pilot(net, { start: [-1.5, 0, 0], seed: 0 });
  trail.length = 0; prevPos = curPos = [...pilot.drone.pos]; prevYaw = curYaw = pilot.drone.yaw;
  lastEscapes = 0; schedule = []; toastUntil = -1;
  brainAct.fill(0); edgePulses.length = 0; pokeUntil = -1;
  rasterCtx.clearRect(0, 0, raster.width, raster.height);
  $("score").classList.toggle("on", kind === "game");
}

// ================================================================== three.js scene
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: RECORD });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
{
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
}
const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 60);
camera.position.set(-4.3, 2.5, 3.3);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.autoRotate = !RECORD; controls.autoRotateSpeed = 0.3;
controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.8; controls.maxDistance = 12;
controls.target.set(-1, 1, 0);
controls.addEventListener("start", () => (controls.autoRotate = false));

const V = (x, y, z) => new THREE.Vector3(x, z, -y); // sim (z up) -> three (y up)
const room = createRoom(scene);

// drone + fly mascot
const droneRoot = new THREE.Group(); scene.add(droneRoot);
const drone = createDrone(); drone.group.scale.setScalar(1.6); droneRoot.add(drone.group);
const fly = createFly(); drone.group.add(fly.group);
droneRoot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
const swatter = createSwatter(); swatter.group.visible = false; scene.add(swatter.group);

// trail
const TRAIL_N = 220;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
trailGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
scene.add(trailLine);
// escape shockwave
const wave = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 64), new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
wave.rotation.x = -Math.PI / 2; scene.add(wave);
let waveT = 9;
// particles: sparks (escape / hit) and prop wash dust near the floor
const P_N = 400;
const pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(P_N * 3), pCol = new Float32Array(P_N * 3), pVel = new Float32Array(P_N * 3), pLife = new Float32Array(P_N);
pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
particles.frustumCulled = false; scene.add(particles);
let pNext = 0;
function emit(pos, n, color, speed, up = 0, spread = 1) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const k = pNext++ % P_N, a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * spread;
    pPos.set([pos.x, pos.y, pos.z], k * 3);
    pVel.set([Math.cos(a) * speed * (0.4 + Math.random()), up + e * speed, Math.sin(a) * speed * (0.4 + Math.random())], k * 3);
    pCol.set([c.r, c.g, c.b], k * 3); pLife[k] = 0.6 + Math.random() * 0.6;
  }
}
function stepParticles(dt) {
  for (let k = 0; k < P_N; k++) {
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = -99; continue; }
    pLife[k] -= dt;
    pVel[k * 3 + 1] -= 1.5 * dt;
    for (let j = 0; j < 3; j++) pPos[k * 3 + j] += pVel[k * 3 + j] * dt;
    if (pPos[k * 3 + 1] < 0.01) { pPos[k * 3 + 1] = 0.01; pVel[k * 3 + 1] *= -0.3; }
    const f = Math.max(0, Math.min(1, pLife[k] * 2));
    pCol[k * 3] *= 0.985 + 0.015 * f; pCol[k * 3 + 1] *= 0.985 + 0.015 * f; pCol[k * 3 + 2] *= 0.985 + 0.015 * f;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.3, 0.3, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyTheme() {
  room.setTheme(theme, { scene, bloom, renderer });
  scene.environmentIntensity = theme === "night" ? 0.12 : 0.45;
  if (theme === "night") { bloom.threshold = 0.42; bloom.strength = 0.75; }
  drone.setGlow(theme === "night" ? 1 : 0.35);
  trailLine.material.opacity = theme === "night" ? 0.95 : 0.55;
  document.body.classList.toggle("day", theme === "day");
  $("bTheme").firstChild.textContent = theme === "night" ? "DAY" : "NIGHT";
}
applyTheme();

function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// ================================================================== sound (WebAudio, off until you turn it on)
const sfx = {
  ctx: null, on: false, hum: null, humGain: null, humFilter: null,
  ensure() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.humGain = this.ctx.createGain(); this.humGain.gain.value = 0;
    this.humFilter = this.ctx.createBiquadFilter(); this.humFilter.type = "lowpass"; this.humFilter.frequency.value = 900;
    this.humFilter.connect(this.humGain).connect(this.ctx.destination);
    this.hum = [0, 7].map((det) => { const o = this.ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 140; o.detune.value = det * 10; o.connect(this.humFilter); o.start(); return o; });
  },
  toggle() { this.ensure(); this.on = !this.on; if (this.ctx?.state === "suspended") this.ctx.resume(); return this.on; },
  tone(freq, dur, type = "sine", vol = 0.15, slide = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  noise(dur, from, to, vol = 0.25) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * dur), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t);
  },
  buzz(dur = 0.6) { this.tone(210, dur, "square", 0.06, 40); this.tone(223, dur, "sawtooth", 0.04, -20); },
  update(flying, throttle) {
    if (!this.ctx) return;
    const target = this.on && flying ? 0.035 : 0;
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    for (const o of this.hum) o.frequency.setTargetAtTime(130 + 45 * Math.max(0, throttle), this.ctx.currentTime, 0.15);
  },
};

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
  hideHint();
  if (scenario !== "gestures") newPilot("gestures");
  autoplay = false; $("bAuto").classList.remove("on"); $("bSwat").classList.remove("on");
  if (name === "rush") {
    pilot.gesture = { ...PRESET.fist }; schedule = [[pilot.t + 0.1, { ...PRESET.fist, size: 0.6, label: "hand rushes at camera" }], [pilot.t + 1.4, { ...PRESET.fist, label: "fist" }]];
  } else { pilot.gesture = { ...PRESET[name] }; schedule = []; }
  document.querySelectorAll("[data-g]").forEach((b) => b.classList.toggle("on", b.dataset.g === name));
}
document.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => setGesture(b.dataset.g)));
$("bAuto").onclick = () => { hideHint(); newPilot("gestures"); autoplay = true; setButtons("auto"); };
$("bChair").onclick = () => { hideHint(); newPilot("chair"); autoplay = false; setButtons("chair"); };
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
    setButtons("");
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

// ================================================================== brain panel: hover + click to stimulate
let pokeUntil = -1, pokeLabel = "", hoverPop = null;
function popAt(ev) {
  const r = brainC.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * brainC.width, y = ((ev.clientY - r.top) / r.height) * brainC.height;
  let best = null, bd = 30 * 30;
  for (const pop of net.pops) {
    const [, , start, count] = pop;
    let cx = 0, cy = 0;
    for (let i = start; i < start + count; i++) { cx += nodes[i * 2]; cy += nodes[i * 2 + 1]; }
    cx = (cx / count) * brainC.width; cy = (cy / count) * brainC.height;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) { bd = d; best = pop; }
  }
  return best;
}
const POP_INFO = {
  "R1-R6": "photoreceptors: brightness", T4a: "motion, front-to-back", T4b: "motion, back-to-front", T4c: "motion, upward", T4d: "motion, downward",
  LPi_h: "inhibitory lobula plate cells (horizontal)", LPi_v: "inhibitory lobula plate cells (vertical)", HS: "horizontal system: body rotation", VS: "vertical system: sinking / rising",
  LPLC2: "looming detector", LC4: "looming speed", PVLP: "looming integrators", PVLP_inh: "picks the saccade direction", LAL_inh: "steering inhibition",
  DNg02: "wing-stroke amplitude -> throttle and yaw", DNp03: "evasive flight saccade", DNp01: "giant fiber: escape", haltere: "halteres: rotation sense",
};
brainC.addEventListener("mousemove", (ev) => {
  const pop = popAt(ev); hoverPop = pop;
  const tip = $("tip");
  if (!pop) { tip.style.display = "none"; return; }
  const [type, side, start, count] = pop;
  let c = 0; for (let i = start; i < start + count; i++) c += brainAct[i];
  tip.innerHTML = `<b>${type} ${side}</b> · ${count} neuron${count > 1 ? "s" : ""}<br>${POP_INFO[type] || ""}<br><span style="color:#8a98a8">click: stimulate for 1 s at 150 Hz</span>`;
  tip.style.display = "block"; tip.style.left = `${Math.min(window.innerWidth - 280, ev.clientX - 270)}px`; tip.style.top = `${ev.clientY + 14}px`;
});
brainC.addEventListener("mouseleave", () => { hoverPop = null; $("tip").style.display = "none"; });
brainC.addEventListener("click", (ev) => {
  const pop = popAt(ev); if (!pop || pilot.phase !== "flight") return;
  const [type, side, start, count] = pop;
  pilot.brain.unpoke(); pilot.brain.poke(start, count, 150);
  pokeUntil = pilot.t + 1.0; pokeLabel = `${type} ${side}`;
  sfx.tone(660, 0.12, "triangle", 0.08);
  popup(`ZAP ${type} ${side}`, "#39ff88");
});

// ================================================================== the swat game
const game = { speed: 1.2, dodges: 0, hits: 0, streak: 0, best: 0, round: null, cooldown: 0, auto: false, react: null };
const FIST = { present: true, openness: 0.1, x: 0, y: 0, size: 0.15, label: "fist" };
const DROP = { present: false, openness: 0, x: 0, y: 1, size: 0, label: "hand dropped" };
const SWAT_HALF = [0.05, 0.32, 0.12]; // thickness, half-width, half-height (m)

function startGame() {
  if (scenario !== "game") { newPilot("game"); autoplay = false; }
  setButtons("swat");
}
function spawnSwat() {
  if (scenario !== "game") { startGame(); return; }
  if (game.round || pilot.phase !== "flight" || pilot.drone.takeoffTarget !== null || pilot.t < 2.5 || game.cooldown > 0) return;
  const d = pilot.drone, fx = Math.cos(d.yaw), fy = Math.sin(d.yaw);
  // distance to the wall along the heading
  let wallD = 99;
  for (const [p, f] of [[d.pos[0], fx], [d.pos[1], fy]]) if (Math.abs(f) > 1e-3) wallD = Math.min(wallD, ((f > 0 ? 3 : -3) - p) / f);
  const D = Math.min(2.4, wallD - 0.25);
  if (D < 1.3) { popup("too close to a wall", "#8a98a8"); return; }
  const box = { lo: [0, 0, 0], hi: [0, 0, 0], shade: 0.1, name: "swatter", solid: false, moving: true };
  d.room.boxes.push(box);
  game.round = { c: [d.pos[0] + fx * D, d.pos[1] + fy * D, d.pos[2]], f: [fx, fy], D, box, t: 0, escT: null, esc0: pilot.decoder.escapes, swing: 0 };
  swatter.group.visible = true;
  sfx.noise(D / game.speed, 300, 2400, 0.18);
  $("scHint").textContent = "incoming! watch the LPLC2 and DNp01 neurons";
}
function endRound(silent = false) {
  if (!game.round) return;
  const boxes = pilot?.drone.room.boxes;
  if (boxes) { const i = boxes.indexOf(game.round.box); if (i >= 0) boxes.splice(i, 1); }
  game.round = null; swatter.group.visible = false;
  if (!silent) game.cooldown = 1.6;
}
function gameTick() {
  const d = pilot.drone;
  if (game.cooldown > 0) {
    game.cooldown -= 0.05;
    pilot.gesture = d.pos[2] > 1.15 ? DROP : FIST; // bring the drone back to ~1 m with a rising illusion, then hold
    if (game.cooldown <= 0 && d.pos[2] > 1.2) game.cooldown = 0.05;
  } else if (!game.round) pilot.gesture = FIST;
  if (game.auto && !game.round && game.cooldown <= 0 && pilot.t > 3) spawnSwat();
  const r = game.round; if (!r) return;
  r.t += 0.05;
  r.c[0] -= r.f[0] * game.speed * 0.05; r.c[1] -= r.f[1] * game.speed * 0.05;
  const [hx, hy, hz] = SWAT_HALF;
  const ax = Math.abs(r.f[0]) * hx + Math.abs(r.f[1]) * hy, ay = Math.abs(r.f[1]) * hx + Math.abs(r.f[0]) * hy;
  r.box.lo = [r.c[0] - ax, r.c[1] - ay, r.c[2] - hz]; r.box.hi = [r.c[0] + ax, r.c[1] + ay, r.c[2] + hz];
}
function gameAfterTick() {
  const r = game.round; if (!r) return;
  const d = pilot.drone;
  if (r.escT === null && pilot.decoder.escapes > r.esc0) {
    r.escT = r.t;
    d.jump(d.pos[2] > 1.4 ? -1.6 : 1.6, 0); // browser game: the giant fiber triggers a jump, like a fly's takeoff
    fly.buzz(1.0); sfx.tone(880, 0.25, "square", 0.08, 600);
  }
  const q = d.pos, along = (r.c[0] - q[0]) * r.f[0] + (r.c[1] - q[1]) * r.f[1];
  if (along <= SWAT_HALF[0]) {
    const lat = Math.abs(-(r.c[0] - q[0]) * r.f[1] + (r.c[1] - q[1]) * r.f[0]);
    const hit = lat < SWAT_HALF[1] + 0.1 && Math.abs(q[2] - r.c[2]) < SWAT_HALF[2] + 0.07;
    game.react = r.escT !== null ? Math.round((r.D / game.speed - r.escT) * 1000) : null;
    const at = V(q[0], q[1], q[2]);
    if (hit) {
      game.hits++; game.streak = 0; game.speed = Math.max(1.2, game.speed - 0.2);
      d.vel[0] -= r.f[0] * 1.2; d.vel[1] -= r.f[1] * 1.2; d.vel[2] -= 0.4;
      fly.hit(); shake = 0.5; emit(at, 60, 0xff3355, 1.6, 0.8, 1.5);
      popup("SWATTED!", "#ff4d8d", 1.2); sfx.tone(120, 0.35, "sine", 0.35, -80); sfx.noise(0.2, 800, 200, 0.4);
      $("scHint").textContent = game.react === null ? "the giant fiber never fired: too fast for these eyes" : `giant fiber fired only ${game.react} ms before impact`;
    } else {
      game.dodges++; game.streak++; game.best = Math.max(game.best, game.streak); game.speed = Math.min(3.0, game.speed + 0.1);
      emit(at, 40, 0x39ff88, 1.2, 1.0, 1.2);
      popup(game.streak > 2 ? `DODGED x${game.streak}` : "DODGED", "#39ff88", 1.0); sfx.tone(988, 0.12, "triangle", 0.1); setTimeout(() => sfx.tone(1318, 0.18, "triangle", 0.1), 90);
      $("scHint").textContent = `giant fiber fired ${game.react ?? "?"} ms before impact · next swing is faster`;
    }
    endRound();
  }
}

// ================================================================== popups + 3D picking
const popups = [];
function popup(text, color, scale = 1) {
  const el = document.createElement("div"); el.className = "pop"; el.textContent = text; el.style.color = color; el.style.fontSize = `${26 * scale}px`;
  $("popups").appendChild(el); popups.push({ el, t: 0 });
}
function updatePopups(dt) {
  const p = droneRoot.position.clone().add(new THREE.Vector3(0, 0.55, 0)).project(camera);
  const r = canvas.getBoundingClientRect();
  for (let i = popups.length - 1; i >= 0; i--) {
    const q = popups[i]; q.t += dt;
    const x = r.left + ((p.x + 1) / 2) * r.width, y = r.top + ((1 - p.y) / 2) * r.height - q.t * 60 - i * 26;
    q.el.style.left = `${x}px`; q.el.style.top = `${y}px`; q.el.style.opacity = String(Math.max(0, 1 - q.t / 1.4));
    if (q.t > 1.4) { q.el.remove(); popups.splice(i, 1); }
  }
}
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
const pickables = [
  { obj: fly.group, name: "fly", tip: "<b>the fly</b> · a mascot riding along. Click it!" },
  { obj: drone.group, name: "drone", tip: "<b>the drone</b> · its camera is the fly brain's eyes" },
  { obj: swatter.group, name: "swatter", tip: "<b>swatter</b> · the brain only knows it from optic flow" },
  { obj: room.furniture.chair.group, name: "chair", tip: "<b>chair</b> · obstacle (try CHAIR RUN)" },
  { obj: room.furniture.bed.group, name: "bed", tip: "<b>bed</b>" },
  { obj: room.furniture.wardrobe.group, name: "wardrobe", tip: "<b>wardrobe</b>" },
];
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  for (const p of pickables) if (p.obj.visible && raycaster.intersectObject(p.obj, true).length) return p;
  return null;
}
let downAt = null;
canvas.addEventListener("pointerdown", (ev) => (downAt = [ev.clientX, ev.clientY]));
canvas.addEventListener("pointermove", (ev) => {
  if (downAt) return;
  const p = pick(ev), tip = $("tip");
  canvas.style.cursor = p ? "pointer" : "grab";
  if (p) { tip.innerHTML = p.tip; tip.style.display = "block"; tip.style.left = `${ev.clientX + 16}px`; tip.style.top = `${ev.clientY + 14}px`; }
  else if (!hoverPop) tip.style.display = "none";
});
canvas.addEventListener("pointerup", (ev) => {
  const moved = downAt ? Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) : 99; downAt = null;
  if (moved > 6) return;
  hideHint();
  const p = pick(ev);
  if (p?.name === "fly") { fly.buzz(1.6); sfx.buzz(0.8); popup(["bzzz!", "hey!", "bzz bzz", "I'm just the mascot"][Math.floor(Math.random() * 4)], "#ffd23f", 0.8); return; }
  if (p?.name === "drone") { emit(droneRoot.position, 25, 0x5fb4ff, 0.6, 0.5); popup("drone camera = fly eyes", "#5fb4ff", 0.7); return; }
  if (scenario === "game") spawnSwat();
});

// ================================================================== buttons + keys
function setButtons(active) {
  document.querySelectorAll("[data-g]").forEach((b) => b.classList.toggle("on", b.dataset.g === active));
  $("bAuto").classList.toggle("on", active === "auto"); $("bChair").classList.toggle("on", active === "chair"); $("bSwat").classList.toggle("on", active === "swat");
}
$("bSwat").onclick = () => { hideHint(); if (scenario === "game") spawnSwat(); else startGame(); };
$("bTheme").onclick = () => { theme = theme === "day" ? "night" : "day"; applyTheme(); };
$("bView").onclick = () => { view = { orbit: "chase", chase: "drone", drone: "orbit" }[view]; $("bView").firstChild.textContent = `VIEW: ${view.toUpperCase()}`; };
$("bSound").onclick = () => { const on = sfx.toggle(); $("bSound").firstChild.textContent = on ? "SOUND ON" : "SOUND OFF"; if (on) sfx.buzz(0.3); };
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (k === "s") $("bSwat").onclick();
  if (k === "n") $("bTheme").onclick();
  if (k === "c") $("bView").onclick();
  if (k === "m") $("bSound").onclick();
});
let hintHidden = false;
function hideHint() { if (!hintHidden) { hintHidden = true; $("hint").style.opacity = 0; } }
setTimeout(hideHint, 12000);

// ================================================================== simulation step + UI
function simTick() {
  if (autoplay && scenario === "gestures" && pilot.phase === "flight") {
    let gst = DEMO_TIMELINE[0][1];
    for (const [ts, st] of DEMO_TIMELINE) if (pilot.t >= ts) gst = st;
    pilot.gesture = gst;
    if (pilot.t > 23.5) newPilot("gestures");
  } else if (webcam && pilot.phase === "flight" && scenario === "gestures") {
    pilot.gesture = readWebcam();
  }
  while (schedule.length && pilot.t >= schedule[0][0]) pilot.gesture = schedule.shift()[1];
  if (scenario === "chair" && pilot.t > 18) newPilot("chair");
  if (scenario === "game" && pilot.phase === "flight") gameTick();
  if (pokeUntil > 0 && pilot.t > pokeUntil) { pilot.brain.unpoke(); pokeUntil = -1; }

  prevPos = curPos; prevYaw = curYaw;
  const t0 = performance.now();
  const last = pilot.tick();
  const wall = performance.now() - t0;
  simSpeed = isNaN(simSpeed) ? 50 / wall : 0.9 * simSpeed + 0.1 * (50 / Math.max(wall, 0.01));
  if (scenario === "game") gameAfterTick();
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
    let label = (pilot.gesture.label || "no hand").toUpperCase(), sub = autoplay ? "autoplay" : webcam ? "your hand" : "manual", chain = il.channel;
    if (scenario === "chair") { label = "CHAIR RUN"; sub = "cruise forward, the brain brakes and dodges"; chain = pilot.decoder.brake > 0.2 ? "looming -> DNp03 / DNp01 -> brake + saccade" : "optic flow -> T4/T5 -> HS/VS -> DNg02 -> steady flight"; }
    if (scenario === "game") { label = game.round ? "SWATTER INCOMING" : "SWAT THE DRONE"; sub = game.round ? `${game.speed.toFixed(1)} m/s` : "press S or click the room"; chain = game.round ? "expansion -> LPLC2 + LC4 -> giant fiber DNp01 -> jump" : il.channel; }
    if (pokeUntil > 0) { label = `ZAP ${pokeLabel}`; sub = "you are stimulating these neurons"; }
    if (last.cmd.escape) chain = "LPLC2 + LC4 -> giant fiber DNp01 -> escape";
    $("gname").innerHTML = `${label}<small>${sub}</small>`;
    $("chain").textContent = chain;
  }
  if (pilot.decoder.escapes > lastEscapes) {
    lastEscapes = pilot.decoder.escapes; toastUntil = pilot.t + 1.1; waveT = 0;
    emit(V(curPos[0], curPos[1], curPos[2]), 50, 0xffb020, 1.4, 0.6, 1.2);
    fly.buzz(0.8);
  }
  const showToast = pilot.t < toastUntil;
  $("toast").classList.toggle("on", showToast); $("flash").classList.toggle("on", showToast && pilot.t < toastUntil - 0.6);
  if (scenario === "game") {
    $("scDodge").textContent = game.dodges; $("scHit").textContent = game.hits; $("scStreak").textContent = game.streak;
    $("scBest").textContent = game.best; $("scSpeed").textContent = game.speed.toFixed(1); $("scReact").textContent = game.react ?? "-";
  }
  return last;
}

let shake = 0;
const camTmp = new THREE.Vector3();
function updateScene(alpha, dtReal) {
  const p = prevPos.map((v, i) => v + (curPos[i] - v) * alpha);
  const yaw = prevYaw + (curYaw - prevYaw) * alpha;
  const c = pilot.last ? pilot.last.cmd : { forward: 0, lateral: 0, yaw: 0, throttle: 0, escape: false };
  droneRoot.position.copy(V(p[0], p[1], p[2] + 0.2));
  droneRoot.rotation.set(0, yaw, 0);
  drone.group.rotation.z = -c.forward * 0.25 - pilot.drone.vel[0] * 0; drone.group.rotation.x = c.yaw * 0.12;
  const t = performance.now() / 1000;
  drone.update(dtReal, { flying: pilot.drone.flying, throttle: c.throttle, escape: c.escape, hit: fly && game.round === null && shake > 0 ? shake : 0, time: t });
  // fly looks at the swatter when it comes
  let look = 0;
  if (game.round) {
    const rel = V(game.round.c[0], game.round.c[1], game.round.c[2]).sub(droneRoot.position);
    look = Math.atan2(rel.z, rel.x) * -1 - yaw; look = Math.max(-0.8, Math.min(0.8, look));
  }
  fly.update(dtReal, { flying: pilot.drone.flying, escape: c.escape, lookYaw: look });
  // swatter
  if (game.round) {
    const r = game.round;
    swatter.group.position.copy(V(r.c[0], r.c[1], r.c[2]));
    swatter.group.rotation.set(0, Math.atan2(r.f[1], r.f[0]), 0);
    swatter.group.rotateZ(Math.sin(Math.min(1, r.t / (r.D / game.speed)) * Math.PI * 0.5) * 0.5 - 0.25);
  }
  // trail
  const pos = trailGeo.attributes.position.array, col = trailGeo.attributes.color.array;
  const tc = theme === "night" ? [0.22, 1.0, 0.53] : [0.25, 0.45, 0.95];
  for (let i = 0; i < TRAIL_N; i++) {
    const q = trail[Math.max(0, trail.length - TRAIL_N + i)] || curPos, f = trail.length ? i / TRAIL_N : 0;
    pos[i * 3] = q[0]; pos[i * 3 + 1] = q[2] + 0.12; pos[i * 3 + 2] = -q[1];
    col[i * 3] = tc[0] * f; col[i * 3 + 1] = tc[1] * f; col[i * 3 + 2] = tc[2] * f;
  }
  trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
  trailGeo.setDrawRange(Math.max(0, TRAIL_N - trail.length), TRAIL_N);
  // shockwave + prop wash
  waveT += dtReal;
  wave.position.set(p[0], Math.max(0.01, p[2] + 0.1), -p[1]);
  wave.scale.setScalar(1 + waveT * 6); wave.material.opacity = Math.max(0, 0.9 - waveT * 1.3);
  if (pilot.drone.flying && p[2] < 0.9 && Math.random() < 0.6) {
    emit(new THREE.Vector3(p[0] + (Math.random() - 0.5) * 0.3, 0.02, -p[1] + (Math.random() - 0.5) * 0.3), 2, theme === "night" ? 0x4cc9f0 : 0xb8a58a, 0.9 * (1 - p[2]), 0.05, 0.1);
  }
  stepParticles(dtReal);
  const loom = pilot.last ? pilot.last.vision.loomLevel : 0;
  room.highlight("chair", loom);
  room.update(camera, dtReal);
  updatePopups(dtReal);
  sfx.update(pilot.drone.flying, c.throttle);
  // camera modes
  shake = Math.max(0, shake - dtReal);
  if (view === "chase") {
    const back = new THREE.Vector3(-Math.cos(yaw) * 1.5, 0.55, Math.sin(yaw) * 1.5);
    camTmp.copy(droneRoot.position).add(back); camera.position.lerp(camTmp, 0.08);
    camera.lookAt(droneRoot.position.clone().add(new THREE.Vector3(Math.cos(yaw) * 0.6, 0, -Math.sin(yaw) * 0.6)));
  } else if (view === "drone") {
    const eye = drone.camera.getWorldPosition(new THREE.Vector3());
    camera.position.copy(eye).add(new THREE.Vector3(Math.cos(yaw) * 0.12, 0, -Math.sin(yaw) * 0.12));
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(yaw), -0.05, -Math.sin(yaw))));
  } else {
    controls.target.lerp(new THREE.Vector3(p[0] * 0.6, Math.max(0.8, p[2]), -p[1] * 0.6), 0.04);
  }
  fly.group.visible = view !== "drone";
  if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake * 0.12, (Math.random() - 0.5) * shake * 0.12, 0));
}

// ================================================================== loop / record API
newPilot(qs.get("scene") === "game" ? "game" : qs.get("scene") === "chair" ? "chair" : "gestures");
if (scenario === "game") { autoplay = false; game.auto = qs.has("autoswat"); setButtons("swat"); }
else if (scenario === "chair") { autoplay = false; setButtons("chair"); }
else setButtons(autoplay ? "auto" : "");
resize();
if (RECORD) {
  document.body.classList.add("rec"); hideHint();
  if (qs.has("view")) view = qs.get("view");
  let simT = 0;
  window.FD = {
    advance(seconds) { const n = Math.round(seconds * 20); for (let i = 0; i < n; i++) { simTick(); simT += 0.05; } },
    frame(dt = 0.05) {
      updateScene(1, dt);
      if (view === "orbit") {
        const ang = parseFloat(qs.get("ang") || "2.3") + simT * 0.03, rad = parseFloat(qs.get("rad") || "3.4");
        const tg = droneRoot.position.clone().lerp(new THREE.Vector3(-0.6, 0.9, 0), 0.25);
        camera.position.set(tg.x + Math.cos(ang) * rad, parseFloat(qs.get("h") || "2.2"), tg.z + Math.sin(ang) * rad);
        camera.lookAt(tg);
      }
      composer.render();
    },
    spawn() { spawnSwat(); },
    setSpeed(v) { game.speed = v; },
    setView(v) { view = v; },
    theme(t) { theme = t; applyTheme(); },
    ready: true,
  };
} else {
  let prevT = performance.now(), slow = 0, lowQuality = false;
  const loop = (now) => {
    const dtReal = Math.min(0.1, (now - prevT) / 1000); prevT = now;
    slow = 0.95 * slow + 0.05 * (dtReal > 0.045 ? 1 : 0);
    if (!lowQuality && slow > 0.6 && now > 8000) { lowQuality = true; bloom.enabled = false; renderer.shadowMap.enabled = false; renderer.setPixelRatio(1); resize(); }
    acc += dtReal; let n = 0;
    while (acc >= 0.05 && n < 3) { simTick(); acc -= 0.05; n++; }
    if (n === 3) acc = 0;
    updateScene(Math.min(1, acc / 0.05), dtReal);
    if (view === "orbit") controls.update();
    composer.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
