// Camera director.
// Modes: cinematic (automatic shots), flycam (over the fly's shoulder), cockpit (looking back at
// the fly), chase, orbit (free, mouse-dragged), player (mouse-aim chase when you fly).
// Cinematic scores candidate shots (both jets in frame, nothing in the way, sensible size) and
// does not cut during the decisive moments of a fight.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const Y = new V3(0, 1, 0);

const TITLES = {
  chase: 'Chase', twoShot: 'Two-shot', reverse: 'Bandit POV', side: 'Tracking', flyby: 'Flyby', orbit: 'Orbit',
  cockpit: 'Pilot · Drosophila melanogaster', flycam: 'Over the fly’s shoulder', missile: 'Missile cam', kill: 'Splash', death: 'Shot down',
};
const FIGHT = { twoShot: 3, chase: 1.5, reverse: 1.5, side: 1.1, flycam: 1.5, cockpit: 0.4, flyby: 0.5 };
const QUIET = { orbit: 1.8, flyby: 1.8, side: 1.5, cockpit: 1.3, flycam: 1.1, chase: 1 };

export class Director {
  constructor(camera, groundAt) {
    this.cam = camera; this.ground = groundAt;
    this.mode = 'cinematic';
    this.shot = 'chase'; this.t = 0; this.dur = 6; this.data = {};
    this.timeScale = 1; this.slowT = 0; this.slowmo = true;
    this.rel = new V3(); this.lookRel = new V3(); this.abs = new V3(); this.look = new V3(); this.snap = true;
    this.fixed = new V3(); this.orbitA = 0; this.fov = 60; this.side = 1; this.badT = 0; this.checkT = 0;
    this.free = { yaw: 0.6, pitch: 0.22, dist: 70 };
    this.onCut = null;
    this.tmp = new THREE.PerspectiveCamera();
    this._a = new V3(); this._b = new V3(); this._c = new V3(); this._s = new V3();
    this._o = { pos: new V3(), look: new V3(), up: new V3(), fov: 60, stiff: 5, anchor: null };
  }
  get title() { return this.mode === 'cinematic' ? TITLES[this.shot] : ''; }
  get letterbox() { return this.mode === 'cinematic' && this.shot !== 'chase' && this.shot !== 'twoShot'; }

  setMode(m) { this.mode = m; this.snap = true; if (m === 'cinematic') this.cut('chase', {}, 4); }

  cut(shot, data = {}, dur) {
    this.shot = shot; this.t = 0; this.data = data; this.dur = dur ?? rand(6, 10); this.badT = 0;
    this.side = Math.random() < 0.5 ? -1 : 1; this.snap = true;
    if (shot === 'flyby') this.needPrep = true;
    if (this.onCut && this.mode === 'cinematic') this.onCut(shot, TITLES[shot]);
  }

  event(type, d) {
    if (type === 'death') { if (this.mode === 'cinematic') this.cut('death', { pos: d.pos.clone() }, 5.5); if (this.slowmo) this.slowT = 2.2; return; }
    if (type === 'kill') { if (this.mode === 'cinematic') this.cut('kill', { pos: d.pos.clone(), victim: d }, 3.4); if (this.slowmo) this.slowT = 1.4; return; }
    if (this.mode !== 'cinematic' || this.shot === 'kill' || this.shot === 'death') return;
    if (type === 'missile') this.cut('missile', { m: d }, 7);
    else if (type === 'escape' && this.shot !== 'missile' && performance.now() - (this.lastEscape || -1e9) > 25000) { this.lastEscape = performance.now(); this.cut('flycam', {}, 3.5); }
    else if (type === 'wave') this.cut('orbit', {}, 5);
  }

  // where a shot wants the camera; false if the shot cannot be framed now
  rig(shot, ctx, o) {
    const { P, target } = ctx;
    const T = target && target.alive && !target.falling ? target : null;
    const fwd = this._a.copy(P.fwd); fwd.y *= 0.5; fwd.normalize();
    const right = this._b.crossVectors(fwd, Y).normalize();
    o.up.copy(Y); o.anchor = P.pos; o.stiff = 5; o.fov = 58;
    switch (shot) {
      case 'chase':
        o.pos.copy(P.pos).addScaledVector(fwd, -34).addScaledVector(Y, 8).addScaledVector(right, this.side * 5);
        o.look.copy(P.pos).addScaledVector(P.fwd, 90); if (T) o.look.lerp(T.pos, 0.1);
        o.up.addScaledVector(P.up, 0.35).normalize(); o.fov = 58 + clamp((P.speed - 150) / 230, 0, 1) * 10;
        return true;
      case 'twoShot': {
        if (!T) return false;
        const dir = this._c.subVectors(T.pos, P.pos); const d = dir.length(); if (d > 3500) return false; dir.divideScalar(d);
        const sv = this._s.crossVectors(dir, Y).normalize();
        o.pos.copy(P.pos).addScaledVector(dir, -42).addScaledVector(Y, 11).addScaledVector(sv, this.side * 10);
        o.look.copy(P.pos).addScaledVector(dir, clamp(d * 0.5, 30, 500));
        o.fov = d > 1200 ? 46 : 54; o.stiff = 4;
        return true;
      }
      case 'reverse': {
        if (!T || T.pos.distanceTo(P.pos) > 2200) return false;
        const dir = this._c.subVectors(T.pos, P.pos).normalize();
        const sv = this._s.crossVectors(dir, Y).normalize();
        o.anchor = T.pos;
        o.pos.copy(T.pos).addScaledVector(dir, 32).addScaledVector(Y, 8).addScaledVector(sv, this.side * 7);
        o.look.copy(T.pos).lerp(P.pos, 0.8); o.fov = 48; o.stiff = 4;
        return true;
      }
      case 'side':
        o.pos.copy(P.pos).addScaledVector(right, this.side * 60).addScaledVector(Y, 9).addScaledVector(fwd, -12);
        o.look.copy(P.pos).addScaledVector(P.fwd, 25); o.fov = 42; o.stiff = 3;
        return true;
      case 'flycam':
        P.world(this._c.set(0, 1.78, -1.5), o.pos); P.world(this._c.set(0, 1.3, -60), o.look);
        o.up.copy(P.up); o.fov = 66; o.stiff = 30;
        return true;
      case 'cockpit':
        P.world(this._c.set(1.35 * this.side, 1.6, -8.2), o.pos); P.world(this._c.set(0, 1.05, -4.0), o.look);
        o.up.copy(P.up); o.fov = 44; o.stiff = 30;
        return true;
      case 'orbit':
        o.pos.set(P.pos.x + Math.cos(this.orbitA) * 120, P.pos.y + 26, P.pos.z + Math.sin(this.orbitA) * 120);
        o.look.copy(P.pos); o.fov = 50; o.stiff = 8;
        return true;
      case 'flyby':
        if (this.needPrep) { this.prepFlyby(P); this.needPrep = false; }
        o.anchor = null; o.pos.copy(this.fixed); o.look.copy(P.pos); o.fov = 36; o.stiff = 1e3;
        return true;
      default: return false;
    }
  }

  // how good a shot would look right now
  score(shot, ctx) {
    const o = this._o;
    if (!this.rig(shot, ctx, o)) return -99;
    const cam = this.tmp; cam.fov = o.fov; cam.aspect = this.cam.aspect; cam.near = 1; cam.far = 50000; cam.updateProjectionMatrix();
    cam.position.copy(o.pos); cam.up.copy(o.up); cam.lookAt(o.look); cam.updateMatrixWorld();
    let s = 0;
    const vis = p => { const v = this._c.copy(p).project(cam); return v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.8; };
    if (vis(ctx.P.pos)) s += 2; else s -= 3;
    const T = ctx.target && ctx.target.alive ? ctx.target : null;
    if (T && T.pos.distanceTo(ctx.P.pos) < 3000) s += vis(T.pos) ? 1.5 : -0.5;
    if (this.occluded(o.pos, ctx.P.pos)) s -= 5;
    if (o.pos.y < this.ground(o.pos.x, o.pos.z) + 8) s -= 4;
    return s;
  }
  occluded(a, b) {
    for (let i = 1; i < 12; i++) {
      const t = i / 12, x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
      if (y < this.ground(x, z)) return true;
    }
    return false;
  }
  pickNext(ctx) {
    const T = ctx.target && ctx.target.alive && !ctx.target.falling ? ctx.target : null;
    const fight = T && T.pos.distanceTo(ctx.P.pos) < 3200;
    const w = fight ? FIGHT : QUIET;
    let best = 'chase', bs = -1e9;
    for (const [shot, weight] of Object.entries(w)) {
      if (shot === this.shot) continue;
      if (shot === 'flyby') this.prepFlyby(ctx.P);
      const s = this.score(shot, ctx) + weight + Math.random() * 1.2;
      if (s > bs) { bs = s; best = shot; }
    }
    return best;
  }

  update(dt, ctx) {
    const { P, missiles } = ctx, cam = this.cam, o = this._o;
    this.t += dt; this.slowT -= dt; this.checkT -= dt;
    this.timeScale = this.slowT > 0 ? 0.25 : lerp(this.timeScale, 1, 1 - Math.exp(-dt * 2.5));
    let shot = this.shot;
    if (this.mode === 'cinematic') {
      if (!P.alive && shot !== 'death') { this.cut('death', { pos: P.pos.clone() }, 5.5); shot = 'death'; }
      if (shot !== 'missile' && shot !== 'kill' && shot !== 'death') {
        // leave a shot that has gone bad; otherwise never cut in the middle of the action
        if (this.checkT <= 0) { this.checkT = 0.25; this.badT = this.score(shot, ctx) < 0 ? this.badT + 0.25 : 0; }
        const done = this.t > this.dur && (!ctx.critical || this.t > this.dur + 6);
        if (done || this.badT > 0.75) { const keepFlyby = shot === 'flyby'; this.cut(this.pickNext(ctx)); if (keepFlyby && this.shot === 'flyby') this.needPrep = true; shot = this.shot; }
      } else if (this.t > this.dur && shot !== 'death') { this.cut(this.pickNext(ctx)); shot = this.shot; }
    } else shot = this.mode;

    if (shot === 'orbit' && this.mode === 'cinematic') this.orbitA += dt * 0.22 * this.side;
    if (shot === 'missile') {
      const m = this.data.m;
      o.anchor = null; o.up.copy(Y); o.stiff = 1e3;
      if (m && missiles.includes(m)) {
        o.pos.copy(m.pos).addScaledVector(m.dir, -16).addScaledVector(Y, 3.2);
        o.look.copy(m.pos).addScaledVector(m.dir, 70); this.lastPos = m.pos.clone(); o.fov = 55;
      } else {
        if (!this.data.goneT) this.data.goneT = this.t;
        o.pos.copy(cam.position); o.look.copy(this.lastPos || P.pos); o.fov = 50;
        if (this.t - this.data.goneT > 1.4) this.t = this.dur;
      }
    } else if (shot === 'kill' || shot === 'death') {
      const v = this.data.victim;
      if (v && v.alive && v.falling) this.data.pos.copy(v.pos);
      const R = shot === 'kill' ? 115 : 150, c = this.data.pos;
      this.orbitA += dt * (shot === 'kill' ? 0.5 : 0.25);
      o.anchor = null; o.up.copy(Y); o.stiff = 1e3;
      o.pos.set(c.x + Math.cos(this.orbitA) * R, c.y + 22, c.z + Math.sin(this.orbitA) * R); o.look.copy(c); o.fov = 52;
    } else if (shot === 'orbit' && this.mode === 'orbit') {
      const f = this.free; o.anchor = P.pos; o.up.copy(Y); o.stiff = 12; o.fov = 55;
      o.pos.set(P.pos.x + Math.cos(f.yaw) * Math.cos(f.pitch) * f.dist, P.pos.y + Math.sin(f.pitch) * f.dist, P.pos.z + Math.sin(f.yaw) * Math.cos(f.pitch) * f.dist);
      o.look.copy(P.pos);
    } else if (shot === 'player') {
      const a = ctx.aim; o.anchor = P.pos; o.stiff = 1e3; o.fov = 60 + clamp((P.speed - 150) / 230, 0, 1) * 9;
      const upP = this._c.copy(Y).addScaledVector(a, -a.y).normalize();
      o.pos.copy(P.pos).addScaledVector(a, -27).addScaledVector(upP, 6); o.look.copy(o.pos).add(a); o.up.copy(Y);
    } else if (!this.rig(shot, ctx, o)) this.rig('chase', ctx, o);
    // smooth relative to the subject so a 300 m/s jet does not leave the camera behind
    const k = 1 - Math.exp(-dt * o.stiff);
    if (o.anchor) {
      const relT = this._a.subVectors(o.pos, o.anchor), lookT = this._b.subVectors(o.look, o.anchor);
      if (this.snap) { this.rel.copy(relT); this.lookRel.copy(lookT); } else { this.rel.lerp(relT, k); this.lookRel.lerp(lookT, k); }
      cam.position.copy(o.anchor).add(this.rel); this.look.copy(o.anchor).add(this.lookRel);
    } else {
      if (this.snap) { this.abs.copy(o.pos); this.look.copy(o.look); } else { this.abs.lerp(o.pos, k); this.look.lerp(o.look, k); }
      cam.position.copy(this.abs);
    }
    this.snap = false;
    const gh = this.ground(cam.position.x, cam.position.z) + 5;
    if (cam.position.y < gh) cam.position.y = gh;
    this.fov = lerp(this.fov, o.fov, 1 - Math.exp(-dt * 3));
    cam.fov = this.fov; cam.up.copy(o.up); cam.lookAt(this.look);
  }

  prepFlyby(P) {
    const right = this._s.set(1, 0, 0).applyQuaternion(P.quat); right.y = 0; right.normalize();
    this.fixed.copy(P.pos).addScaledVector(P.vel, 2.6).addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * rand(30, 60)).addScaledVector(Y, rand(-8, 18));
    const gh = this.ground(this.fixed.x, this.fixed.z) + 15;
    if (this.fixed.y < gh) this.fixed.y = gh;
  }
}
