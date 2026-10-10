// How the fly learns from getting hurt. Two mechanisms, both game models (not connectome simulations):
//
// 1. Danger memory, modelled on the mushroom body. The real mushroom body learns
//    which situations predict punishment: dopamine neurons weaken or strengthen
//    Kenyon-cell -> output-neuron synapses for whatever odour (here: situation)
//    was active. Here every situation leaves a decaying trace; damage raises the
//    learned danger of the situations with a trace, kills lower it.
// 2. Tactics, tuned by trial and error. Each wave the fly flies a slightly varied
//    set of tactic numbers. If that wave goes better than its best so far, it keeps
//    them. A death counts heavily against.
//
// Memory is saved in this browser between visits.

const KEY = 'valley-intercept-learning-v1';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export const SITUATIONS = {
  headOn: 'Head-on passes',
  closeSix: 'Sitting close on a tail',
  slowFight: 'Slow turning fights',
  blindSpot: 'Bandit in the blind spot',
  bomberRear: "Bomber's tail-gun cone",
  missile: 'Late missile defence',
  lowAlt: 'Fighting low',
  straight: 'Flying straight near bandits',
};
export const TACTICS = { // [min, max, start, step]
  corner: [125, 200, 145, 9, 'Fight speed', 'm/s'],
  gunRange: [450, 1100, 1000, 70, 'Gun range', 'm'],
  breakRange: [900, 2400, 1700, 140, 'Break when attacked within', 'm'],
  flareDist: [1300, 3200, 2000, 180, 'Flares at', 'm'],
  checkSix: [2.5, 10, 6, 0.9, 'Check six every', 's'],
  rtbHp: [15, 60, 30, 5, 'Go home below', '%'],
  floor: [250, 900, 400, 55, 'Lowest fight height', 'm'],
};
const defaults = () => Object.fromEntries(Object.entries(TACTICS).map(([k, v]) => [k, v[2]]));

export class Learner {
  constructor() {
    this.enabled = true;
    this.V = Object.fromEntries(Object.keys(SITUATIONS).map(k => [k, 0]));
    this.trace = Object.fromEntries(Object.keys(SITUATIONS).map(k => [k, 0]));
    this.best = { theta: defaults(), fit: null };
    this.theta = defaults();
    this.episodes = 0; this.history = [];
    this.pulse = 0; this.lastEvent = '';
    this.ep = null;
    this.load();
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return;
      Object.assign(this.V, d.V || {});
      if (d.best) this.best = { theta: { ...defaults(), ...d.best.theta }, fit: d.best.fit };
      this.episodes = d.episodes || 0; this.history = d.history || [];
      this.theta = { ...this.best.theta };
    } catch (e) { /* no memory yet */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ V: this.V, best: this.best, episodes: this.episodes, history: this.history.slice(-40) })); } catch (e) { /* storage blocked */ }
  }
  reset() {
    for (const k of Object.keys(this.V)) { this.V[k] = 0; this.trace[k] = 0; }
    this.best = { theta: defaults(), fit: null }; this.theta = defaults();
    this.episodes = 0; this.history = []; this.ep = null; this.lastEvent = 'Memory wiped';
    this.save();
  }
  // situations active right now leave a trace that fades over ~3 s
  tick(dt, active) {
    for (const k of Object.keys(this.trace)) this.trace[k] = clamp(this.trace[k] * Math.exp(-dt / 3) + (active[k] ? dt : 0), 0, 1);
    this.pulse = Math.max(0, this.pulse - dt);
    if (this.ep) this.ep.time += dt;
  }
  punish(dmg) {
    if (this.ep) this.ep.damage += dmg;
    if (!this.enabled) return;
    let top = null, topD = 0;
    for (const k of Object.keys(this.V)) {
      const d = 0.012 * dmg * this.trace[k];
      this.V[k] = clamp(this.V[k] + d, 0, 1);
      if (d > topD) { topD = d; top = k; }
    }
    if (top) { this.pulse = 1; this.lastEvent = `Hurt: more wary of ${SITUATIONS[top].toLowerCase()}`; }
  }
  reward() {
    if (this.ep) this.ep.kills++;
    if (!this.enabled) return;
    for (const k of Object.keys(this.V)) this.V[k] = clamp(this.V[k] - 0.06 * this.trace[k], 0, 1);
    this.pulse = 0.6; this.lastEvent = 'Kill: what it was doing feels safer';
  }
  // one episode = one wave (or one duel round)
  startEpisode() {
    this.theta = { ...this.best.theta };
    if (this.enabled && this.best.fit !== null) {
      for (const [k, [lo, hi, , step]] of Object.entries(TACTICS)) this.theta[k] = clamp(this.theta[k] + gauss() * step, lo, hi);
    }
    this.ep = { time: 0, damage: 0, kills: 0 };
  }
  endEpisode(died, cleared) {
    if (!this.ep) return null;
    const e = this.ep; this.ep = null;
    const fit = e.kills * 120 + (cleared ? 150 : 0) - e.damage * 1.5 - (died ? 220 : 0) - Math.min(e.time, 400) * 0.25;
    this.episodes++;
    let kept = false;
    if (this.enabled) {
      if (this.best.fit === null || fit > this.best.fit) { this.best = { theta: { ...this.theta }, fit }; kept = true; }
      else this.best.fit = this.best.fit * 0.85 + fit * 0.15; // old luck fades, so it keeps exploring
    }
    this.history.push({ n: this.episodes, fit: Math.round(fit), kept, died });
    this.lastEvent = kept ? `Wave ${died ? 'lost' : 'won'}: kept the new tactics (score ${Math.round(fit)})` : `Wave ${died ? 'lost' : 'won'}: went back to its best tactics`;
    this.pulse = 1;
    this.save();
    return { fit, kept };
  }
}
