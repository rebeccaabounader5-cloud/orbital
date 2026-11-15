// ORBITAL — exercise form coach (MediaPipe Pose landmarks, on device).
// For each exercise it tracks the joints that matter, counts repetitions from real joint angles, measures range of
// motion, tempo and left/right symmetry, and checks exercise-specific form rules. It never judges a body part the
// camera cannot see: when required joints are not visible it says so instead of inventing a mistake.
// Landmarks (normalised image coordinates): 0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips,
// 25/26 knees, 27/28 ankles, 29/30 heels, 31/32 toes. Index 11/23/25/27 = the person's LEFT side.
const V = (p, i) => p[i] && (p[i].visibility ?? 1) > 0.5 && p[i].x > -0.02 && p[i].x < 1.02 && p[i].y > -0.02 && p[i].y < 1.02;
// Joint angles in 3-D (MediaPipe world landmarks, metres) so they don't depend on where the camera stands; z = 0
// when only image landmarks are available.
const ang = (a, b, c) => { const v1 = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)], v2 = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)]; const d = Math.hypot(...v1) * Math.hypot(...v2); return d ? Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / d))) * 57.3 : 180; };
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
const lean = (sh, hp) => { const dx = sh.x - hp.x, dy = sh.y - hp.y, dz = (sh.z || 0) - (hp.z || 0); const n = Math.hypot(dx, dy, dz) || 1; return Math.acos(Math.max(-1, Math.min(1, -dy / n))) * 57.3; }; // torso angle from vertical (y points down)
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const JOINT = { 11: 'left shoulder', 12: 'right shoulder', 13: 'left elbow', 14: 'right elbow', 15: 'left wrist', 16: 'right wrist', 23: 'left hip', 24: 'right hip', 25: 'left knee', 26: 'right knee', 27: 'left ankle', 28: 'right ankle' };

// ---------------------------------------------------------------- per-exercise definitions
// need: joints that must be visible · sig(p): the signal used to count reps · down/up thresholds (hysteresis)
// checks(p, frame): continuous checks → issue keys · repChecks(rep): checks on a finished repetition
export const EX = {
  squat: { name: 'Squat', need: [23, 24, 25, 26, 27, 28], rom: 'knee bend',
    sig: q => (ang(q[23], q[25], q[27]) + ang(q[24], q[26], q[28])) / 2, down: 140, up: 160, lowIsDown: true,
    frame: (p, q) => { const kl = ang(q[23], q[25], q[27]), kr = ang(q[24], q[26], q[28]); const hip = mid(q[23], q[24]), sh = V(p, 11) && V(p, 12) ? mid(q[11], q[12]) : null, hip2 = mid(p[23], p[24]);
      const kneeW = Math.abs(p[25].x - p[26].x), ankW = Math.abs(p[27].x - p[28].x);
      return { kl, kr, asym: Math.abs(kl - kr), lean: sh ? lean(sh, hip) : null, valgus: ankW > 0.04 ? kneeW / ankW : null, hipX: hip2.x }; },
    repChecks: r => [r.minSig > 115 && ['depth', 'Go a little lower, if it feels comfortable.'], r.maxLean > 45 && ['back', 'Keep your chest up and your back straighter.'], r.minValgus != null && r.minValgus < 0.8 && ['knees', 'Push your knees out, in line with your feet.'], r.maxAsym > 18 && ['asym', 'Your movement is uneven — keep both sides balanced.'], r.downSec < 0.7 && ['fast', 'Lower yourself more slowly.'], r.sway > 0.06 && ['balance', 'Steady yourself — use the handrail if you need to.']] },
  lunge: { name: 'Lunge', need: [23, 24, 25, 26, 27, 28], rom: 'front-knee bend',
    sig: q => Math.min(ang(q[23], q[25], q[27]), ang(q[24], q[26], q[28])), down: 125, up: 155, lowIsDown: true,
    frame: (p, q) => { const hip = mid(q[23], q[24]), sh = V(p, 11) && V(p, 12) ? mid(q[11], q[12]) : null; return { lean: sh ? lean(sh, hip) : null, hipX: mid(p[23], p[24]).x }; },
    repChecks: r => [r.minSig > 115 && ['depth', 'Bend your front knee a little more — towards a right angle.'], r.maxLean > 30 && ['back', 'Keep your upper body upright.'], r.downSec < 0.7 && ['fast', 'Slow down on the way down.'], r.sway > 0.07 && ['balance', 'Steady your balance before the next one.']] },
  deadlift: { name: 'Deadlift', need: [11, 12, 23, 24, 25, 26], rom: 'hip hinge',
    sig: q => (ang(q[11], q[23], q[25]) + ang(q[12], q[24], q[26])) / 2, down: 130, up: 160, lowIsDown: true,
    frame: (p, q) => { const kl = ang(q[23], q[25], q[27] || q[25]), kr = ang(q[24], q[26], q[28] || q[26]); return { knee: (kl + kr) / 2, asym: Math.abs(kl - kr), hipX: mid(p[23], p[24]).x }; },
    repChecks: r => [r.minSig > 140 && ['depth', 'Hinge a bit further at the hips.'], r.minKnee != null && r.minKnee < 120 && ['squatting', 'This is turning into a squat — keep your knees softer and push your hips back.'], r.downSec < 0.8 && ['fast', 'Lower slowly and keep control.'], r.maxAsym > 18 && ['asym', 'Keep both sides even.']] },
  heel: { name: 'Heel raise', need: [23, 24, 25, 26, 27, 28], rom: 'rise',
    sig: q => -(q[23].y + q[24].y) / 2, down: null, up: null, rise: true,
    frame: (p, q) => { const kl = ang(q[23], q[25], q[27]), kr = ang(q[24], q[26], q[28]); return { knee: Math.min(kl, kr), hipX: mid(p[23], p[24]).x }; },
    repChecks: r => [r.minKnee != null && r.minKnee < 160 && ['knees', 'Keep your knees straight — the lift comes from your ankles.'], r.upSec + r.downSec < 0.9 && ['fast', 'Rise and lower more slowly.'], r.sway > 0.05 && ['balance', 'Hold the handrail to keep your balance.']] },
  shoulders: { name: 'Shoulder circles', need: [11, 12], rom: 'shoulder travel',
    sig: q => -(q[11].y + q[12].y) / 2, rise: true,
    frame: (p, q) => ({ dl: p[11].y, dr: p[12].y }),
    repChecks: r => [r.amp < 0.012 && ['small', 'Make the circles a little bigger.'], r.ampAsym > 0.5 && ['asym', 'Move both shoulders equally.']] },
  row: { name: 'Band row', need: [11, 12, 13, 14, 15, 16], rom: 'elbow bend',
    sig: q => (ang(q[11], q[13], q[15]) + ang(q[12], q[14], q[16])) / 2, down: 110, up: 150, lowIsDown: true,
    frame: (p, q) => { const el = ang(q[11], q[13], q[15]), er = ang(q[12], q[14], q[16]); return { asym: Math.abs(el - er), shrug: (p[11].y + p[12].y) / 2 }; },
    repChecks: r => [r.minSig > 105 && ['depth', 'Pull your elbows further back.'], r.maxAsym > 20 && ['asym', 'Pull evenly with both arms.'], r.downSec < 0.5 && ['fast', 'Pull smoothly — don\'t jerk the band.']] },
  plank: { name: 'Plank', need: [11, 23, 27], hold: true, rom: 'body line',
    frame: (p, q) => { const side = V(p, 11) && V(p, 23) && V(p, 27) ? [11, 23, 27] : [12, 24, 28]; const a = ang(q[side[0]], q[side[1]], q[side[2]]); const sag = p[side[1]].y > (p[side[0]].y + p[side[2]].y) / 2; return { line: a, sag }; },
    holdCheck: f => f.line < 160 ? [f.sag ? 'sag' : 'pike', f.sag ? 'Lift your hips a little — keep a straight line.' : 'Lower your hips — keep your body in one straight line.'] : null },
  balance: { name: 'Balance', need: [23, 24, 27, 28], hold: true, rom: 'sway',
    frame: (p, q) => ({ hipX: mid(p[23], p[24]).x }),
    holdCheck: (f, st) => st.sway > 0.05 ? ['balance', 'You\'re swaying — fix your eyes on one point and tighten your core.'] : null },
};
export const EX_KEYS = Object.keys(EX);

// ---------------------------------------------------------------- automatic recognition (movement pattern over ~4 s)
export function recognise(hist) {
  const h = hist.filter(x => x.p).map(x => ({ ...x, img: x.p, p: x.q || x.p })); if (h.length < 20) return { key: null, conf: 0 };
  const rng = f => { const v = h.map(x => f(x.p)).filter(x => x != null && isFinite(x)); return v.length > 10 ? Math.max(...v) - Math.min(...v) : 0; };
  const P = h.at(-1).img;
  const legsSeen = [23, 24, 25, 26, 27, 28].every(i => V(P, i)), armsSeen = [11, 12, 13, 14, 15, 16].every(i => V(P, i));
  const kl = legsSeen ? rng(p => ang(p[23], p[25], p[27])) : 0, kr = legsSeen ? rng(p => ang(p[24], p[26], p[28])) : 0;
  const hipY = legsSeen ? h.length > 10 ? (v => Math.max(...v) - Math.min(...v))(h.map(x => (x.img[23].y + x.img[24].y) / 2)) : 0 : 0;
  const hipAng = V(P, 11) && V(P, 23) && V(P, 25) ? rng(p => ang(p[11], p[23], p[25])) : 0;
  const elbow = armsSeen ? rng(p => (ang(p[11], p[13], p[15]) + ang(p[12], p[14], p[16])) / 2) : 0;
  const shY = V(P, 11) && V(P, 12) ? (v => Math.max(...v) - Math.min(...v))(h.map(x => (x.img[11].y + x.img[12].y) / 2)) : 0;
  const c = [];
  if (kl > 35 && kr > 35 && Math.abs(kl - kr) < 25 && hipY > 0.05) c.push(['squat', Math.min(1, (kl + kr) / 120)]);
  if (Math.max(kl, kr) > 35 && Math.abs(kl - kr) >= 25) c.push(['lunge', Math.min(1, Math.abs(kl - kr) / 50)]);
  if (hipAng > 35 && kl < 30 && kr < 30) c.push(['deadlift', Math.min(1, hipAng / 70)]);
  if (legsSeen && kl < 12 && kr < 12 && hipY > 0.012 && hipY < 0.07) c.push(['heel', 0.6]);
  if (elbow > 35 && hipY < 0.03) c.push(['row', Math.min(1, elbow / 70)]);
  if (shY > 0.015 && elbow < 25 && hipY < 0.02) c.push(['shoulders', 0.55]);
  c.sort((a, b) => b[1] - a[1]);
  return c.length ? { key: c[0][0], conf: c[0][1] } : { key: null, conf: 0 };
}

// ---------------------------------------------------------------- the coach
export class FormCoach {
  /** exercise: one of EX_KEYS or 'auto'. previous: { repSec, rom, form } from earlier sessions of this exercise (optional). */
  constructor({ exercise = 'auto', previous = {} } = {}) {
    this.want = exercise; this.previous = previous; this.hist = []; this.key = exercise === 'auto' ? null : exercise;
    this.reps = []; this.phase = 'up'; this.cur = null; this.issues = {}; this.cueLog = []; this.lastCue = 0; this.started = null; this.holdIssue = null; this.lastSeenAll = 0; this.visibleFrames = 0; this.frames = 0;
  }
  /** Feed one pose (array of 33 landmarks or null). Returns the live status for the UI. */
  update(p, now, world = null) {
    if (this.started == null) this.started = now; this.frames++;
    const q = p ? (world && world.length === p.length ? world : p.map(o => ({ x: o.x, y: o.y, z: 0, visibility: o.visibility }))) : null;
    this.hist.push({ t: now, p, q }); while (this.hist.length && now - this.hist[0].t > 4000) this.hist.shift();
    if (this.want === 'auto' && (!this.key || this.reps.length === 0)) { const r = recognise(this.hist); if (r.key && r.conf >= 0.5) { if (r.key !== this.key) { this.key = r.key; this.phase = 'up'; this.cur = null; this.lastUpT = null; } this.conf = r.conf; } }
    const ex = this.key && EX[this.key];
    const out = { exercise: this.key, name: ex?.name || 'Detecting…', conf: this.conf, reps: this.reps.length, phase: this.phase, issues: [], cue: null, visible: true, missing: [] };
    if (!p) { out.visible = false; out.missing = ['whole body']; out.note = 'No person detected — step into the camera view.'; return out; }
    if (!ex) { out.note = 'Start moving — I\'ll recognise the exercise.'; return out; }
    const missing = ex.need.filter(i => !V(p, i));
    if (missing.length) { out.visible = false; out.missing = [...new Set(missing.map(i => JOINT[i].replace(/^(left|right) /, '')))]; out.note = `I can't see your ${out.missing.join(' and ')} — I won't judge your form until I can. Step back so your whole body is in view.`; return out; }
    this.visibleFrames++;
    const f = ex.frame(p, q);
    // sway of the hips over the last few seconds (balance)
    const hx = this.hist.map(x => x.p && V(x.p, 23) && V(x.p, 24) ? (x.p[23].x + x.p[24].x) / 2 : null).filter(x => x != null);
    const sway = hx.length > 5 ? Math.max(...hx) - Math.min(...hx) : 0;
    if (ex.hold) {
      const iss = ex.holdCheck(f, { sway });
      if (iss) { this.holdIssue = this.holdIssue && this.holdIssue.k === iss[0] ? this.holdIssue : { k: iss[0], since: now }; if (now - this.holdIssue.since > 1500) { out.issues.push(iss[1]); this.count(iss[0]); out.cue = this.cue(iss[0], iss[1], now); } }
      else this.holdIssue = null;
      out.holdSec = (now - this.started) / 1000; return out;
    }
    // repetition tracking
    const sig = ex.sig(ex.rise ? p : q);
    if (!this.cur) this.cur = { t0: now, tBottom: null, minSig: sig, maxSig: sig, maxLean: 0, maxAsym: 0, minValgus: null, minKnee: null, ds: [], amps: [], base: sig };
    const c = this.cur;
    if (this.phase === 'down' && ex.lowIsDown) { if (sig < c.minSig - 0.5) { c.bStart = now; c.bEnd = now; } else if (sig <= c.minSig + 3) c.bEnd = now; }
    c.minSig = Math.min(c.minSig, sig); c.maxSig = Math.max(c.maxSig, sig);
    if (f.lean != null) c.maxLean = Math.max(c.maxLean, f.lean);
    if (f.asym != null) c.maxAsym = Math.max(c.maxAsym, f.asym);
    if (f.valgus != null && this.phase === 'down') c.minValgus = c.minValgus == null ? f.valgus : Math.min(c.minValgus, f.valgus);
    if (f.knee != null) c.minKnee = c.minKnee == null ? f.knee : Math.min(c.minKnee, f.knee);
    if (f.dl != null) c.amps.push([f.dl, f.dr]);
    let done = false;
    if (ex.rise) { // small vertical movements: adaptive thresholds around the recent range
      const vals = this.hist.filter(x => x.p).map(x => ex.sig(x.p)); const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo;
      if (span > (this.key === 'shoulders' ? 0.008 : 0.01)) { if (this.phase === 'up' && sig > lo + span * 0.7) { this.phase = 'down'; c.tBottom = now; } else if (this.phase === 'down' && sig < lo + span * 0.3) { this.phase = 'up'; done = true; } }
    } else if (ex.lowIsDown) {
      if (this.phase === 'up' && sig < ex.down) { this.phase = 'down'; c.partial = this.lastUpT == null; c.tDown = this.lastUpT ?? now; c.bStart = now; c.bEnd = now; c.minSig = sig; }
      if (this.phase === 'down' && sig > ex.up) { this.phase = 'up'; done = true; c.tBottom = c.bStart; }
      if (this.phase === 'up' && sig >= ex.up) this.lastUpT = now; // last moment fully up = start of the next descent
    }
    if (done && this.cur?.partial) { this.cur = null; done = false; } // started before tracking began: not judged
    if (done) {
      const t0 = c.tDown || c.t0;
      const rep = { t: now, sec: (now - t0) / 1000, downSec: ((c.bStart || now) - t0) / 1000, upSec: (now - (c.bEnd || c.bStart || t0)) / 1000, minSig: c.minSig, maxSig: c.maxSig, rom: ex.lowIsDown ? 180 - c.minSig : (c.maxSig - c.minSig) * 100, maxLean: c.maxLean, maxAsym: c.maxAsym, minValgus: c.minValgus, minKnee: c.minKnee, sway,
        pause: c.bStart && c.bEnd ? (c.bEnd - c.bStart) / 1000 : 0 };
      if (c.amps.length > 5) { const l = c.amps.map(a => a[0]), r = c.amps.map(a => a[1]); const al = Math.max(...l) - Math.min(...l), ar = Math.max(...r) - Math.min(...r); rep.amp = Math.max(al, ar); rep.ampAsym = Math.abs(al - ar) / Math.max(al, ar, 1e-4); }
      const found = (ex.repChecks?.(rep) || []).filter(Boolean);
      rep.issues = found.map(x => x[0]); this.reps.push(rep);
      for (const [k] of found) this.count(k);
      // tempo against this session's first repetitions and against earlier sessions → possible fatigue / discomfort
      const first = this.reps.slice(0, 3).map(r => r.sec);
      if (this.reps.length >= 5 && avg(first) && rep.sec > avg(first) * 1.5) { rep.issues.push('slowing'); this.count('slowing'); }
      if (found.length) out.cue = this.cue(found[0][0], found[0][1], now);
      else if (rep.issues.includes('slowing')) out.cue = this.cue('slowing', 'You\'re slowing down — are you getting tired? Take a short break if you need one.', now);
      out.lastRep = rep;
      this.cur = null;
    }
    out.reps = this.reps.length; out.phase = this.phase; out.angles = f; out.signal = sig;
    out.issues = this.reps.length ? (this.reps.at(-1).issues || []).map(k => ISSUE[k] || k) : [];
    return out;
  }
  count(k) { this.issues[k] = (this.issues[k] || 0) + 1; }
  /** Spoken corrections: at most one every 5 s, never the same one within 15 s. */
  cue(k, text, now) {
    if (now - this.lastCue < 5000) return null;
    if (this.cueLog.some(c => c.k === k && now - c.t < 15000)) return null;
    this.lastCue = now; this.cueLog.push({ k, t: now, text }); return text;
  }
  /** Session summary for storage and trends. */
  summary(now = performance.now()) {
    const ex = this.key && EX[this.key]; const r = this.reps; const clean = r.filter(x => !(x.issues || []).filter(k => k !== 'slowing').length).length;
    const s = { exercise: this.key, name: ex?.name || null, reps: r.length, repSec: avg(r.map(x => x.sec)), rom: avg(r.map(x => x.rom)), form: r.length ? Math.round(100 * clean / r.length) : null, issues: { ...this.issues }, durationSec: this.started == null ? 0 : (now - this.started) / 1000, visibleShare: this.frames ? this.visibleFrames / this.frames : 0, hold: !!ex?.hold };
    if (ex?.hold && this.frames) s.form = Math.round(100 * (1 - Math.min(1, (this.issues.sag || 0) / Math.max(1, this.visibleFrames) * 20 + (this.issues.pike || 0) / Math.max(1, this.visibleFrames) * 20 + (this.issues.balance || 0) / Math.max(1, this.visibleFrames) * 20)));
    const P = this.previous; const notes = [];
    if (P.repSec && s.repSec && s.repSec > P.repSec * 1.25) notes.push({ k: 'slower', text: `Repetitions were ${Math.round((s.repSec / P.repSec - 1) * 100)}% slower than your previous sessions (${s.repSec.toFixed(1)} s vs ${P.repSec.toFixed(1)} s).` });
    if (P.rom && s.rom && s.rom < P.rom - 15) notes.push({ k: 'rom', text: `Range of motion was smaller than usual (${Math.round(s.rom)}° vs ${Math.round(P.rom)}°).` });
    if ((this.issues.asym || 0) >= Math.max(2, r.length / 3)) notes.push({ k: 'asym', text: 'Movement was uneven between left and right on several repetitions.' });
    if ((this.issues.slowing || 0) >= 2) notes.push({ k: 'fatigue', text: 'Repetitions got noticeably slower during the set — possible fatigue.' });
    const pauses = r.filter(x => x.pause > 1.5).length; if (pauses >= 2) { s.issues.hesitation = pauses; notes.push({ k: 'hesitation', text: `Paused at the bottom on ${pauses} repetitions — possible hesitation or discomfort.` }); }
    s.notes = notes; return s;
  }
}
export const ISSUE = { depth: 'Not deep enough', back: 'Back / torso leaning', knees: 'Knee alignment', asym: 'Uneven left vs right', fast: 'Too fast', balance: 'Losing balance', slowing: 'Slowing down', squatting: 'Bending the knees too much', small: 'Small movement', sag: 'Hips sagging', pike: 'Hips too high', hesitation: 'Hesitation' };
