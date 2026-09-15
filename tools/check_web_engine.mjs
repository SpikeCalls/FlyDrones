// CI check: the browser engine (docs/live/engine.js) must reproduce the Python demo behaviour.
//   node tools/check_web_engine.mjs
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { Pilot, DEMO_TIMELINE } from "../docs/live/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const net = JSON.parse(fs.readFileSync(path.join(here, "../docs/live/minifly.json"), "utf8"));
const p = new Pilot(net);
const alt = {};
while (!(p.phase === "flight" && p.t > 21)) {
  if (p.phase === "flight") {
    let g = DEMO_TIMELINE[0][1];
    for (const [ts, st] of DEMO_TIMELINE) if (p.t >= ts) g = st;
    p.gesture = g;
  }
  const l = p.tick();
  alt[p.t.toFixed(2)] = l.tel.alt;
}
const check = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("ok:", msg); };
check(alt["4.50"] > alt["2.50"] + 0.3, "open palm climbs");
check(Math.abs(alt["9.00"] - alt["6.00"]) < 0.25, "fist holds");
check(alt["20.95"] < alt["15.50"] - 0.5, "dropped hand descends");
check(p.decoder.escapes >= 1, "rushing hand triggers a giant-fiber escape");
check(p.drone.collisions === 0, "no collisions");
