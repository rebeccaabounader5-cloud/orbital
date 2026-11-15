// ORBITAL — signal processing for EXPERIMENTAL camera-based physiological estimates.
// rPPG: POS algorithm (Wang et al., IEEE TBME 2017) on facial skin RGB means.
// Breathing: vertical shoulder motion from pose landmarks.
// These are research techniques; accuracy depends strongly on lighting, motion and skin tone, and
// results are NOT validated medical measurements.

export function resample(samples, fs = 30) { // samples: [{t(ms), v:[...]}] -> uniform arrays
  if (samples.length < 2) return null;
  const t0 = samples[0].t, t1 = samples[samples.length - 1].t; const n = Math.floor((t1 - t0) / 1000 * fs);
  const dims = samples[0].v.length; const out = Array.from({ length: dims }, () => new Float64Array(n));
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * 1000 / fs;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j], b = samples[j + 1]; const u = Math.max(0, Math.min(1, (t - a.t) / ((b.t - a.t) || 1)));
    for (let d = 0; d < dims; d++) out[d][i] = a.v[d] + (b.v[d] - a.v[d]) * u;
  }
  return { fs, n, ch: out, dur: (t1 - t0) / 1000 };
}

const mean = a => { let s = 0; for (const x of a) s += x; return s / a.length; };
const std = a => { const m = mean(a); let s = 0; for (const x of a) s += (x - m) ** 2; return Math.sqrt(s / a.length); };

function detrend(x, win) { // subtract moving average
  const n = x.length, y = new Float64Array(n); const h = Math.floor(win / 2);
  let s = 0, c = 0; const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h + 1); y[i] = x[i] - (pre[b] - pre[a]) / (b - a); }
  return y;
}

/** Power spectrum by direct DFT on a frequency grid (Hz). */
export function spectrum(x, fs, fLo, fHi, step = 0.01) {
  const n = x.length; const freqs = [], pow = [];
  // Hann window
  const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  for (let f = fLo; f <= fHi + 1e-9; f += step) {
    let re = 0, im = 0; const k = 2 * Math.PI * f / fs;
    for (let i = 0; i < n; i++) { const v = x[i] * w[i]; re += v * Math.cos(k * i); im -= v * Math.sin(k * i); }
    freqs.push(f); pow.push(re * re + im * im);
  }
  return { freqs, pow };
}

function peakAndSNR(sp, bw = 0.1) {
  let pi = 0; sp.pow.forEach((p, i) => { if (p > sp.pow[pi]) pi = i; });
  const f0 = sp.freqs[pi]; let sig = 0, tot = 0;
  sp.freqs.forEach((f, i) => { tot += sp.pow[i]; if (Math.abs(f - f0) <= bw || Math.abs(f - 2 * f0) <= bw) sig += sp.pow[i]; });
  const snrDb = 10 * Math.log10(sig / Math.max(1e-12, tot - sig));
  return { f0, snrDb };
}

/** rgbSamples: [{t, v:[r,g,b]}]; motion: array of head-motion magnitudes (normalised). */
export function estimateHeartRate(rgbSamples, { motion = 0, brightness = 128 } = {}) {
  const rs = resample(rgbSamples, 30); if (!rs || rs.dur < 10) return { ok: false, reason: 'Need at least 10 s of continuous face data.' };
  const { ch: [R, G, B], fs, n } = rs;
  // POS
  const L = Math.round(1.6 * fs); const H = new Float64Array(n);
  for (let s = 0; s + L <= n; s++) {
    const mr = mean(R.subarray(s, s + L)), mg = mean(G.subarray(s, s + L)), mb = mean(B.subarray(s, s + L));
    const x1 = new Float64Array(L), x2 = new Float64Array(L);
    for (let i = 0; i < L; i++) { const r = R[s + i] / mr, g = G[s + i] / mg, b = B[s + i] / mb; x1[i] = g - b; x2[i] = -2 * r + g + b; }
    const a = std(x1) / Math.max(1e-9, std(x2)); const m = new Float64Array(L); for (let i = 0; i < L; i++) m[i] = x1[i] + a * x2[i];
    const mm = mean(m); for (let i = 0; i < L; i++) H[s + i] += m[i] - mm;
  }
  const sig = detrend(H, Math.round(fs * 1.5));
  const sp = spectrum(sig, fs, 0.7, 3.0, 0.0083); // 42–180 bpm
  const { f0, snrDb } = peakAndSNR(sp, 0.1);
  const bpm = f0 * 60;
  // quality heuristic: SNR, motion and lighting
  let q = Math.max(0, Math.min(1, (snrDb + 6) / 10));
  if (motion > 0.02) q *= 0.5; if (brightness < 60) q *= 0.5; if (brightness > 235) q *= 0.6; if (rs.dur < 20) q *= 0.85;
  const ok = q >= 0.45;
  return { ok, bpm, snrDb, quality: q, dur: rs.dur, spectrum: sp, signal: Array.from(sig.slice(-Math.round(fs * 8))),
    reason: ok ? '' : (motion > 0.02 ? 'Too much head movement.' : brightness < 60 ? 'Lighting too dark.' : 'Pulse signal too weak/noisy for a reliable estimate.') };
}

/** ySamples: [{t, v:[y]}] normalised shoulder height. */
export function estimateBreathing(ySamples) {
  const rs = resample(ySamples, 15); if (!rs || rs.dur < 20) return { ok: false, reason: 'Need at least 20 s of upper-body data.' };
  const x = detrend(rs.ch[0], Math.round(15 * 12));
  const sp = spectrum(x, 15, 0.1, 0.7, 0.005); // 6–42 breaths/min
  const { f0, snrDb } = peakAndSNR(sp, 0.03);
  const amp = std(x);
  let q = Math.max(0, Math.min(1, (snrDb + 4) / 10)); if (amp < 0.0007) q *= 0.4;
  const ok = q >= 0.45;
  return { ok, rate: f0 * 60, snrDb, quality: q, dur: rs.dur, spectrum: sp, signal: Array.from(x), reason: ok ? '' : (amp < 0.0007 ? 'Breathing motion too small to detect — sit upright with shoulders visible.' : 'Signal too irregular (talking or moving?).') };
}

/** Average RGB of rectangles (normalised coords) from a frame drawn on a canvas. */
export function sampleRGB(ctx, w, h, rects) {
  let r = 0, g = 0, b = 0, n = 0, lum = 0;
  for (const q of rects) {
    const x = Math.max(0, Math.floor(q.x * w)), y = Math.max(0, Math.floor(q.y * h));
    const ww = Math.max(1, Math.min(w - x, Math.floor(q.w * w))), hh = Math.max(1, Math.min(h - y, Math.floor(q.h * h)));
    const d = ctx.getImageData(x, y, ww, hh).data;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  if (!n) return null; r /= n; g /= n; b /= n; lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { r, g, b, lum };
}

export function skinROIs(lm) {
  // forehead (above brows) and both cheeks, from face landmarks
  const fw = Math.abs(lm[454].x - lm[234].x);
  const fh = Math.abs(lm[152].y - lm[10].y);
  const fore = { x: lm[151].x - fw * 0.18, y: lm[151].y - fh * 0.06, w: fw * 0.36, h: fh * 0.1 };
  const cl = { x: lm[50].x - fw * 0.07, y: lm[50].y - fh * 0.05, w: fw * 0.14, h: fh * 0.1 };
  const cr = { x: lm[280].x - fw * 0.07, y: lm[280].y - fh * 0.05, w: fw * 0.14, h: fh * 0.1 };
  return [fore, cl, cr];
}
