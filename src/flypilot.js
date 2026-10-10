// Fruit fly pilot: eyes, brain, and the flight skills that turn its decisions into manoeuvres.
//
// FROM THE FLY (data from NeuroMechFly and the FlyWire whole-brain model):
//   Eyes   721 ommatidia per eye, each with its real viewing direction (NeuroMechFly).
//          They sample a simplified scene: sky, terrain, aircraft and missiles.
//   Brain  Descending-neuron rates measured in the Shiu et al. whole-brain model while
//          LC10a (small moving target), LPLC2 and LC4 (looming) were driven per eye
//          (fly_pilot/brain_probe.py). Interpolated here; input effects are summed.
//          The brain picks the target (what LC10a sees), the turn direction
//          (DNa02/DNa04 left vs right) and triggers escapes (DNp01 giant fiber).
//
// NOT FROM THE FLY (game code, shown as such in the brain panel):
//   Flight skills  pursuit geometry, gun lead, energy management (airbrake to corner
//                  speed), overshoot avoidance, missile defence, terrain recovery.
//   Jet sensors    radar and radar-warning receiver: the fly's eyes are blind in a
//                  ~46 deg cone behind it, so the jet tells it about attackers there.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MAG = 30;        // distant aircraft look up to 30x larger, or the fly could not see a jet beyond ~100 m
const MIN_A = 0.1;     // ...but never bigger than ~6 deg from the boost; up close they have true size
const ACC = 0.045;     // half acceptance angle of one ommatidium (rad, ~2.6 deg)
const VISION_DT = 1 / 30;
const TAU_DN = 0.12;   // smoothing of descending-neuron rates (s)
export const MAX_IN = 160; // highest input rate probed in the brain model (Hz)
const BULLET_V = 1000;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const Y = new THREE.Vector3(0, 1, 0);

export class FlyPilot {
  constructor() {
    this.ready = false;
    this.error = null;
    this.inputs = {};
    this.dn = {};
    this.mode = 'search';
    this.skill = '';
    this.uses = {};
    this.visionAcc = 0;
    this.escapeT = 0; this.escapeCd = 0; this.escapeSide = 1; this.escapeUp = 0.6; this.escapes = 0;
    this.elevErr = 0; this.targetSeen = 0;
    this.terrainLoom = 0; this.objLoom = 0;
    this.focus = null; this.memTarget = null; this.lostT = 99;
    this.flareCd = 0; this.jinkDir = 1; this.jinkSwap = 0; this.hitT = 0;
    this.out = { dir: new THREE.Vector3(0, 0, -1), throttle: 1, brake: 0, fire: false, missile: false, flares: false, escaped: false };
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    this._up = new THREE.Vector3(); this._dir = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.objs = [];
  }

  async load(base) {
    try {
      const [eyes, brain, map] = await Promise.all([
        fetch(base + 'eyes.json').then(r => r.json()),
        fetch(base + 'brain_response.json').then(r => r.json()),
        fetch(base + 'brain_map.json').then(r => r.json()),
      ]);
      this.eyes = ['left', 'right'].map(side => {
        const e = eyes[side], n = e.dirs.length, dirs = new Float32Array(n * 3);
        e.dirs.forEach(([x, y, z], i) => { dirs[i * 3] = -y; dirs[i * 3 + 1] = z; dirs[i * 3 + 2] = -x; }); // thorax -> jet frame
        return { side, n, dirs, uv: e.uv, lum: new Float32Array(n), cov: new Float32Array(n) };
      });
      this.brain = brain;
      this.map = map;
      this.base = brain.responses.baseline['0'];
      this.rates = [0, ...brain.meta.input_rates_hz];
      for (const k of Object.keys(this.base)) this.dn[k] = this.base[k];
      for (const g of Object.keys(brain.responses)) if (g !== 'baseline') this.inputs[g] = 0;
      this.turn = brain.turning;
      const gltf = await new GLTFLoader().loadAsync(base + 'fly.glb');
      this.model = this.buildModel(gltf.scene);
      this.ready = true;
    } catch (err) {
      this.error = err;
      console.error('Fly pilot failed to load', err);
    }
  }

  buildModel(root) {
    // flygym thorax frame (x forward, y left, z up, mm) -> jet frame (x right, y up, -z forward, m)
    const g = new THREE.Group(), inner = new THREE.Group();
    inner.add(root);
    inner.matrixAutoUpdate = false;
    inner.matrix.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0))
      .multiply(new THREE.Matrix4().makeScale(0.42, 0.42, 0.42));
    g.add(inner);
    this.wings = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
      const col = o.geometry.getAttribute('color');
      if (col) { // trimesh writes sRGB vertex colours; three expects linear
        const c = new THREE.Color();
        for (let i = 0; i < col.count; i++) {
          c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
          col.setXYZ(i, c.r, c.g, c.b);
        }
      }
      const wing = /wing/.test(o.name), eye = /_eye/.test(o.name);
      o.material = new THREE.MeshStandardMaterial({
        vertexColors: !!col, roughness: wing ? 0.15 : eye ? 0.3 : 0.6, metalness: 0.05,
        transparent: wing, opacity: wing ? 0.35 : 1, side: wing ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !wing,
      });
      o.castShadow = !wing;
      if (wing) this.wings.push(o);
    });
    return g;
  }

  respond(group, rate) {
    const table = this.brain.responses[group], rs = this.rates;
    const r = clamp(rate, 0, rs[rs.length - 1]);
    let k = 0; while (k < rs.length - 2 && r > rs[k + 1]) k++;
    const t = (r - rs[k]) / (rs[k + 1] - rs[k]);
    const a = k === 0 ? this.base : table[String(rs[k])], b = table[String(rs[k + 1])];
    return name => lerp(a[name], b[name], t);
  }

  /* ---------- eyes ---------- */
  see(w) {
    const P = w.P, qi = this._q.copy(P.quat).invert(), up = this._up.copy(Y).applyQuaternion(qi);
    const den2 = w.fogDen * w.fogDen;
    const objs = this.objs; objs.length = 0;
    const add = (pos, vel, r, dark, src, chase) => {
      const rel = this._v.subVectors(pos, P.pos), d = rel.length();
      if (d < 1 || d > 9000) return;
      const closing = -this._w.subVectors(vel, P.vel).dot(rel) / d;
      rel.divideScalar(d).applyQuaternion(qi);
      const a = Math.min(Math.max(Math.atan(r / d), Math.min(Math.atan((r * MAG) / d), MIN_A)), 1.2);
      objs.push({ src, chase, x: rel.x, y: rel.y, z: rel.z, a, cosLim: Math.cos(a + ACC), ttc: closing > 1 ? d / closing : 1e9, dark,
        lc: [0, 0], elevS: 0, elevW: 0 });
    };
    for (const e of w.enemies) if (e.alive) add(e.pos, e.vel, e.radius || 9, 0.06, e, !e.falling);
    for (const m of w.missiles) add(m.pos, this._dir.copy(m.dir).multiplyScalar(m.speed), 2.5, 0.12, m, false);

    const sum = { lc: [0, 0], loomT: [0, 0], loomO: [0, 0] };
    this.eyes.forEach((eye, ei) => {
      const D = eye.dirs;
      for (let i = 0; i < eye.n; i++) {
        const dx = D[i * 3], dy = D[i * 3 + 1], dz = D[i * 3 + 2];
        const el = dx * up.x + dy * up.y + dz * up.z;
        let lum = 0.86 + 0.1 * el;
        if (el < 0.3) {
          const wd = this._w.set(dx, dy, dz).applyQuaternion(P.quat);
          let prev = 0, hit = 0;
          for (let s = 120; s < 26000; s *= 1.8) {
            if (P.pos.y + wd.y * s <= w.groundAt(P.pos.x + wd.x * s, P.pos.z + wd.z * s)) {
              let lo = prev, hi = s;
              for (let k = 0; k < 4; k++) { const m = (lo + hi) / 2; if (P.pos.y + wd.y * m <= w.groundAt(P.pos.x + wd.x * m, P.pos.z + wd.z * m)) hi = m; else lo = m; }
              hit = hi; break;
            }
            prev = s;
          }
          if (hit) {
            lum = lerp(0.3, 0.82, 1 - Math.exp(-den2 * hit * hit));
            const c = P.vel.x * wd.x + P.vel.y * wd.y + P.vel.z * wd.z;
            if (c > 1) { const ttc = hit / c; if (ttc < 5) sum.loomT[ei] += 1 / ttc; }
          } else if (el < 0) lum = 0.8;
        }
        let cov = 0;
        for (const o of objs) {
          const ca = dx * o.x + dy * o.y + dz * o.z;
          if (ca < o.cosLim) continue;
          const c = clamp((o.a + ACC - Math.acos(Math.min(ca, 1))) / (2 * ACC), 0, 1);
          if (c <= 0) continue;
          lum = lerp(lum, o.dark, c); cov = Math.max(cov, c);
          if (o.a < 0.3 && o.chase) { // LC10a: weighted toward the front but active across the eye
            const fw = 0.35 + 0.65 * clamp((-dz + 0.2) / 0.8, 0, 1);
            o.lc[ei] += c * fw;
            o.elevS += c * fw * Math.asin(clamp(dy, -1, 1)); o.elevW += c * fw;
          }
          if (o.ttc < 1.5) sum.loomO[ei] += c / o.ttc; // only an imminent collision looms
        }
        eye.lum[i] = lum; eye.cov[i] = cov;
      }
    });
    // attention: the strongest target, sticking with the current one unless another is much stronger
    let best = null, cur = null;
    for (const o of objs) {
      o.drive = o.lc[0] + o.lc[1];
      if (o.drive > 0.02 && (!best || o.drive > best.drive)) best = o;
      if (o.src === this.focus && o.drive > 0.02) cur = o;
    }
    const sel = cur && best && cur.drive > 0.5 * best.drive ? cur : best;
    this.focus = sel ? sel.src : null;
    for (const o of objs) { const k = o === sel ? 1 : 0.15; sum.lc[0] += o.lc[0] * k; sum.lc[1] += o.lc[1] * k; }
    ['left', 'right'].forEach((s, i) => {
      this.inputs[`LC10a_${s}`] = MAX_IN * clamp(sum.lc[i] / 5, 0, 1);
      this.inputs[`LPLC2_${s}`] = MAX_IN * clamp(sum.loomT[i] / 50 + sum.loomO[i] / 16, 0, 1);
      this.inputs[`LC4_${s}`] = MAX_IN * clamp(sum.loomO[i] / 8, 0, 1);
    });
    this.elevErr = sel && sel.elevW > 0 ? sel.elevS / sel.elevW : 0;
    this.targetSeen = sel ? sel.elevW : 0;
    this.terrainLoom = sum.loomT[0] + sum.loomT[1];
    this.objLoom = sum.loomO[0] + sum.loomO[1];
  }

  /* ---------- brain ---------- */
  think(dt) {
    const target = { ...this.base };
    for (const [g, r] of Object.entries(this.inputs)) {
      if (r <= 0) continue;
      const f = this.respond(g, r);
      for (const k of Object.keys(target)) target[k] += f(k) - this.base[k];
    }
    const k = 1 - Math.exp(-dt / TAU_DN);
    for (const n of Object.keys(target)) this.dn[n] += (Math.max(0, target[n]) - this.dn[n]) * k;
  }
  turnL() { return this.turn.left.reduce((s, n) => s + this.dn[n], 0) / this.turn.normLeft; }
  turnR() { return this.turn.right.reduce((s, n) => s + this.dn[n], 0) / this.turn.normRight; }
  get steerSignal() { return clamp(this.turnR() - this.turnL(), -1, 1); }
  get giantFiber() { return Math.max(this.dn.DNp01_left || 0, this.dn.DNp01_right || 0); }

  notifyHit() { this.hitT = 1.5; }

  /* ---------- decisions + flight skills ---------- */
  // w: { P, enemies, missiles, groundAt, fogDen, locked, lockTarget, time, patrol, home, learner }
  update(dt, w) {
    this.visionAcc += dt;
    if (this.visionAcc >= VISION_DT) { this.see(w); this.visionAcc = 0; }
    this.think(dt);
    const P = w.P, f = P.fwd, spd = P.speed, out = this.out, L = w.learner, th = L.theta, V = L.V;
    out.fire = out.missile = out.flares = out.escaped = false; out.brake = 0; out.throttle = 1;
    this.escapeT -= dt; this.escapeCd -= dt; this.flareCd -= dt; this.hitT -= dt; this.jinkSwap -= dt;
    this.checkCd = (this.checkCd ?? 4) - dt; this.checkT = (this.checkT ?? 0) - dt;
    const yaw0 = Math.atan2(-f.x, -f.z), pitch0 = Math.asin(clamp(f.y, -1, 1));
    const setYP = (yaw, pitch) => { const c = Math.cos(pitch); out.dir.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c); };
    const levelTurn = (side, pitch) => setYP(yaw0 - side * 1.45, clamp(pitch0 * 0.3 + pitch, -0.5, 0.6));
    const right = this._a.set(1, 0, 0).applyQuaternion(P.quat);
    const uses = this.uses = { eyes: true, lc10a: false, loom: false, turn: false, gf: false, skills: true, sensors: false, memory: false, learned: false };
    const sit = this.sit = {};

    const T = this.focus && this.focus.alive && !this.focus.falling ? this.focus : null;
    if (T) { this.memTarget = T; this.lostT = 0; } else this.lostT += dt;
    const M = !T && this.memTarget && this.memTarget.alive && !this.memTarget.falling && this.lostT < 10 ? this.memTarget : null;
    const live = w.enemies.filter(e => e.alive && !e.falling);
    let nd = 1e9;
    for (const e of live) {
      const rel = this._b.subVectors(e.pos, P.pos), d = rel.length();
      nd = Math.min(nd, d);
      if (d < 2000 && f.dot(rel.divideScalar(d)) < -0.69 && e.kind !== 'bomber') sit.blindSpot = true;
    }
    const agl = P.pos.y - w.groundAt(P.pos.x, P.pos.z);
    const fighting = nd < 3000;
    if (fighting) {
      if (agl < 700) sit.lowAlt = true;
      if (spd < 170 && nd < 2000) sit.slowFight = true;
      if (P.g < 1.6 && Math.abs(P.ctl.r) < 0.2) sit.straight = true;
    }

    // 1. terrain (reflex): predicted ground conflict -> wings level, pull up
    let danger = agl < 220;
    for (let s = 1; s <= 4 && !danger; s++) {
      const t = s * 1.5, x = P.pos.x + P.vel.x * t, y = P.pos.y + P.vel.y * t, z = P.pos.z + P.vel.z * t;
      if (y < w.groundAt(x, z) + 160) danger = true;
    }
    const floor = fighting ? th.floor + V.lowAlt * 450 : 0;
    // 2. giant fiber escape (connectome)
    if (this.giantFiber > 25 && this.escapeCd <= 0) {
      this.escapeT = 1.3; this.escapeCd = 2.4; this.escapes++;
      const l = this.inputs.LPLC2_left + this.inputs.LC4_left, r = this.inputs.LPLC2_right + this.inputs.LC4_right;
      this.escapeSide = l >= r ? 1 : -1;
      this.escapeUp = this.terrainLoom * 0.12 > this.objLoom ? 1 : 0.5;
      out.escaped = true;
    }
    const incoming = w.missiles.filter(m => m.target === P).sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos))[0];
    const mD = incoming ? incoming.pos.distanceTo(P.pos) : 1e9;
    if (mD < 3000) sit.missile = true;
    const flareRange = th.flareDist * (1 + 0.5 * V.missile), beamRange = 5000 * (1 + 0.3 * V.missile);

    if (danger) {
      this.mode = 'terrain'; this.skill = 'Terrain recovery: wings level, full pull';
      out.dir.set(f.x, 0, f.z).normalize(); out.dir.y = 1.3; out.dir.normalize();
      out.throttle = 1.1; uses.loom = this.terrainLoom > 0;
    } else if (this.escapeT > 0) {
      this.mode = 'escape'; this.skill = 'Giant fiber fired: break away from the looming side';
      setYP(yaw0 - this.escapeSide * 0.9 * (1 - this.escapeUp * 0.5), clamp(pitch0 + 0.8 * this.escapeUp + 0.15, -0.4, 1.2));
      out.throttle = 1.1; uses.loom = uses.gf = true;
      if (mD < flareRange && this.flareCd <= 0) { out.flares = true; this.flareCd = 0.9; }
    } else if (mD < beamRange) {
      // 3. missile defence: put the missile on the beam, flares in range, hard break at the end
      const los = this._b.subVectors(incoming.pos, P.pos); los.y = 0; los.normalize();
      const perp = this._v.set(los.z, 0, -los.x); if (perp.dot(f) < 0) perp.negate();
      this.mode = 'defend';
      if (mD < 1000) { levelTurn(Math.sign(perp.dot(right)) || 1, -0.15); this.skill = 'Last-ditch break against the missile'; }
      else { out.dir.copy(perp); out.dir.y = -0.18; out.dir.normalize(); this.skill = mD < flareRange ? 'Beam + flares' : 'Beam the missile'; }
      if (mD < flareRange && this.flareCd <= 0) { out.flares = true; this.flareCd = 1.0; }
      out.throttle = 1.1; uses.sensors = true; uses.learned = V.missile > 0.15;
    } else {
      // 4. gun defence: an attacker with its nose on us, usually in the blind cone (radar warning)
      const breakRange = th.breakRange * (1 + 0.4 * V.blindSpot);
      let att = null, attD = 1e9;
      for (const e of live) {
        if (e.kind === 'bomber') continue;
        const rel = this._b.subVectors(P.pos, e.pos), d = rel.length();
        if (d > breakRange) continue;
        rel.divideScalar(d);
        if (e.fwd.dot(rel) > 0.95 && f.dot(rel) > 0.15 && d < attD) { att = e; attD = d; }
      }
      const tgt = T || M;
      const tgtD = tgt ? tgt.pos.distanceTo(P.pos) : 1e9;
      const shotAhead = tgt && tgtD < 700 && f.dot(this._b.subVectors(tgt.pos, P.pos).normalize()) > 0.9;
      const corner = th.corner + V.slowFight * 35;
      const home = w.home;
      const hurt = P.hp < th.rtbHp && home;
      if (att && !shotAhead) {
        const side = Math.sign(this._b.subVectors(att.pos, P.pos).dot(right)) || 1;
        if (this.jinkSwap <= 0) { this.jinkDir = -this.jinkDir; this.jinkSwap = 0.9 + Math.random() * 0.8; }
        levelTurn(side, 0.05 + this.jinkDir * 0.18);
        this.mode = 'defend'; this.skill = 'Break turn into the attacker, jinking';
        if (spd > corner + 25) { out.throttle = 0.6; out.brake = 0.7; this.skill += ' · airbrake'; } else out.throttle = 1.1;
        uses.sensors = true; uses.learned = V.blindSpot > 0.15;
        if (T === att) uses.lc10a = uses.turn = true;
        this.lastSide = side;
      } else if (hurt) {
        // badly damaged: go home, where the flak covers it and it repairs and rearms
        const hd = Math.hypot(home.x - P.pos.x, home.z - P.pos.z);
        if (hd > 1400) out.dir.set(home.x - P.pos.x, (w.groundAt(home.x, home.z) + 900 - P.pos.y) * 0.7, home.z - P.pos.z).normalize();
        else { const a = w.time * 0.35; out.dir.set(home.x + Math.cos(a) * 1100 - P.pos.x, (w.groundAt(home.x, home.z) + 800 - P.pos.y) * 0.7, home.z + Math.sin(a) * 1100 - P.pos.z).normalize(); }
        this.mode = 'rtb'; this.skill = `Airframe ${Math.round(P.hp)}%: home under the flak to repair`;
        out.throttle = 1.1; uses.learned = true;
      } else if (tgt) {
        this.attack(tgt, !!T, w, out, levelTurn, corner);
      } else {
        // 5. nothing seen: check six now and then, follow the radar, or patrol between waves
        if (live.length && this.checkCd <= 0) { this.checkCd = th.checkSix * (1 - 0.6 * V.blindSpot); this.checkT = 1.4; this.checkSide = Math.random() < 0.5 ? -1 : 1; }
        const near = live.slice().sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos))[0];
        if (this.checkT > 0 && live.length) {
          levelTurn(this.checkSide, 0.1); this.mode = 'search'; this.skill = 'Check six: turn to clear the blind spot'; uses.learned = V.blindSpot > 0.15;
        } else if (near) {
          out.dir.subVectors(near.pos, P.pos).normalize();
          out.dir.y = clamp(out.dir.y, -0.25, 0.35); out.dir.normalize();
          if (V.straight > 0.25) { if (this.jinkSwap <= 0) { this.jinkDir = -this.jinkDir; this.jinkSwap = 1.2; } out.dir.addScaledVector(right, this.jinkDir * 0.25 * V.straight).normalize(); uses.learned = true; }
          this.mode = 'search'; this.skill = 'Radar cue: fly toward the nearest contact'; uses.sensors = true;
        } else {
          const a = w.time * 0.12, cx = w.patrol.x + Math.cos(a) * 2500, cz = w.patrol.z + Math.sin(a) * 2500;
          out.dir.set(cx - P.pos.x, (1700 - P.pos.y) * 0.6, cz - P.pos.z).normalize();
          this.mode = 'patrol'; this.skill = 'Patrol over the airfield';
        }
        out.throttle = 0.95;
      }
    }
    if (agl < floor && this.mode !== 'terrain' && this.mode !== 'rtb') {
      out.dir.y = Math.max(out.dir.y, 0.25); out.dir.normalize(); this.skill += ' · stay above learned floor'; uses.learned = true;
    }
    if (this.hitT > 0 && this.mode !== 'terrain') out.dir.addScaledVector(P.up, (Math.random() - 0.5) * 0.3).normalize();
    if (L) L.tick(dt, sit);
    if (this.wings) { const a = Math.sin(performance.now() * 0.09) * (0.04 + clamp(this.giantFiber / 80, 0, 1) * 0.35); this.wings.forEach((m, i) => { m.rotation.x = i ? a : -a; }); }
    return out;
  }

  attack(tgt, visible, w, out, levelTurn, corner) {
    const P = w.P, f = P.fwd, spd = P.speed, uses = this.uses, V = w.learner.V, th = w.learner.theta, sit = this.sit;
    const rel = this._b.subVectors(tgt.pos, P.pos), r = rel.length();
    const los = this._v.copy(rel).divideScalar(r);
    const relVel = this._w.subVectors(tgt.vel, P.vel);
    const closure = -relVel.dot(los);
    const off = Math.acos(clamp(f.dot(los), -1, 1));
    let t = r / BULLET_V;               // gun solution: bullets inherit our velocity
    const aim = this._dir;
    for (let i = 0; i < 3; i++) { aim.copy(rel).addScaledVector(relVel, t); t = aim.length() / BULLET_V; }
    aim.normalize();
    const headOn = tgt.fwd.dot(los) < -0.8 && r < 2500 && tgt.kind !== 'bomber';
    const behind = tgt.fwd.dot(los) > 0.6;
    if (headOn) sit.headOn = true;
    if (behind && r < 500) sit.closeSix = true;
    if (tgt.kind === 'bomber' && behind && r < 1200) sit.bomberRear = true;
    const minRange = 200 + V.closeSix * 350;
    this.mode = visible ? 'attack' : 'memory';
    uses.lc10a = visible; uses.memory = !visible;
    let overshoot = false;
    const right = this._up.set(1, 0, 0).applyQuaternion(P.quat);
    if (headOn && V.headOn > 0.3 && r > 450) {
      // learned: head-on gun passes hurt, so offset and set up a turn instead
      out.dir.copy(los).addScaledVector(right, 0.55 * V.headOn).addScaledVector(P.up, 0.2).normalize();
      this.skill = 'Learned: avoid the head-on, offset for the turn'; uses.learned = true;
    } else if (off > 0.85 && visible && Math.abs(this.steerSignal) > 0.12) {
      const side = Math.sign(this.steerSignal); // target well off the nose: the brain's turn neurons choose the side
      levelTurn(side, clamp(los.y * 0.9, -0.4, 0.5));
      this.skill = `Brain turn ${side > 0 ? 'right' : 'left'} (DNa02/DNa04)`;
      uses.turn = true; this.lastSide = side;
    } else if (tgt.kind === 'bomber' && r > 450) {
      const side = this._a.set(1, 0, 0).applyQuaternion(tgt.quat); // slash from the side, outside the tail gunner's cone
      if (side.dot(rel) > 0) side.negate();
      out.dir.copy(rel).addScaledVector(relVel, (r / BULLET_V) * 1.2).addScaledVector(side, clamp(r - 450, 0, 500) * (1 + V.bomberRear)).normalize();
      this.skill = 'Bomber: beam attack, away from the tail gun'; uses.learned = V.bomberRear > 0.15;
    } else if (r > 2600) {
      out.dir.copy(los); this.skill = 'Pure pursuit';
    } else if (r > 950) {
      out.dir.copy(rel).addScaledVector(relVel, (r / BULLET_V) * 1.3).normalize(); this.skill = 'Lead pursuit';
    } else {
      out.dir.copy(aim); this.skill = 'Gun tracking';
    }
    if ((r < 480 && closure > 65 && off < 1.0) || (behind && r < minRange && closure > 0)) {
      overshoot = true; // about to fly past (or too close): aim behind the target and climb, bleed speed
      out.dir.copy(tgt.pos).addScaledVector(tgt.vel, -0.7).sub(P.pos).normalize().addScaledVector(P.up, 0.35).normalize();
      out.throttle = 0.15; out.brake = 1;
      this.skill = r < minRange && V.closeSix > 0.15 ? 'Learned: too close, pull off high' : 'Overshoot: lag pursuit + high yo-yo, airbrake';
    }
    if (!overshoot) {
      if (off > 0.55 && r < 2200) { // turning fight: fight at the learned speed
        if (spd > corner + 80 && P.pos.y < 3500) { out.dir.addScaledVector(P.up, 0.45).normalize(); out.throttle = 0.9; this.skill += ' · trade speed for height'; }
        else if (spd > corner + 30) { out.throttle = 0.25; out.brake = 1; this.skill += ' · airbrake to fight speed'; }
        else if (spd > corner + 10) { out.throttle = 0.6; out.brake = 0.35; }
        else out.throttle = 1.1;
      } else {
        out.throttle = r > 1200 || closure < 15 ? 1.1 : closure > 70 ? 0.55 : 0.95;
        if (closure > 120 && r < 1000) { out.brake = 0.6; this.skill += ' · airbrake (closing fast)'; }
      }
    }
    const err = Math.acos(clamp(f.dot(aim), -1, 1));
    out.fire = r < th.gunRange && err < Math.atan(11 / r) + 0.004;
    out.missile = w.locked && w.lockTarget === tgt && r > 500 && r < 3800 && P.missiles > 0 && !w.missiles.some(m => m.owner === P && m.target === tgt);
    if (out.missile) this.skill = 'Fox two: IR missile away';
    else if (out.fire) this.skill = 'Guns, guns, guns';
  }
}
