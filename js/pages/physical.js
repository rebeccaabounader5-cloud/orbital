// ORBITAL — Physical Health: no manual tests, no symptom reports, no manual device entry.
// ORBI observes physical indicators automatically, compares them with the Earth baseline and recent days, prescribes a
// daily cabin workout (spoken by ORBI) and uses its RGB eye (pose tracking) to check whether the exercises are done.
import { state, on, daily, addRecords } from '../store.js';
import { current, compare } from '../analysis.js';
import { METRICS, srcBadge, srcLegend } from '../metrics.js';
import { $, esc, alertHTML, statHTML, metricChart, destroyCharts, toast, fmtTime, fmtDate } from '../ui.js';
import { importFile } from '../importer.js';
import { planFor, adherence, missedStreak, recordExerciseObserved, recordSkip, DUE_HOUR, loadAdaptation, setAdaptation } from '../companion/daily.js';
import { assess } from '../companion/wellbeing.js';
import { compareAll, comparisonTable } from '../companion/compare.js';
import { speak, stopSpeaking } from '../voice.js';
import { startCamera, stopCamera, getPose, drawPose } from '../cv/vision.js';
import { FormCoach, EX, EX_KEYS, ISSUE } from '../cv/exercise.js';
import { askAstronaut } from '../companion/overlay.js';
import { voiceState } from '../voice.js';

const PHYS = ['hr', 'rr', 'skin_temp', 'puffiness', 'move_speed', 'posture', 'reaction_ms', 'coordination', 'gaze_stability', 'blink_rate', 'perclos', 'exercise_min', 'body_mass'];
const AUTO = ['hr', 'rr', 'skin_temp', 'puffiness', 'move_speed', 'posture', 'blink_rate', 'perclos'];
const ST = { done: ['ok', 'Done ✓'], partial: ['caution', 'Partly done'], missed: ['warning', 'Skipped'], overdue: ['warning', 'Overdue'], pending: ['info', 'Scheduled'], nodata: ['na', '—'] };
const PHYS_CMP = ['hr', 'rr', 'skin_temp', 'puffiness', 'move_speed', 'posture', 'reaction_ms', 'coordination', 'blink_rate', 'perclos'];

export async function render(view) {
  let chartType = 'exercise_min', chartDays = 30, session = null;
  await loadAdaptation();
  const draw = () => {
    destroyCharts();
    const { alerts, cmp } = current();
    const rel = alerts.filter(a => (a.hazards || []).includes('gravity') || (a.organs || []).some(o => ['heart', 'muscles', 'bones', 'inner_ear', 'lungs'].includes(o)));
    const labs = state.records.filter(r => r.type === 'lab').sort((a, b) => b.ts - a.ts);
    const recent = state.records.filter(r => PHYS.includes(r.type) || r.type === 'exercise_skip').slice(-40).reverse();
    const plan = planFor(); const adh = adherence(7); const todaySt = adh.at(-1).status; const miss = missedStreak();
    const w = assess(); const why = [];
    if (w.sleep && (w.sleep.insomnia || w.sleep.h < 6)) why.push(`short or broken sleep last night (${w.sleep.h.toFixed(1)} h)`);
    if (w.fatigue.flagged) why.push('physical fatigue signs (eye closure, slower movement)');
    if (w.sleep?.discomfort) why.push('restless, uncomfortable night (possible back pain)');
    if (w.stress.detected) why.push('high stress / muscle tension');
    if (w.mood.severity !== 'ok' && (w.mood.affectLow != null || w.mood.silence != null)) why.push('possible emotional distress signs (to be asked about, not assumed)');
    const today = state.records.filter(r => r.type === 'exercise_min' && r.ts >= adh.at(-1).day).at(-1);

    view.innerHTML = `
    <p class="page-intro">No manual tests, no forms. <b>ORBI</b> measures your physical indicators automatically whenever its cameras can see you, compares them with your <b>Earth baseline</b> and recent days, prescribes your daily cabin workout and watches whether you do it. You can always just tell ORBI what hurts (Virtual Body). ${srcLegend()}</p>
    <div class="grid g4">${AUTO.map(t => `<div class="card">${statHTML(t, null, cmp[t] || compare(t))}</div>`).join('')}</div>
    <div class="btn-row" style="margin-top:8px"><button class="btn sm" id="simAuto">Demo: simulate today's automatic ORBI observations</button><span class="small dim">With a real webcam, open AI Camera — ORBI's RGB eye saves blink rate, eye closure, posture, movement, puffiness and heart-rate estimates on its own every minute.</span></div>

    <div class="grid g3" style="margin-top:16px">
      <div class="card span2 glow">
        <div class="card-h"><h2>Today's exercise — ${esc(plan.title)}</h2><span class="pill lv-${ST[todaySt][0] === 'ok' ? 'ok' : ST[todaySt][0] === 'warning' ? 'warning' : ST[todaySt][0] === 'caution' ? 'caution' : 'info'}">${ST[todaySt][1]}</span></div>
        <p class="small muted">≈${plan.minutes} min · cabin-safe (resistance device, bungees, handrails, cycle ergometer) · due by ${DUE_HOUR}:00 ship time. ${plan.preLanding ? `<b>${esc(plan.stage)}:</b> extra balance & gaze drills prepare your body for the gravity change.` : 'Protects muscle, bone and heart in weightlessness.'}</p>
        ${plan.note ? `<div class="callout" style="margin-bottom:8px">🛈 ${esc(plan.note)} <button class="btn sm ghost" id="undoAdapt">Restore full plan</button></div>` : ''}
        <div class="ex-list">${plan.items.map((x, i) => `<details class="ex" id="ex${i}"><summary><span class="ex-n">${i + 1}</span><span><b>${esc(x.name)}</b> <span class="small muted">· ${esc(x.dose)} · ≈${x.min} min · ${esc(x.part)}</span> <span class="ex-obs small" id="obs${i}"></span></span></summary>
          <div class="small" style="padding:6px 0 0 34px"><b>How:</b> ${esc(x.cue)}<br><b>Why:</b> ${esc(x.why)}<br><b>Modification:</b> ${esc(x.mod || 'Go lighter if anything hurts.')}</div></details>`).join('')}</div>
        <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="guideBtn">${session ? '■ Stop session' : '▶ Start session — ORBI speaks the instructions and watches'}</button><span class="small dim" id="guideTxt"></span></div>
        <div class="ex-cam hidden" id="exCam"><div class="cam-wrap" style="max-width:360px"><video id="exVideo" playsinline muted></video><canvas id="exOverlay" class="overlay"></canvas></div><div class="small" id="exCamTxt"></div></div>
        <div class="btn-row" style="margin-top:8px"><span class="small muted">Demo — what ORBI's camera sees:</span><button class="btn sm" id="simDone">Full session done</button><button class="btn sm" id="simPartial">Stopped halfway</button><button class="btn sm danger" id="simSkip">Session skipped</button></div>
        ${today ? `<p class="small" style="margin-top:6px">Today: <b>${Math.round(today.value)} min</b> observed ${srcBadge(today.source)} ${today.meta?.fraction != null ? `· ${Math.round(today.meta.fraction * 100)}% of the routine` : ''} ${today.meta?.how ? '· ' + esc(today.meta.how) : ''}</p>` : ''}
      </div>
      <div class="card">
        <h2>Exercise adherence — 7 days</h2>
        <div class="adh">${adh.map(d => `<div class="adh-d ${d.status}" title="${fmtDate(d.day)}: ${ST[d.status][1]}"><span>${new Date(d.day).toLocaleDateString([], { weekday: 'short' })[0]}</span></div>`).join('')}</div>
        ${miss ? `<div class="callout warn" style="margin-top:10px"><b>${todaySt === 'partial' ? 'Routine not completed today.' : `Exercise skipped ${miss > 1 ? miss + ' days in a row' : 'today'}.`}</b> ORBI noticed it and asked you why — it investigates before drawing any conclusion.
          ${why.length ? `<div class="small" style="margin-top:6px">Possible factors ORBI is considering: ${why.map(esc).join('; ')}.</div>` : '<div class="small" style="margin-top:6px">No sleep, fatigue, stress or mood warning signs — possibly workload or schedule. ORBI asks rather than assumes.</div>'}
          <div class="small" style="margin-top:6px">Tell ORBI what's going on (“ORBI, I don't feel like exercising”): pain → routine adapted around it; exhaustion → gentle mobility routine.</div></div>`
          : '<p class="small muted" style="margin-top:10px">No skipped sessions detected.</p>'}
      </div>
    </div>

    <div class="card glow" style="margin-top:16px" id="coachCard">
      <div class="card-h"><h2>Form coach — live camera</h2><span class="pill lv-info">Pose estimation on this computer</span></div>
      <p class="small muted">ORBI's RGB eye tracks your joints, recognises the exercise, counts repetitions and checks <b>how</b> you move — depth, back and knee alignment, left/right balance, tempo — and gives short spoken corrections. It only judges what it can see: keep your whole body in view (about 2–3 m from the camera).</p>
      <div class="btn-row"><label class="small">Exercise <select id="coachEx" style="width:auto"><option value="auto">Recognise automatically</option>${EX_KEYS.map(k => `<option value="${k}">${EX[k].name}</option>`).join('')}</select></label>
        <button class="btn primary" id="coachBtn">▶ Start form coach</button><label class="small"><input type="checkbox" id="coachVoice" checked> Spoken corrections</label></div>
      <div class="coach-wrap hidden" id="coachWrap">
        <div class="cam-wrap" style="max-width:480px"><video id="coachVideo" playsinline muted></video><canvas id="coachOverlay" class="overlay"></canvas></div>
        <div class="coach-live" id="coachLive"></div>
      </div>
      <div id="coachSummary"></div>
    </div>

    <div class="card" style="margin-top:16px"><h2>ORBI comparison — today vs previous days vs Earth baseline</h2>${comparisonTable(compareAll(PHYS_CMP), srcBadge)}</div>

    <div class="grid g3" style="margin-top:16px">
      <div class="card span2">
        <div class="card-h"><h2>History &amp; baseline</h2>
          <div class="btn-row"><select id="chartSel" style="width:auto">${PHYS.map(t => `<option value="${t}" ${t === chartType ? 'selected' : ''}>${METRICS[t].label}</option>`).join('')}</select>
          <select id="chartDays" style="width:auto">${[7, 14, 30].map(d => `<option ${d === chartDays ? 'selected' : ''} value="${d}">${d} days</option>`).join('')}</select></div></div>
        <div class="chart-box tall"><canvas id="physChart"></canvas></div>
        <p class="small dim">${METRICS[chartType].refNote ? esc(METRICS[chartType].refNote) : 'Dashed band = personal baseline.'}</p>
      </div>
      <div class="card"><h2>Unusual trends explained</h2>${rel.length ? [...rel].sort((x, y) => (y.kind === 'exercise') - (x.kind === 'exercise')).slice(0, 4).map(a => alertHTML(a, { compact: true })).join('') : '<p class="muted">No unusual physical trends detected.</p>'}</div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card">
        <div class="card-h"><h2>Pre-flight &amp; laboratory records</h2><label class="btn sm" style="margin:0">⇪ Import medical file<input type="file" id="labFile" accept=".json,.csv" hidden></label></div>
        <div class="table-wrap"><table class="table"><tr><th>Date</th><th>Test</th><th>Value</th><th>Ref.</th><th>Source</th></tr>
        ${labs.map(r => `<tr><td>${fmtTime(r.ts)}</td><td>${esc(r.meta?.name)}</td><td><b>${r.value.toFixed(2)}</b> ${esc(r.meta?.unit)}</td><td class="muted">${esc(r.meta?.refRange || '')}</td><td>${srcBadge(r.source)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No lab results.</td></tr>'}</table></div>
      </div>
      <div class="card">
        <h2>Recent automatic observations</h2>
        <div class="table-wrap" style="max-height:330px;overflow:auto"><table class="table"><tr><th>Time</th><th>Indicator</th><th>Value</th><th>Source</th></tr>
        ${recent.map(r => `<tr><td class="small">${fmtTime(r.ts)}</td><td>${METRICS[r.type]?.label || r.type}</td><td>${r.type === 'exercise_skip' ? '<span class="danger-text">missed</span>' : `<b>${r.value.toFixed(METRICS[r.type]?.dec ?? 1)}</b> ${METRICS[r.type]?.unit || ''}`}</td><td>${srcBadge(r.source)}</td></tr>`).join('')}</table></div>
      </div>
    </div>`;

    metricChart($('#physChart'), chartType, { days: chartDays, color: '#22d3ee', kind: chartType === 'exercise_min' ? 'bar' : 'line' });
    $('#chartSel').onchange = e => { chartType = e.target.value; draw(); };
    $('#chartDays').onchange = e => { chartDays = +e.target.value; draw(); };
    $('#labFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const r = await importFile(f); toast(`Imported ${r.imported} record(s).`); } catch (err) { toast('Import failed: ' + esc(err.message), true); } };
    $('#simDone').onclick = () => recordExerciseObserved(plan.minutes, 'demo: full routine observed', { fraction: 1 });
    $('#simPartial').onclick = () => recordExerciseObserved(Math.round(plan.minutes / 2), 'demo: stopped after half of the routine', { fraction: 0.5 });
    $('#simSkip').onclick = () => recordSkip();
    $('#simAuto').onclick = simulateAuto;
    $('#undoAdapt') && ($('#undoAdapt').onclick = async () => { await setAdaptation(null); draw(); });
    $('#guideBtn').onclick = () => session ? endSession(false) : startSession(plan);
    $('#coachBtn').onclick = () => coach ? stopCoach() : startCoach();
  };

  // ---- ORBI-guided session with camera verification (pose tracking) ----
  async function startSession(plan) {
    session = { stop: false, obs: [], cam: null, pose: null, raf: 0 };
    $('#guideBtn').textContent = '■ Stop session';
    // try to open ORBI's RGB eye (webcam) for verification
    const v = $('#exVideo'), ov = $('#exOverlay'); $('#exCam').classList.remove('hidden');
    try { session.cam = await startCamera(v); ov.width = v.videoWidth; ov.height = v.videoHeight; $('#exCamTxt').textContent = 'Loading pose model…'; session.pose = await getPose(); $('#exCamTxt').innerHTML = `ORBI RGB eye: watching your movement ${srcBadge('observed')}`; trackLoop(v, ov); }
    catch (e) { $('#exCamTxt').innerHTML = `Webcam unavailable (${esc(e.message)}) — movement verification is <b>simulated</b> for this session ${srcBadge('simulated')}`; }
    await speak(`Let's start today's session: ${plan.title}. ${plan.items.length} exercises. I'll give you each instruction and my camera will check your movement. Say stop any time.`);
    for (let i = 0; i < plan.items.length; i++) {
      if (!session || session.stop) return;
      view.querySelectorAll('.ex').forEach((e, j) => e.classList.toggle('on', j === i)); $(`#ex${i}`)?.setAttribute('open', '');
      const x = plan.items[i]; $('#guideTxt').textContent = `Exercise ${i + 1} of ${plan.items.length}: ${x.name}`;
      await speak(`Exercise ${i + 1}: ${x.name}. ${x.dose}. ${x.cue}`);
      if (!session || session.stop) return;
      session.win = { active: 0, total: 0 };
      session.fc = session.cam && EX[x.key] ? new FormCoach({ exercise: x.key, previous: prevFor(x.key) }) : null; // form checks where the camera can judge them
      await new Promise(r => { session.wait = r; session.tm = setTimeout(r, 20000); }); // demo pace: 20 s per exercise
      if (!session || session.stop) return;
      if (session.fc) { const fs = session.fc.summary(); session.fc = null; if (fs.reps || fs.hold) { await addRecords([{ type: 'ex_form', value: fs.form ?? 0, source: 'observed', meta: { exercise: fs.exercise, name: fs.name, reps: fs.reps, repSec: fs.repSec ? +fs.repSec.toFixed(2) : null, rom: fs.rom ? +fs.rom.toFixed(1) : null, issues: fs.issues, notes: fs.notes.map(n => n.text), via: 'ORBI RGB eye — guided session' } }]); const el2 = $(`#obs${i}`); if (el2) el2.insertAdjacentHTML('beforeend', ` <span class="pill lv-${fs.form >= 80 ? 'ok' : 'caution'}">form ${fs.form}/100 · ${fs.reps} reps</span>`); } }
      const w = session.win; const frac = session.cam ? (w.total ? w.active / w.total : 0) : 0.7 + Math.random() * 0.3;
      const ok = frac >= 0.3; session.obs.push(ok);
      const el = $(`#obs${i}`); if (el) el.innerHTML = ok ? '<span class="pill lv-ok">movement seen</span>' : '<span class="pill lv-caution">little movement seen</span>';
      if (!ok) await speak(['I didn\'t see much movement on that one. That\'s okay — is something bothering you?', 'You seem to be holding back on this one. If it hurts, tell me and I\'ll adapt it.'][i % 2]);
      else if (i < plan.items.length - 1) await speak(['Good work.', 'Nice form.', 'Keep breathing.', 'That\'s it.'][i % 4] + ' Next one.');
    }
    if (session && !session.stop) endSession(true, plan);
  }
  function trackLoop(v, ov) {
    const ctx = ov.getContext('2d'); let last = null, lastT = 0;
    const tick = () => {
      if (!session || session.stop || !session.cam) return; session.raf = requestAnimationFrame(tick);
      if (v.readyState < 2 || !session.pose) return; const now = performance.now(); if (now - lastT < 66) return; lastT = now;
      let p = null, w = null; try { const res = session.pose.detectForVideo(v, now); p = res.landmarks?.[0] || null; w = res.worldLandmarks?.[0] || null; } catch (e) { /* skip */ }
      if (session.fc) { const st = session.fc.update(p, now, w); if (st.cue && voiceState.state !== 'speaking') speak(st.cue); if (st.note && !session.noteSaid) { session.noteSaid = true; $('#exCamTxt').innerHTML = esc(st.note); } }
      ctx.clearRect(0, 0, ov.width, ov.height); if (!p) return; drawPose(ctx, p, ov.width, ov.height);
      const sw = Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y) || 0.2; const pts = [0, 11, 12, 15, 16, 23, 24].map(i => [p[i].x / sw, p[i].y / sw]);
      if (last && session.win) { const sp = pts.reduce((s, q, i) => s + Math.hypot(q[0] - last[i][0], q[1] - last[i][1]), 0) / pts.length; session.win.total++; if (sp > 0.02) session.win.active++; }
      last = pts;
    };
    tick();
  }
  async function endSession(done, plan) {
    const s = session; session = null; if (s) { s.stop = true; clearTimeout(s.tm); s.wait?.(); cancelAnimationFrame(s.raf); stopCamera(s.cam); }
    $('#exCam')?.classList.add('hidden'); stopSpeaking();
    const n = s?.obs.length || 0, seen = s?.obs.filter(Boolean).length || 0; const fraction = plan ? seen / plan.items.length : n ? seen / n : 0;
    if (s && (n || done)) {
      const mins = Math.round((plan || planFor()).minutes * (done ? fraction : n / Math.max(1, (plan || planFor()).items.length)));
      await recordExerciseObserved(Math.max(1, mins), done ? 'ORBI-guided session' : 'ORBI-guided session stopped early', { fraction: done ? fraction : fraction * 0.5 }, s.cam ? 'observed' : 'simulated');
      speak(done && fraction >= 0.8 ? 'Session complete. Brilliant job — your bones and muscles thank you.' : 'Okay, we stopped early. That still counts for something. If something is bothering you, tell me.');
    } else draw();
  }

  // ---- Form coach: real-time pose analysis of HOW the exercise is done ----
  let coach = null;
  const prevFor = key => { const r = state.records.filter(x => x.type === 'ex_form' && x.meta?.exercise === key).slice(-8); const m = a => a.length ? a.reduce((s2, x) => s2 + x, 0) / a.length : null; return { repSec: m(r.map(x => x.meta.repSec).filter(Boolean)), rom: m(r.map(x => x.meta.rom).filter(Boolean)), form: m(r.map(x => x.value)), n: r.length }; };
  async function startCoach() {
    const v = $('#coachVideo'), ov = $('#coachOverlay'); $('#coachWrap').classList.remove('hidden'); $('#coachSummary').innerHTML = '';
    const want = $('#coachEx').value;
    coach = { fc: new FormCoach({ exercise: want, previous: want !== 'auto' ? prevFor(want) : {} }), cam: null, pose: null, raf: 0, last: null };
    $('#coachBtn').textContent = '■ Stop & save'; $('#coachLive').innerHTML = '<p class="small">Opening the camera…</p>';
    try { coach.cam = await startCamera(v); ov.width = v.videoWidth; ov.height = v.videoHeight; $('#coachLive').innerHTML = '<p class="small">Loading the pose model…</p>'; coach.pose = await getPose(); }
    catch (e) { $('#coachLive').innerHTML = `<div class="callout warn">The form coach needs the webcam: ${esc(e.message)}. Nothing is simulated here.</div>`; const c = coach; coach = null; stopCamera(c?.cam); $('#coachBtn').textContent = '▶ Start form coach'; return; }
    const ctx = ov.getContext('2d'); let lastT = 0, lastVT = -1, n = 0;
    const tick = () => {
      if (!coach) return; coach.raf = requestAnimationFrame(tick);
      if (v.readyState < 2 || v.currentTime === lastVT) return; const now = performance.now(); if (now - lastT < 33) return; lastT = now; lastVT = v.currentTime;
      let res = null; try { res = coach.pose.detectForVideo(v, now); } catch (e) { return; }
      const p = res.landmarks?.[0] || null, w = res.worldLandmarks?.[0] || null;
      ctx.clearRect(0, 0, ov.width, ov.height); if (p) drawPose(ctx, p, ov.width, ov.height);
      // the previous exercise is remembered once the coach recognises it
      if (coach.fc.key && !coach.prevSet && coach.fc.want === 'auto') { coach.fc.previous = prevFor(coach.fc.key); coach.prevSet = true; }
      const st = coach.fc.update(p, now, w); coach.last = st;
      if (st.cue && $('#coachVoice')?.checked && voiceState.state !== 'speaking') speak(st.cue);
      if (st.cue) coach.lastCue = st.cue;
      if (++n % 6 === 0) drawCoach(st);
    };
    tick();
  }
  function drawCoach(st) {
    const el = $('#coachLive'); if (!el) return;
    const lastRep = coach.fc.reps.at(-1);
    el.innerHTML = `<div class="live-grid">
      <div class="live-cell"><div class="ll">Exercise</div><div class="lv">${esc(st.name)}${st.conf && coach.fc.want === 'auto' ? ` <span class="small muted">${Math.round(st.conf * 100)}%</span>` : ''}</div></div>
      <div class="live-cell"><div class="ll">${EX[st.exercise]?.hold ? 'Hold' : 'Repetitions'}</div><div class="lv">${EX[st.exercise]?.hold ? Math.round(st.holdSec || 0) + '<small> s</small>' : st.reps}</div></div>
      <div class="live-cell"><div class="ll">Last repetition</div><div class="lv"><span class="small">${lastRep ? `${lastRep.sec.toFixed(1)} s · ${EX[st.exercise]?.rom || 'range'} ${Math.round(lastRep.rom)}${st.exercise === 'heel' || st.exercise === 'shoulders' ? '' : '°'}` : '—'}</span></div></div>
      <div class="live-cell"><div class="ll">Form</div><div class="lv"><span class="small">${!st.visible ? '<span class="warn-text">can\'t assess</span>' : lastRep ? (lastRep.issues?.length ? lastRep.issues.map(k => esc(ISSUE[k] || k)).join(', ') : '<span class="dot ok"></span>good') : '—'}</span></div></div></div>
      ${st.note ? `<div class="callout warn small" style="margin-top:6px">${esc(st.note)}</div>` : ''}
      ${coach.lastCue ? `<p class="small" style="margin-top:6px">🗣 <b>${esc(coach.lastCue)}</b></p>` : ''}`;
  }
  async function stopCoach() {
    const c = coach; coach = null; if (!c) return; cancelAnimationFrame(c.raf); stopCamera(c.cam); $('#coachBtn').textContent = '▶ Start form coach'; $('#coachWrap').classList.add('hidden');
    const s2 = c.fc.summary();
    if (!s2.exercise || (!s2.reps && !s2.hold) || s2.visibleShare < 0.3) { $('#coachSummary').innerHTML = `<p class="small muted">Not saved — ${!s2.exercise ? 'no exercise was recognised' : s2.visibleShare < 0.3 ? 'your body was not clearly visible most of the time' : 'no complete repetition was seen'}.</p>`; return; }
    const meta = { exercise: s2.exercise, name: s2.name, reps: s2.reps, repSec: s2.repSec ? +s2.repSec.toFixed(2) : null, rom: s2.rom ? +s2.rom.toFixed(1) : null, issues: s2.issues, notes: s2.notes.map(n => n.text), durationSec: Math.round(s2.durationSec), via: 'ORBI RGB eye — pose estimation (Form coach)' };
    const recs = [{ type: 'ex_form', value: s2.form ?? 0, source: 'observed', meta }];
    if (s2.repSec) recs.push({ type: 'ex_rep_s', value: +s2.repSec.toFixed(1), source: 'observed', meta: { exercise: s2.exercise, name: s2.name } });
    if (s2.rom && !['heel', 'shoulders'].includes(s2.exercise)) recs.push({ type: 'ex_rom', value: Math.round(s2.rom), source: 'observed', meta: { exercise: s2.exercise, name: s2.name } });
    await addRecords(recs);
    const iss = Object.entries(s2.issues).filter(([, v]) => v).map(([k, v]) => `${ISSUE[k] || k} ×${v}`);
    $('#coachSummary').innerHTML = `<div class="callout" style="margin-top:8px"><b>${esc(s2.name)}</b> — ${s2.hold ? Math.round(s2.durationSec) + ' s hold' : `${s2.reps} repetitions, ${s2.repSec?.toFixed(1)} s each`}, form ${s2.form ?? '—'}/100 ${srcBadge('observed')}
      <div class="small">${iss.length ? 'Issues: ' + esc(iss.join(' · ')) : 'No form problems detected.'}</div>${s2.notes.length ? `<div class="small warn-text">${s2.notes.map(n => esc(n.text)).join('<br>')}</div>` : ''}<div class="small dim">Saved to your exercise history; recurring changes appear in “Unusual trends explained”.</div></div>`;
    // unusual movement → a natural question, never a diagnosis
    const k = s2.notes.map(n => n.k);
    if (k.includes('slower') || k.includes('fatigue') || k.includes('hesitation') || k.includes('rom')) {
      const what = k.includes('rom') ? 'you weren\'t going as deep as usual' : k.includes('hesitation') ? 'you paused at the bottom a few times' : 'your movement was slower than usual';
      askAstronaut(`I noticed ${what} during your ${s2.name.toLowerCase()}s today. Are you feeling tired, or is something uncomfortable?`, 'exercise_why');
    } else if (k.includes('asym')) askAstronaut(`Your ${s2.name.toLowerCase()}s were a bit uneven between left and right today. Is one side bothering you?`, 'exercise_why');
  }

  async function simulateAuto() {
    const n = (mu, sd) => +(mu + sd * (Math.random() * 2 - 1)).toFixed(1);
    const via = { via: 'ORBI passive observation (simulated)' };
    await addRecords([['hr', n(66, 4)], ['rr', n(14, 1.5)], ['skin_temp', n(34.8, 0.2)], ['puffiness', n(7, 2)], ['move_speed', n(78, 5)], ['reaction_ms', n(295, 25)], ['coordination', n(84, 5)], ['posture', n(82, 6)], ['gaze_stability', n(83, 5)], ['blink_rate', n(15, 3)], ['perclos', n(6, 2.5)]].map(([type, value]) => ({ type, value, source: 'simulated', meta: { ...via, how: { reaction_ms: 'response time to cabin alerts & handrail grabs', coordination: 'hand movements during tasks', posture: 'body alignment while working', gaze_stability: 'eye tracking while reading displays', skin_temp: 'thermal eye', rr: 'thermal eye (nostril temperature)', puffiness: 'RGB face shape vs pre-flight image', move_speed: 'RGB pose tracking' }[type] || 'continuous observation' } })));
    toast('Today\'s automatic ORBI observations added (simulated).');
  }

  draw();
  const startEv = () => { if (!session) startSession(planFor()); }; window.addEventListener('orbi:startExercise', startEv);
  const off = on(w => { if (w === 'records' && !session) draw(); });
  return () => { if (coach) { cancelAnimationFrame(coach.raf); stopCamera(coach.cam); coach = null; } off(); window.removeEventListener('orbi:startExercise', startEv); if (session) { session.stop = true; clearTimeout(session.tm); cancelAnimationFrame(session.raf); stopCamera(session.cam); } stopSpeaking(); };
}
