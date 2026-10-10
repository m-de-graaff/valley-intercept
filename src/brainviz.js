// Brain panel: what the fly sees, which neurons are active, and what reaches the controls.
// Neuron positions are real (FlyWire v783, frontal projection). Rates come from the fly pilot.
import { MAX_IN } from './flypilot.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const C = {
  ink: 'rgba(8,12,17,.78)', line: 'rgba(242,236,220,.14)', text: 'rgba(242,236,220,.86)', dim: 'rgba(242,236,220,.48)',
  visual: '#38c3b8', central: '#8b78e0', descending: '#e5a542', sensory: '#7e8794', mushroom: '#d77ab8',
  lc10: '#ffc04d', loom: '#ff7b54', turn: '#9be38a', gf: '#ff4f45', game: '#7fb0ff',
};
const POP = { LC10a: C.lc10, LPLC2: C.loom, LC4: C.loom };
const RASTER = [
  ['LC10a_left', 'in', 3], ['LC10a_right', 'in', 3], ['LPLC2_left', 'in', 2], ['LPLC2_right', 'in', 2], ['LC4_left', 'in', 2], ['LC4_right', 'in', 2],
  ['DNa02_left', 'turn', 1], ['DNa02_right', 'turn', 1], ['DNa04_left', 'turn', 1], ['DNa04_right', 'turn', 1],
  ['DNp01_left', 'gf', 1], ['DNp01_right', 'gf', 1],
  ['DNp04_left', 'dn', 1], ['DNp04_right', 'dn', 1], ['DNp02_left', 'dn', 1], ['DNp02_right', 'dn', 1],
  ['DNp11_left', 'dn', 1], ['DNp11_right', 'dn', 1], ['DNb01_left', 'dn', 1], ['DNb01_right', 'dn', 1],
];
const RCOL = { in: C.visual, turn: C.turn, gf: C.gf, dn: C.descending };
const SPAN = 4; // seconds of raster history

export class BrainViz {
  constructor(fly) {
    this.fly = fly;
    this.bg = document.createElement('canvas');
    this.ras = document.createElement('canvas');
    this.key = '';
    this.rasAcc = 0;
    this.rows = [];
    let prev = '';
    for (const [k, kind, n] of RASTER) for (let i = 0; i < n; i++) { this.rows.push({ k, kind, first: kind !== prev }); prev = kind; }
  }

  // static brain silhouette, cached per size
  prepBg(w, h, dpr) {
    const key = `${w}x${h}x${dpr}`;
    if (key === this.key) return;
    this.key = key;
    const c = this.bg; c.width = w * dpr; c.height = h * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const m = this.fly.map;
    for (const [px, py, cls] of m.background) {
      x.fillStyle = C[cls] || C.central; x.globalAlpha = cls === 'visual' ? 0.28 : 0.22;
      x.fillRect(px * w - 0.6, py * h - 0.6, 1.2, 1.2);
    }
    x.globalAlpha = 0.45; x.fillStyle = C.mushroom;
    for (const [px, py] of m.mushroom) x.fillRect(px * w - 0.6, py * h - 0.6, 1.2, 1.2);
    x.globalAlpha = 1;
    this.pops = {};
    for (const [k, pts] of Object.entries(m.populations)) {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      this.pops[k] = { pts, cx, cy, flash: new Float32Array(pts.length) };
    }
    const mk = m.mushroom; this.mb = [mk.reduce((s, p) => s + p[0], 0) / mk.length, mk.reduce((s, p) => s + p[1], 0) / mk.length];
    this.ras.width = 0; // reset raster on resize
  }

  draw(c, x0, y0, pw, ph, dt, ctl) {
    const f = this.fly; if (!f.ready) return;
    const dpr = c.getTransform().a || 1;
    const pad = 10, iw = pw - pad * 2;
    // vertical budget
    const eyeW = Math.min((iw - 10) / 2, 92), eyeH = eyeW * 512 / 450;
    const brainH = Math.round(iw * 0.42), chainH = 120, rasH = clamp(ph - (26 + eyeH + 30 + brainH + 14 + chainH + 30), 60, 150);
    const H = 26 + eyeH + 30 + brainH + 14 + chainH + rasH + 30;
    c.save();
    c.fillStyle = C.ink; c.fillRect(x0, y0, pw, H);
    c.strokeStyle = C.line; c.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, H - 1);
    // header
    c.font = '700 12px "Saira Condensed", sans-serif'; c.textAlign = 'left'; c.fillStyle = C.text;
    c.fillText('FRUIT FLY PILOT', x0 + pad, y0 + 17);
    c.font = '500 10px "IBM Plex Mono", monospace'; c.fillStyle = C.dim;
    c.fillText('NeuroMechFly eyes · FlyWire brain', x0 + pad + 92, y0 + 17);
    let y = y0 + 26;

    // eyes
    const r = Math.max(1.1, eyeW / 60);
    f.eyes.forEach((eye, ei) => {
      const ex = x0 + pad + (iw - eyeW * 2 - 10) / 2 + ei * (eyeW + 10);
      for (let i = 0; i < eye.n; i++) {
        const v = Math.round(clamp(eye.lum[i], 0, 1) * 255), cv = eye.cov[i];
        c.fillStyle = cv > 0.05 ? `rgb(${Math.min(255, v + Math.round(cv * 160))},${Math.round(v * 0.7)},${Math.round(v * 0.35)})` : `rgb(${Math.round(v * 0.8)},${v},${Math.round(v * 0.7)})`;
        c.fillRect(ex + eye.uv[i][0] * eyeW - r, y + eye.uv[i][1] * eyeH - r, r * 2, r * 2);
      }
      c.fillStyle = C.dim; c.font = '500 9.5px "IBM Plex Mono", monospace'; c.textAlign = 'center';
      c.fillText(ei ? 'right eye' : 'left eye', ex + eyeW / 2, y + eyeH + 11);
    });
    c.fillStyle = C.dim; c.textAlign = 'center'; c.fillText('721 ommatidia per eye', x0 + pw / 2, y + eyeH + 23);
    y += eyeH + 30;

    // brain map
    const bx = x0 + pad, by = y, bw = iw, bh = brainH;
    this.prepBg(bw, bh, dpr);
    c.drawImage(this.bg, bx, by, bw, bh);
    const P = (p) => [bx + p[0] * bw, by + p[1] * bh];
    // pathways: population -> descending neuron, weighted by the measured response
    c.lineWidth = 1;
    for (const [g, pop] of Object.entries(this.pops)) {
      const rate = f.inputs[g] || 0; if (rate < 2) continue;
      const resp = f.respond(g, rate), [cx, cy] = P([pop.cx, pop.cy]);
      for (const [n, pos] of Object.entries(f.map.neurons)) {
        const d = resp(n) - (f.base[n] || 0); if (d < 3) continue;
        const [nx, ny] = P(pos);
        c.strokeStyle = POP[g.split('_')[0]]; c.globalAlpha = clamp(d / 90, 0.08, 0.75);
        c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo((cx + nx) / 2, Math.min(cy, ny) - 12, nx, ny); c.stroke();
      }
    }
    c.globalAlpha = 1;
    // input populations: every neuron, flickering at its firing rate
    for (const [g, pop] of Object.entries(this.pops)) {
      const rate = f.inputs[g] || 0, col = POP[g.split('_')[0]];
      const p = rate * dt;
      for (let i = 0; i < pop.pts.length; i++) {
        if (Math.random() < p) pop.flash[i] = 1; else pop.flash[i] *= 0.82;
        const a = 0.18 + clamp(rate / MAX_IN, 0, 1) * 0.45 + pop.flash[i] * 0.5;
        c.globalAlpha = clamp(a, 0, 1); c.fillStyle = pop.flash[i] > 0.6 ? '#fff' : col;
        const [px, py] = P(pop.pts[i]); c.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
      }
    }
    c.globalAlpha = 1;
    // descending neurons
    for (const [n, pos] of Object.entries(f.map.neurons)) {
      const rate = f.dn[n] || 0, [nx, ny] = P(pos);
      const col = /DNp01/.test(n) ? C.gf : /DNa02|DNa04/.test(n) ? C.turn : C.descending;
      const rad = 1.6 + clamp(rate / 40, 0, 4);
      if (rate > 5) { c.globalAlpha = clamp(rate / 150, 0.15, 0.55); c.fillStyle = col; c.beginPath(); c.arc(nx, ny, rad + 4, 0, 6.283); c.fill(); }
      c.globalAlpha = rate > 2 ? 1 : 0.45; c.fillStyle = col; c.beginPath(); c.arc(nx, ny, rad, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
    // region labels
    const label = (txt, sub, px, py, lx, ly, col, align) => {
      c.strokeStyle = col; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(px, py); c.lineTo(lx, ly); c.stroke(); c.globalAlpha = 1;
      c.textAlign = align; c.fillStyle = col; c.font = '700 9.5px "Saira Condensed", sans-serif'; c.fillText(txt, lx, ly - 2);
      if (sub) { c.fillStyle = C.dim; c.font = '500 8.5px "IBM Plex Mono", monospace'; c.fillText(sub, lx, ly + 8); }
    };
    const L = this.pops.LC10a_left, R = this.pops.LC10a_right;
    label('OPTIC L', 'LC10a · LPLC2 · LC4', ...P([L.cx, L.cy]), bx + 2, by + 12, C.visual, 'left');
    label('OPTIC R', 'LC10a · LPLC2 · LC4', ...P([R.cx, R.cy]), bx + bw - 2, by + 12, C.visual, 'right');
    if (this.learner && this.learner.pulse > 0) { // learning: dopamine-style update of the danger memory
      const [mx, my] = P(this.mb), pu = this.learner.pulse;
      const g = c.createRadialGradient(mx, my, 0, mx, my, 26); g.addColorStop(0, `rgba(215,122,184,${0.75 * pu})`); g.addColorStop(1, 'rgba(215,122,184,0)');
      c.fillStyle = g; c.beginPath(); c.arc(mx, my, 26, 0, 6.283); c.fill();
    }
    label('MUSHROOM B.', 'learning · model', ...P(this.mb), bx + bw - 2, by + bh - 4, C.mushroom, 'right');
    const g = f.map.neurons.DNp01_left;
    if (g) label('DESCENDING', 'turn · escape', ...P(g), bx + bw * 0.3, by + bh - 4, C.descending, 'left');
    y += brainH + 14;

    // output chain: brain outputs -> flight skills (game code) -> controls
    const tl = clamp(f.turnL(), 0, 1), tr = clamp(f.turnR(), 0, 1), gf = clamp(f.giantFiber / 120, 0, 1), u = f.uses || {};
    const box = (txt, sub, x, yy, w, h, col, on) => {
      c.globalAlpha = 0.18 + on * 0.6; c.fillStyle = col; c.fillRect(x, yy, w, h); c.globalAlpha = 1;
      c.strokeStyle = col; c.globalAlpha = 0.35 + on * 0.6; c.strokeRect(x + 0.5, yy + 0.5, w - 1, h - 1); c.globalAlpha = 1;
      c.fillStyle = on > 0.35 ? '#0a0f14' : C.text; c.textAlign = 'center'; c.font = '700 9.5px "Saira Condensed", sans-serif';
      c.fillText(txt, x + w / 2, yy + (sub ? 11 : h / 2 + 3.5));
      if (sub) { c.font = '500 8px "IBM Plex Mono", monospace'; c.fillText(sub, x + w / 2, yy + 21); }
    };
    const bw3 = (iw - 12) / 3;
    box('TURN L', 'DNa02+DNa04', x0 + pad, y, bw3, 26, C.turn, tl);
    box('TURN R', 'DNa02+DNa04', x0 + pad + bw3 + 6, y, bw3, 26, C.turn, tr);
    box('GIANT FIBER', 'DNp01 · escape', x0 + pad + (bw3 + 6) * 2, y, bw3, 26, C.gf, gf);
    const y2 = y + 34;
    box('FLIGHT SKILLS', 'game code', x0 + pad, y2, iw * 0.62, 26, C.game, 0.45);
    box('JET SENSORS', 'radar · RWR', x0 + pad + iw * 0.62 + 6, y2, iw * 0.38 - 6, 26, C.game, u.sensors ? 0.8 : 0.05);
    c.fillStyle = C.text; c.textAlign = 'left'; c.font = '500 9px "IBM Plex Mono", monospace';
    c.fillText((f.skill || '').slice(0, Math.floor(iw / 5.6)), x0 + pad, y2 + 38);
    // which brain outputs drive the current manoeuvre
    c.fillStyle = C.dim; c.textAlign = 'right';
    const src = [u.lc10a && 'LC10a target', u.turn && 'turn DNs', u.gf && 'giant fiber', u.loom && 'looming', u.memory && 'memory', u.learned && 'learned memory', u.sensors && 'jet sensors'].filter(Boolean).join(' + ');
    c.textAlign = 'left'; c.fillText(src ? 'using: ' + src : '', x0 + pad, y2 + 50);
    y += chainH;

    // controls strip
    const ctlItems = [['STICK', 1], ['THR', clamp(ctl.throttle / 1.1, 0, 1)], ['BRAKE', ctl.brake], ['GUN', ctl.fire ? 1 : 0], ['MSL', ctl.missile ? 1 : 0], ['FLR', ctl.flares ? 1 : 0]];
    const cw = (iw - 5 * 4) / 6;
    ctlItems.forEach(([t, v], i) => box(t, '', x0 + pad + i * (cw + 4), y2 + 58, cw, 14, i === 0 ? C.game : t === 'BRAKE' || t === 'THR' ? C.game : C.lc10, v));

    // spike raster
    c.fillStyle = C.dim; c.textAlign = 'left'; c.font = '700 9px "Saira Condensed", sans-serif';
    c.fillText(`SPIKE RASTER · last ${SPAN} s`, x0 + pad, y + 8);
    const ry = y + 12, rw = iw, rh = rasH;
    this.drawRaster(c, x0 + pad, ry, rw, rh, dt, dpr);
    // legend
    let lx = x0 + pad; const ly = ry + rh + 12;
    c.font = '500 8.5px "IBM Plex Mono", monospace';
    for (const [t, col] of [['VISUAL', C.visual], ['TURN', C.turn], ['ESCAPE', C.gf], ['OTHER DN', C.descending], ['GAME CODE', C.game]]) {
      c.fillStyle = col; c.fillRect(lx, ly - 6, 6, 6); c.fillStyle = C.dim; c.textAlign = 'left'; c.fillText(t, lx + 9, ly); lx += c.measureText(t).width + 20;
    }
    c.restore();
    return H;
  }

  drawRaster(c, x, y, w, h, dt, dpr) {
    const R = this.ras, W = Math.round(w * dpr), Hh = Math.round(h * dpr);
    if (R.width !== W || R.height !== Hh) { R.width = W; R.height = Hh; this.rasAcc = 0; }
    const rc = R.getContext('2d');
    this.rasAcc += (W / SPAN) * dt;
    const shift = Math.floor(this.rasAcc);
    if (shift > 0) {
      this.rasAcc -= shift;
      rc.globalCompositeOperation = 'copy'; rc.drawImage(R, -shift, 0); rc.globalCompositeOperation = 'source-over';
      rc.clearRect(W - shift, 0, shift, Hh);
      const rowH = Hh / this.rows.length, f = this.fly;
      this.rows.forEach((row, i) => {
        const rate = row.kind === 'in' ? f.inputs[row.k] || 0 : f.dn[row.k] || 0;
        const span = (shift / W) * SPAN;
        let t = -Math.log(Math.random()) / Math.max(rate, 1e-3);
        rc.fillStyle = RCOL[row.kind];
        while (t < span) { rc.fillRect(W - shift + (t / span) * shift, i * rowH + rowH * 0.15, Math.max(1, dpr * 0.9), Math.max(1, rowH * 0.7)); t += -Math.log(Math.random()) / rate; }
      });
    }
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x, y, w, h);
    c.drawImage(R, x, y, w, h);
    // row group labels
    c.font = '500 7.5px "IBM Plex Mono", monospace'; c.textAlign = 'left';
    const rowH = h / this.rows.length;
    const names = { in: 'VISUAL IN', turn: 'TURN DN', gf: 'GIANT FIBER', dn: 'OTHER DN' };
    this.rows.forEach((row, i) => {
      if (!row.first) return;
      c.fillStyle = 'rgba(242,236,220,.5)';
      c.fillText(names[row.kind], x + 2, y + i * rowH + 8);
      c.fillStyle = 'rgba(242,236,220,.08)'; if (i) c.fillRect(x, y + i * rowH, w, 1);
    });
  }
}
