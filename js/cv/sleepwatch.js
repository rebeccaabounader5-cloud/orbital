// ORBITAL — night sleep watch from the RGB eye's EYE STATE (MediaPipe face landmarks + eye-blink blendshapes).
// A thermal image cannot resolve eyelids, so eye state comes from the RGB camera (an IR-capable webcam works in the dark;
// an ordinary webcam needs some light). Rules:
//   • eyes visibly OPEN for ≥ 1.5 s                          → AWAKE (apparently)
//   • eyes closed < 1 s                                      → a normal blink — ignored
//   • eyes closed ≥ 1 s                                      → EYES CLOSED (resting)
//   • eyes closed continuously ≥ `sleepAfter` and little head movement → POSSIBLY ASLEEP (closed eyes ≠ certain sleep)
//   • face/eyes not visible (dark, turned away, poor image) → UNKNOWN — never counted as sleep or wake
// Over time it builds segments, counts awakenings (possibly asleep → awake) and restless moments (head movement while
// the eyes are closed). Only well-observed sessions are saved to the sleep history.
import { eyeState } from './vision.js';
export const LABEL = { awake: 'Awake (eyes open)', closed: 'Eyes closed (resting)', asleep: 'Possibly asleep', unknown: 'UNKNOWN — eyes not visible' };

export class SleepWatch {
  constructor({ sleepAfter = 120 } = {}) { this.sleepAfter = sleepAfter; this.reset(); }
  reset() { this.ears = []; this.state = 'unknown'; this.segs = []; this.seg = null; this.eye = null; this.eyeSince = 0; this.lastSeen = 0; this.awakenings = 0; this.restless = 0; this.motion = []; this.prevNose = null; this.t0 = null; this.reason = 'Starting…'; }
  /** f = faceFeatures(...) or null; lum = image brightness 0–255; now = ms. Returns the current state. */
  update(f, lum, now) {
    if (this.t0 == null) this.t0 = now;
    const visible = !!f && lum >= 35 && f.box.w > 0.08;
    let st = this.state;
    if (!visible) {
      if (now - this.lastSeen > 2000) { st = 'unknown'; this.reason = !f ? (lum < 35 ? 'Too dark for the RGB eye to see the eyes.' : 'Face not in view.') : lum < 35 ? 'Too dark to judge the eyelids.' : 'Face too far away to judge the eyelids.'; this.eye = null; }
    } else {
      this.lastSeen = now;
      const mv = this.prevNose ? Math.hypot(f.nose.x - this.prevNose.x, f.nose.y - this.prevNose.y) : 0; this.prevNose = { x: f.nose.x, y: f.nose.y };
      this.motion.push({ t: now, mv }); while (this.motion.length && now - this.motion[0].t > 30000) this.motion.shift();
      // personal open-eye reference: the upper range of the eye-opening values seen so far
      const ear = (f.earL + f.earR) / 2; this.ears.push(ear); if (this.ears.length > 600) this.ears.shift();
      const openEar = this.ears.length > 30 ? [...this.ears].sort((a, b) => a - b)[Math.floor(this.ears.length * 0.9)] : null;
      const e = eyeState(f, openEar && openEar > 0.24 ? openEar : null) || this.eye; // in-between: keep the last clear reading
      if (e !== this.eye) { this.eye = e; this.eyeSince = now; }
      const dur = (now - this.eyeSince) / 1000;
      const still = this.motion.length ? this.motion.reduce((s, m) => s + m.mv, 0) / this.motion.length < 0.004 : true;
      if (this.eye === 'open' && dur >= 1.5) { st = 'awake'; this.reason = 'Eyes visibly open.'; }
      else if (this.eye === 'closed' && dur >= this.sleepAfter && still) { st = 'asleep'; this.reason = `Eyes closed for ${Math.round(dur / 60 * 10) / 10} min with little movement — possibly asleep (closed eyes alone do not prove sleep).`; }
      else if (this.eye === 'closed' && dur >= 1) { st = 'closed'; this.reason = dur >= this.sleepAfter ? 'Eyes closed but moving — resting, not counted as sleep.' : `Eyes closed for ${Math.round(dur)} s — waiting before calling it sleep.`; }
      if (this.eye === 'closed' && mv > 0.02 && this.state !== 'awake') this.restless++;
    }
    if (st !== this.state) {
      if (this.state === 'asleep' && st === 'awake') this.awakenings++;
      this.state = st;
    }
    if (!this.seg || this.seg.st !== st) { if (this.seg) this.segs.push(this.seg); this.seg = { st, s: now, e: now }; } else this.seg.e = now;
    return st;
  }
  summary(now = performance.now()) {
    const all = [...this.segs, this.seg].filter(Boolean); const min = st => all.filter(x => x.st === st).reduce((s, x) => s + (x.e - x.s), 0) / 60000;
    const total = this.t0 == null ? 0 : (now - this.t0) / 60000; const unknown = min('unknown');
    return { totalMin: total, asleepMin: min('asleep'), closedMin: min('closed'), awakeMin: min('awake'), unknownMin: unknown, coverage: total ? 1 - unknown / total : 0, awakenings: this.awakenings, restless: this.restless, segments: all.map(x => ({ st: x.st, s: (x.s - this.t0) / 60000, e: (x.e - this.t0) / 60000 })) };
  }
}
