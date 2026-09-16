// The bedroom the drone flies in: walls that hide when the camera is behind them, furniture that matches the
// simulator's collision boxes, a window, a lamp, and two themes (day / night).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const SX = 6, SY = 6, H = 2.7;

function tex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

export function createRoom(scene) {
  const root = new THREE.Group(); scene.add(root);
  const themed = []; // [mesh, dayMaterial, nightMaterial]
  const neonLines = [];
  const add = (parent, geo, day, night, pos, opts = {}) => {
    const m = new THREE.Mesh(geo, day); m.position.set(...pos);
    m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
    if (opts.rot) m.rotation.set(...opts.rot);
    parent.add(m); if (night) themed.push([m, day, night]);
    return m;
  };

  // ------------------------------------------------------------ textures
  const floorDay = tex(512, 512, (g, w, h) => {
    const plank = h / 8;
    for (let i = 0; i < 8; i++) {
      const base = 150 + ((i * 37) % 30);
      g.fillStyle = `rgb(${base + 40},${base - 5},${base - 55})`; g.fillRect(0, i * plank, w, plank);
      for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(90,55,25,${0.05 + ((k * 13) % 7) * 0.01})`; g.beginPath(); const y = i * plank + ((k * 29) % plank); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1); g.stroke(); }
      g.fillStyle = "rgba(60,35,15,.55)"; g.fillRect(0, i * plank, w, 2);
      g.fillRect(((i * 211) % w), i * plank, 2, plank);
    }
  }, SX / 1.6, SY / 1.6);
  const floorNight = tex(256, 256, (g, w, h) => {
    g.fillStyle = "#0a0e14"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#111823"; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    g.strokeStyle = "rgba(76,201,240,.25)"; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  }, SX / 0.7, SY / 0.7);
  const wallDay = tex(512, 512, (g, w, h) => {
    g.fillStyle = "#d3dae2"; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(x, 0, 30, h); }
    g.fillStyle = "#b9c3ce"; g.fillRect(0, h * 0.66, w, h * 0.34);
    g.fillStyle = "#f4f6f8"; g.fillRect(0, h * 0.65, w, 8);
    for (let x = 0; x < w; x += 128) { g.strokeStyle = "rgba(120,135,150,.35)"; g.lineWidth = 3; g.strokeRect(x + 14, h * 0.7, 100, h * 0.26); }
  }, SX / 1.5, 1);
  const wallNight = tex(256, 256, (g, w, h) => {
    g.fillStyle = "#0b1017"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#0f1622"; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = "rgba(76,201,240,.18)"; g.fillRect(0, h * 0.92, w, 3);
  }, SX / 0.6, 3);

  const matFloorDay = new THREE.MeshStandardMaterial({ map: floorDay, roughness: 0.55, metalness: 0.05 });
  const matFloorNight = new THREE.MeshStandardMaterial({ map: floorNight, roughness: 0.7, metalness: 0.1 });
  const matWallDay = new THREE.MeshStandardMaterial({ map: wallDay, roughness: 0.9 });
  const matWallNight = new THREE.MeshStandardMaterial({ map: wallNight, roughness: 0.9 });

  // floor + rug
  add(root, new THREE.PlaneGeometry(SX, SY), matFloorDay, matFloorNight, [0, 0, 0], { rot: [-Math.PI / 2, 0, 0], cast: false });
  const rugTex = tex(512, 512, (g, w, h) => {
    g.translate(w / 2, h / 2);
    const rings = ["#2f5fd0", "#f2efe8", "#7fb2ff", "#f2efe8", "#1c2b6e", "#f2efe8", "#ffb020"];
    rings.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(0, 0, 250 - i * 34, 0, Math.PI * 2); g.fill(); });
  });
  add(root, new THREE.CircleGeometry(1.25, 64), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }), std(0x0d1320), [-0.4, 0.004, 0.2], { rot: [-Math.PI / 2, 0, 0], cast: false });

  // ------------------------------------------------------------ walls
  // sim +x wall = three x=+3, sim -x = three x=-3, sim +y = three z=-3, sim -y = three z=+3
  const walls = [];
  const wallDefs = [
    { name: "east", pos: [SX / 2, H / 2, 0], rotY: -Math.PI / 2, test: (c) => c.x > SX / 2 },
    { name: "west", pos: [-SX / 2, H / 2, 0], rotY: Math.PI / 2, test: (c) => c.x < -SX / 2 },
    { name: "north", pos: [0, H / 2, -SY / 2], rotY: 0, test: (c) => c.z < -SY / 2 },
    { name: "south", pos: [0, H / 2, SY / 2], rotY: Math.PI, test: (c) => c.z > SY / 2 },
  ];
  for (const d of wallDefs) {
    const grp = new THREE.Group(); grp.position.set(...d.pos); grp.rotation.y = d.rotY; root.add(grp);
    add(grp, new THREE.PlaneGeometry(SX, H), matWallDay, matWallNight, [0, 0, 0], { cast: false });
    add(grp, new THREE.BoxGeometry(SX, 0.1, 0.03), std(0xf4f6f8), std(0x0e141d), [0, -H / 2 + 0.05, 0.015]);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(SX, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: 0x4cc9f0 }));
    strip.position.set(0, -H / 2 + 0.11, 0.03); grp.add(strip); neonLines.push(strip);
    walls.push({ ...d, grp });
  }
  const wall = Object.fromEntries(walls.map((w) => [w.name, w.grp]));

  // window on the north wall
  {
    const g = wall.north;
    const skyDay = tex(256, 256, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#8fd0ff"); gr.addColorStop(0.7, "#e6f5ff"); gr.addColorStop(1, "#fff1cf");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(255,255,255,.9)";
      for (const [x, y, r] of [[60, 70, 22], [85, 62, 28], [112, 72, 20], [180, 120, 16], [200, 112, 22]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#7fae6a"; c.fillRect(0, h * 0.82, w, h * 0.18);
    });
    const skyNight = tex(256, 256, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#050a1e"); gr.addColorStop(1, "#1a2350");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.14})`; c.fillRect((i * 97) % w, (i * 53) % (h * 0.8), 2, 2); }
      c.fillStyle = "#f3f1d0"; c.beginPath(); c.arc(190, 60, 18, 0, Math.PI * 2); c.fill();
    });
    add(g, new THREE.PlaneGeometry(1.5, 1.05), new THREE.MeshBasicMaterial({ map: skyDay }), new THREE.MeshBasicMaterial({ map: skyNight }), [0.6, 0.25, 0.01], { cast: false, receive: false });
    const frame = std(0xffffff, { roughness: 0.4 });
    for (const [w, h, x, y] of [[1.62, 0.07, 0.6, 0.8], [1.62, 0.07, 0.6, -0.3], [0.07, 1.12, -0.18, 0.25], [0.07, 1.12, 1.38, 0.25], [0.04, 1.05, 0.6, 0.25], [1.5, 0.04, 0.6, 0.25]]) {
      add(g, new THREE.BoxGeometry(w, h, 0.06), frame, std(0x1a2230), [x, y, 0.03]);
    }
    add(g, new THREE.BoxGeometry(1.8, 0.05, 0.16), frame, std(0x1a2230), [0.6, -0.34, 0.08]);
    // curtains
    for (const x of [-0.45, 1.65]) add(g, new THREE.BoxGeometry(0.34, 1.5, 0.05), std(0x6a8fd6, { roughness: 1 }), std(0x151c33), [x, 0.2, 0.06]);
    // plant on the sill
    add(g, new THREE.CylinderGeometry(0.07, 0.055, 0.12, 20), std(0xd46a3f), std(0x20283a), [1.15, -0.25, 0.1]);
    for (let i = 0; i < 7; i++) {
      const leaf = add(g, new THREE.SphereGeometry(0.06, 12, 8), std(0x3f9a4a), std(0x143020), [1.15 + Math.cos(i) * 0.05, -0.12 + (i % 3) * 0.05, 0.1 + Math.sin(i) * 0.04]);
      leaf.scale.set(0.5, 1.2, 0.3); leaf.rotation.z = Math.cos(i * 2) * 0.6;
    }
  }
  // poster above the bed (west wall)
  {
    const poster = tex(512, 700, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#0b1320"); gr.addColorStop(1, "#1c2b6e"); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.strokeStyle = "rgba(57,255,136,.35)"; c.lineWidth = 2;
      for (let i = 0; i < 40; i++) { c.beginPath(); c.moveTo((i * 131) % w, (i * 71) % h); c.lineTo((i * 57 + 90) % w, (i * 113 + 60) % h); c.stroke(); }
      c.fillStyle = "#39ff88"; for (let i = 0; i < 40; i++) { c.beginPath(); c.arc((i * 131) % w, (i * 71) % h, 5, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#e8eef5"; c.font = "900 78px ui-monospace, Menlo, Consolas, monospace"; c.textAlign = "center"; c.fillText("FLY", w / 2, h * 0.78); c.fillText("DRONES", w / 2, h * 0.9);
      c.fillStyle = "#ff4d8d"; c.font = "700 26px ui-monospace, Menlo, Consolas, monospace"; c.fillText("850 NEURONS · 1 DRONE", w / 2, h * 0.96);
    });
    add(wall.west, new THREE.PlaneGeometry(0.72, 1.0), new THREE.MeshStandardMaterial({ map: poster, roughness: 0.6 }), null, [2.05, 0.4, 0.012], { cast: false });
    add(wall.west, new THREE.BoxGeometry(0.78, 1.06, 0.02), std(0x222222), null, [2.05, 0.4, 0.002], { cast: false });
  }
  // door on the east wall
  {
    const g = wall.east;
    add(g, new THREE.BoxGeometry(0.95, 2.05, 0.05), std(0xa8764a, { roughness: 0.6 }), std(0x161d2a), [-0.6, -H / 2 + 1.025, 0.02]);
    for (const y of [0.5, -0.4]) add(g, new THREE.BoxGeometry(0.7, 0.7, 0.02), std(0x96683f, { roughness: 0.6 }), std(0x1a2231), [-0.6, -H / 2 + 1.025 + y, 0.05]);
    add(g, new THREE.SphereGeometry(0.035, 16, 12), std(0xd8c27a, { metalness: 0.9, roughness: 0.25 }), std(0x4cc9f0, { emissive: 0x1a5a70 }), [-0.22, -H / 2 + 1.0, 0.08]);
  }
  // wall clock on the south wall
  {
    const face = tex(256, 256, (c, w, h) => {
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(w / 2, h / 2, 124, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#1c2b6e"; c.lineWidth = 12; c.stroke();
      c.fillStyle = "#1c2b6e"; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillRect(w / 2 + Math.cos(a) * 100 - 4, h / 2 + Math.sin(a) * 100 - 4, 8, 8); }
    });
    add(wall.south, new THREE.CircleGeometry(0.22, 40), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5 }), std(0x18202c), [1.2, 0.6, 0.012], { cast: false });
  }

  // ------------------------------------------------------------ furniture (matches simulator boxes)
  const furniture = {};
  const wood = std(0xb07a46, { roughness: 0.55 }), woodDark = std(0x8a5a30, { roughness: 0.6 }), nightBody = std(0x151b24);
  const addNeon = (group, box, color) => {
    const size = new THREE.Vector3().subVectors(box.max, box.min), c = new THREE.Vector3().addVectors(box.max, box.min).multiplyScalar(0.5);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    l.position.copy(c); group.add(l); neonLines.push(l); return l;
  };
  { // chair: sim x 1.2..1.7, y -0.25..0.25, z 0..1.15  -> three x 1.2..1.7, z -0.25..0.25
    const g = new THREE.Group(); root.add(g);
    for (const [x, z] of [[1.24, -0.21], [1.66, -0.21], [1.24, 0.21], [1.66, 0.21]]) add(g, new THREE.CylinderGeometry(0.022, 0.018, 0.46, 12), woodDark, nightBody, [x, 0.23, z]);
    add(g, new RoundedBoxGeometry(0.5, 0.06, 0.5, 3, 0.02), wood, nightBody, [1.45, 0.48, 0]);
    add(g, new RoundedBoxGeometry(0.44, 0.07, 0.44, 4, 0.03), std(0xd8553f, { roughness: 0.9 }), std(0x24121a), [1.45, 0.54, 0]);
    for (const z of [-0.21, 0.21]) add(g, new THREE.BoxGeometry(0.04, 0.66, 0.04), woodDark, nightBody, [1.66, 0.82, z]);
    for (const y of [0.72, 0.92, 1.1]) add(g, new RoundedBoxGeometry(0.04, 0.07, 0.48, 2, 0.015), wood, nightBody, [1.66, y, 0]);
    const neon = addNeon(g, new THREE.Box3(new THREE.Vector3(1.2, 0, -0.25), new THREE.Vector3(1.7, 1.15, 0.25)), 0x4cc9f0);
    furniture.chair = { group: g, neon };
  }
  { // bed: three x -2.9..-1.3, z -2.9..-1.2, y 0..0.55
    const g = new THREE.Group(); root.add(g);
    add(g, new RoundedBoxGeometry(1.6, 0.28, 1.7, 3, 0.03), wood, nightBody, [-2.1, 0.14, -2.05]);
    add(g, new RoundedBoxGeometry(1.52, 0.2, 1.62, 4, 0.06), std(0xf5f3ee, { roughness: 1 }), std(0x1b2230), [-2.1, 0.38, -2.05]);
    add(g, new RoundedBoxGeometry(1.0, 0.07, 1.66, 4, 0.03), std(0x3b6fd6, { roughness: 1 }), std(0x1a2a5c), [-1.8, 0.5, -2.05]);
    for (const z of [-2.5, -1.62]) add(g, new RoundedBoxGeometry(0.34, 0.12, 0.62, 4, 0.05), std(0xffffff, { roughness: 1 }), std(0x222a38), [-2.62, 0.54, z]);
    add(g, new RoundedBoxGeometry(0.08, 0.95, 1.72, 3, 0.03), woodDark, nightBody, [-2.92, 0.475, -2.05]);
    const neon = addNeon(g, new THREE.Box3(new THREE.Vector3(-2.9, 0, -2.9), new THREE.Vector3(-1.3, 0.55, -1.2)), 0xa78bfa);
    furniture.bed = { group: g, neon };
  }
  { // wardrobe: three x 2.4..2.9, z 1.9..2.9, y 0..1.9
    const g = new THREE.Group(); root.add(g);
    const white = std(0xeae4da, { roughness: 0.5 });
    add(g, new RoundedBoxGeometry(0.5, 1.86, 1.0, 3, 0.02), white, nightBody, [2.65, 0.93, 2.4]);
    for (const z of [2.15, 2.65]) {
      add(g, new THREE.BoxGeometry(0.02, 1.7, 0.46), std(0xf6f1e8, { roughness: 0.45 }), std(0x1a2230), [2.395, 0.95, z]);
      add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.16, 10), std(0x9aa3ad, { metalness: 0.9, roughness: 0.2 }), std(0xffb020, { emissive: 0x553300 }), [2.375, 1.0, z + (z < 2.4 ? 0.19 : -0.19)]);
    }
    add(g, new THREE.BoxGeometry(0.56, 0.05, 1.06), woodDark, nightBody, [2.65, 1.885, 2.4]);
    const neon = addNeon(g, new THREE.Box3(new THREE.Vector3(2.4, 0, 1.9), new THREE.Vector3(2.9, 1.9, 2.9)), 0xffb020);
    furniture.wardrobe = { group: g, neon };
  }

  // ------------------------------------------------------------ lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.0); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(1.5, 4.5, -4.5); sun.target.position.set(-0.5, 0, 0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 14 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  root.add(sun, sun.target);
  // hanging lamp
  const lamp = new THREE.Group(); lamp.position.set(-0.3, H, 0.3); root.add(lamp);
  add(lamp, new THREE.CylinderGeometry(0.006, 0.006, 0.55, 6), std(0x222222), null, [0, -0.275, 0], { cast: false });
  const shade = add(lamp, new THREE.ConeGeometry(0.22, 0.2, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 }), std(0x1c2b6e, { side: THREE.DoubleSide }), [0, -0.62, 0], { cast: false });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
  add(lamp, new THREE.SphereGeometry(0.05, 16, 12), bulbMat, null, [0, -0.68, 0], { cast: false, receive: false });
  const lampLight = new THREE.PointLight(0xffe2b0, 6, 7, 1.6); lampLight.position.set(0, -0.72, 0); lamp.add(lampLight);
  const neonA = new THREE.PointLight(0x4cc9f0, 0, 9, 1.6); neonA.position.set(-2.4, 1.6, 2.4); root.add(neonA);
  const neonB = new THREE.PointLight(0xff4d8d, 0, 9, 1.6); neonB.position.set(2.4, 1.6, -2.2); root.add(neonB);

  // floating dust in the sunlight
  const dustN = 260, dustGeo = new THREE.BufferGeometry(), dustPos = new Float32Array(dustN * 3), dustVel = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dustPos.set([(Math.random() - 0.5) * SX * 0.9, Math.random() * H, (Math.random() - 0.5) * SY * 0.9], i * 3);
    dustVel.set([(Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.01, (Math.random() - 0.5) * 0.02], i * 3);
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff6dc, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false }));
  root.add(dust);

  let theme = "day";
  const api = {
    root, walls, furniture, sun, lamp, dust,
    get theme() { return theme; },
    setTheme(t, { scene: sc, bloom, renderer } = {}) {
      theme = t;
      const night = t === "night";
      for (const [m, day, nightMat] of themed) m.material = night ? nightMat : day;
      for (const l of neonLines) l.visible = night;
      hemi.intensity = night ? 0.25 : 1.0; hemi.color.set(night ? 0x8fb8ff : 0xffffff);
      sun.intensity = night ? 0.15 : 2.2; sun.color.set(night ? 0x8fa8ff : 0xfff1d6);
      lampLight.intensity = night ? 2.5 : 6; lampLight.color.set(night ? 0x9fd8ff : 0xffe2b0);
      bulbMat.color.set(night ? 0x9fd8ff : 0xfff2c4);
      neonA.intensity = night ? 10 : 0; neonB.intensity = night ? 8 : 0;
      dust.material.opacity = night ? 0.25 : 0.55;
      if (sc) { sc.background = new THREE.Color(night ? 0x04060a : 0xcfd6de); sc.fog = new THREE.Fog(night ? 0x04060a : 0xcfd6de, 10, 24); }
      if (bloom) { bloom.strength = night ? 0.85 : 0.25; bloom.threshold = night ? 0.18 : 0.92; bloom.radius = night ? 0.45 : 0.3; }
      if (renderer) renderer.toneMappingExposure = night ? 1.05 : 1.0;
    },
    update(camera, dt) {
      for (const w of walls) w.grp.visible = !w.test(camera.position);
      for (let i = 0; i < dustN; i++) {
        for (let k = 0; k < 3; k++) {
          dustPos[i * 3 + k] += dustVel[i * 3 + k] * dt;
          const lim = k === 1 ? [0, H] : [-SX * 0.45, SX * 0.45];
          if (dustPos[i * 3 + k] < lim[0]) dustPos[i * 3 + k] = lim[1];
          if (dustPos[i * 3 + k] > lim[1]) dustPos[i * 3 + k] = lim[0];
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
      lamp.rotation.z = Math.sin(performance.now() / 1400) * 0.02;
    },
    highlight(name, level) {
      const f = furniture[name]; if (!f) return;
      f.neon.material.color.set(level > 0.2 ? 0xffb020 : name === "chair" ? 0x4cc9f0 : name === "bed" ? 0xa78bfa : 0xffb020);
      if (theme === "day") f.neon.visible = level > 0.2;
    },
  };
  api.setTheme("day");
  return api;
}
