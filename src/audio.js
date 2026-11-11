// Procedural ambience: every sound is synthesized with Web Audio, no samples.
// The context starts on the first user gesture (autoplay rules), and each
// scene's bed crossfades in and out with the scene.

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    // 6 s of brown-ish noise, looped
    const n = ctx.sampleRate * 6, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    noiseBuf = b;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  src.start(0, Math.random() * 5);
  return src;
}

function lfo(ctx, rate, depth, param) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = rate; g.gain.value = depth;
  o.connect(g).connect(param); o.start();
  return o;
}

// Slow swell of filtered noise, like water moving overhead.
function swell(ctx, out, { cutoff, level, rate }) {
  const src = noise(ctx), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.4;
  g.gain.value = level;
  src.connect(f).connect(g).connect(out);
  const a = lfo(ctx, rate, level * 0.45, g.gain), b = lfo(ctx, rate * 0.6, cutoff * 0.35, f.frequency);
  return [src, a, b];
}

// Sounds placed at random times: bubbles, reef clicks, distant pings.
function scatter(ctx, out, every, play) {
  let timer = 0, live = true;
  const next = () => { if (!live) return; timer = setTimeout(() => { if (ctx.state === 'running') play(ctx, out, () => live); next(); }, every[0] + Math.random() * (every[1] - every[0])); };
  next();
  return { stop() { live = false; clearTimeout(timer); } };
}
function bubble(ctx, out, level = 0.05) {
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  const f0 = 280 + Math.random() * 500;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.07);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.1);
}
function click(ctx, out) {
  const t = ctx.currentTime, src = noise(ctx), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'highpass'; f.frequency.value = 3500;
  g.gain.setValueAtTime(0.025 * Math.random(), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  src.connect(f).connect(g).connect(out); src.stop(t + 0.02);
}

const BEDS = {
  reef(ctx, out) {
    const nodes = swell(ctx, out, { cutoff: 650, level: 0.32, rate: 0.08 });
    const a = scatter(ctx, out, [900, 3200], (c, o) => bubble(c, o, 0.04));
    const b = scatter(ctx, out, [25, 160], click); // snapping shrimp crackle
    return { nodes, timers: [a, b] };
  },
  ocean(ctx, out) {
    const nodes = swell(ctx, out, { cutoff: 380, level: 0.42, rate: 0.05 });
    const a = scatter(ctx, out, [2500, 7000], (c, o) => bubble(c, o, 0.03));
    return { nodes, timers: [a] };
  },
  kelp(ctx, out) {
    const nodes = swell(ctx, out, { cutoff: 520, level: 0.36, rate: 0.11 });
    // bubble vents: short runs of bubbles
    const a = scatter(ctx, out, [1800, 4500], (c, o, alive) => { for (let i = 0; i < 4; i++) setTimeout(() => { if (alive()) bubble(c, o, 0.035); }, i * (60 + Math.random() * 90)); });
    return { nodes, timers: [a] };
  },
  deep(ctx, out) {
    const nodes = swell(ctx, out, { cutoff: 150, level: 0.5, rate: 0.03 });
    const drone = ctx.createGain(); drone.gain.value = 0.06; drone.connect(out);
    for (const fr of [55, 55.35, 82.4]) { const o = ctx.createOscillator(); o.frequency.value = fr; o.connect(drone); o.start(); nodes.push(o); }
    nodes.push(lfo(ctx, 0.04, 0.03, drone.gain));
    // far-off soft pings with a long echo
    const echo = ctx.createDelay(2), fb = ctx.createGain(), wet = ctx.createGain();
    echo.delayTime.value = 0.9; fb.gain.value = 0.45; wet.gain.value = 0.6;
    echo.connect(fb).connect(echo); echo.connect(wet).connect(out);
    const disc = [echo, fb, wet]; // break the feedback loop on teardown
    const a = scatter(ctx, out, [9000, 20000], (c) => {
      const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 520 + Math.random() * 380;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g); g.connect(echo); g.connect(out); o.start(t); o.stop(t + 2.3);
    });
    return { nodes, timers: [a], disc };
  },
};

export class Ambience {
  constructor() { this.ctx = null; this.scene = null; this.muted = false; this.bed = null; }
  get running() { return this.ctx?.state === 'running'; }
  // Call from a user gesture.
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    if (this.scene) this.setScene(this.scene);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  setScene(key) {
    this.scene = key;
    const ctx = this.ctx;
    if (!ctx || this.bed?.key === key) return;
    const t = ctx.currentTime;
    if (this.bed) {
      const old = this.bed;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 1.2);
      old.timers.forEach((x) => x.stop());
      setTimeout(() => { old.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } n.disconnect(); }); (old.disc || []).forEach((n) => n.disconnect()); old.gain.disconnect(); }, 1500);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 2.5);
    gain.connect(this.master);
    this.bed = { key, gain, ...BEDS[key](ctx, gain) };
  }
  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(m ? 0 : 0.8, t + 0.4);
  }
  // Silence everything while the tab is hidden.
  setHidden(h) {
    if (!this.ctx) return;
    if (h) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }
}
