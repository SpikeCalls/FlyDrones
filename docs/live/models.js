// Procedural 3D models for the live demo: the blue quadcopter, the fly mascot riding on it, and the swatter.
// Everything is built from three.js primitives and canvas textures (no external assets).
// Local axes: +x = forward (camera side), +y = up, +z = right.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const TAU = Math.PI * 2;

function tex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; }
function beam(from, to, radius, mat) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new RoundedBoxGeometry(len, radius * 0.85, radius, 2, radius * 0.35), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

// ====================================================================== drone
export function createDrone() {
  const g = new THREE.Group();
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x2f5fd0, roughness: 0.32, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const blueLight = new THREE.MeshPhysicalMaterial({ color: 0x3f7ae6, roughness: 0.28, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const navy = new THREE.MeshPhysicalMaterial({ color: 0x1c2b6e, roughness: 0.45, metalness: 0.1, clearcoat: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.6 });
  const silver = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.25, metalness: 0.9 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.45, metalness: 0.2 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x5fb4ff });
  const leds = [ledMat];
  const glows = [];

  // body
  g.add(mesh(new RoundedBoxGeometry(0.26, 0.075, 0.15, 5, 0.032), blue));
  g.add(mesh(new RoundedBoxGeometry(0.2, 0.03, 0.118, 5, 0.014), blueLight, -0.01, 0.043, 0));
  g.add(mesh(new THREE.BoxGeometry(0.19, 0.003, 0.004), dark, -0.01, 0.059, 0));
  g.add(mesh(new RoundedBoxGeometry(0.055, 0.062, 0.132, 4, 0.02), blue, 0.125, -0.004, 0));
  g.add(mesh(new RoundedBoxGeometry(0.05, 0.05, 0.122, 4, 0.018), navy, -0.13, -0.006, 0));
  g.add(mesh(new RoundedBoxGeometry(0.03, 0.008, 0.02, 2, 0.003), dark, -0.07, 0.061, 0.03));
  // side panel details
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.028, 0.004), navy, -0.02, -0.012, s * 0.076));
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.018, 0.004, 0.002), dark, -0.05 + i * 0.03, 0.0, s * 0.079));
  }
  // front "eyes" LEDs
  for (const s of [-1, 1]) {
    const l = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 20), ledMat, 0.153, 0.006, s * 0.045);
    l.rotation.z = Math.PI / 2; g.add(l);
    glows.push(g.add(glowSprite(0x5fb4ff, 0.05, 0.158, 0.006, s * 0.045)).children.at(-1));
  }

  // arms, motors, LEDs, props, legs
  const rotors = [];
  const blurTex = tex(256, 256, (c, w, h) => {
    c.translate(w / 2, h / 2);
    for (let k = 0; k < 2; k++) {
      c.rotate(Math.PI);
      for (let i = 0; i < 7; i++) {
        const r0 = 36 + i * 13;
        c.strokeStyle = `rgba(40,42,48,${0.16 - i * 0.012})`; c.lineWidth = 7 - i * 0.5;
        c.beginPath(); c.arc(0, 0, r0, -0.2, 1.25 - i * 0.05); c.stroke();
      }
    }
  });
  const armDefs = [
    { root: [0.07, 0.012, 0.075], motor: [0.165, 0.03, 0.225], dir: 1 },
    { root: [0.07, 0.012, -0.075], motor: [0.165, 0.03, -0.225], dir: -1 },
    { root: [-0.075, -0.012, 0.07], motor: [-0.155, 0.012, 0.235], dir: -1 },
    { root: [-0.075, -0.012, -0.07], motor: [-0.155, 0.012, -0.235], dir: 1 },
  ];
  for (const a of armDefs) {
    const [mx, my, mz] = a.motor;
    g.add(beam(a.root, [mx, my - 0.005, mz], 0.032, navy));
    g.add(mesh(new RoundedBoxGeometry(0.05, 0.036, 0.042, 3, 0.012), navy, a.root[0], a.root[1], a.root[2]));
    g.add(mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 28), navy, mx, my - 0.012, mz));
    // glowing LED strip on the outside of the pod
    const strip = mesh(new THREE.CylinderGeometry(0.0365, 0.0365, 0.009, 28, 1, true, 0, Math.PI), ledMat, mx, my - 0.03, mz);
    strip.rotation.y = mz > 0 ? -Math.PI / 2 + (mx > 0 ? -0.5 : 0.5) : Math.PI / 2 + (mx > 0 ? 0.5 : -0.5);
    g.add(strip);
    glows.push(g.add(glowSprite(0x4da3ff, 0.07, mx + Math.sign(mx) * 0.02, my - 0.03, mz + Math.sign(mz) * 0.03)).children.at(-1));
    g.add(mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.024, 28), silver, mx, my + 0.025, mz));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.006, 28), dark, mx, my + 0.039, mz));
    const hub = new THREE.Group(); hub.position.set(mx, my + 0.047, mz);
    hub.add(mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.014, 20), black, 0, 0, 0));
    const blades = new THREE.Group();
    for (const s of [0, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0.008, -0.006); shape.quadraticCurveTo(0.06, -0.017, 0.118, -0.006);
      shape.quadraticCurveTo(0.126, 0.0, 0.118, 0.006); shape.quadraticCurveTo(0.06, 0.012, 0.008, 0.006);
      const bl = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: false }), black);
      bl.rotation.x = -Math.PI / 2 + 0.12; bl.rotation.y = s * Math.PI; bl.castShadow = true;
      blades.add(bl);
    }
    hub.add(blades);
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.135, 48), new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    blur.rotation.x = -Math.PI / 2; blur.position.y = 0.004; hub.add(blur);
    g.add(hub);
    rotors.push({ blades, blur, dir: a.dir });
    // landing leg under the pod
    const leg = mesh(new RoundedBoxGeometry(0.024, 0.085, 0.03, 3, 0.008), navy, mx - Math.sign(mx) * 0.004, my - 0.075, mz);
    leg.rotation.z = Math.sign(mx) * 0.12; g.add(leg);
  }
  // U-shaped skids under the front like the reference drone
  for (const s of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.09, -0.03, s * 0.055), new THREE.Vector3(0.1, -0.1, s * 0.07), new THREE.Vector3(0.07, -0.125, s * 0.075),
      new THREE.Vector3(-0.02, -0.125, s * 0.075), new THREE.Vector3(-0.04, -0.1, s * 0.07), new THREE.Vector3(-0.035, -0.03, s * 0.06),
    ]);
    g.add(mesh(new THREE.TubeGeometry(path, 40, 0.008, 10, false), navy));
  }
  // gimbal camera
  g.add(mesh(new RoundedBoxGeometry(0.04, 0.03, 0.07, 3, 0.01), navy, 0.1, -0.05, 0));
  const cam = new THREE.Group(); cam.position.set(0.13, -0.078, 0); g.add(cam);
  const housing = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 32), navy, 0, 0, 0); housing.rotation.z = Math.PI / 2; cam.add(housing);
  for (const s of [-1, 1]) { const d = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.014, 24), navy, -0.004, 0, s * 0.034); d.rotation.x = Math.PI / 2; cam.add(d); }
  const ring = mesh(new THREE.TorusGeometry(0.021, 0.0045, 12, 32), silver, 0.026, 0, 0); ring.rotation.y = Math.PI / 2; cam.add(ring);
  const glass = mesh(new THREE.SphereGeometry(0.019, 24, 16, 0, TAU, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0b1430, roughness: 0.05, metalness: 0.3, clearcoat: 1 }), 0.024, 0, 0);
  glass.rotation.z = -Math.PI / 2; cam.add(glass);
  cam.add(mesh(new THREE.CircleGeometry(0.007, 20), new THREE.MeshBasicMaterial({ color: 0x3f8cff }), 0.0435, 0, 0).rotateY(Math.PI / 2));
  glows.push(cam.add(glowSprite(0x3f8cff, 0.035, 0.05, 0, 0)).children.at(-1));

  g.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  const state = { spin: 0, ledBase: new THREE.Color(0x5fb4ff) };
  return {
    group: g, leds, rotors, camera: cam, glows,
    setGlow(k) { for (const s of glows) s.material.opacity = k; },
    update(dt, { flying, throttle = 0, escape = false, hit = 0, time = 0 }) {
      const target = flying ? 1 : 0;
      state.spin += (target - state.spin) * Math.min(1, dt * 2.5);
      const speed = state.spin * (70 + 25 * throttle);
      for (const r of rotors) {
        r.blades.rotation.y += r.dir * speed * dt;
        r.blades.visible = state.spin < 0.85;
        r.blur.rotation.z += r.dir * speed * dt * 0.08;
        r.blur.material.opacity = Math.min(1, state.spin * 1.2);
      }
      const col = hit > 0 ? (Math.floor(time * 12) % 2 ? 0xff3355 : 0x220008) : escape ? 0xffb020 : 0x5fb4ff;
      ledMat.color.setHex(col);
    },
  };
}

function glowSprite(color, size, x, y, z) {
  const t = glowSprite.tex || (glowSprite.tex = tex(64, 64, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  }));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(size, size, 1); s.position.set(x, y, z);
  return s;
}

// ====================================================================== fly
export function createFly() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  g.scale.setScalar(1.32); g.position.y = -0.012;

  const eyeTex = tex(512, 256, (c, w, h) => {
    c.fillStyle = "#c92a22"; c.fillRect(0, 0, w, h);
    const r = 7;
    for (let y = 0, row = 0; y < h + r; y += r * 1.5, row++) {
      for (let x = row % 2 ? r * 0.87 : 0; x < w + r; x += r * 1.73) {
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        c.closePath();
        c.fillStyle = `rgba(255,${80 + ((x * 7 + y * 3) % 40)},60,${0.1 + ((x + y) % 5) * 0.02})`; c.fill();
        c.strokeStyle = "rgba(90,10,10,.55)"; c.lineWidth = 1.2; c.stroke();
      }
    }
  });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: eyeTex, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const grey = new THREE.MeshPhysicalMaterial({ color: 0x61656c, roughness: 0.55, clearcoat: 0.3 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.5, metalness: 0.2 });
  const thoraxTex = tex(256, 128, (c, w, h) => {
    c.fillStyle = "#34432c"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "rgba(8,12,8,.7)" : "rgba(95,130,70,.35)"; c.fillRect(w * (i / 8), 0, w * 0.05, h); }
  });
  const thoraxMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: thoraxTex, roughness: 0.38, metalness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(0x6f9a4a) });
  const abdTex = tex(256, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#1b2814"); gr.addColorStop(0.5, "#3f6129"); gr.addColorStop(1, "#1b2814");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { c.fillStyle = "rgba(10,16,8,.45)"; c.fillRect(0, h * (0.1 + i * 0.15), w, h * 0.06); }
  });
  const abdMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: abdTex, roughness: 0.3, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12, iridescence: 0.35 });

  // head + eyes + face
  const head = new THREE.Group(); head.position.set(0.085, 0.112, 0); body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.034, 32, 24), grey));
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = mesh(new THREE.SphereGeometry(0.035, 40, 28), eyeMat, 0.008, 0.012, s * 0.036);
    e.scale.set(0.92, 1.05, 0.86); e.rotation.y = s * 0.6; head.add(e); eyes.push(e);
  }
  const face = mesh(new THREE.SphereGeometry(0.02, 20, 16), grey, 0.03, -0.006, 0);
  face.scale.set(0.8, 1.1, 1.0); head.add(face);
  for (const s of [-1, 1]) {
    const ant = mesh(new THREE.CylinderGeometry(0.0035, 0.0045, 0.022, 10), new THREE.MeshStandardMaterial({ color: 0xa8612c, roughness: 0.4 }), 0.045, 0.002, s * 0.008);
    ant.rotation.z = -1.1; ant.rotation.x = s * 0.25; head.add(ant);
    head.add(mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshStandardMaterial({ color: 0x6b3a18 }), 0.055, -0.004, s * 0.011));
  }
  const smile = mesh(new THREE.TorusGeometry(0.011, 0.0028, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a0c0c, roughness: 0.6 }), 0.047, -0.018, 0);
  smile.rotation.set(0, Math.PI / 2, Math.PI); head.add(smile);
  head.add(mesh(new THREE.SphereGeometry(0.006, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd95a6a }), 0.048, -0.026, 0));

  // thorax + abdomen
  const thoraxGeo = new THREE.SphereGeometry(0.05, 36, 28); thoraxGeo.rotateZ(Math.PI / 2);
  const thorax = mesh(thoraxGeo, thoraxMat, 0.03, 0.106, 0); thorax.scale.set(1.1, 0.92, 0.95); body.add(thorax);
  const abdGeo = new THREE.SphereGeometry(0.06, 36, 28); abdGeo.rotateZ(Math.PI / 2);
  const abdomen = mesh(abdGeo, abdMat, -0.068, 0.1, 0); abdomen.scale.set(1.35, 0.82, 1.0); body.add(abdomen);

  // bristles
  const bristleGeo = new THREE.CylinderGeometry(0.0005, 0.0011, 0.013, 4); bristleGeo.translate(0, 0.0065, 0);
  const bristles = new THREE.InstancedMesh(bristleGeo, legMat, 190);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), n = new THREE.Vector3(), sc = new THREE.Vector3();
    let i = 0, seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const parts = [[thorax, 0.05, 70], [abdomen, 0.06, 45], [head, 0.034, 30]];
    for (const [part, r, count] of parts) {
      for (let k = 0; k < count && i < 190; k++) {
        n.set(rnd() * 2 - 1, rnd() * 0.9 + 0.1, rnd() * 2 - 1).normalize();
        p.copy(n).multiplyScalar(r).multiply(part === head ? new THREE.Vector3(1, 1, 1) : part.scale);
        p.add(part === head ? head.position : part.position);
        q.setFromUnitVectors(up, n.clone().add(new THREE.Vector3(-0.4, 0.2, 0)).normalize());
        const len = 0.6 + rnd() * 0.8;
        m.compose(p, q, sc.set(1, len, 1)); bristles.setMatrixAt(i++, m);
      }
    }
    bristles.count = i;
  }
  body.add(bristles);

  // legs (feet stand on the drone's top surface at y = 0.045)
  const legs = [];
  // [hip x, knee x, foot x, foot z]
  const legDefs = [[0.065, 0.1, 0.11, 0.05], [0.035, 0.03, 0.02, 0.056], [0.005, -0.05, -0.075, 0.05]];
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.4 });
  for (const [hipX, kneeX, footX, footZ] of legDefs) {
    for (const s of [-1, 1]) {
      const hip = new THREE.Vector3(hipX, 0.078, s * 0.026), knee = new THREE.Vector3(kneeX, 0.118, s * 0.088);
      const ankle = new THREE.Vector3((kneeX + footX) / 2, 0.066, s * (footZ + 0.028)), foot = new THREE.Vector3(footX, 0.036, s * footZ);
      for (const [a, b, r] of [[hip, knee, 0.0065], [knee, ankle, 0.0055], [ankle, foot, 0.004]]) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, a.distanceTo(b), 8), legMat);
        seg.position.copy(a).lerp(b, 0.5); seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        seg.castShadow = true; body.add(seg); legs.push(seg);
      }
      body.add(mesh(new THREE.SphereGeometry(0.0075, 10, 8), jointMat, knee.x, knee.y, knee.z));
      body.add(mesh(new THREE.SphereGeometry(0.006, 10, 8), jointMat, ankle.x, ankle.y, ankle.z));
      for (const c of [-1, 1]) {
        const claw = mesh(new THREE.ConeGeometry(0.0025, 0.012, 6), legMat, foot.x + c * 0.005, foot.y - 0.002, foot.z + s * 0.004);
        claw.rotation.z = c * 1.3; body.add(claw);
      }
    }
  }

  // wings
  const wingTex = tex(512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const gr = c.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, "rgba(200,188,175,.7)"); gr.addColorStop(1, "rgba(230,230,238,.5)");
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(110,80,55,.75)"; c.lineWidth = 3;
    const vein = (pts) => { c.beginPath(); c.moveTo(pts[0], pts[1]); c.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); c.stroke(); };
    vein([0, h * 0.5, w * 0.3, h * 0.2, w * 0.7, h * 0.15, w, h * 0.3]);
    vein([0, h * 0.5, w * 0.35, h * 0.4, w * 0.7, h * 0.38, w * 0.98, h * 0.45]);
    vein([0, h * 0.52, w * 0.35, h * 0.6, w * 0.7, h * 0.62, w * 0.95, h * 0.6]);
    vein([0, h * 0.55, w * 0.3, h * 0.8, w * 0.6, h * 0.85, w * 0.85, h * 0.8]);
    c.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) vein([w * (0.35 + i * 0.2), h * 0.22, w * (0.37 + i * 0.2), h * 0.4, w * (0.35 + i * 0.2), h * 0.6, w * (0.38 + i * 0.2), h * 0.78]);
  });
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.05, 0.045, 0.16, 0.05, 0.2, 0.012);
  wingShape.bezierCurveTo(0.21, -0.012, 0.15, -0.035, 0.07, -0.028); wingShape.bezierCurveTo(0.03, -0.02, 0.01, -0.01, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 24);
  { // planar UVs across the wing outline
    const pos = wingGeo.attributes.position, uv = wingGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 0.21, (pos.getY(i) + 0.04) / 0.1);
  }
  const wingMat = new THREE.MeshPhysicalMaterial({ map: wingTex, transparent: true, side: THREE.DoubleSide, roughness: 0.15, iridescence: 1, iridescenceIOR: 1.35, depthWrite: false, opacity: 1 });
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.03, 0.142, s * 0.03); body.add(pivot);
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.rotation.x = -Math.PI / 2; // lie flat, outline in the x-z plane
    const holder = new THREE.Group(); holder.add(wing);
    holder.rotation.y = Math.PI + s * 0.32; // point backwards, swept outwards
    holder.rotation.z = s * 0.0;
    pivot.add(holder);
    pivot.add(mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb06a34 }), 0, 0, 0));
    wings.push({ pivot, holder, s });
  }

  // dizzy stars (shown after a hit)
  const stars = new THREE.Group(); stars.position.set(0.085, 0.18, 0); g.add(stars);
  const starTex = tex(64, 64, (c, w, h) => {
    c.translate(w / 2, h / 2); c.fillStyle = "#ffd23f"; c.beginPath();
    for (let k = 0; k < 10; k++) { const r = k % 2 ? 11 : 28, a = (k / 10) * TAU - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath(); c.fill();
  });
  for (let k = 0; k < 4; k++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false })); sp.scale.set(0.035, 0.035, 1); stars.add(sp); }
  stars.visible = false;

  const st = { buzz: 0, hit: 0, look: 0, blink: 0, t: 0, hop: 0 };
  return {
    group: g, head, eyes, wings, body,
    buzz(seconds = 1.2) { st.buzz = Math.max(st.buzz, seconds); },
    hit() { st.hit = 1.8; st.buzz = 1.5; st.hop = 1; },
    update(dt, { flying = false, escape = false, lookYaw = 0 } = {}) {
      st.t += dt;
      if (escape) st.buzz = Math.max(st.buzz, 0.4);
      st.buzz = Math.max(0, st.buzz - dt);
      st.hit = Math.max(0, st.hit - dt);
      // wings: resting sweep + flutter
      const amp = st.buzz > 0 ? 0.55 : flying ? 0.08 : 0.02;
      const f = st.buzz > 0 ? 38 : flying ? 21 : 3;
      for (const w of wings) {
        const osc = Math.sin(st.t * f * TAU) * amp;
        w.pivot.rotation.x = w.s * (-0.12 + osc);
        w.pivot.rotation.z = -0.3 - (st.buzz > 0 ? Math.abs(osc) * 0.5 : 0);
      }
      // head looks around, tracks threats
      const idleLook = Math.sin(st.t * 0.7) * 0.35 + Math.sin(st.t * 1.9) * 0.1;
      st.look += ((lookYaw || idleLook) - st.look) * Math.min(1, dt * 4);
      head.rotation.y = st.look; head.rotation.z = Math.sin(st.t * 1.3) * 0.06;
      // breathing abdomen
      abdomen.scale.set(1.35 + Math.sin(st.t * 3) * 0.015, 0.85 + Math.sin(st.t * 3) * 0.012, 1.0);
      // hit: hop + tumble + stars
      st.hop = Math.max(0, st.hop - dt * 1.6);
      body.position.y = Math.sin(st.hop * Math.PI) * 0.08;
      body.rotation.x = st.hit > 0 ? Math.sin(st.t * 18) * 0.25 * (st.hit / 1.8) : 0;
      body.rotation.z = st.hit > 0 ? Math.sin(st.t * 9) * 0.15 * (st.hit / 1.8) : 0;
      stars.visible = st.hit > 0;
      stars.children.forEach((sp, k) => {
        const a = st.t * 5 + (k / 4) * TAU;
        sp.position.set(Math.cos(a) * 0.05, Math.sin(st.t * 7 + k) * 0.01, Math.sin(a) * 0.05);
      });
      // eye glint pulse
      for (const e of eyes) e.material.emissive?.setRGB(0.25 * Math.max(0, Math.sin(st.t * 2)), 0, 0);
    },
  };
}

// ====================================================================== swatter
export function createSwatter() {
  const g = new THREE.Group();
  const red = new THREE.MeshPhysicalMaterial({ color: 0xff3b3b, roughness: 0.35, clearcoat: 0.6 });
  const yellow = new THREE.MeshPhysicalMaterial({ color: 0xffc62b, roughness: 0.4, clearcoat: 0.4 });
  const netTex = tex(256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(255,70,70,.35)"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(160,20,20,.9)"; c.lineWidth = 3;
    for (let x = 0; x <= w; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y <= h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  });
  // head faces +x (towards the drone when oriented), spans z (width) and y (height)
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.26), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  pad.rotation.y = Math.PI / 2; g.add(pad);
  const border = new THREE.Group();
  for (const [sy, sz, h, w] of [[0.135, 0, 0.02, 0.66], [-0.135, 0, 0.02, 0.66], [0, 0.32, 0.29, 0.02], [0, -0.32, 0.29, 0.02]]) {
    border.add(mesh(new THREE.BoxGeometry(0.03, h, w), red, 0, sy, sz));
  }
  g.add(border);
  const handle = mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.55, 14), yellow, -0.02, -0.4, 0);
  g.add(handle);
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 14), red, -0.02, -0.64, 0));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g };
}
