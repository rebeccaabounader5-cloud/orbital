// ORBI — camera evidence about the astronaut's responsiveness, for the moments when they stop answering.
// Silence alone is never treated as unconsciousness. This module looks at what the RGB eye can actually see:
//   • face visible + eyes open (or blinking) + some movement  → "responsive"  (awake but not answering — no alarm)
//   • body horizontal / sudden drop and no movement           → "collapse"
//   • face visible, eyes closed the whole time, no movement   → "unconscious" (possible)
//   • camera off / too dark / astronaut not in view           → "uncertain"   (reported as such, never guessed)
// Sources: the AI Camera page reports live observations here while it runs; otherwise the Virtual Body opens the
// webcam for a short 6-second check (with the camera permission already granted). A SIMULATION override exists only
// for safe testing and is labelled as such everywhere.
import { startCamera, stopCamera, getFace, getPose, faceFeatures, eyeState } from '../cv/vision.js';

let live = null;      // latest observation from the AI Camera page
let simulated = null; // safe-test override
/** Called by the AI Camera page with each analysed frame summary. */
export function report(o) { live = { ...o, ts: Date.now() }; }
/** Safe software simulation for tests: 'collapse' | 'unconscious' | 'responsive' | 'uncertain' | null. */
export function simulateEvidence(kind) { simulated = kind; }
export const simulation = () => simulated;

const torsoTilt = p => { // degrees from vertical of the shoulder-mid → hip-mid line
  const sx = (p[11].x + p[12].x) / 2, sy = (p[11].y + p[12].y) / 2, hx = (p[23].x + p[24].x) / 2, hy = (p[23].y + p[24].y) / 2;
  return Math.abs(Math.atan2(hx - sx, hy - sy) * 57.3);
};

/** Look for up to `ms` and classify. Returns { status, detail, source, metrics }. */
export async function assessResponsiveness({ ms = 6000 } = {}) {
  if (simulated) {
    const D = { collapse: 'SIMULATION: camera sees the body horizontal with no movement after a sudden drop.', unconscious: 'SIMULATION: face visible, eyes closed throughout, no movement.', responsive: 'SIMULATION: face visible, eyes open, moving.', uncertain: 'SIMULATION: the astronaut is not in the camera view.' };
    return { status: simulated, detail: D[simulated], source: 'simulated', simulated: true };
  }
  // 1) live observations from the AI Camera page (last 10 s)
  if (live && Date.now() - live.ts < 10000) return classify(live.window || [live], 'AI Camera (live)');
  // 2) short webcam check
  if (!navigator.mediaDevices?.getUserMedia) return { status: 'uncertain', detail: 'No camera available in this browser — cannot see the astronaut.', source: 'none' };
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(v);
  let stream = null; const frames = [];
  try {
    stream = await startCamera(v);
    const [fm, pm] = await Promise.all([getFace(), getPose().catch(() => null)]);
    const t0 = performance.now(); let lastT = -1;
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const g = c.getContext('2d', { willReadFrequently: true });
    while (performance.now() - t0 < ms) {
      await new Promise(r => setTimeout(r, 120));
      if (v.currentTime === lastT) continue; lastT = v.currentTime; const now = performance.now();
      let f = null, p = null;
      try { f = faceFeatures(fm.detectForVideo(v, now)); } catch (e) { /* skip */ }
      try { p = pm ? pm.detectForVideo(v, now).landmarks?.[0] || null : null; } catch (e) { /* skip */ }
      g.drawImage(v, 0, 0, 64, 48); const d = g.getImageData(0, 0, 64, 48).data; let lum = 0; for (let i = 0; i < d.length; i += 4) lum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; lum /= d.length / 4;
      frames.push({ t: now, face: !!f, eyesClosed: f ? eyeState(f) === 'closed' : null, nose: f ? { x: f.nose.x, y: f.nose.y } : null, tilt: p && (p[11].visibility ?? 1) > 0.5 && (p[23].visibility ?? 1) > 0.5 ? torsoTilt(p) : null, lum });
    }
  } catch (e) { return { status: 'uncertain', detail: `The camera could not be used (${e.message}) — cannot see the astronaut.`, source: 'none' }; }
  finally { stopCamera(stream); v.remove(); }
  return classify(frames, 'RGB eye (6-s check)');
}

export function classify(frames, source) {
  const n = frames.length;
  if (!n) return { status: 'uncertain', detail: 'No camera frames received — cannot see the astronaut.', source };
  const lum = frames.reduce((s, f) => s + (f.lum ?? 128), 0) / n;
  const faceFr = frames.filter(f => f.face).length / n;
  const tilts = frames.map(f => f.tilt).filter(x => x != null);
  const closed = frames.filter(f => f.face && f.eyesClosed === true).length / Math.max(1, frames.filter(f => f.face).length);
  const noses = frames.map(f => f.nose).filter(Boolean);
  let motion = 0; for (let i = 1; i < noses.length; i++) motion += Math.hypot(noses[i].x - noses[i - 1].x, noses[i].y - noses[i - 1].y);
  motion = noses.length > 1 ? motion / (noses.length - 1) : null;
  const m = { frames: n, faceVisible: +faceFr.toFixed(2), eyesClosedShare: +closed.toFixed(2), motion: motion == null ? null : +motion.toFixed(4), torsoTiltDeg: tilts.length ? Math.round(tilts.reduce((a, b) => a + b, 0) / tilts.length) : null, brightness: Math.round(lum) };
  if (lum < 30 && faceFr < 0.3) return { status: 'uncertain', detail: 'Too dark for the RGB eye to see the astronaut.', source, metrics: m };
  if (m.torsoTiltDeg != null && m.torsoTiltDeg > 60 && (motion == null || motion < 0.004)) return { status: 'collapse', detail: `Body appears horizontal (torso ${m.torsoTiltDeg}° from upright) with no movement.`, source, metrics: m };
  if (faceFr >= 0.5 && closed >= 0.8 && (motion == null || motion < 0.003)) return { status: 'unconscious', detail: 'Face visible, eyes closed the whole time and no movement — possibly unconscious.', source, metrics: m };
  if (faceFr >= 0.5 && closed < 0.5) return { status: 'responsive', detail: 'Face visible with eyes open — the astronaut appears awake.', source, metrics: m };
  return { status: 'uncertain', detail: faceFr < 0.3 ? 'The astronaut is not in the camera view.' : 'The camera view is not clear enough to tell.', source, metrics: m };
}
