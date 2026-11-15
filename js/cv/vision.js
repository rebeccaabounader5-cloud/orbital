// ORBITAL — on-device computer vision (MediaPipe Tasks Vision, bundled locally; no cloud calls).
// Models: face_landmarker (478 landmarks + 52 blendshapes), hand_landmarker, pose_landmarker_lite (Apache-2.0, Google).
let visionMod = null, fileset = null;
const models = {};
const BASE = new URL('../../', import.meta.url).href;

async function fs() {
  if (!visionMod) visionMod = await import(BASE + 'vendor/mediapipe/vision_bundle.mjs');
  if (!fileset) fileset = await visionMod.FilesetResolver.forVisionTasks(BASE + 'vendor/mediapipe/wasm');
  return { V: visionMod, fileset };
}

const pending = {};
const SPECS = {
  face: ['FaceLandmarker', { model: 'models/face_landmarker.task', extra: { numFaces: 1, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4, minTrackingConfidence: 0.4, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true } }],
  hands: ['HandLandmarker', { model: 'models/hand_landmarker.task', extra: { numHands: 1, minHandDetectionConfidence: 0.5 } }],
  pose: ['PoseLandmarker', { model: 'models/pose_landmarker_lite.task', extra: { numPoses: 1 } }],
};
/** Create a model once (concurrent callers share the same promise). GPU first; CPU if the GPU path is unavailable. */
async function create(kind, forceCPU = false) {
  if (models[kind] && !forceCPU) return models[kind];
  if (pending[kind] && !forceCPU) return pending[kind];
  const [factory, opts] = SPECS[kind];
  pending[kind] = (async () => {
    const { V, fileset } = await fs();
    const mk = delegate => V[factory].createFromOptions(fileset, { baseOptions: { modelAssetPath: BASE + opts.model, delegate }, runningMode: 'VIDEO', ...opts.extra });
    let m;
    if (forceCPU) { try { models[kind]?.close(); } catch (e) { /* already closed */ } m = await mk('CPU'); m.delegate = 'CPU'; }
    else { try { m = await mk('GPU'); m.delegate = 'GPU'; } catch (e) { console.warn(kind, 'GPU delegate failed, using CPU', e); m = await mk('CPU'); m.delegate = 'CPU'; } }
    models[kind] = m; return m;
  })();
  try { return await pending[kind]; } finally { pending[kind] = null; }
}

export const getFace = () => create('face');
export const getHands = () => create('hands');
export const getPose = () => create('pose');
/** Re-create a model on the CPU (used when the GPU path fails while running — e.g. some Windows graphics drivers). */
export const useCPU = kind => create(kind, true);

// ---------- camera ----------
export async function startCamera(video) {
  if (!window.isSecureContext) throw Object.assign(new Error('Camera requires a secure context. Open ORBITAL via http://localhost (see README) or HTTPS.'), { code: 'insecure' });
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser does not support camera access (getUserMedia).'), { code: 'unsupported' });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } }, audio: false });
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    await new Promise(r => video.readyState >= 2 ? r() : video.onloadeddata = r);
    return stream;
  } catch (e) {
    const map = {
      NotAllowedError: 'Camera permission was denied. Click the camera icon in the address bar → Allow, then press Start camera again.',
      NotFoundError: 'No camera was found on this computer.',
      NotReadableError: 'The camera is in use by another application. Close it and try again.',
      OverconstrainedError: 'The camera does not support the requested mode.',
    };
    throw Object.assign(new Error(map[e.name] || e.message), { code: e.name });
  }
}
export function stopCamera(stream) { stream?.getTracks().forEach(t => t.stop()); }

// ---------- face features ----------
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const EYE_R = [33, 160, 158, 133, 153, 144], EYE_L = [362, 385, 387, 263, 373, 380];
function ear(lm, idx) { const p = idx.map(i => lm[i]); return (d2(p[1], p[5]) + d2(p[2], p[4])) / (2 * d2(p[0], p[3])); }

export function faceFeatures(res) {
  if (!res?.faceLandmarks?.length) return null;
  const lm = res.faceLandmarks[0];
  const bs = {}; (res.faceBlendshapes?.[0]?.categories || []).forEach(c => { bs[c.categoryName] = c.score; });
  const earL = ear(lm, EYE_L), earR = ear(lm, EYE_R);
  const blink = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2;
  // iris position relative to eye corners (0 = outer corner, 1 = inner corner)
  let gazeX = null, gazeY = null;
  if (lm.length >= 478) {
    const rx = (lm[468].x - lm[33].x) / (lm[133].x - lm[33].x), lx = (lm[473].x - lm[362].x) / (lm[263].x - lm[362].x);
    gazeX = (rx + lx) / 2; // both increase as the iris moves toward image-right
    const ry = (lm[468].y - lm[159].y) / Math.max(1e-4, lm[145].y - lm[159].y), ly = (lm[473].y - lm[386].y) / Math.max(1e-4, lm[374].y - lm[386].y);
    gazeY = (ry + ly) / 2;
  }
  let yaw = 0, pitch = 0, roll = 0;
  const m = res.facialTransformationMatrixes?.[0]?.data;
  if (m) { yaw = Math.asin(-Math.max(-1, Math.min(1, m[2]))) * 57.3; pitch = Math.atan2(m[6], m[10]) * 57.3; roll = Math.atan2(m[1], m[0]) * 57.3; }
  const xs = lm.map(p => p.x), ys = lm.map(p => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { lm, bs, earL, earR, blink, gazeX, gazeY, yaw, pitch, roll, box, nose: lm[1] };
}

/**
 * Eye state from two independent cues: the eyeBlink blendshapes and the eye aspect ratio (eyelid landmarks).
 * openEar = this person's typical open-eye EAR when known. Returns 'closed' | 'open' | null (in between / unclear).
 */
export function eyeState(f, openEar = null) {
  const ear = (f.earL + f.earR) / 2;
  const relClosed = openEar ? ear < 0.6 * openEar : false;
  if (f.blink > 0.55 || ear < 0.2 || relClosed) return 'closed';
  if (f.blink < 0.35 && ear > Math.max(0.23, openEar ? 0.8 * openEar : 0)) return 'open';
  return null;
}

/** Tracks blinks / eye closure over time from blendshape eyeBlink score. */
export class BlinkTracker {
  constructor() { this.reset(); }
  reset() { this.closed = false; this.closeStart = 0; this.blinks = []; this.prolonged = []; this.frames = []; this.yawns = []; this.yawnStart = 0; }
  update(f, t) {
    const c = f.blink;
    this.frames.push({ t, c, closed80: c > 0.55 });
    while (this.frames.length && t - this.frames[0].t > 60000) this.frames.shift();
    if (!this.closed && c > 0.5) { this.closed = true; this.closeStart = t; }
    else if (this.closed && c < 0.35) {
      this.closed = false; const dur = t - this.closeStart;
      if (dur >= 40 && dur < 500) this.blinks.push(t); else if (dur >= 500) this.prolonged.push({ t, dur });
    }
    const jaw = f.bs.jawOpen ?? 0;
    if (jaw > 0.55 && !this.yawnStart) this.yawnStart = t;
    if (jaw < 0.35 && this.yawnStart) { if (t - this.yawnStart > 1500) this.yawns.push(t); this.yawnStart = 0; }
  }
  rate(t, win = 60000) { const n = this.blinks.filter(b => t - b < win).length; const span = Math.min(win, t - (this.frames[0]?.t ?? t)); return span > 5000 ? n / (span / 60000) : null; }
  perclos() { if (this.frames.length < 30) return null; return 100 * this.frames.filter(f => f.closed80).length / this.frames.length; }
}

// drawing helpers (overlay canvas is mirrored by CSS like the video)
export function drawFace(ctx, f, w, h) {
  ctx.fillStyle = 'rgba(34,211,238,.55)';
  for (let i = 0; i < f.lm.length; i += 3) { const p = f.lm[i]; ctx.fillRect(p.x * w - 1, p.y * h - 1, 2, 2); }
  ctx.strokeStyle = '#67e8f9'; ctx.lineWidth = 1.5;
  for (const idx of [EYE_L, EYE_R]) { ctx.beginPath(); idx.forEach((i, k) => { const p = f.lm[i]; k ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h); }); ctx.closePath(); ctx.stroke(); }
  if (f.lm.length >= 478) { ctx.fillStyle = '#f5b942'; for (const i of [468, 473]) { ctx.beginPath(); ctx.arc(f.lm[i].x * w, f.lm[i].y * h, 3, 0, 7); ctx.fill(); } }
  ctx.strokeStyle = 'rgba(34,211,238,.6)'; ctx.setLineDash([6, 4]);
  ctx.strokeRect(f.box.x * w - 8, f.box.y * h - 8, f.box.w * w + 16, f.box.h * h + 16); ctx.setLineDash([]);
}
const HAND_CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
export function drawHand(ctx, lm, w, h) {
  ctx.strokeStyle = '#34d399'; ctx.lineWidth = 2;
  HAND_CONN.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); });
  ctx.fillStyle = '#f5b942'; ctx.beginPath(); ctx.arc(lm[8].x * w, lm[8].y * h, 7, 0, 7); ctx.fill();
}
const POSE_CONN = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [0, 7], [0, 8]];
export function drawPose(ctx, lm, w, h) {
  ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 3;
  POSE_CONN.forEach(([a, b]) => { if ((lm[a].visibility ?? 1) < .4 || (lm[b].visibility ?? 1) < .4) return; ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); });
  ctx.fillStyle = '#22d3ee'; lm.forEach((p, i) => { if (i > 28 || (p.visibility ?? 1) < .4) return; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 4, 0, 7); ctx.fill(); });
}
