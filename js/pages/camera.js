// ORBITAL — AI Camera: ORBI, the floating companion camera with two eyes.
//  Eye 1 RGB  — REAL webcam analysis on this device (MediaPipe): face & landmarks, blinks/eye closure, facial fatigue,
//               pose & movement briskness, facial puffiness vs a reference image, rolling rPPG heart-rate estimate.
//               Without a webcam a clearly labelled demonstration (synthetic face, simulated values) is used.
//  Eye 2 THERMAL — independent; SIMULATED radiometric data unless a thermal camera is connected (see thermal.js).
import { state, addRecords, on } from '../store.js';
import { METRICS, srcBadge } from '../metrics.js';
import { $, esc, toast, qualityBars } from '../ui.js';
import { DB } from '../db.js';
import { startCamera, stopCamera, getFace, getPose, useCPU, faceFeatures, eyeState, BlinkTracker, drawFace, drawPose } from '../cv/vision.js';
import { estimateHeartRate, sampleRGB, skinROIs } from '../cv/signal.js';
import { ThermalEye, MODES } from '../orbi/thermal.js';
import { OrbiScene } from '../orbi/scene.js';
import { compareAll, comparisonTable } from '../companion/compare.js';
import { assess } from '../companion/wellbeing.js';
import { startProtocol, onProtocol, run as protoRun, endProtocol } from '../orbi/protocol.js';
import { setVoiceOverride, ensureVoice } from '../companion/overlay.js';
import { speak } from '../voice.js';
import { SleepWatch, LABEL as SW_LABEL } from '../cv/sleepwatch.js';
import { report as reportObs } from '../orbi/observer.js';
import { addRecord } from '../store.js';

const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const stdv = a => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const CAPS = [['face', 'Face detection'], ['landmarks', 'Facial landmarks'], ['eyes', 'Eyes & blink analysis'], ['fatigue', 'Facial / eye fatigue'], ['pose', 'Posture & movement'], ['hr', 'Heart rate (rPPG estimate)'], ['puffy', 'Facial puffiness vs reference']];
const STATUS = { active: ['ok', 'Active'], analyzing: ['info', 'Analyzing'], insufficient: ['caution', 'Insufficient image quality'], unavailable: ['na', 'Unavailable'], simulated: ['info', 'Simulated (demo)'] };

const ORBI_SVG = `<svg viewBox="0 0 220 200" class="orbi-svg" aria-label="ORBI floating camera with RGB and thermal eyes">
  <defs><radialGradient id="ob" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#dbe5f3"/><stop offset="1" stop-color="#8fa4c4"/></radialGradient></defs>
  <ellipse cx="110" cy="186" rx="52" ry="7" fill="rgba(34,211,238,.15)" class="orbi-shadow"/>
  <g class="orbi-float"><circle cx="110" cy="92" r="70" fill="url(#ob)"/><ellipse cx="110" cy="92" rx="70" ry="22" fill="none" stroke="#3b82f6" stroke-width="4"/>
  <rect x="28" y="88" width="14" height="8" rx="3" fill="#3b82f6" opacity=".6"/><rect x="178" y="88" width="14" height="8" rx="3" fill="#3b82f6" opacity=".6"/>
  <circle cx="85" cy="80" r="20" fill="#0b1220"/><circle cx="85" cy="80" r="10" fill="#22d3ee" class="eye-rgb"/><circle cx="81" cy="76" r="3" fill="#e0fbff"/>
  <circle cx="135" cy="80" r="20" fill="#0b1220"/><circle cx="135" cy="80" r="10" fill="#f97316" class="eye-th"/><circle cx="131" cy="76" r="3" fill="#ffe4cc"/></g>
  <text x="85" y="128" text-anchor="middle" font-size="10" fill="#0e7490" font-weight="700">RGB</text><text x="135" y="128" text-anchor="middle" font-size="10" fill="#c2410c" font-weight="700">THERMAL</text></svg>`;

export async function render(view) {
  view.innerHTML = `
  <p class="page-intro"><b>ORBI</b> is ORBITAL's floating AI companion camera — a small spherical free-flyer (inspired by JAXA's Int-Ball2 on the ISS) that follows you through the spacecraft with <b>two eyes</b>: an <b>RGB camera</b> and a <b>thermal camera</b>. All video is processed on this device; nothing is stored or transmitted. Every value is labelled ${srcBadge('observed')} ${srcBadge('estimated')} ${srcBadge('simulated')}.</p>
  <div class="grid g3">
    <div class="card span2"><div class="card-h"><h2>ORBI following the astronaut</h2><span class="pill lv-info">Simulation</span></div>
      <div class="orbi-scene"><canvas id="scene"></canvas></div>
      <div class="small" id="sceneStatus" style="margin-top:6px"></div></div>
    <div class="card orbi-card">${ORBI_SVG}
      <ul class="small eyes-list"><li><span class="dot" style="background:#22d3ee"></span><b>Eye 1 — RGB:</b> heart-rate (rPPG) estimate, face &amp; eye fatigue, blinking, posture &amp; movement, facial puffiness, exercise monitoring.</li>
      <li><span class="dot" style="background:#f97316"></span><b>Eye 2 — Thermal:</b> breathing rate, skin temperature, stress-related facial temperature, sleep monitoring in darkness.</li></ul>
      <p class="small dim">This computer's webcam plays the role of the RGB eye. A webcam cannot see infrared, so the thermal eye is simulated unless thermal hardware is connected below.</p></div>
  </div>

  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-h"><h2><span class="dot" style="background:#22d3ee"></span>Eye 1 — RGB camera</h2><span id="rgbMode">${srcBadge('observed')}</span></div>
      <div class="cam-wrap" id="camWrap"><video id="video" playsinline muted></video><canvas id="overlay" class="overlay"></canvas><div class="cam-hud" id="hud"></div>
        <div class="cam-placeholder" id="camPh"><div><div style="font-size:2.2rem">◉</div><p><b>RGB eye off</b></p><p class="small">Start the webcam (permission required) or run the labelled demonstration.</p></div></div>
        <div class="dark-note hidden" id="darkNote">Too dark for the RGB eye → thermal eye has taken over</div></div>
      <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="camStart">▶ Start webcam</button><button class="btn" id="demoStart">▶ Demo footage (simulated)</button><button class="btn" id="camStop" disabled>■ Stop</button><span id="modelStatus" class="small muted"></span></div>
      <div id="camErr" class="callout warn hidden" style="margin-top:8px"></div>
      <div class="grid g2" style="margin-top:10px;gap:10px">
        <div><div class="section-title" style="margin:0 0 6px">Capabilities</div><table class="table caps" id="caps"></table></div>
        <div><div class="section-title" style="margin:0 0 6px">Live analysis</div><div class="live-grid" id="rgbLive"></div>
          <canvas id="hrWave" height="50" style="width:100%;height:50px;margin-top:6px;background:#050d1d;border-radius:8px"></canvas>
          <div class="small dim">rPPG = remote photoplethysmography: tiny periodic colour changes of facial skin with each heartbeat, separated from lighting and motion (POS method). Overall skin redness or paleness is <b>not</b> used to measure heart rate.</div></div>
      </div>
      <div id="autoLog" class="small muted" style="margin-top:6px"></div>
      <div class="sleepwatch" id="swBox">
        <div class="btn-row"><button class="btn sm" id="swBtn">🌙 Start sleep watch (eye state)</button><label class="small muted">Call it "possibly asleep" after eyes closed for <select id="swAfter" style="width:auto"><option value="30">30 s (demo)</option><option value="120" selected>2 min</option><option value="300">5 min</option></select></label></div>
        <div id="swPanel" class="hidden"><div class="sw-state" id="swState"></div><div class="sw-bar" id="swBar"></div><div class="small" id="swStats"></div></div>
        <p class="small dim" style="margin:4px 0 0">Uses the RGB eye to see whether the eyes are open or closed (a thermal image can't resolve eyelids). In darkness an ordinary webcam can't see the eyes, so the state is UNKNOWN unless the camera has infrared night vision. Unknown time is never stored as sleep.</p>
      </div>
    </div>

    <div class="card"><div class="card-h"><h2><span class="dot" style="background:#f97316"></span>Eye 2 — Thermal camera</h2><span id="thBadge">${srcBadge('simulated')}</span></div>
      <div class="thermal-wrap"><canvas id="thermal" width="640" height="480"></canvas></div>
      <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="thStart">▶ Start thermal eye</button><button class="btn" id="thStop" disabled>■ Stop</button>
        ${Object.entries(MODES).map(([k, m]) => `<button class="chip ${k === 'day' ? 'on' : ''}" data-tm="${k}">${m.label}</button>`).join('')}</div>
      <div class="btn-row small" style="margin-top:6px"><span class="muted">Night speed</span><select id="thSpeed" style="width:auto"><option value="60">×60 (8 h ≈ 8 min)</option><option value="240" selected>×240 (8 h ≈ 2 min)</option></select></div>
      <div class="live-grid" id="thLive" style="margin-top:8px"></div>
      <canvas id="brWave" height="50" style="width:100%;height:50px;margin-top:6px;background:#050d1d;border-radius:8px"></canvas>
      <div id="thAlerts"></div>
      <details class="small" style="margin-top:8px"><summary>Connect real thermal hardware</summary>
        <p class="muted">A USB (UVC) thermal camera that appears as a video device can be shown here (relative false-colour). Calibrated temperatures require the vendor's radiometric SDK.</p>
        <div class="btn-row"><select id="thDev" style="width:auto"><option value="">— select a video device —</option></select><button class="btn sm" id="thConnect">Connect</button><button class="btn sm" id="thDisconnect">Use simulation</button></div></details>
    </div>
  </div>

  <div class="card" style="margin-top:16px"><div class="card-h"><h2>ORBI analysis — today vs previous days vs Earth baseline</h2><button class="btn sm" id="cmpRefresh">↻ Refresh</button></div>
    <div id="cmp"></div><div class="section-title">Support ORBI would provide now</div><ul class="obs-list" id="support"></ul></div>

  <div class="card emg-demo" style="margin-top:16px"><div class="card-h"><h2>Emergency demo — the astronaut cannot speak</h2>${srcBadge('simulated')}</div>
    <p class="small">ORBI's cameras see a sudden collapse and no movement. ORBI asks “Are you okay?” — if nobody answers by voice (“I'm okay”) or button within 15 seconds, it starts the unresponsive-person protocol by itself, speaks each step for crewmates, logs the event and notifies Earth.</p>
    <div class="btn-row"><button class="btn danger" id="collapseBtn">Simulate collapse (no response)</button><button class="btn ok hidden" id="okBtn">I'm okay</button><span id="collapseStatus" class="small"></span></div>
    <div id="protoBox" class="hidden" style="margin-top:10px"></div></div>`;

  // ================= ORBI scene =================
  const scene = new OrbiScene($('#scene'), { onStatus: st => { const el = $('#sceneStatus'); if (el && (scene._n = (scene._n || 0) + 1) % 10 === 0) el.innerHTML = `<b>${esc(st.activity)}</b> · ORBI ${st.dist.toFixed(1)} m away · active eye: <b style="color:${st.eye === 'rgb' ? '#22d3ee' : '#f97316'}">${st.eye === 'rgb' ? 'RGB' : 'THERMAL (lights off)'}</b>`; } });
  scene.start();

  // ================= RGB eye =================
  const video = $('#video'), overlay = $('#overlay'), octx = overlay.getContext('2d');
  const sampler = document.createElement('canvas'); sampler.width = 320; sampler.height = 240; const pctx = sampler.getContext('2d', { willReadFrequently: true });
  let stream = null, faceM = null, poseM = null, poseState = 'loading', raf = 0, lastVT = -1, frameN = 0, demo = false, demoT = 0, alive = true;
  let detErr = 0, poseErr = 0, lastFrameAt = 0, faceLostAt = 0, lastHRAt = 0, modelErr = '';
  const blink = new BlinkTracker();
  const R = { face: null, pose: null, lum: null, darkSince: 0, firstFace: 0, ppg: [], ppgMotion: [], prevNose: null, hr: null, hrAt: 0, puffRatios: [], base: (await DB.kvGet('faceBaseline')) || null, puff: null, move: [], posture: null, brisk: null, gaze: [], fatigue: null };
  const auto = { t0: 0, saved: 0 };

  // The models are loaded as soon as the page opens (in the background), so detection starts the moment the video does.
  let modelsP = null;
  function loadModels() {
    if (modelsP) return modelsP;
    $('#modelStatus').textContent = 'Loading on-device face model…';
    modelsP = (async () => {
      try { faceM = await getFace(); $('#modelStatus').textContent = `Face model ready (${faceM.delegate})`; }
      catch (e) { modelErr = e.message || String(e); showErr('The face-detection model could not load — this browser needs WebAssembly (use an up-to-date Chrome or Edge). Details: ' + modelErr); $('#modelStatus').textContent = 'Face model failed to load'; }
      getPose().then(m => { poseM = m; poseState = 'ok'; if (faceM) $('#modelStatus').textContent = `Models ready (on-device, ${faceM.delegate})`; }).catch(() => { poseState = 'fail'; });
    })();
    return modelsP;
  }
  loadModels();
  function showErr(m) { const el = $('#camErr'); el.innerHTML = '⚠ ' + esc(m); el.classList.remove('hidden'); }
  $('#camStart').onclick = async () => {
    $('#camErr').classList.add('hidden'); stopAll();
    try {
      $('#camStart').disabled = true;
      const st = await startCamera(video);
      if (!alive) { stopCamera(st); return; } // the page was closed while the browser asked for permission
      stream = st; overlay.width = video.videoWidth || 640; overlay.height = video.videoHeight || 480;
      $('#camPh').classList.add('hidden'); $('#camStop').disabled = false; $('#rgbMode').innerHTML = srcBadge('observed');
      R.camStart = performance.now(); lastFrameAt = R.camStart; detErr = 0; faceLostAt = 0;
      await loadModels(); if (!alive || !stream) return;
      auto.t0 = performance.now(); loop();
    }
    catch (e) { showErr(e.message + ' — you can use “Demo footage (simulated)” instead.'); $('#camStart').disabled = false; }
  };
  $('#demoStart').onclick = () => { stopAll(); demo = true; overlay.style.transform = 'none'; overlay.width = 640; overlay.height = 480; $('#camPh').classList.add('hidden'); $('#camStop').disabled = false; $('#rgbMode').innerHTML = srcBadge('simulated') + ' <span class="small dim">synthetic demo footage</span>'; auto.t0 = performance.now(); loop(); };
  $('#camStop').onclick = () => stopAll();
  function stopAll() {
    if (sw) stopSleepWatch();
    cancelAnimationFrame(raf); stopCamera(stream); stream = null; video.srcObject = null; demo = false; overlay.style.transform = ''; R.camStart = 0;
    $('#camPh').classList.remove('hidden'); $('#camStart').disabled = false; $('#camStop').disabled = true; octx.clearRect(0, 0, overlay.width, overlay.height);
    R.face = null; R.pose = null; R.ppg = []; R.hr = null; updateCaps(); $('#hud').innerHTML = '';
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (demo) return demoFrame();
    if (!stream) return;
    const now = performance.now();
    if (video.readyState < 2 || video.currentTime === lastVT) {
      // Is the webcam actually delivering frames?
      if (now - lastFrameAt > 3000 && !R.noFrames) { R.noFrames = true; updateCaps(now); updateLive(now); }
      return;
    }
    lastVT = video.currentTime; lastFrameAt = now; R.noFrames = false; frameN++;
    if (overlay.width !== video.videoWidth && video.videoWidth) { overlay.width = video.videoWidth; overlay.height = video.videoHeight; }
    const W = overlay.width, H = overlay.height; octx.clearRect(0, 0, W, H);
    let f = null;
    if (faceM) {
      try { f = faceFeatures(faceM.detectForVideo(video, now)); detErr = 0; }
      catch (e) {
        // Never fail silently: after repeated errors switch the model to the CPU, and report it if that fails too.
        if (++detErr === 8) {
          console.warn('[ORBI] face detection failing on', faceM.delegate, e);
          if (faceM.delegate === 'GPU') { const old = faceM; faceM = null; $('#modelStatus').textContent = 'Graphics acceleration failed — switching the face model to the processor…'; useCPU('face').then(m => { if (old !== m) faceM = m; detErr = 0; $('#modelStatus').textContent = 'Face model running on the processor (CPU)'; }).catch(er => { modelErr = er.message; showErr('Face detection is not working in this browser: ' + er.message); }); }
          else { modelErr = e.message || String(e); showErr('Face detection keeps failing: ' + modelErr + ' — try reloading the page, or another browser (Chrome/Edge).'); }
        }
      }
    }
    if (f) { if (!R.firstFace) R.firstFace = now; faceLostAt = 0; blink.update(f, now); drawFace(octx, f, W, H); trackHead(f, now); }
    else { if (R.face) faceLostAt = now; R.firstFace = 0; }
    R.face = f;
    if (sw) { if (R.lum == null || frameN % 15 === 0) { pctx.drawImage(video, 0, 0, 320, 240); const d = pctx.getImageData(0, 0, 320, 240).data; let l = 0; for (let i = 0; i < d.length; i += 64) l += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; R.lum = l / (d.length / 64); } sw.update(f, R.lum ?? 128, now); if (frameN % 6 === 0) drawSleepWatch(now); }
    // live evidence for ORBI's responsiveness check (Virtual Body / emergency escalation)
    R.obs = R.obs || []; R.obs.push({ t: now, face: !!f, eyesClosed: f ? eyeState(f) === 'closed' : null, nose: f ? { x: f.nose.x, y: f.nose.y } : null, tilt: R.pose ? Math.abs(Math.atan2(((R.pose[23].x + R.pose[24].x) - (R.pose[11].x + R.pose[12].x)) / 2, ((R.pose[23].y + R.pose[24].y) - (R.pose[11].y + R.pose[12].y)) / 2) * 57.3) : null, lum: R.lum ?? 128 });
    while (R.obs.length && now - R.obs[0].t > 6000) R.obs.shift();
    if (frameN % 10 === 0) reportObs({ window: R.obs.slice() });
    if (poseM && frameN % 2 === 0) { try { const p = poseM.detectForVideo(video, now).landmarks?.[0] || null; R.pose = p && (p[11].visibility ?? 1) > 0.5 && (p[12].visibility ?? 1) > 0.5 ? p : null; poseErr = 0; } catch (e) { R.pose = null; if (++poseErr === 8 && poseM.delegate === 'GPU') { poseM = null; useCPU('pose').then(m => { poseM = m; poseErr = 0; }).catch(() => { poseState = 'fail'; }); } } }
    if (R.pose) { drawPose(octx, R.pose, W, H); trackPose(now); }
    // lighting + rPPG sampling
    pctx.drawImage(video, 0, 0, 320, 240);
    if (f) {
      const s = sampleRGB(pctx, 320, 240, skinROIs(f.lm));
      if (s) { R.lum = s.lum; const mo = R.prevNose ? d2(f.nose, R.prevNose) : 0; R.prevNose = { ...f.nose }; R.ppg.push({ t: now, v: [s.r, s.g, s.b] }); R.ppgMotion.push(mo); while (R.ppg.length && now - R.ppg[0].t > 20000) { R.ppg.shift(); R.ppgMotion.shift(); } }
      octx.strokeStyle = 'rgba(192,132,252,.8)'; skinROIs(f.lm).forEach(q => octx.strokeRect(q.x * W, q.y * H, q.w * W, q.h * H));
      if (f.gazeX != null) { R.gaze.push([f.gazeX, f.gazeY]); if (R.gaze.length > 900) R.gaze.shift(); }
      trackPuffiness(f, now);
    } else if (frameN % 15 === 0) { const d = pctx.getImageData(0, 0, 320, 240).data; let l = 0; for (let i = 0; i < d.length; i += 64) l += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; R.lum = l / (d.length / 64); R.ppg = []; }
    // rPPG every 2 s once ≥10 s of face video exists (works at any webcam frame rate ≥ ~8 fps)
    if (R.ppg.length >= 80 && now - R.ppg[0].t >= 10000 && now - lastHRAt > 2000) { lastHRAt = now; const res = estimateHeartRate(R.ppg, { motion: avg(R.ppgMotion), brightness: R.lum ?? 128 }); R.hr = res; if (res.ok) R.hrAt = now; drawWave($('#hrWave'), res.signal || [], '#c084fc'); }
    darkCheck(now);
    if (frameN % 8 === 0) { updateLive(now); updateCaps(now); }
    autoSave(now, 'observed');
  }
  // ---------------- sleep watch (RGB eye state) ----------------
  let sw = null;
  function drawSleepWatch(now = performance.now()) {
    if (!sw) return; const sm = sw.summary(now);
    const cls = { awake: 'ok', closed: 'info', asleep: 'sleep', unknown: 'na' }[sw.state];
    $('#swState').innerHTML = `<span class="sw-chip ${cls}">${SW_LABEL[sw.state]}</span> <span class="small muted">${esc(sw.reason)}</span>`;
    const tot = Math.max(0.01, sm.totalMin);
    $('#swBar').innerHTML = sm.segments.map(x => `<i class="${x.st}" style="width:${Math.max(0.3, (x.e - x.s) / tot * 100)}%" title="${SW_LABEL[x.st]}"></i>`).join('');
    const mm = v => v < 1 ? Math.round(v * 60) + ' s' : v.toFixed(1) + ' min';
    $('#swStats').innerHTML = `Watched ${mm(sm.totalMin)} · possibly asleep <b>${mm(sm.asleepMin)}</b> · eyes closed ${mm(sm.closedMin)} · awake ${mm(sm.awakeMin)} · <b>unknown ${mm(sm.unknownMin)}</b> · awakenings ${sm.awakenings} · restless moments ${sm.restless} · coverage ${Math.round(sm.coverage * 100)}%`;
  }
  async function stopSleepWatch() {
    if (!sw) return; const sm = sw.summary(); sw = null; $('#swBtn').textContent = '🌙 Start sleep watch (eye state)';
    const observed = sm.totalMin - sm.unknownMin;
    if (observed < 10) { toast(`Sleep watch stopped — only ${observed.toFixed(1)} min with the eyes visible, so nothing was added to the sleep history.`); return; }
    const meta = { via: 'ORBI RGB eye — eye state', awakeMin: +sm.awakeMin.toFixed(1), closedMin: +sm.closedMin.toFixed(1), unknownMin: +sm.unknownMin.toFixed(1), coverage: +sm.coverage.toFixed(2), awakenings: sm.awakenings, restless: sm.restless };
    await addRecord('sleep_eyes', +sm.asleepMin.toFixed(1), 'observed', meta);
    if (sm.asleepMin >= 60 && sm.coverage >= 0.7) await addRecord('sleep_h', +(sm.asleepMin / 60).toFixed(1), 'observed', { ...meta, notes: `RGB eye-state watch: ${sm.awakenings} awakening(s), ${sm.restless} restless moment(s); ${Math.round(sm.coverage * 100)}% of the time the eyes were visible.` });
    toast(`Sleep watch saved: possibly asleep ${sm.asleepMin.toFixed(1)} min, ${sm.awakenings} awakening(s)${sm.asleepMin >= 60 && sm.coverage >= 0.7 ? ' — added to sleep history' : ' (too short or too little visible to count as a night of sleep)'}.`);
  }
  $('#swBtn').onclick = async () => {
    if (sw) return stopSleepWatch();
    if (!stream) { $('#camStart').click(); await new Promise(r => setTimeout(r, 2500)); if (!stream) return toast('The sleep watch needs the webcam (RGB eye).', true); }
    sw = new SleepWatch({ sleepAfter: +$('#swAfter').value }); $('#swPanel').classList.remove('hidden'); $('#swBtn').textContent = '■ Stop sleep watch & save'; drawSleepWatch();
  };
  function trackHead(f, now) {
    const h = { t: now, yaw: f.yaw, pitch: f.pitch, roll: f.roll };
    if (R.lastHead) { const dt = Math.max(0.016, (now - R.lastHead.t) / 1000); R.headSpeed = (R.headSpeed ?? 0) * 0.85 + 0.15 * (Math.abs(h.yaw - R.lastHead.yaw) + Math.abs(h.pitch - R.lastHead.pitch)) / dt; }
    R.lastHead = h;
    R.gazeDir = f.gazeX == null ? null : f.gazeX < 0.42 ? 'right' : f.gazeX > 0.58 ? 'left' : 'centre'; // image is mirrored for the viewer
    R.faceSize = f.box.w;
  }
  function trackPose(now) {
    const p = R.pose; const sw = d2(p[11], p[12]) || 0.2;
    const tilt = Math.abs(Math.atan2(p[11].y - p[12].y, p[11].x - p[12].x) * 57.3); const tl = Math.min(tilt, Math.abs(180 - tilt));
    const headOff = Math.abs((p[0].x - (p[11].x + p[12].x) / 2) / sw) * 100;
    R.posture = Math.round(clamp(100 - Math.max(0, tl - 2) * 3 - Math.max(0, headOff - 6) * 0.8));
    const pts = [11, 12, 15, 16].map(i => ({ x: p[i].x / sw, y: p[i].y / sw }));
    if (R.lastPts) { const sp = avg(pts.map((q, i) => Math.hypot(q.x - R.lastPts[i].x, q.y - R.lastPts[i].y))) / Math.max(0.016, (now - R.lastPoseT) / 1000); R.move.push({ t: now, sp }); while (R.move.length && now - R.move[0].t > 60000) R.move.shift(); }
    R.lastPts = pts; R.lastPoseT = now;
    const moving = R.move.filter(m => m.sp > 0.15); // only judge briskness while actually moving
    R.activity = R.move.length ? moving.length / R.move.length : null;
    R.brisk = moving.length > 20 ? Math.round(clamp(avg(moving.map(m => m.sp)) * 45)) : null;
  }
  async function trackPuffiness(f, now) {
    if (Math.abs(f.yaw) > 12 || Math.abs(f.pitch) > 15) { R.puffQuality = 'pose'; return; }
    R.puffQuality = 'ok';
    const ratio = d2(f.lm[234], f.lm[454]) / Math.max(1e-4, d2(f.lm[33], f.lm[263]));
    R.puffRatios.push(ratio); if (R.puffRatios.length > 300) R.puffRatios.shift();
    const med = [...R.puffRatios].sort((a, b) => a - b)[R.puffRatios.length >> 1];
    R.puffT = R.puffT || now;
    if (!R.base && R.puffRatios.length >= 40 && now - R.puffT > 6000) { R.base = { ratio: med, ts: Date.now(), note: 'Reference image captured on this computer (stand-in for the pre-flight photo)' }; await DB.kvSet('faceBaseline', R.base); toast('ORBI saved a facial reference image (shape only, no picture) for puffiness comparison.'); }
    if (R.base && R.puffRatios.length >= 20) R.puff = (med / R.base.ratio - 1) * 100;
  }
  function darkCheck(now) {
    const dark = R.lum != null && R.lum < 35 && !R.face; // the thermal eye only takes over when the RGB eye can no longer see a face
    if (dark) { if (!R.darkSince) R.darkSince = now; if (now - R.darkSince > 3000 && $('#darkNote').classList.contains('hidden')) { $('#darkNote').classList.remove('hidden'); thermalEye.setMode('night'); setModeChips('night'); startThermal(); speak('It is too dark for my RGB eye. Switching to the thermal eye.'); } }
    else { R.darkSince = 0; $('#darkNote').classList.add('hidden'); }
  }
  function fatigueIndex(now) {
    const pc = blink.perclos(), br = blink.rate(now); if (pc == null) return null;
    const f = R.face; const squint = f ? ((f.bs.eyeSquintLeft || 0) + (f.bs.eyeSquintRight || 0)) / 2 : 0; const browD = f ? ((f.bs.browDownLeft || 0) + (f.bs.browDownRight || 0)) / 2 : 0;
    const yawns = blink.yawns.filter(t => now - t < 300000).length; const prolonged = blink.prolonged.filter(p => now - p.t < 60000).length;
    return Math.round(clamp(pc * 2.2 + (br != null && br < 6 ? 10 : 0) + squint * 25 + browD * 15 + yawns * 12 + prolonged * 8));
  }
  function capStatus(now) {
    if (demo) return Object.fromEntries(CAPS.map(([k]) => [k, 'simulated']));
    if (!stream) return Object.fromEntries(CAPS.map(([k]) => [k, 'unavailable']));
    const s = {}; const dark = R.lum != null && R.lum < 45; const f = R.face;
    s.face = !faceM ? (modelErr ? 'unavailable' : 'analyzing') : R.noFrames ? 'unavailable' : f ? (R.faceSize < 0.12 ? 'insufficient' : 'active') : (dark || now - (R.camStart || now) > 5000) ? 'insufficient' : 'analyzing';
    s.landmarks = s.face === 'active' && f.lm.length >= 468 ? 'active' : s.face;
    s.eyes = !f ? s.face : blink.rate(now) == null ? 'analyzing' : 'active';
    s.fatigue = !f ? s.face : blink.perclos() == null ? 'analyzing' : 'active';
    s.pose = poseState === 'fail' ? 'unavailable' : poseState === 'loading' ? 'analyzing' : R.pose ? 'active' : 'insufficient';
    s.hr = !f ? s.face : dark ? 'insufficient' : !R.hr ? 'analyzing' : R.hr.ok ? 'active' : 'insufficient';
    s.puffy = !f ? s.face : R.puffQuality === 'pose' ? 'insufficient' : R.puff == null ? 'analyzing' : 'active';
    return s;
  }
  function updateCaps(now = performance.now()) {
    const s = capStatus(now);
    const reason = demo ? {} : { face: faceReason(now), hr: R.hr && !R.hr.ok ? R.hr.reason : '', pose: s.pose === 'insufficient' ? 'Shoulders not visible — step back' : '', puffy: R.puffQuality === 'pose' ? 'Face the camera' : !R.base ? 'Capturing reference…' : '' };
    $('#caps').innerHTML = CAPS.map(([k, l]) => `<tr><td>${l}</td><td><span class="dot ${STATUS[s[k]][0]}"></span>${STATUS[s[k]][1]}${reason[k] ? `<div class="small dim">${esc(reason[k])}</div>` : ''}</td></tr>`).join('');
  }
  /** Plain-language explanation of why the face is not (well) detected — never pretend it is working. */
  function faceReason(now) {
    if (!stream) return '';
    if (modelErr) return 'Face model unavailable: ' + modelErr;
    if (!faceM) return 'Loading the face model…';
    if (R.noFrames) return 'The webcam is not delivering video (covered, in use by another app, or asleep).';
    if (R.face && R.faceSize < 0.12) return 'Face too small — come closer (40–80 cm).';
    if (R.face) return '';
    if (now - (R.camStart || now) < 5000) return 'Scanning…';
    if (R.lum != null && R.lum < 45) return 'Too dark for the RGB eye — add light in front of you.';
    if (R.lum != null && R.lum > 225) return 'Image overexposed — avoid a bright light behind or in front of the camera.';
    return faceLostAt ? `Face lost ${Math.round((now - faceLostAt) / 1000)} s ago — look toward the camera.` : 'No face found — sit in front of the camera, face it, 40–80 cm away.';
  }
  function cell(l, v) { return `<div class="live-cell"><div class="ll">${l}</div><div class="lv">${v}</div></div>`; }
  function updateLive(now) {
    const f = R.face, br = blink.rate(now), pc = blink.perclos(); R.fatigue = fatigueIndex(now);
    const expr = f ? [['smile', ((f.bs.mouthSmileLeft || 0) + (f.bs.mouthSmileRight || 0)) / 2], ['brow lowering', ((f.bs.browDownLeft || 0) + (f.bs.browDownRight || 0)) / 2], ['eye squint', ((f.bs.eyeSquintLeft || 0) + (f.bs.eyeSquintRight || 0)) / 2], ['jaw open', f.bs.jawOpen || 0]].filter(x => x[1] > 0.3).map(x => x[0]).join(', ') || 'neutral' : '—';
    const hr = R.hr; const hrTxt = hr?.ok ? `${hr.bpm.toFixed(0)} <small>bpm</small> ${srcBadge('estimated')}<div class="small">${qualityBars(hr.quality)}</div>` : hr ? `<span class="small muted">${esc(hr.reason || 'analyzing')}</span>` : '<span class="small muted">collecting 10–20 s…</span>';
    $('#rgbLive').innerHTML = cell('Face', f ? '<span class="dot ok"></span>detected' : '—') + cell('Blink rate', br == null ? '…' : br.toFixed(0) + '<small>/min</small>') + cell('Eye closure (PERCLOS)', pc == null ? '…' : pc.toFixed(1) + '<small>%</small>') +
      cell('Facial / eye fatigue', R.fatigue == null ? '…' : `${R.fatigue}<small>/100</small> ${R.fatigue > 40 ? '<span class="danger-text small">drowsy signs</span>' : ''}`) + cell('Expression', `<span class="small">${expr}</span>`) +
      cell('Posture', R.posture == null ? '—' : R.posture + '<small>/100</small>') + cell('Movement', R.brisk == null ? (R.activity != null ? `<span class="small">mostly still</span>` : '—') : `${R.brisk}<small>/100 brisk</small>`) +
      cell('Head movement', f ? `<span class="small">yaw ${f.yaw.toFixed(0)}° · pitch ${f.pitch.toFixed(0)}° · ${(R.headSpeed ?? 0) > 25 ? 'moving' : 'steady'}</span>` : '—') + cell('Gaze', f && R.gazeDir ? `<span class="small">${R.gazeDir}</span>` : '—') +
      cell('Heart rate (rPPG)', hrTxt) + cell('Facial puffiness', R.puff == null ? '…' : `${R.puff > 0 ? '+' : ''}${R.puff.toFixed(1)}<small>% vs ref.</small>`);
    const why = faceReason(now);
    const st = !faceM ? 'LOADING MODEL' : R.noFrames ? 'NO VIDEO' : f ? (R.faceSize < 0.12 ? 'FACE TOO FAR' : 'FACE LOCKED') : faceLostAt ? 'FACE LOST' : 'SCANNING';
    $('#hud').innerHTML = `<span class="hud-chip">● RGB EYE · ON-DEVICE</span><span class="hud-chip ${f ? 'hud-ok' : 'hud-warn'}">${st}</span>${R.lum != null && R.lum < 45 ? '<span class="hud-chip">LOW LIGHT</span>' : ''}${!f && why ? `<div class="hud-why">${esc(why)}</div>` : ''}`;
  }
  function autoSave(now, source) {
    if (now - auto.t0 < 60000) { if (frameN % 30 === 0) $('#autoLog').textContent = `ORBI saves automatically every minute — next in ${Math.ceil((60000 - (now - auto.t0)) / 1000)} s · ${auto.saved} saves this session`; return; }
    auto.t0 = now; const meta = { method: source === 'simulated' ? 'demo footage (simulated)' : 'ORBI RGB eye, automatic 60-s observation' }; const recs = [];
    const add = (type, value, src = source) => value != null && isFinite(value) && recs.push({ type, value: +(+value).toFixed(1), source: src, meta });
    if (demo) { add('hr', 63 + Math.random() * 6); add('blink_rate', 13 + Math.random() * 5); add('perclos', 3 + Math.random() * 3); add('posture', 80 + Math.random() * 8); add('move_speed', 76 + Math.random() * 8); add('puffiness', 6 + Math.random() * 2); }
    else {
      add('blink_rate', blink.rate(now)); add('perclos', blink.perclos()); add('posture', R.posture); add('move_speed', R.brisk); add('puffiness', R.puff);
      if (R.gaze.length > 60) { const g = R.gaze.slice(-600); add('gaze_stability', clamp(100 - (stdv(g.map(x => x[0])) + stdv(g.map(x => x[1]))) * 220)); }
      if (R.hr?.ok && now - R.hrAt < 15000) recs.push({ type: 'hr', value: +R.hr.bpm.toFixed(0), source: 'estimated', meta: { method: 'rPPG (POS), ORBI RGB eye', quality: +R.hr.quality.toFixed(2) } });
    }
    if (recs.length) { addRecords(recs); auto.saved++; $('#autoLog').innerHTML = `Saved ${new Date().toLocaleTimeString()}: ${recs.map(r => `${METRICS[r.type].label} <b>${r.value}</b>`).join(' · ')}`; }
  }
  // ---- labelled demonstration footage (no webcam) ----
  function demoFrame() {
    const now = performance.now(); demoT += 1 / 60; frameN++; const W = overlay.width, H = overlay.height, c = octx;
    c.fillStyle = '#0c1424'; c.fillRect(0, 0, W, H);
    const sway = Math.sin(demoT * 0.6) * 12, blinkOn = (demoT % 4.2) < 0.15;
    c.fillStyle = '#1e293b'; c.beginPath(); c.ellipse(W / 2 + sway * 0.5, H * 0.98, 170, 110, 0, Math.PI, 0); c.fill(); // shoulders
    c.fillStyle = '#d8b49a'; c.beginPath(); c.ellipse(W / 2 + sway, H * 0.45, 92, 118, 0, 0, 7); c.fill();
    c.fillStyle = '#3b2a20'; c.beginPath(); c.ellipse(W / 2 + sway, H * 0.29, 96, 50, 0, Math.PI, 0); c.fill();
    for (const s of [-1, 1]) { c.fillStyle = '#fff'; c.beginPath(); c.ellipse(W / 2 + sway + s * 36, H * 0.42, 16, blinkOn ? 1.5 : 8, 0, 0, 7); c.fill(); if (!blinkOn) { c.fillStyle = '#334155'; c.beginPath(); c.arc(W / 2 + sway + s * 36, H * 0.42, 5, 0, 7); c.fill(); } }
    c.strokeStyle = '#8b5e4a'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2 + sway, H * 0.55, 26, 0.2, Math.PI - 0.2); c.stroke();
    c.strokeStyle = 'rgba(34,211,238,.7)'; c.setLineDash([6, 4]); c.strokeRect(W / 2 + sway - 105, H * 0.18, 210, 260); c.setLineDash([]);
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, H - 30, W, 30); c.fillStyle = '#f5b942'; c.font = '16px Inter, sans-serif'; c.fillText('DEMONSTRATION FOOTAGE — SIMULATED, NOT A REAL MEASUREMENT', 12, H - 10);
    if (frameN % 8 === 0) {
      updateCaps(now);
      const hr = 64 + Math.sin(demoT / 7) * 3;
      $('#rgbLive').innerHTML = cell('Face', 'simulated') + cell('Blink rate', (15 + Math.sin(demoT / 5) * 2).toFixed(0) + '<small>/min</small>') + cell('Eye closure (PERCLOS)', (4.5 + Math.sin(demoT / 9)).toFixed(1) + '<small>%</small>') + cell('Facial / eye fatigue', '18<small>/100</small>') + cell('Expression', '<span class="small">neutral</span>') + cell('Posture', '84<small>/100</small>') + cell('Movement', '78<small>/100 brisk</small>') + cell('Heart rate', `${hr.toFixed(0)} <small>bpm</small> ${srcBadge('simulated')}`) + cell('Facial puffiness', '+6.8<small>% vs ref.</small>');
      $('#hud').innerHTML = '<span class="hud-chip">DEMO · SIMULATED</span>';
      drawWave($('#hrWave'), Array.from({ length: 120 }, (_, i) => Math.sin((demoT * 6.7 - i * 0.12) * 1.07) + 0.15 * Math.sin(i * 0.9)), '#94a3b8');
    }
    autoSave(now, 'simulated');
  }
  function drawWave(cv, v, col) {
    if (!cv || !v.length) return; cv.width = cv.clientWidth * devicePixelRatio; const g = cv.getContext('2d'); const mn = Math.min(...v), mx = Math.max(...v);
    g.clearRect(0, 0, cv.width, cv.height); g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
    v.forEach((y, i) => { const X = i / (v.length - 1) * cv.width, Y = cv.height - 5 - (y - mn) / ((mx - mn) || 1) * (cv.height - 10); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
  }
  updateCaps();

  // ================= Thermal eye =================
  let thLast = 0, thSaveT = 0;
  const thermalEye = new ThermalEye($('#thermal'), {
    onReading: r => {
      const now = performance.now(); if (now - thLast < 400) return; thLast = now;
      const sim = !thermalEye.hw; const b = sim ? srcBadge('simulated') : '<span class="pill lv-caution">relative</span>';
      const f1 = v => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1);
      const Q = { good: ['ok', 'Good'], fair: ['caution', 'Fair'], poor: ['warning', 'Poor'] }[r.quality] || ['na', '—'];
      $('#thLive').innerHTML = cell('Breathing rate', r.rr == null ? '<span class="small muted">measuring…</span>' : `${r.rr.toFixed(0)}<small>/min</small> ${b}`) + cell('Breath amplitude', r.grad?.breathAmp == null ? '—' : `${r.grad.breathAmp.toFixed(2)}<small>°C</small>`) +
        cell('Forehead – nose', r.grad?.foreheadNose == null ? '—' : `${r.grad.foreheadNose.toFixed(1)}<small>°C</small> <span class="small muted">calm ≈0.9</span>`) + cell('Eye corner – forehead', r.grad?.canthusForehead == null ? '—' : `${r.grad.canthusForehead.toFixed(1)}<small>°C</small>`) +
        cell('Cheek L – R', r.grad?.cheekAsym == null ? '—' : `${r.grad.cheekAsym.toFixed(1)}<small>°C</small>`) + cell('Data quality', `<span class="dot ${Q[0]}"></span>${Q[1]} <span class="small muted">noise ${r.noise.toFixed(2)} °C</span>`) +
        (r.sleep ? cell('Sleep state', `<b>${r.sleep.state}</b> <span class="small muted">${r.sleep.clock}</span>`) + cell('Awakenings / onset', `${r.sleep.wakes} · ${r.sleep.onset == null ? 'not asleep yet' : Math.round(r.sleep.onset) + ' min'}`) : cell('Movement', r.motion > 0.3 ? 'moving' : 'still')) +
        `<div class="live-cell" style="grid-column:1/-1"><table class="table small th-rois"><tr><th>Region analysed</th><th>Now</th><th>Your baseline</th><th>Change</th></tr>${(r.rois || []).map(x => `<tr><td>${x.label}</td><td><b>${x.now == null ? '—' : x.now.toFixed(1) + ' °C'}</b></td><td>${x.base == null ? '<span class="dim">learning…</span>' : x.base.toFixed(1) + ' °C'}</td><td class="${x.delta != null && Math.abs(x.delta) >= 0.7 ? 'warn-text' : ''}">${f1(x.delta)}</td></tr>`).join('')}</table>
        <div class="small dim">${sim ? 'All thermal values are SIMULATED model data (no infrared sensor) — they show how ORBI analyses a thermal image, not a measurement of you.' : 'Connected thermal camera: RELATIVE values from an uncalibrated sensor — not absolute °C.'}${r.baseLearning ? ' Learning your baseline while you are calm and awake…' : ''}</div></div>`;
      $('#thAlerts').innerHTML = r.alerts.map(a => `<div class="callout ${a.lvl === 'warning' ? 'warn' : ''}" style="margin-top:6px">${esc(a.text)}</div>`).join('');
      drawWave($('#brWave'), thermalEye.breath.map(x => x.v), '#f97316');
      if (sim && r.rr != null && now - thSaveT > 60000) { thSaveT = now; const recs = [{ type: 'rr', value: +r.rr.toFixed(0), source: 'simulated', meta: { method: 'ORBI thermal eye — nostril temperature (simulated data)' } }]; if (r.skin != null && !thermalEye.night) recs.push({ type: 'skin_temp', value: +r.skin.toFixed(1), source: 'simulated', meta: { method: 'ORBI thermal eye — forehead (simulated data)' } }); addRecords(recs); }
    },
    onNightEnd: async sm => {
      await addRecords([['sleep_h', sm.h, { periods: sm.periods, monitor: 'ORBI thermal eye — simulated night in darkness', notes: `Thermal eye: ${sm.wakes} awakening(s), fell asleep after ${sm.latency} min, restlessness ${sm.restless}/100.${sm.faceTrend ? ` Face temperature ${sm.faceTrend.start.toFixed(1)} → ${sm.faceTrend.end.toFixed(1)} °C over the night (lowest ${sm.faceTrend.min.toFixed(1)} °C) — the usual nightly drop.` : ''}` }], ['sleep_latency', sm.latency], ['sleep_wakes', sm.wakes], ['sleep_restless', sm.restless], ['sleep_q', Math.max(1, Math.min(10, 9 - sm.wakes - sm.latency / 30 - sm.restless / 40))]].map(([type, value, meta]) => ({ type, value: +(+value).toFixed(1), source: 'simulated', meta: { via: 'ORBI thermal eye (simulated)', ...(meta || {}) } })));
      toast(`Night complete — thermal sleep summary saved: ${sm.h} h, ${sm.wakes} awakening(s). See Mental Health.`);
    },
  });
  thermalEye.setBaseline((await DB.kvGet('thermalBaseline')) || null);
  thermalEye.onBaseline = async bse => { await DB.kvSet('thermalBaseline', bse); toast('Thermal eye: personal baseline for each facial region saved.'); };
  const ctxT = $('#thermal').getContext('2d'); ctxT.fillStyle = '#05070d'; ctxT.fillRect(0, 0, 640, 480); ctxT.fillStyle = '#94a3b8'; ctxT.font = '18px Inter'; ctxT.fillText('Thermal eye off — press Start', 210, 240);
  function startThermal() { thermalEye.speed = +$('#thSpeed').value; if (!thermalEye.running) { if (!thermalEye.night && thermalEye.mode === 'night') thermalEye.setMode('night'); thermalEye.start(); } $('#thStart').disabled = true; $('#thStop').disabled = false; }
  const setModeChips = m => view.querySelectorAll('[data-tm]').forEach(b => b.classList.toggle('on', b.dataset.tm === m));
  $('#thStart').onclick = () => { thermalEye.setMode(thermalEye.mode); startThermal(); };
  $('#thStop').onclick = () => { thermalEye.stop(); $('#thStart').disabled = false; $('#thStop').disabled = true; };
  view.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { thermalEye.setMode(b.dataset.tm); setModeChips(b.dataset.tm); startThermal(); });
  $('#thSpeed').onchange = e => { thermalEye.speed = +e.target.value; };
  try { (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(d => d.kind === 'videoinput').forEach((d, i) => $('#thDev').insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}">${esc(d.label || 'Video device ' + (i + 1))}</option>`)); } catch (e) { /* no devices */ }
  $('#thConnect').onclick = async () => { const id = $('#thDev').value; if (!id) return toast('Select a video device first.', true);
    const rgbId = stream?.getVideoTracks()[0]?.getSettings().deviceId; if (rgbId && rgbId === id) return toast('That device is the RGB eye (your webcam). The thermal eye needs a separate thermal camera.', true); try { await thermalEye.connect(id); $('#thBadge').innerHTML = '<span class="pill lv-caution">Hardware · relative scale</span>'; startThermal(); toast('Thermal hardware connected (relative false-colour, not calibrated °C).'); } catch (e) { toast('Could not open that device: ' + esc(e.message), true); } };
  $('#thDisconnect').onclick = () => { thermalEye.disconnect(); $('#thBadge').innerHTML = srcBadge('simulated'); };

  // ================= analysis & support =================
  function drawAnalysis() {
    const rows = compareAll(); $('#cmp').innerHTML = comparisonTable(rows, srcBadge);
    const a = assess(); const sup = [];
    const inv = rows.filter(r => r.status === 'investigate');
    if (a.fatigue.flagged || inv.some(r => ['perclos', 'move_speed'].includes(r.t))) sup.push(['Physical fatigue', 'Rest when possible and lighten today\'s exercise (“ORBI, make it lighter”).']);
    if (a.stress.detected) sup.push(['Stress / tension', 'Offer a relaxation exercise matched to the tension seen (neck, shoulders, breathing).']);
    if (a.sleep?.insomnia || a.sleep?.discomfort) sup.push(['Sleep disturbance', 'Sleep hygiene support tonight; mention to the CMO if it repeats.']);
    if (a.mood.severity === 'severe') sup.push(['Emotional distress signs', 'Gentle check-in from the Well-being Assistant; music or a happy memory.']);
    if (a.ex.today === 'missed' || a.ex.today === 'overdue') sup.push(['Inactivity / skipped exercise', 'Ask why before concluding anything; adapt the routine for pain or exhaustion.']);
    inv.filter(r => ['hr', 'rr', 'skin_temp'].includes(r.t)).forEach(r => sup.push([`${r.label} changed on several days`, 'Investigate: confirm with a validated medical device and inform the crew medical officer.']));
    $('#support').innerHTML = sup.length ? sup.map(([k, v]) => `<li><span><b>${esc(k)}</b><br><span class="small muted">${esc(v)}</span></span></li>`).join('') : '<li><span class="muted">No concerning changes — no support needed right now.</span></li>';
  }
  drawAnalysis(); $('#cmpRefresh').onclick = drawAnalysis;

  // ================= emergency demo: cannot speak =================
  let checkTimer = 0;
  $('#collapseBtn').onclick = async () => {
    if (protoRun.active) return toast('A protocol is already running.', true);
    await ensureVoice().catch(() => {});
    $('#collapseBtn').disabled = true; $('#okBtn').classList.remove('hidden');
    $('#collapseStatus').innerHTML = '<b class="danger-text">RGB eye: sudden downward movement, then no motion · Thermal eye: body horizontal, breathing signal weak.</b>';
    let left = 15; let answered = false;
    const finish = ok => { if (answered) return; answered = true; clearInterval(checkTimer); setVoiceOverride(null); $('#okBtn').classList.add('hidden'); $('#collapseBtn').disabled = false; return ok; };
    setVoiceOverride(t => { if (/\b(i'?m (ok|okay|fine|alright)|okay|fine|yes)\b/i.test(t)) { finish(true); $('#collapseStatus').textContent = 'Astronaut responded — no emergency. Event noted.'; speak('Thank you. I\'m glad you\'re okay. I\'ll keep an eye on you.'); } });
    $('#okBtn').onclick = () => { finish(true); $('#collapseStatus').textContent = 'Astronaut responded — no emergency.'; speak('Thank you. I\'m glad you\'re okay.'); };
    speak('Are you okay? Say I\'m okay, or press the button.');
    checkTimer = setInterval(async () => {
      left--; if (!answered) $('#collapseStatus').innerHTML = `<b class="danger-text">ORBI: “Are you okay?” — waiting for a response… ${left} s</b>`;
      if (left <= 0 && !answered) { finish(false); $('#collapseStatus').innerHTML = '<b class="danger-text">No response — ORBI started the protocol automatically.</b>'; await startProtocol('arrest', { source: 'camera', intro: 'Crew alert! Crew alert! ORBI detected a collapse and the astronaut is not responding.' }); }
    }, 1000);
  };
  const drawProto = r => {
    const box = $('#protoBox'); if (!box) return;
    if (!r.active) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="callout warn"><b>${esc(r.proto.title)}</b> — step ${Math.min(r.step + 1, r.proto.steps.length)} of ${r.proto.steps.length} (spoken by ORBI; say “next”, “repeat”, “back”, “stop”)
      <ol class="small" style="margin:6px 0 0">${r.proto.steps.map((s, i) => `<li style="${i === r.step ? 'color:#fff;font-weight:700' : 'opacity:.6'}">${esc(s)}</li>`).join('')}</ol>
      <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="pNext">Next</button><button class="btn sm" id="pStop">Stop</button></div></div>`;
    $('#pNext').onclick = () => import('../orbi/protocol.js').then(m => m.protocolCommand('next')); $('#pStop').onclick = () => import('../orbi/protocol.js').then(m => m.protocolCommand('stop'));
  };
  const offP = onProtocol(drawProto); drawProto(protoRun);
  const offR = on(w => { if (w === 'records') drawAnalysis(); });

  return () => { alive = false; cancelAnimationFrame(raf); stopCamera(stream); stream = null; thermalEye.stop(); thermalEye.disconnect(); scene.dispose(); clearInterval(checkTimer); setVoiceOverride(null); offP(); offR(); };
}
