// FlyDrones browser engine: a line-by-line port of the Python package
// (brain/lif.py, senses/retina.py, senses/encoder.py, senses/gestures.py,
//  motor/decoder.py, safety.py, drones/sim.py) so the demo behaves like `flydrones demo`.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ brain
export class Brain {
  constructor(net, seed = 0) {
    const cfg = net.config;
    const p = cfg.brain.lif;
    this.net = net; this.cfg = cfg; this.p = p;
    this.n = net.n;
    this.indptr = Int32Array.from(net.indptr);
    this.indices = Int32Array.from(net.indices);
    this.w = Float32Array.from(net.data, (x) => x * p.w_syn);
    this.groups = {};
    for (const [k, v] of Object.entries(net.groups)) this.groups[k] = Int32Array.from(v);
    this.D = Math.max(1, Math.round(p.delay / p.dt));
    this.refSteps = Math.max(1, Math.round(p.t_ref / p.dt));
    this.decay = Math.exp(-p.dt / p.tau_syn);
    this.kv = p.dt / p.tau_m;
    this.rng = mulberry32(seed + 1);
    this.bias = new Float32Array(this.n);
    for (const [g, mv] of Object.entries(cfg.brain.bias || {})) for (const i of this.groups[g] || []) this.bias[i] = mv;
    this.inputNames = Object.keys(cfg.inputs);
    this.outputNames = Object.keys(cfg.outputs);
    // neuron class for drawing: 0 hidden, 1 input, 2 output
    this.role = new Uint8Array(this.n);
    for (const k of this.inputNames) for (const i of this.groups[k] || []) this.role[i] = 1;
    for (const k of this.outputNames) for (const i of this.groups[k] || []) this.role[i] = 2;
    this.reset();
  }
  reset() {
    const n = this.n;
    this.v = new Float32Array(n).fill(this.p.v_rest);
    this.g = new Float32Array(n);
    this.ref = new Int32Array(n);
    this.buf = new Float32Array(this.D * n);
    this.rate = new Float32Array(n);
    this.t = 0; this.tMs = 0; this.totalSpikes = 0;
    this.activity = new Float32Array(n); // for glow
  }
  setInputs(rates) {
    this.rate.fill(0);
    for (const [name, arr] of Object.entries(rates)) {
      const idx = this.groups[name];
      if (!idx) continue;
      for (let k = 0; k < idx.length; k++) this.rate[idx[k]] = arr[k];
    }
  }
  // run `ms` of brain time; returns {rates: {group: Hz}, spikes: [[tFrac, neuron], ...]}
  tick(inputRates, ms) {
    this.setInputs(inputRates);
    const { n, p, D, indptr, indices, w, v, g, ref, buf, rate, bias } = this;
    const steps = Math.max(1, Math.round(ms / p.dt));
    const counts = new Int32Array(n);
    const spikes = [];
    const pk = p.dt / 1000, kick = p.w_syn * p.poisson_factor;
    for (let s = 0; s < steps; s++) {
      const off = (this.t % D) * n;
      for (let i = 0; i < n; i++) { g[i] += buf[off + i]; buf[off + i] = 0; }
      for (let i = 0; i < n; i++) if (rate[i] > 0 && this.rng() < rate[i] * pk) g[i] += kick;
      for (let i = 0; i < n; i++) {
        if (ref[i] > 0) { v[i] = p.v_reset; ref[i]--; continue; }
        v[i] += this.kv * (p.v_rest - v[i] + g[i] + bias[i]);
        g[i] *= this.decay;
        if (v[i] > p.v_th) {
          v[i] = p.v_reset; g[i] = 0; ref[i] = this.refSteps;
          counts[i]++; spikes.push([s / steps, i]);
          for (let k = indptr[i]; k < indptr[i + 1]; k++) buf[off + indices[k]] += w[k];
        }
      }
      this.t++; this.tMs += p.dt;
    }
    const out = {};
    for (const name of [...this.outputNames, ...this.inputNames]) {
      const idx = this.groups[name];
      let c = 0;
      for (const i of idx) c += counts[i];
      out[name] = idx.length ? (c / idx.length) * 1000 / ms : 0;
    }
    this.totalSpikes += spikes.length;
    return { rates: out, spikes, counts };
  }
}

// ------------------------------------------------------------------ room + camera
export const ROOM = {
  sx: 6, sy: 6, h: 2.7,
  boxes: [
    { lo: [1.2, -0.25, 0], hi: [1.7, 0.25, 1.15], shade: 0.12, name: "chair" },
    { lo: [-2.9, 1.2, 0], hi: [-1.3, 2.9, 0.55], shade: 0.3, name: "bed" },
    { lo: [2.4, -2.9, 0], hi: [2.9, -1.9, 1.9], shade: 0.22, name: "wardrobe" },
  ],
};

export class RayCamera {
  constructor(w = 96, h = 72, fovDeg = 82) {
    this.w = w; this.h = h;
    const tx = Math.tan((fovDeg * Math.PI) / 360), ty = (tx * h) / w;
    this.U = new Float32Array(w * h); this.V = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      this.U[j * w + i] = (((i + 0.5) / w) * 2 - 1) * tx;
      this.V[j * w + i] = (1 - ((j + 0.5) / h) * 2) * ty;
    }
  }
  // returns Float32Array gray 0..1 (row major)
  render(room, pos, yaw) {
    const { w, h, U, V } = this;
    const out = new Float32Array(w * h);
    const fx = Math.cos(yaw), fy = Math.sin(yaw), rx = Math.sin(yaw), ry = -Math.cos(yaw);
    const [px, py, pz] = pos;
    const hx = room.sx / 2, hy = room.sy / 2;
    const INF = 1e9;
    for (let k = 0; k < w * h; k++) {
      let dx = fx + U[k] * rx, dy = fy + U[k] * ry, dz = V[k];
      const nrm = Math.hypot(dx, dy, dz); dx /= nrm; dy /= nrm; dz /= nrm;
      let tb = INF, shade = 0;
      const wall = (t, along, zz) => {
        if (t > 1e-6 && t < tb) {
          const stripe = (Math.floor(along / 0.3) % 2 + 2) % 2 * 0.35 + 0.35;
          const band = ((Math.floor(zz / 0.45) % 2) + 2) % 2 === 0 ? 1.0 : 0.8;
          tb = t; shade = stripe * band;
        }
      };
      if (dx !== 0) { let t = (hx - px) / dx; wall(t, py + t * dy, pz + t * dz); t = (-hx - px) / dx; wall(t, py + t * dy, pz + t * dz); }
      if (dy !== 0) { let t = (hy - py) / dy; wall(t, px + t * dx, pz + t * dz); t = (-hy - py) / dy; wall(t, px + t * dx, pz + t * dz); }
      if (dz !== 0) {
        let t = -pz / dz;
        if (t > 1e-6 && t < tb) {
          const cx = Math.floor((px + t * dx) / 0.35) + Math.floor((py + t * dy) / 0.35);
          tb = t; shade = ((cx % 2) + 2) % 2 * 0.35 + 0.25;
        }
        t = (room.h - pz) / dz;
        if (t > 1e-6 && t < tb) { tb = t; shade = 0.9; }
      }
      for (const b of room.boxes) {
        const t1 = (b.lo[0] - px) / dx, t2 = (b.hi[0] - px) / dx;
        const t3 = (b.lo[1] - py) / dy, t4 = (b.hi[1] - py) / dy;
        const t5 = (b.lo[2] - pz) / dz, t6 = (b.hi[2] - pz) / dz;
        const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
        const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
        if (tmax >= tmin && tmin > 1e-6 && tmin < tb) {
          const hx_ = px + tmin * dx, hy_ = py + tmin * dy, hz_ = pz + tmin * dz;
          const chk = ((Math.floor((hx_ + hy_) / 0.12) + Math.floor(hz_ / 0.12)) % 2 + 2) % 2;
          tb = tmin; shade = b.shade + chk * 0.22;
        }
      }
      shade = shade / (1 + 0.06 * Math.min(tb, 50));
      out[k] = Math.floor(clamp(shade * 255, 0, 255)) / 255;
    }
    return out;
  }
}

// ------------------------------------------------------------------ drone physics
export class SimDrone {
  constructor(start = [-1.5, 0, 0], yawDeg = 0, seed = 0) {
    this.room = ROOM;
    this.pos = [...start]; this.vel = [0, 0, 0];
    this.yaw = (yawDeg * Math.PI) / 180; this.yawRate = 0;
    this.vMax = 1.0; this.vzMax = 0.8; this.yrMax = (120 * Math.PI) / 180; this.tau = 0.35; this.wind = 0.03;
    this.rng = mulberry32(seed + 99);
    this.cam = new RayCamera();
    this.cmd = { throttle: 0, yaw: 0, forward: 0, lateral: 0 };
    this.flying = false; this.t = 0; this.collisions = 0; this.touching = false;
    this.takeoffTarget = null; this.landing = false; this.battery = 100;
  }
  gauss() { const u = 1 - this.rng(), v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  takeoff() { this.flying = true; this.takeoffTarget = 0.9; this.landing = false; }
  land() { this.landing = true; }
  send(cmd) { this.cmd = cmd; }
  telemetry() {
    return { t: this.t, alt: this.pos[2], x: this.pos[0], y: this.pos[1], yawDeg: ((this.yaw * 180) / Math.PI % 360 + 360) % 360,
      yawRateDps: (-this.yawRate * 180) / Math.PI, battery: this.battery, flying: this.flying };
  }
  frame() { return this.cam.render(this.room, this.pos, this.yaw); }
  step(dt) {
    this.t += dt;
    this.battery = Math.max(0, this.battery - (dt * 100) / 600);
    if (!this.flying) { this.vel = [0, 0, 0]; this.yawRate = 0; return; }
    const c = this.cmd;
    let target, yrT;
    if (this.takeoffTarget !== null) {
      const vz = this.pos[2] < this.takeoffTarget ? 0.6 : 0;
      if (this.pos[2] >= this.takeoffTarget) this.takeoffTarget = null;
      target = [0, 0, vz]; yrT = 0;
    } else if (this.landing) { target = [0, 0, -0.5]; yrT = 0; }
    else {
      const f = [Math.cos(this.yaw), Math.sin(this.yaw)], r = [Math.sin(this.yaw), -Math.cos(this.yaw)];
      target = [(c.forward * f[0] + c.lateral * r[0]) * this.vMax, (c.forward * f[1] + c.lateral * r[1]) * this.vMax, c.throttle * this.vzMax];
      yrT = -c.yaw * this.yrMax;
    }
    const k = 1 - Math.exp(-dt / this.tau);
    for (let i = 0; i < 3; i++) this.vel[i] += (target[i] - this.vel[i]) * k + this.gauss() * this.wind * Math.sqrt(dt);
    this.yawRate += (yrT - this.yawRate) * k;
    this.yaw += this.yawRate * dt;
    const nw = this.pos.map((p, i) => p + this.vel[i] * dt);
    const [q, hit] = this.collide(nw);
    if (hit) { if (!this.touching) this.collisions++; this.vel = this.vel.map((x) => x * -0.2); }
    this.touching = hit;
    this.pos = q;
    if (this.landing && this.pos[2] <= 0.02) { this.flying = false; this.pos[2] = 0; }
  }
  collide(p) {
    const r = 0.12, room = this.room;
    const hx = room.sx / 2 - r, hy = room.sy / 2 - r;
    let q = [clamp(p[0], -hx, hx), clamp(p[1], -hy, hy), clamp(p[2], 0, room.h - r)];
    let hit = Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9 || (q[2] !== p[2] && p[2] > 0);
    for (const b of room.boxes) {
      if (q[0] > b.lo[0] - r && q[0] < b.hi[0] + r && q[1] > b.lo[1] - r && q[1] < b.hi[1] + r && q[2] > b.lo[2] - r && q[2] < b.hi[2] + r) {
        q = [...this.pos]; hit = true;
      }
    }
    return [q, hit];
  }
}

// ------------------------------------------------------------------ retina
function weightedSlope(v, w, rows, cols, c0, c1, axis) {
  let sw = 0, cm = 0, vm = 0;
  for (let r = 0; r < rows; r++) for (let c = c0; c < c1; c++) {
    const k = r * cols + c, x = axis === "x" ? c - c0 - (c1 - c0 - 1) / 2 : r - (rows - 1) / 2;
    sw += w[k]; cm += w[k] * x; vm += w[k] * v[k];
  }
  sw += 1e-6; cm /= sw; vm /= sw;
  let cov = 0, vr = 0;
  for (let r = 0; r < rows; r++) for (let c = c0; c < c1; c++) {
    const k = r * cols + c, x = axis === "x" ? c - c0 - (c1 - c0 - 1) / 2 : r - (rows - 1) / 2;
    cov += w[k] * (x - cm) * (v[k] - vm); vr += w[k] * (x - cm) ** 2;
  }
  return cov / (vr + 1e-6);
}

export class Retina {
  constructor(cfg) {
    const v = cfg.vision;
    this.w = v.width; this.h = v.height; this.rows = v.grid[0]; this.cols = v.grid[1];
    this.flowGain = v.flow_gain; this.loomGain = v.loom_gain; this.loomFloor = v.loom_floor; this.blurR = v.blur;
    this.prev = null; this.prevExp = { L: 0, R: 0 }; this.loomEma = null;
  }
  reset() { this.prev = null; this.loomEma = null; }
  blur(img) {
    const { w, h } = this, r = this.blurR;
    if (r <= 0) return img;
    const out = new Float32Array(w * h), k = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        s += img[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
      }
      out[y * w + x] = s / (k * k);
    }
    return out;
  }
  encode(gray) {
    const { w, h, rows, cols } = this;
    const img = this.blur(gray);
    const prev = this.prev || img;
    this.prev = img;
    const ncols = cols * 2, rh = Math.floor(h / rows), cw = Math.floor(w / ncols), nc = rows * ncols;
    const sxx = new Float64Array(nc), syy = new Float64Array(nc), sxy = new Float64Array(nc), sxt = new Float64Array(nc), syt = new Float64Array(nc), br = new Float64Array(nc);
    const avg = (x, y) => (img[y * w + x] + prev[y * w + x]) * 0.5;
    for (let y = 0; y < rh * rows; y++) for (let x = 0; x < cw * ncols; x++) {
      const ix = x === 0 ? avg(1, y) - avg(0, y) : x === w - 1 ? avg(x, y) - avg(x - 1, y) : (avg(x + 1, y) - avg(x - 1, y)) / 2;
      const iy = y === 0 ? avg(x, 1) - avg(x, 0) : y === h - 1 ? avg(x, y) - avg(x, y - 1) : (avg(x, y + 1) - avg(x, y - 1)) / 2;
      const it = img[y * w + x] - prev[y * w + x];
      const k = Math.floor(y / rh) * ncols + Math.floor(x / cw);
      sxx[k] += ix * ix; syy[k] += iy * iy; sxy[k] += ix * iy; sxt[k] += ix * it; syt[k] += iy * it; br[k] += img[y * w + x];
    }
    const vx = new Float32Array(nc), vy = new Float32Array(nc), tex = new Float32Array(nc), energy = new Float64Array(nc);
    for (let k = 0; k < nc; k++) {
      const a = sxx[k] + 1e-4, d = syy[k] + 1e-4, det = a * d - sxy[k] ** 2;
      vx[k] = (-d * sxt[k] + sxy[k] * syt[k]) / det;
      vy[k] = (sxy[k] * sxt[k] - a * syt[k]) / det;
      energy[k] = a + d; br[k] /= rh * cw;
    }
    const sorted = Array.from(energy).sort((p, q) => p - q);
    const med = nc % 2 ? sorted[(nc - 1) / 2] : (sorted[nc / 2 - 1] + sorted[nc / 2]) / 2;
    for (let k = 0; k < nc; k++) {
      tex[k] = clamp(energy[k] / (med + 1e-6), 0, 1);
      vx[k] = clamp(vx[k], -3, 3) * tex[k]; vy[k] = clamp(vy[k], -3, 3) * tex[k];
    }
    const expansion = (c0, c1) => Math.min(weightedSlope(vx, tex, rows, ncols, c0, c1, "x"), weightedSlope(vy, tex, rows, ncols, c0, c1, "y"));
    const expAll = expansion(0, ncols), expL = expansion(0, cols), expR = expansion(cols, ncols);
    this.loomEma = this.loomEma === null ? expAll : 0.5 * this.loomEma + 0.5 * expAll;
    const level = clamp((this.loomEma - this.loomFloor) * this.loomGain, 0, 1);
    const sideL = clamp(0.5 + (expL - expR) * 2, 0, 1);
    const loomBy = { L: level * Math.min(1, 2 * sideL), R: level * Math.min(1, 2 * (1 - sideL)) };
    const g = this.flowGain, eyes = {};
    for (const [eye, c0] of [["L", 0], ["R", cols]]) {
      const n = rows * cols, sign = eye === "L" ? -1 : 1;
      const grids = { brightness: new Float32Array(n), ftb: new Float32Array(n), btf: new Float32Array(n), up: new Float32Array(n), down: new Float32Array(n), loom: new Float32Array(n), loom_speed: new Float32Array(n) };
      const lv = loomBy[eye], ls = clamp((lv - this.prevExp[eye]) * 3, 0, 1);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const k = r * ncols + c0 + c, e = r * cols + c;
        grids.brightness[e] = br[k];
        grids.ftb[e] = clamp((sign * vx[k]) / g, 0, 1); grids.btf[e] = clamp((-sign * vx[k]) / g, 0, 1);
        grids.up[e] = clamp(-vy[k] / g, 0, 1); grids.down[e] = clamp(vy[k] / g, 0, 1);
        grids.loom[e] = lv; grids.loom_speed[e] = ls;
      }
      this.prevExp[eye] = 0.7 * this.prevExp[eye] + 0.3 * lv;
      eyes[eye] = grids;
    }
    return { eyes, vx, vy, tex, loomLevel: level, ncols, rows };
  }
  blank() {
    const n = this.rows * this.cols, z = () => new Float32Array(n);
    const e = () => ({ brightness: z(), ftb: z(), btf: z(), up: z(), down: z(), loom: z(), loom_speed: z() });
    return { eyes: { L: e(), R: e() }, vx: new Float32Array(n * 2), vy: new Float32Array(n * 2), tex: new Float32Array(n * 2), loomLevel: 0, ncols: this.cols * 2, rows: this.rows };
  }
}

// ------------------------------------------------------------------ encoder
export class Encoder {
  constructor(brain) { this.brain = brain; this.specs = brain.cfg.inputs; this.yawSat = (brain.cfg.imu || {}).yaw_saturation_dps || 150; }
  encode(vision, yawRateDps) {
    const out = {};
    for (const [name, spec] of Object.entries(this.specs)) {
      const idx = this.brain.groups[name];
      if (!idx || !idx.length) continue;
      const arr = new Float32Array(idx.length), max = spec.max_hz || 100;
      if (spec.feature === "yaw_pos" || spec.feature === "yaw_neg") {
        const val = spec.feature === "yaw_pos" ? yawRateDps : -yawRateDps;
        arr.fill(max * clamp(val / this.yawSat, 0, 1));
      } else {
        const grid = vision.eyes[spec.eye || "L"][spec.feature];
        if (!grid) continue;
        for (let k = 0; k < idx.length; k++) arr[k] = max * grid[Math.floor((k * grid.length) / idx.length)];
      }
      out[name] = arr;
    }
    return out;
  }
}

// ------------------------------------------------------------------ gestures
export const DEMO_TIMELINE = [
  [0.0, { present: false, openness: 0, x: 0, y: 0, size: 0, label: "no hand" }],
  [2.5, { present: true, openness: 0.95, x: 0, y: 0, size: 0.2, label: "open palm" }],
  [4.5, { present: true, openness: 0.1, x: 0, y: 0, size: 0.15, label: "fist" }],
  [9.5, { present: true, openness: 0.1, x: 0.85, y: 0, size: 0.15, label: "fist, moved right" }],
  [12.0, { present: true, openness: 0.1, x: 0, y: 0, size: 0.15, label: "fist" }],
  [13.5, { present: true, openness: 0.1, x: 0, y: 0, size: 0.55, label: "hand rushes at camera" }],
  [14.0, { present: true, openness: 0.1, x: 0, y: 0, size: 0.55, label: "fist, close" }],
  [15.5, { present: false, openness: 0, x: 0, y: 1, size: 0, label: "hand dropped" }],
];

export class GestureIllusion {
  constructor(strength = 0.5, dropHold = 30, loomGrowth = 0.03) {
    this.s = strength; this.dropHold = dropHold; this.loomGrowth = loomGrowth;
    this.lastPresent = null; this.prevSize = 0; this.loom = 0; this.mode = "no hand"; this.channel = "";
  }
  apply(vision, gst, t) {
    const s = this.s;
    let up = 0, down = 0, rot = 0;
    if (gst.present) {
      if (this.lastPresent === null || t - this.lastPresent > 0.5) this.prevSize = gst.size;
      this.lastPresent = t;
      if (gst.openness > 0.6) { up = (s * (gst.openness - 0.6)) / 0.4; this.mode = "open palm -> sinking illusion"; this.channel = "scene drifts up -> T4c -> VS -> DNg02 up -> climb"; }
      else { this.mode = "fist -> still scene"; this.channel = "no motion -> DNg02 at rest -> hold"; }
      if (Math.abs(gst.x) > 0.35) { rot = (s * Math.sign(gst.x) * (Math.abs(gst.x) - 0.35)) / 0.65; this.mode += " + rotate"; this.channel = `scene rotates ${rot > 0 ? "right" : "left"} -> HS -> DNg02 ${rot > 0 ? "R>L" : "L>R"} -> yaw`; }
      const growth = gst.size - this.prevSize;
      if (growth > this.loomGrowth) this.loom = Math.max(this.loom, Math.min(1, growth / (4 * this.loomGrowth)));
      this.prevSize = gst.size;
    } else if (this.lastPresent !== null && t - this.lastPresent < this.dropHold) {
      down = Math.min(1, s * 1.4); this.mode = "hand dropped -> rising illusion"; this.channel = "scene drifts down -> T4d -> LPi -| DNg02 -> descend"; this.prevSize = 0;
    } else { this.mode = "no hand"; this.channel = "camera optic flow only"; }
    this.loom *= 0.85;
    const loom = this.loom > 0.05 ? this.loom : 0;
    if (loom) { this.mode = "hand rushing in -> looming"; this.channel = "expansion -> LPLC2 + LC4 -> giant fiber DNp01"; }
    for (const eye of ["L", "R"]) {
      const gr = vision.eyes[eye];
      const key = rot > 0 ? (eye === "L" ? "btf" : "ftb") : eye === "L" ? "ftb" : "btf";
      for (let k = 0; k < gr.up.length; k++) {
        gr.up[k] = clamp(gr.up[k] + up, 0, 1); gr.down[k] = clamp(gr.down[k] + down, 0, 1);
        gr[key][k] = clamp(gr[key][k] + Math.abs(rot), 0, 1);
        gr.loom[k] = clamp(gr.loom[k] + loom, 0, 1); gr.loom_speed[k] = clamp(gr.loom_speed[k] + loom, 0, 1);
      }
    }
    return vision;
  }
}

// ------------------------------------------------------------------ decoder
export class Decoder {
  constructor(cfg) {
    const d = cfg.decoder;
    this.smoothing = d.smoothing; this.deadzone = d.deadzone; this.settle = d.settle_s;
    this.axes = d.axes; this.cruise = d.cruise; this.brakeTerms = d.brake_terms;
    this.esc = d.escape;
    this.baseline = null; this.sum = {}; this.nSettle = 0; this.elapsed = 0;
    this.state = { throttle: 0, yaw: 0, forward: 0, lateral: 0 };
    this.escUntil = -1; this.gf = 0; this.brake = 0; this.escapes = 0;
  }
  update(rates, dt) {
    this.elapsed += dt;
    if (this.elapsed < this.settle) {
      for (const [k, v] of Object.entries(rates)) this.sum[k] = (this.sum[k] || 0) + v;
      this.nSettle++;
      return { throttle: 0, yaw: 0, forward: 0, lateral: 0, escape: false, note: "settling" };
    }
    if (!this.baseline) { this.baseline = {}; for (const [k, v] of Object.entries(this.sum)) this.baseline[k] = v / Math.max(1, this.nSettle); }
    const b = (k) => this.baseline[k] || 0;
    const raw = {};
    for (const [axis, spec] of Object.entries(this.axes)) {
      let val = 0;
      for (const [gname, wt] of Object.entries(spec.terms || {})) val += wt * ((rates[gname] || 0) - b(gname));
      raw[axis] = (spec.gain || 0) * val;
    }
    let brake = 0;
    for (const [gname, wt] of Object.entries(this.brakeTerms)) brake += wt * Math.max(0, (rates[gname] || 0) - b(gname));
    this.brake = Math.max(brake, this.brake * 0.93);
    raw.forward += this.cruise * Math.max(0, 1 - this.brake);
    const a = this.smoothing, cmd = { escape: false, note: "" };
    for (const axis of ["throttle", "yaw", "forward", "lateral"]) {
      this.state[axis] = (1 - a) * this.state[axis] + a * clamp(raw[axis], -1, 1);
      cmd[axis] = Math.abs(this.state[axis]) < this.deadzone ? 0 : this.state[axis];
    }
    const gfNow = Math.max(...this.esc.terms.map((k) => rates[k] || 0));
    this.gf = 0.6 * this.gf + 0.4 * gfNow;
    if (this.gf >= this.esc.threshold_hz && this.elapsed > this.escUntil) { this.escUntil = this.elapsed + this.esc.duration_s; this.escapes++; }
    if (this.elapsed <= this.escUntil) {
      cmd.escape = true; cmd.forward = 0;
      if (this.esc.mode === "climb") cmd.throttle = this.esc.strength;
      else if (this.esc.mode === "drop") cmd.throttle = -this.esc.strength;
      cmd.note = `giant fiber escape (${this.esc.mode})`;
    }
    return cmd;
  }
}

// ------------------------------------------------------------------ safety
export class Safety {
  constructor(cfg) {
    const s = cfg.safety;
    this.max = { throttle: s.max_throttle, yaw: s.max_yaw, forward: s.max_forward, lateral: s.max_lateral };
    this.slew = s.slew_per_s; this.minAlt = s.min_alt_m; this.maxAlt = s.max_alt_m; this.fence = s.geofence_radius_m;
    this.prev = { throttle: 0, yaw: 0, forward: 0, lateral: 0 };
    this.lastEvent = "";
  }
  filter(cmd, tel, dt) {
    const out = {}, notes = [];
    for (const a of ["throttle", "yaw", "forward", "lateral"]) out[a] = clamp(cmd[a], -this.max[a], this.max[a]);
    const soft = this.maxAlt - 0.3;
    if (tel.alt > soft && tel.alt < this.maxAlt && out.throttle > 0) out.throttle *= (this.maxAlt - tel.alt) / 0.3;
    if (tel.alt >= this.maxAlt && out.throttle > 0) { out.throttle = Math.min(0, out.throttle) - 0.2; notes.push("ceiling"); }
    if (tel.flying && tel.alt <= this.minAlt && out.throttle < 0) { out.throttle = 0; notes.push("floor"); }
    if (Math.hypot(tel.x, tel.y) > this.fence && out.forward > 0) { out.forward = 0; notes.push("geofence"); }
    const step = this.slew * Math.max(dt, 1e-3);
    const sgn = (v) => (Object.is(v, -0) || v < 0 ? -1 : 1);
    for (const a of ["throttle", "yaw", "forward", "lateral"]) {
      const p = this.prev[a];
      let v = out[a];
      if (Math.abs(v) > Math.abs(p) || sgn(v) !== sgn(p)) v = clamp(v, p - step, p + step);
      out[a] = v;
    }
    this.prev = { ...out };
    if (notes.length) this.lastEvent = notes.join(", ");
    return { ...out, escape: cmd.escape, note: [cmd.note, ...notes].filter(Boolean).join("; ") };
  }
}

// ------------------------------------------------------------------ pilot
export class Pilot {
  constructor(net, opts = {}) {
    this.net = net;
    this.brain = new Brain(net, opts.seed || 0);
    this.cfg = net.config;
    this.retina = new Retina(this.cfg);
    this.encoder = new Encoder(this.brain);
    this.decoder = new Decoder(this.cfg);
    if (opts.cruise !== undefined) this.decoder.cruise = opts.cruise;
    this.safety = new Safety(this.cfg);
    this.illusion = new GestureIllusion();
    this.drone = new SimDrone(opts.start || [-1.5, 0, 0], opts.yawDeg || 0, opts.seed || 0);
    this.hz = 20; this.dt = 1 / this.hz; this.t = -(this.decoder.settle + 0.1);
    this.phase = "warmup";
    this.gesture = { present: false, openness: 0, x: 0, y: 0, size: 0, label: "no hand" };
    this.last = null;
  }
  tick() {
    const dt = this.dt, d = this.drone;
    const gray = d.frame();
    let vision = this.retina.encode(gray);
    const tel = d.telemetry();
    let rates, spikes, cmd;
    if (this.phase === "warmup") {
      const r = this.brain.tick(this.encoder.encode(vision, 0), dt * 1000);
      rates = r.rates; spikes = r.spikes;
      this.decoder.update(rates, dt);
      cmd = { throttle: 0, yaw: 0, forward: 0, lateral: 0, escape: false, note: "warming up the brain" };
      this.t += dt;
      if (this.t >= 0) { this.t = 0; this.phase = "flight"; d.takeoff(); }
    } else {
      vision = this.illusion.apply(vision, this.gesture, this.t);
      const r = this.brain.tick(this.encoder.encode(vision, tel.yawRateDps), dt * 1000);
      rates = r.rates; spikes = r.spikes;
      const raw = this.decoder.update(rates, dt);
      cmd = this.safety.filter(raw, tel, dt);
      d.send(cmd);
      this.t += dt;
    }
    for (let s = 0; s < 4; s++) d.step(dt / 4);
    this.last = { gray, vision, rates, spikes, cmd, tel: d.telemetry() };
    return this.last;
  }
}
