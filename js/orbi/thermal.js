// ORBI — THERMAL EYE (simulated). A normal webcam cannot see infrared, so unless real thermal hardware is connected this
// module SIMULATES a radiometric thermal camera: it builds a temperature field (°C) of the astronaut every frame, then
// ANALYSES that field exactly like real thermal data would be analysed — nostril-region breathing signal → breathing
// rate, forehead/inner-eye temperatures → skin temperature & fever check, forehead-vs-nose pattern → stress, frame
// differences → movement, sleep/wake state and awakenings during the night.
// A connected UVC thermal camera can be shown instead (relative, uncalibrated false-colour; radiometric temperatures
// need the vendor SDK).
const GW = 96, GH = 72; // temperature grid resolution

// iron-bow palette
const STOPS = [[0, [0, 0, 10]], [0.15, [32, 0, 96]], [0.32, [120, 0, 140]], [0.5, [200, 30, 90]], [0.66, [240, 90, 20]], [0.82, [255, 180, 0]], [0.94, [255, 240, 120]], [1, [255, 255, 255]]];
export function ironbow(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i]; const k = (t - a) / (b - a); return ca.map((c, j) => Math.round(c + (cb[j] - c) * k)); }
  return STOPS.at(-1)[1];
}

export const MODES = {
  day: { label: 'Awake (normal)', core: 0, stress: 0, rr: 14 },
  stress: { label: 'Acute stress', core: 0, stress: 1, rr: 19 },
  fever: { label: 'Possible fever', core: 2.4, stress: 0, rr: 18 },
  night: { label: 'Night — sleeping in darkness', core: -0.3, stress: 0, rr: 12 },
};

export class ThermalEye {
  constructor(canvas, { onReading, onNightEnd } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.grid = new Float32Array(GW * GH); this.prev = new Float32Array(GW * GH);
    this.img = this.ctx.createImageData(GW, GH); this.off = document.createElement('canvas'); this.off.width = GW; this.off.height = GH;
    this.mode = 'day'; this.t = 0; this.running = false; this.onReading = onReading; this.onNightEnd = onNightEnd;
    this.breath = []; this.motion = []; this.events = []; this.readings = {}; this.hw = null;
    this.night = null; this.speed = 60; // night simulation: 1 real second = 60 simulated seconds
    this.base = null; this.learn = []; this.onBaseline = null; this.trend = [];
  }
  /** Personal per-region baseline (°C), learned during calm, awake observation and stored by the camera page. */
  setBaseline(b) { this.base = b; this.learn = []; }
  setMode(m) {
    this.mode = m; this.breath = []; this.events = []; this.trend = [];
    this.night = m === 'night' ? { simMin: 0, periods: [], state: 'awake', since: 0, wakes: 0, restlessMin: 0, onset: null, lastMove: -99, plan: this.planNight() } : null;
  }
  planNight() { // scripted night: sleep onset after ~18 min, 2 awakenings, a few restless spells
    const r = Math.random; return { onset: 14 + r() * 10, wakes: [150 + r() * 40, 300 + r() * 50], restless: [70, 210, 360].map(x => x + r() * 25) };
  }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); const loop = now => { if (!this.running) return; const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.step(dt); this.draw(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  // ---------- simulated physics: temperature field ----------
  step(dt) {
    this.t += dt; const M = MODES[this.mode]; const g = this.grid; this.prev.set(g);
    const N = this.night; let lying = false, moveAmp = 0.15, headLift = 0, awake = true;
    if (N) {
      N.simMin += dt * this.speed / 60; const m = N.simMin, P = N.plan;
      lying = true;
      const inWake = P.wakes.some(w => m > w && m < w + 12) || m < P.onset;
      const inRest = P.restless.some(x => m > x && m < x + 6);
      awake = inWake; moveAmp = inWake ? 2.4 : inRest ? 0.9 : 0.04; headLift = inWake && P.wakes.some(w => m > w && m < w + 12) ? 1 : 0;
    }
    const breathRate = N ? (awake ? 15 : 12) : M.rr; const ph = this.t * breathRate / 60 * Math.PI * 2;
    const exhale = Math.sin(ph); // + = exhaling warm air
    const sway = Math.sin(this.t * 0.7) * moveAmp * 1.5 + (Math.random() - 0.5) * moveAmp * 1.2;
    const core = 37 + M.core, skin = 34.3 + M.core * 0.8;
    const ambient = N ? 21.5 : 22.5;
    // geometry (grid units)
    const cx = GW / 2 + sway, headY = lying ? GH * 0.42 - headLift * 6 : GH * 0.3, headX = lying ? GW * 0.22 + sway : cx;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      let T = ambient + 0.6 * (y / GH);
      if (lying) {
        // sleeping bag body (insulated → cooler surface), head out of the bag
        const bx = (x - GW * 0.58) / (GW * 0.36), by = (y - GH * 0.5) / (GH * 0.2); if (bx * bx + by * by < 1) T = 27.5 + 1.2 * (1 - (bx * bx + by * by));
      } else {
        const bx = (x - cx) / (GW * 0.3), by = (y - GH * 0.95) / (GH * 0.42); if (bx * bx + by * by < 1) T = 31.5 + 0.8 * (1 - bx * bx); // torso (clothing)
        const nx = (x - cx) / (GW * 0.07), ny = (y - GH * 0.52) / (GH * 0.1); if (nx * nx + ny * ny < 1) T = skin - 0.6; // neck
      }
      const hx = (x - headX) / (GW * (lying ? 0.1 : 0.13)), hy = (y - headY) / (GH * (lying ? 0.15 : 0.2)); const hr = hx * hx + hy * hy;
      if (hr < 1) {
        T = skin + 0.4 * (1 - hr);
        if (!lying) {
          const fy = (y - (headY - GH * 0.12)) / (GH * 0.05), fx = (x - headX) / (GW * 0.08); if (fx * fx + fy * fy < 1) T += 0.3 + 0.6 * M.stress + 0.5 * M.core; // forehead
          for (const s of [-1, 1]) { const ex = (x - (headX + s * GW * 0.045)) / (GW * 0.018), ey = (y - (headY - GH * 0.03)) / (GH * 0.02); if (ex * ex + ey * ey < 1) T = core - 1.6 + 0.2 * M.core; } // inner eye canthus ≈ core
          const nx = (x - headX) / (GW * 0.025), ny = (y - (headY + GH * 0.04)) / (GH * 0.035); if (nx * nx + ny * ny < 1) T -= 0.6 + 0.9 * M.stress; // nose tip (cools under stress)
          for (const s of [-1, 1]) { const cx2 = (x - (headX + s * GW * 0.07)) / (GW * 0.03), cy2 = (y - (headY + GH * 0.04)) / (GH * 0.04); if (cx2 * cx2 + cy2 * cy2 < 1) T += 0.15 + 0.3 * M.core - 0.25 * M.stress; } // cheeks
          const rx = (x - headX) / (GW * 0.05), ry = (y - (headY + GH * 0.085)) / (GH * 0.025); if (rx * rx + ry * ry < 1) T += 1.1 * exhale - 0.2; // nostril / upper-lip breath zone
        } else {
          const rx = (x - (headX + GW * 0.05)) / (GW * 0.04), ry = (y - headY) / (GH * 0.04); if (rx * rx + ry * ry < 1) T += 0.9 * exhale; // breath zone at the nose (side view)
        }
      }
      g[y * GW + x] = T + (Math.random() - 0.5) * 0.08; // sensor noise (NETD ≈ 50 mK)
    }
    if (this.hw) this.readHardware();
    this.analyse(dt, lying, awake);
  }

  // ---------- analysis of the (simulated or real) temperature field ----------
  roi(x0, y0, x1, y1, fn = 'mean') { const g = this.grid; let s = 0, n = 0, mx = -99; for (let y = Math.max(0, y0 | 0); y < Math.min(GH, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(GW, x1); x++) { const v = g[y * GW + x]; s += v; n++; if (v > mx) mx = v; } return fn === 'max' ? mx : n ? s / n : null; }
  analyse(dt, lying, awake) {
    const g = this.grid; let diff = 0; for (let i = 0; i < g.length; i += 4) diff += Math.abs(g[i] - this.prev[i]); diff /= g.length / 4;
    this.motion.push(diff); if (this.motion.length > 60) this.motion.shift();
    // locate the head = warmest blob; ROIs relative to it
    let hx = 0, hy = 0, hn = 0, mx = 0; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { const v = g[y * GW + x]; if (v > 33.2) { hx += x; hy += y; hn++; } if (v > mx) mx = v; }
    if (!hn) { this.readings = { ...this.readings, valid: false }; return; }
    hx /= hn; hy /= hn;
    // ---- named facial regions (grid boxes relative to the warmest blob = the head) ----
    const B = (x0, y0, x1, y1) => [Math.round(hx + x0), Math.round(hy + y0), Math.round(hx + x1), Math.round(hy + y1)];
    const boxes = lying ? { breath: B(2, -4, 9, 3), face: B(-5, -5, 5, 5) } : {
      forehead: B(-6, -11, 6, -6), canthusL: B(-6, -4, -2, -1), canthusR: B(2, -4, 6, -1), nose: B(-2, 0, 2, 3), cheekL: B(-9, 0, -5, 4), cheekR: B(5, 0, 9, 4), breath: B(-4, 3, 5, 8) };
    const val = (k, fn = 'mean') => boxes[k] ? this.roi(...boxes[k], fn) : null;
    const breathZone = val('breath');
    this.breath.push({ t: this.t, v: breathZone }); while (this.breath.length && this.t - this.breath[0].t > 30) this.breath.shift();
    const rr = this.breathRate();
    const forehead = val('forehead'), noseTip = val('nose');
    const canthusL = val('canthusL', 'max'), canthusR = val('canthusR', 'max');
    const cheekL = val('cheekL'), cheekR = val('cheekR');
    const skin = lying ? val('face', 'max') - 0.6 : forehead;
    const canthus = lying ? mx : Math.max(canthusL ?? 0, canthusR ?? 0) || mx;
    const stressIdx = forehead != null && noseTip != null ? forehead - noseTip : null; // forehead–nose gradient (calm ≈ 0.9 °C)
    // breathing amplitude in the breath zone (peak-to-peak over the last 10 s) and sensor noise (background) → data quality
    const recentB = this.breath.filter(x => this.t - x.t < 10).map(x => x.v); const amp = recentB.length > 5 ? Math.max(...recentB) - Math.min(...recentB) : null;
    let bs = 0, bq = 0, bn = 0; for (let x = 2; x < 12; x++) for (let y = 2; y < 10; y++) { const v = g[y * GW + x]; bs += v; bq += v * v; bn++; } const noise = Math.sqrt(Math.max(0, bq / bn - (bs / bn) ** 2));
    const quality = !hn || hn < 40 ? 'poor' : noise > 0.25 || (amp != null && amp < 0.15) ? 'fair' : 'good';
    const regions = lying ? [['face', 'Face (max)', skin + 0.6]] : [['forehead', 'Forehead', forehead], ['canthusL', 'Inner eye corner L', canthusL], ['canthusR', 'Inner eye corner R', canthusR], ['nose', 'Nose tip', noseTip], ['cheekL', 'Cheek L', cheekL], ['cheekR', 'Cheek R', cheekR]];
    // personal baseline: learn during ~40 s of calm, awake observation (only if none is stored)
    if (!lying && !this.base && this.mode === 'day') { this.learn.push(Object.fromEntries(regions.map(([k, , v]) => [k, v]))); if (this.learn.length > 400) { const bse = {}; for (const [k] of regions) bse[k] = +(this.learn.reduce((s2, o) => s2 + o[k], 0) / this.learn.length).toFixed(2); bse.ts = Date.now(); this.base = bse; this.onBaseline?.(bse); } }
    const base = this.base;
    const rois = regions.map(([k, label, now]) => ({ key: k, label, now, base: base?.[k] ?? null, delta: base?.[k] != null && now != null ? now - base[k] : null, box: boxes[k] }));
    const grad = { foreheadNose: stressIdx, canthusForehead: canthus != null && forehead != null ? canthus - forehead : null, cheekAsym: cheekL != null && cheekR != null ? cheekL - cheekR : null, breathAmp: amp };
    const r = { valid: true, rr, skin, canthus, forehead, noseTip, stressIdx, motion: diff, t: this.t, rois, grad, quality, noise, baseLearning: !base && !lying, boxes };
    r.alerts = []; const D = k => rois.find(x => x.key === k)?.delta;
    const f1 = v => (v > 0 ? '+' : '') + v.toFixed(1);
    if (canthus >= 37.8) r.alerts.push({ lvl: 'warning', text: `Inner eye corners at ${canthus.toFixed(1)} °C${D('canthusL') != null ? ` (${f1(Math.max(D('canthusL'), D('canthusR')))} °C vs your baseline)` : ''}; forehead ${forehead != null ? forehead.toFixed(1) + ' °C' : '—'}. The whole face is warmer — a pattern consistent with fever. Skin is not core temperature: confirm with the medical-kit thermometer.` });
    if (stressIdx != null && stressIdx > 1.3) r.alerts.push({ lvl: 'caution', text: `Nose tip ${noseTip.toFixed(1)} °C${D('nose') != null ? ` (${f1(D('nose'))} °C vs baseline)` : ''} while the forehead is ${forehead.toFixed(1)} °C${D('forehead') != null ? ` (${f1(D('forehead'))})` : ''}: forehead–nose difference ${stressIdx.toFixed(1)} °C${base?.forehead != null ? ` (your baseline ${(base.forehead - base.nose).toFixed(1)} °C)` : ''}. Nose cooling with a stable forehead is a thermal pattern linked to acute stress (narrowing of skin blood vessels).` });
    if (grad.cheekAsym != null && Math.abs(grad.cheekAsym) > 0.8) r.alerts.push({ lvl: 'caution', text: `Left and right cheeks differ by ${Math.abs(grad.cheekAsym).toFixed(1)} °C — an unusual asymmetry; check for local inflammation, a draught or the camera angle.` });
    if (rr != null && (rr > 22 || rr < 8)) r.alerts.push({ lvl: 'caution', text: `Breathing rate ${rr.toFixed(0)}/min from the breath-zone temperature (exhaled air warms the area under the nose) — outside the usual 8–22/min.` });
    if (quality !== 'good') r.alerts.push({ lvl: 'info', text: quality === 'poor' ? 'Data quality poor: the face is not clearly in view — readings unreliable.' : 'Data quality fair: weak breathing signal or noisy image — rates are less certain.' });
    if (this.night) this.nightTrack(diff, awake, r);
    this.readings = r; this.onReading?.(r);
  }
  breathRate() { // resample the breath-zone temperature to 10 Hz, smooth 0.5 s, count exhalation peaks with hysteresis
    const b = this.breath; if (b.length < 20 || b.at(-1).t - b[0].t < 10) return null;
    const t0 = b[0].t, t1 = b.at(-1).t, n = Math.floor((t1 - t0) * 10); const u = new Float64Array(n); let k = 0;
    for (let i = 0; i < n; i++) { const t = t0 + i / 10; while (k < b.length - 2 && b[k + 1].t < t) k++; const a = b[k], c = b[k + 1]; u[i] = a.v + (c.v - a.v) * Math.max(0, Math.min(1, (t - a.t) / ((c.t - a.t) || 1))); }
    const sm = u.map((_, i) => { let s2 = 0, m = 0; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s2 += u[j]; m++; } return s2 / m; });
    const mean = sm.reduce((a, c) => a + c, 0) / n, sd = Math.sqrt(sm.reduce((a, c) => a + (c - mean) ** 2, 0) / n), h = 0.3 * sd;
    let state = sm[0] > mean ? 1 : -1, peaks = 0; for (let i = 1; i < n; i++) { if (state < 0 && sm[i] > mean + h) { state = 1; peaks++; } else if (state > 0 && sm[i] < mean - h) state = -1; }
    return peaks / ((t1 - t0) / 60);
  }
  nightTrack(diff, awake, r) {
    const N = this.night; const m = N.simMin;
    N.sm = (N.sm ?? diff) * 0.9 + Math.min(diff, 0.5) * 0.1; // smoothed movement energy
    const st = N.sm > 0.085 ? 'awake' : N.sm > 0.042 ? 'restless' : 'asleep';
    // smooth: require the state to persist ~2 simulated minutes
    if (st !== N.cand) { N.cand = st; N.candSince = m; }
    if (N.cand !== N.state && m - N.candSince > 2) {
      N.periods.push({ s: N.since, e: m, st: N.state });
      if (N.cand === 'awake' && N.onset != null) N.wakes++;
      if (N.state === 'awake' && N.cand !== 'awake' && N.onset == null) N.onset = m;
      N.state = N.cand; N.since = m;
    }
    if (N.state === 'restless') N.restlessMin += (this.speed / 60) / 60;
    if (!N.lastTrend || m - N.lastTrend >= 15) { N.lastTrend = m; this.trend.push({ simMin: Math.round(m), face: +(r.skin + 0.6).toFixed(2), state: N.state }); }
    r.sleep = { simMin: m, state: N.state, wakes: N.wakes, onset: N.onset, clock: this.nightClock() };
    if (m >= 480 && !N.done) { N.done = true; N.periods.push({ s: N.since, e: m, st: N.state }); this.onNightEnd?.(this.nightSummary()); }
  }
  nightClock() { const m = this.night ? this.night.simMin : 0; const t = (22 * 60 + 30 + m) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
  nightSummary() {
    const N = this.night; const P = N.periods.map(p => ({ s: +(p.s / 60).toFixed(2), e: +(p.e / 60).toFixed(2), st: p.st }));
    const asleep = P.filter(p => p.st !== 'awake').reduce((s, p) => s + p.e - p.s, 0);
    const restless = Math.min(100, Math.round(P.filter(p => p.st === 'restless').reduce((s, p) => s + p.e - p.s, 0) / Math.max(0.1, asleep) * 250));
    const tr = this.trend; const faceTrend = tr.length > 2 ? { start: tr[0].face, end: tr.at(-1).face, min: Math.min(...tr.map(x => x.face)) } : null;
    return { h: +asleep.toFixed(1), latency: Math.round(N.onset ?? 0), wakes: N.wakes, restless, periods: P, faceTrend };
  }

  // ---------- rendering ----------
  draw() {
    const { ctx, cv } = this; const g = this.grid; const lo = this.night ? 20 : 21, hi = 38; const d = this.img.data;
    // optical blur (real thermal optics/sensors produce soft gradients): two-pass 3×3 box blur for display only
    const bl = this.blurBuf || (this.blurBuf = [new Float32Array(g.length), new Float32Array(g.length)]); let src = g;
    for (let pass = 0; pass < 2; pass++) { const dst = bl[pass]; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH) { s += src[yy * GW + xx]; n++; } } dst[y * GW + x] = s / n; } src = dst; }
    for (let i = 0; i < g.length; i++) { const [r, gg, b] = ironbow((src[i] - lo) / (hi - lo)); d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
    this.off.getContext('2d').putImageData(this.img, 0, 0);
    const W = cv.width, H = cv.height; ctx.imageSmoothingEnabled = true; ctx.drawImage(this.off, 0, 0, W, H);
    // scale bar
    for (let y = 0; y < H - 40; y++) { const [r, gg, b] = ironbow(1 - y / (H - 40)); ctx.fillStyle = `rgb(${r},${gg},${b})`; ctx.fillRect(W - 18, 20 + y, 10, 1); }
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(W / 45)}px monospace`; ctx.textAlign = 'right'; ctx.fillText(hi + '°C', W - 22, 28); ctx.fillText(lo + '°C', W - 22, H - 20);
    const R = this.readings; ctx.textAlign = 'left';
    if (R.valid && R.canthus) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(8, 8, W * 0.42, 22); ctx.fillStyle = '#fff'; ctx.fillText(`MAX ${R.canthus.toFixed(1)}°C  ${this.night ? this.nightClock() + ' (×' + this.speed + ')' : ''}`, 14, 24); }
    if (R.valid && R.boxes) {
      const sx = W / GW, sy = H / GH; ctx.lineWidth = 1.5; ctx.font = `${Math.round(W / 60)}px monospace`;
      const LBL = { forehead: 'FH', canthusL: 'EyeL', canthusR: 'EyeR', nose: 'Nose', cheekL: 'ChL', cheekR: 'ChR', breath: 'Breath', face: 'Face' };
      for (const [k, b] of Object.entries(R.boxes)) { ctx.strokeStyle = k === 'breath' ? 'rgba(125,211,252,.9)' : 'rgba(255,255,255,.75)'; ctx.strokeRect(b[0] * sx, b[1] * sy, (b[2] - b[0]) * sx, (b[3] - b[1]) * sy); ctx.fillStyle = '#fff'; ctx.fillText(LBL[k] || k, b[0] * sx + 2, b[1] * sy - 3); }
    }
    ctx.fillStyle = this.hw ? '#f5b942' : '#94a3b8'; ctx.fillText(this.hw ? 'THERMAL HW (relative, uncalibrated)' : 'SIMULATED THERMAL — model data, not a measurement', 10, H - 10);
  }

  // ---------- optional real hardware (UVC thermal camera) ----------
  async connect(deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
    const v = document.createElement('video'); v.srcObject = stream; v.muted = true; await v.play();
    const c = document.createElement('canvas'); c.width = GW; c.height = GH; this.hw = { v, c, cx: c.getContext('2d', { willReadFrequently: true }), stream };
  }
  disconnect() { this.hw?.stream.getTracks().forEach(t => t.stop()); this.hw = null; }
  readHardware() { // map luminance (white-hot assumption) to a RELATIVE 20–38 scale — not calibrated temperature
    const { v, cx } = this.hw; cx.drawImage(v, 0, 0, GW, GH); const p = cx.getImageData(0, 0, GW, GH).data;
    for (let i = 0; i < GW * GH; i++) this.grid[i] = 20 + (p[i * 4] * 0.3 + p[i * 4 + 1] * 0.59 + p[i * 4 + 2] * 0.11) / 255 * 18;
  }
}
