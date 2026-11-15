// ORBITAL — Emergency Center: ORBI's conversational emergency assistant.
// The astronaut describes what is happening in their own words (voice or text). ORBI — the live AI (Claude via the
// local server) when configured, its offline emergency engine otherwise, and ALWAYS the rule-based red-flag check first —
// gives the immediate life-saving action, asks only what matters (one question at a time), starts the validated
// step-by-step protocol by voice when needed, uses the monitoring data (labelled by source, never invented), logs the
// event, notifies Mission Control when the link allows, and keeps guiding when Earth is unreachable.
// If the astronaut may have collapsed and stops answering, ORBI checks responsiveness and starts the protocol by itself.
// The old symptom checklist and the reference cards stay available as optional shortcuts.
import { state, on, saveItem, latest, missionDay, addRecord } from '../store.js';
import { current } from '../analysis.js';
import { METRICS, srcBadge } from '../metrics.js';
import { PROTOCOLS, RED_FLAGS, PROTOCOL_SCOPE, triage } from '../content/protocols.js';
import { ORGANS } from '../content/organs.js';
import { $, esc, toast, fmtTime, download } from '../ui.js';
import { flag } from '../game.js';
import { speak, stopSpeaking, voiceState, onVoice, isListening, support, setOwner } from '../voice.js';
import { ensureVoice, setEmergencyHandler } from '../companion/overlay.js';
import { startProtocol, onProtocol, run as protoRun, protocolCommand, isProtocolCommand, linkUp, setLink, onComm, comm, flushOutbox } from '../orbi/protocol.js';
import { emergencyTurn, emergencyContext, vitalsSummary, resetEmergency, emergencyState } from '../ai/emergency.js';
import { aiKind, askAI, said, remember, refreshAI, onAI, ai, aiLabel } from '../ai/brain.js';
import { ONE_WAY_DELAY_MIN } from '../companion/daily.js';
import { responsivenessCheck, answerCheck, checking, cancelCheck } from '../orbi/respond.js';

const SEV = { unknown: ['info', 'Listening'], low: ['ok', 'Low concern'], moderate: ['caution', 'Needs attention'], urgent: ['warning', 'Urgent'], life_threatening: ['emergency', 'LIFE-THREATENING'] };
const SHORTCUTS = ['I suddenly have severe chest pain', 'I can\'t breathe properly', 'I feel like I\'m going to faint', 'I fell and I can\'t move my leg', 'I\'m bleeding', 'My crewmate collapsed and isn\'t responding'];

export async function render(view) {
  let alive = true, lastTri = null, activeId = null, silenceTimer = 0, alertLevel = 'unknown', turn = 0;
  const log = []; let symptoms = [], actions = [];
  view.innerHTML = `
  <div class="card emg-status" id="emgStatus"></div>

  <div class="grid g3" style="margin-top:14px">
    <div class="card span2 emg-chat-card">
      <div class="card-h"><h2>ORBI emergency assistant</h2><span class="pill" id="emgAI"></span></div>
      <p class="small muted" style="margin:0 0 8px">Tell ORBI what is happening, in your own words — by voice or typing. ORBI acts first and asks only what it needs. If someone is in danger, also alert the crew and the Crew Medical Officer.</p>
      <div class="chat emg-chat" id="emgChat"></div>
      <div class="emg-listen small" id="emgListen"></div>
      <form id="emgForm" class="btn-row" style="margin-top:8px;flex-wrap:nowrap"><button type="button" class="btn" id="emgMic">🎙 Voice</button><input id="emgIn" placeholder="Describe what is happening…" autocomplete="off"><button class="btn primary">Send</button></form>
      <div class="btn-row small" style="margin-top:8px"><span class="muted">Shortcuts (optional):</span>${SHORTCUTS.map((s, i) => `<button class="chip" data-sc="${i}">${esc(s)}</button>`).join('')}</div>
      <div id="protoBox" class="hidden" style="margin-top:10px"></div>
    </div>
    <div class="emg-side">
      <div class="card"><h2>Current actions</h2><ol class="small emg-actions" id="emgActions"></ol></div>
      <div class="card" style="margin-top:12px"><h2>Symptoms</h2><div id="emgSymptoms" class="small"></div></div>
      <div class="card" style="margin-top:12px"><div class="card-h"><h2>Vital signs</h2><span class="small muted">labelled by source</span></div><div id="emgVitals" class="small"></div></div>
      <div class="card" style="margin-top:12px"><h2>Link to Earth</h2><div id="emgComm" class="small"></div>
        <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="linkToggle"></button><button class="btn sm ghost" id="linkAuto" title="Follow this computer's network">Auto</button></div></div>
    </div>
  </div>

  <div class="card" style="margin-top:14px"><div class="card-h"><h2>Responsiveness check</h2><button class="btn sm danger" id="respBtn">Check on the astronaut now</button></div>
    <p class="small muted" style="margin:0">An unconscious astronaut cannot answer questions. ORBI runs this check by itself when it sees a collapse (AI Camera) or when someone who said they might faint stops answering: it asks “Are you okay?” and, with no answer within 15 seconds, starts the unresponsive-person protocol and alerts Earth.</p>
    <div class="btn-row" style="margin-top:6px"><button class="btn ok hidden" id="respOk">I'm okay</button><span id="respStatus" class="small"></span></div></div>

  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Emergency event history</h2><div id="history"></div>
      <div class="section-title">Reports to Mission Control (store-and-forward)</div><div id="outbox"></div></div>
    <div class="card"><h2>Active event</h2><div id="activeBox"></div>
      <div class="section-title">Contacts</div>
      <ol class="small" style="padding-left:18px;margin:4px 0"><li><b>Crew Medical Officer</b> — call out / intercom immediately.</li><li><b>Commander &amp; crew</b> — assistance and vehicle procedures.</li><li><b>Mission Control / flight surgeon</b> — one-way delay ≈${ONE_WAY_DELAY_MIN} min in this mission. <b>Never wait</b> for a reply before starting first aid.</li></ol></div>
  </div>

  <details class="card" style="margin-top:14px" id="quickCheck"><summary><b>Quick symptom checklist</b> <span class="small muted">— optional shortcut; fixed safety rules</span></summary>
    ${[...new Set(RED_FLAGS.map(r => r.group))].map(g => `<div class="section-title" style="margin:10px 0 6px">${g}</div><div class="sym-grid">${RED_FLAGS.filter(r => r.group === g).map(r => `<label class="sym"><input type="checkbox" value="${r.id}"> ${r.label}</label>`).join('')}</div>`).join('')}
    <div class="section-title" style="margin:12px 0 6px">Device readings ${srcBadge('manual')}</div>
    <div class="form-grid"><div class="field"><label>SpO₂ %</label><input id="vSpo2" type="number"></div><div class="field"><label>Heart rate</label><input id="vHr" type="number"></div><div class="field"><label>BP systolic</label><input id="vSys" type="number"></div><div class="field"><label>Temp °C</label><input id="vTemp" type="number" step="0.1"></div></div>
    <div id="triOut"></div></details>

  <details class="card" style="margin-top:14px"><summary><b>Emergency reference cards</b> <span class="small muted">— the validated steps ORBI speaks</span></summary>
    <div class="callout warn small" style="margin:10px 0">${esc(PROTOCOL_SCOPE)}</div>
    <div id="protoList">${PROTOCOLS.map(p => protoHTML(p)).join('')}</div></details>`;

  function protoHTML(p, open = false) {
    return `<details class="protocol" id="proto-${p.id}" ${open ? 'open' : ''}><summary><span>${esc(p.title)}</span><span class="small muted">▾</span></summary><div class="pb">
      <p class="small"><b>Recognise:</b> ${esc(p.when)}</p><ol>${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${p.dont?.length ? `<p class="small danger-text"><b>Do not:</b> ${p.dont.map(esc).join(' ')}</p>` : ''}
      <div class="btn-row"><button class="btn sm danger" data-start="${p.id}">▶ Start with ORBI's voice</button></div>
      <div class="src-note">Source basis: ${esc(p.src)} · Reference only — follow vehicle checklists &amp; CMO.</div></div></details>`;
  }

  // ---------------------------------------------------------------- conversation
  const chat = () => { const el = $('#emgChat'); if (!el) return; el.innerHTML = log.map(m => `<div class="msg ${m.who}">${esc(m.text)}</div>`).join('') || '<div class="msg sys">ORBI is ready. Describe the emergency — for example “I suddenly have severe chest pain”.</div>'; el.scrollTop = el.scrollHeight; };
  const add = (who, text) => { if (!text) return; log.push({ who, text }); chat(); };
  async function orbiSays(text) { if (!text || !alive) return; add('bot', text); await said('emergency', text); await speak(text); }

  async function handle(text) {
    if (!alive) return;
    const t = text.trim(); if (!t) return;
    clearTimeout(silenceTimer);
    if (checking()) { add('me', t); if (/\b(i'?m (ok|okay|fine|here)|okay|yes)\b/i.test(t)) answerCheck(); return; }
    add('me', t);
    // protocol running: its commands go to the protocol runner, anything else to the assistant
    if (protoRun.active && isProtocolCommand(t) && t.split(/\s+/).length <= 4) return protocolCommand(t);
    const my = ++turn; stopSpeaking();
    // 1) rule-based red-flag check — instant, always
    const r = await emergencyTurn(t, { protocolActive: protoRun.active ? protoRun.proto.id : false });
    let reply = r, src = 'rules';
    // 2) the live AI for everything that is not an instant rule-based emergency
    if (!r.protocol) {
      add('sys', 'ORBI is thinking…');
      const live = await askAI('emergency', t, { extra: emergencyContext(linkUp(), protoRun), timeout: 15000 });
      log.splice(log.findIndex(m => m.text === 'ORBI is thinking…'), 1); chat();
      if (my !== turn || !alive) return;
      if (live) { reply = { say: live.say, protocol: live.protocol && live.protocol !== 'none' ? live.protocol : null, severity: live.severity, symptoms: live.symptoms, actions: live.actions, watchSilence: live.watch_for_collapse }; src = 'ai'; }
    } else await remember('emergency', 'user', t);
    if (reply.symptoms?.length) symptoms = [...new Set(reply.symptoms)];
    if (reply.actions?.length) actions = reply.actions.filter(Boolean);
    if (reply.severity) alertLevel = reply.severity;
    drawSide();
    if (reply.protocol && !(protoRun.active && protoRun.proto.id === reply.protocol)) {
      if (reply.say) add('bot', reply.say);
      await logConversationEvent(reply);
      await startProtocol(reply.protocol, { intro: reply.say || undefined, source: 'voice' });
      add('sys', `▶ Protocol started: ${PROTOCOLS.find(p => p.id === reply.protocol)?.title}. Say "next", "repeat", "back" or "stop".`);
    } else await orbiSays(reply.say);
    if (src === 'rules' && ai.status === 'live' && ai.lastError) add('sys', '⚠ Live AI unavailable for this turn (' + ai.lastError + ') — ORBI answered with its offline emergency rules.');
    // someone who might pass out and then goes silent cannot answer: check on them
    if (reply.watchSilence && isListening()) silenceTimer = setTimeout(() => { if (alive && !protoRun.active && voiceState.state === 'listening') runCheck('You went quiet'); }, 30000);
  }
  async function logConversationEvent(reply) {
    const prev = activeId ? state.emergencies.find(e => e.id === activeId && e.status === 'active') : null;
    if (prev) { prev.log = [...(prev.log || []), { ts: Date.now(), text: 'Assistant: ' + (reply.say || 'protocol started') }]; prev.symptoms = symptoms; await saveItem('emergencies', prev); }
  }
  setEmergencyHandler(handle); setOwner('Emergency assistant');

  // ---------------------------------------------------------------- responsiveness check
  function runCheck(reason = 'ORBI is checking on you') {
    $('#respOk').classList.remove('hidden'); $('#respBtn').disabled = true; add('sys', '⚠ Responsiveness check: ORBI asks “Are you okay?” — 15 s to answer.');
    responsivenessCheck({ seconds: 15, reason, onTick: s => { const el = $('#respStatus'); if (el) el.innerHTML = `<b class="danger-text">Waiting for a response… ${s} s</b>`; },
      onDone: ok => { if (!alive) return; $('#respOk').classList.add('hidden'); $('#respBtn').disabled = false; $('#respStatus').textContent = ok ? 'The astronaut responded.' : 'No response — the unresponsive-person protocol started automatically.'; add('sys', ok ? 'Astronaut responded.' : '⚠ No response → unresponsive-person protocol started, Mission Control notified.'); if (!ok) { alertLevel = 'life_threatening'; symptoms = [...new Set([...symptoms, 'Not responding'])]; drawSide(); } } });
  }
  $('#respBtn').onclick = () => runCheck();
  $('#respOk').onclick = () => answerCheck();

  // ---------------------------------------------------------------- side panels
  function drawSide() {
    const ev = state.emergencies.filter(e => e.status === 'active').sort((a, b) => b.ts - a.ts)[0];
    if (ev && !activeId) activeId = ev.id;
    const level = protoRun.active ? 'life_threatening' : alertLevel;
    const [cls, lbl] = SEV[level] || SEV.unknown;
    $('#emgStatus').className = 'card emg-status lv-' + cls;
    $('#emgStatus').innerHTML = `<div class="card-h" style="margin:0"><h2>${protoRun.active ? '⚠ EMERGENCY IN PROGRESS' : ev ? '⚠ Active emergency event' : level === 'unknown' ? '✚ No emergency in progress' : '✚ Emergency assessment'}</h2><span class="pill lv-${cls}">${lbl}</span></div>
      <div class="small" style="margin-top:4px">${protoRun.active ? `<b>${esc(protoRun.proto.title)}</b> — step ${Math.min(protoRun.step + 1, protoRun.proto.steps.length)} of ${protoRun.proto.steps.length}: ${esc(protoRun.proto.steps[protoRun.step] || '')}` : ev ? `${esc(ev.title)} · started ${fmtTime(ev.ts)}` : 'ORBI is ready. Everything here works offline; Earth is notified when the link allows.'}</div>`;
    const acts = protoRun.active ? [`Step ${protoRun.step + 1}: ${protoRun.proto.steps[protoRun.step]}`, 'Say “next” when done, “repeat”, “back”, or “stop”', 'Alert the crew medical officer and crewmates'] : actions.length ? actions : ['Describe what is happening to ORBI'];
    $('#emgActions').innerHTML = acts.map(a => `<li>${esc(a)}</li>`).join('');
    $('#emgSymptoms').innerHTML = symptoms.length ? symptoms.map(s => `<span class="pill lv-${cls === 'info' ? 'info' : cls}" style="margin:2px">${esc(s)}</span>`).join(' ') : '<span class="muted">None reported yet.</span>';
    const v = vitalsSummary();
    $('#emgVitals').innerHTML = v.length ? v.map(x => `<div class="kvrow"><span>${esc(x.label)}</span><span><b>${(Math.round(x.value * 10) / 10)}</b> ${esc(x.unit)} ${srcBadge(x.src)} <span class="dim">${Math.round((Date.now() - x.ts) / 60000)} min</span></span></div>`).join('') + '<p class="dim" style="margin:6px 0 0">Camera values are estimates; simulated values are demo data. Say a reading aloud (“my oxygen is 94”) to add it as reported.</p>' : '<span class="muted">No recent measurements. Use the pulse oximeter and tell ORBI the numbers.</span>';
    const up = linkUp(); const q = state.outbox.filter(o => o.status === 'queued').length; const lastSent = state.outbox.filter(o => o.status === 'sent').sort((a, b) => (b.sentTs || 0) - (a.sentTs || 0))[0];
    $('#emgComm').innerHTML = `<div><span class="dot ${up ? 'ok' : 'warning'}"></span><b>${up ? 'Link available' : 'No link to Earth'}</b>${comm.manual != null ? ' <span class="dim">(set manually)</span>' : ''}</div>
      <div class="muted">One-way delay ≈${ONE_WAY_DELAY_MIN} min · ${q} report${q === 1 ? '' : 's'} queued${lastSent ? ` · last sent ${fmtTime(lastSent.sentTs)}` : ''}</div>
      ${up ? '' : '<div class="warn-text">ORBI keeps guiding without Earth; reports are sent automatically when the link returns.</div>'}`;
    $('#linkToggle').textContent = up ? 'Simulate loss of signal' : 'Restore link';
    const hist = state.emergencies.slice().sort((a, b) => b.ts - a.ts);
    $('#history').innerHTML = hist.length ? `<div class="table-wrap" style="max-height:280px"><table class="table"><tr><th>When</th><th>Event</th><th>Status</th><th></th></tr>${hist.map(e => `<tr><td>${fmtTime(e.ts)}<div class="dim small">Day ${e.missionDay ?? '—'}</div></td><td>${esc(e.title)}<div class="small muted">${esc((e.symptoms || []).join(', '))}</div></td><td><span class="pill lv-${e.status === 'active' ? 'emergency' : 'ok'}">${e.status}</span></td><td><button class="btn sm ghost" data-rep="${e.id}">Report</button></td></tr>`).join('')}</table></div>` : '<p class="muted small">No emergency events recorded.</p>';
    view.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => report(state.emergencies.find(e => e.id === b.dataset.rep)));
    const ob = state.outbox.slice().sort((a, b) => b.ts - a.ts).slice(0, 8);
    $('#outbox').innerHTML = ob.length ? ob.map(o => `<div class="task"><span class="tx small"><b>${esc(o.name)}</b><br><span class="muted">${o.kind} · ${fmtTime(o.ts)}${o.note ? ' · ' + esc(o.note) : ''}</span></span><span class="pill ${o.status === 'sent' ? 'lv-ok' : 'lv-caution'}">${o.status}</span></div>`).join('') : '<p class="muted small">Queue empty.</p>';
    const a = activeId ? state.emergencies.find(e => e.id === activeId && e.status === 'active') : null;
    $('#activeBox').innerHTML = a ? `<div class="alert-item emergency"><b>${esc(a.title)}</b><div class="small muted">${fmtTime(a.ts)} · ${(a.organs || []).map(o => ORGANS[o]?.name || o).join(', ')}</div>
      <div class="small" style="max-height:120px;overflow:auto;margin-top:4px">${(a.log || []).slice(-6).map(l => `<div>${fmtTime(l.ts)} — ${esc(l.text)}</div>`).join('')}</div>
      <form id="noteForm" class="btn-row" style="margin-top:6px;flex-wrap:nowrap"><input id="noteIn" placeholder="Add log entry (e.g. CMO notified 14:02)"><button class="btn sm">Add</button></form>
      <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="resolveBtn">Mark resolved</button><button class="btn sm" id="actRep">Report</button><a class="btn sm" href="#/body">Virtual Body</a></div></div>` : '<p class="muted small">No active event.</p>';
    if (a) {
      $('#noteForm').onsubmit = async e => { e.preventDefault(); const t = $('#noteIn').value.trim(); if (!t) return; a.log = [...(a.log || []), { ts: Date.now(), text: t }]; await saveItem('emergencies', a); };
      $('#resolveBtn').onclick = async () => { a.status = 'resolved'; a.log = [...(a.log || []), { ts: Date.now(), text: 'Marked resolved.' }]; await saveItem('emergencies', a); activeId = null; alertLevel = 'unknown'; symptoms = []; actions = []; resetEmergency(); if (protoRun.active) protocolCommand('stop'); drawSide(); toast('Event marked resolved.'); };
      $('#actRep').onclick = () => report(a);
    }
    const st = $('#emgAI'); st.textContent = aiLabel('emergency'); st.className = 'pill ' + (aiKind('emergency') !== 'offline' ? 'lv-ok' : 'lv-caution'); st.title = ai.status === 'live' ? `Conversation by ${ai.model}; red flags are also checked by fixed safety rules.` : 'Offline emergency rules (not a live AI): they understand free descriptions and follow validated protocols.';
  }
  const drawProto = r => {
    const box = $('#protoBox'); if (!box) return;
    if (!r.active) { box.classList.add('hidden'); drawSide(); return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="callout warn"><b>${esc(r.proto.title)}</b> — step ${Math.min(r.step + 1, r.proto.steps.length)} of ${r.proto.steps.length} (spoken by ORBI)
      <ol class="small" style="margin:6px 0 0">${r.proto.steps.map((s, i) => `<li style="${i === r.step ? 'color:#fff;font-weight:700' : 'opacity:.6'}">${esc(s)}</li>`).join('')}</ol>
      <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="pNext">Next</button><button class="btn sm" id="pRep">Repeat</button><button class="btn sm" id="pStop">Stop</button></div></div>`;
    $('#pNext').onclick = () => protocolCommand('next'); $('#pRep').onclick = () => protocolCommand('repeat'); $('#pStop').onclick = () => protocolCommand('stop');
    drawSide();
  };

  // ---------------------------------------------------------------- optional checklist (kept as a shortcut)
  function vitalsIn() { const n = id => { const v = parseFloat($('#' + id).value); return Number.isFinite(v) ? v : null; }; return { spo2: n('vSpo2'), hr: n('vHr'), sys: n('vSys'), temp: n('vTemp') }; }
  async function evaluateChecklist() {
    const sel = [...view.querySelectorAll('.sym input:checked')].map(i => i.value); const v = vitalsIn();
    const t = triage(sel, v); lastTri = { ...t, sel, v };
    const out = $('#triOut');
    if (!sel.length && !Object.values(v).some(x => x != null)) { out.innerHTML = ''; return; }
    const protos = [...new Set(t.findings.map(f => f.protocol))].map(id => PROTOCOLS.find(p => p.id === id));
    out.innerHTML = `<div class="emg-result ${t.level === 'emergency' ? 'emergency' : t.level === 'warning' ? 'warning' : 'ok'}" style="margin-top:10px">
      <h3 style="margin:0 0 6px">${t.level === 'emergency' ? '⚠ POSSIBLE EMERGENCY — act now' : t.level === 'warning' ? 'Urgent medical attention advised' : 'No red-flag combination detected'}</h3>
      ${t.findings.map(f => `<div>• <b>${esc(f.text)}</b></div>`).join('') || '<div class="small">Continue monitoring. If you are worried, contact the CMO anyway.</div>'}
      <div class="btn-row" style="margin-top:8px">${protos.map(p => `<button class="btn danger sm" data-start="${p.id}">▶ ${esc(p.title)} with ORBI</button>`).join('')}<button class="btn sm" id="logEvt">Log event</button><button class="btn sm" id="repBtn">Generate report</button></div></div>`;
    $('#logEvt').onclick = () => logChecklistEvent(); $('#repBtn').onclick = () => report();
    out.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startFromCard(b.dataset.start));
    if (t.level === 'emergency' && !activeId) await logChecklistEvent(true);
  }
  view.querySelectorAll('.sym input, #vSpo2, #vHr, #vSys, #vTemp').forEach(i => i.addEventListener('input', evaluateChecklist));
  async function logChecklistEvent(auto = false) {
    if (!lastTri) return;
    const protos = [...new Set(lastTri.findings.map(f => f.protocol))];
    const organs = [...new Set(protos.flatMap(id => PROTOCOLS.find(p => p.id === id).organs))];
    const prev = activeId ? state.emergencies.find(e => e.id === activeId) : null;
    const ev = { ...(prev || {}), id: activeId || undefined, ts: prev?.ts || Date.now(), updated: Date.now(), status: 'active', level: lastTri.level,
      title: lastTri.findings[0]?.text || 'Emergency event', symptoms: lastTri.sel.map(id => RED_FLAGS.find(r => r.id === id)?.label), vitals: lastTri.v, protocols: protos, organs, missionDay: missionDay(),
      log: [...(prev?.log || []), { ts: Date.now(), text: auto ? 'Event auto-logged (emergency-level combination).' : 'Event logged/updated by crew.' }], snapshot: snapshot() };
    const saved = await saveItem('emergencies', ev); activeId = saved.id;
    for (const [k, t] of [['spo2', 'spo2'], ['hr', 'hr'], ['sys', 'bp_sys'], ['temp', 'temp']]) if (lastTri.v[k] != null && !prev) await addRecord(t, lastTri.v[k], 'manual', { context: 'emergency' });
    toast(auto ? '⚠ Emergency event logged locally.' : 'Emergency event saved.', true);
  }
  async function startFromCard(pid) { await ensureVoice().catch(() => {}); add('sys', '▶ Protocol started from the reference card.'); await startProtocol(pid, { source: 'voice' }); }
  view.querySelectorAll('#protoList [data-start]').forEach(b => b.onclick = () => startFromCard(b.dataset.start));
  view.querySelectorAll('.protocol').forEach(d => d.addEventListener('toggle', () => { if (d.open) flag('protocols'); }));

  // ---------------------------------------------------------------- reports
  function snapshot() {
    return ['hr', 'spo2', 'bp_sys', 'temp', 'rr', 'env_co2', 'env_o2', 'env_rad'].map(k => { const r = latest(k); return r ? { type: k, value: r.value, ts: r.ts, source: r.source } : null; }).filter(Boolean);
  }
  function reportHTML(ev) {
    const p = state.profile || {};
    const alerts = current().alerts.filter(a => a.level !== 'info').slice(0, 8);
    return `<!doctype html><html><head><meta charset="utf-8"><title>ORBITAL emergency report</title><style>body{font:14px system-ui;margin:30px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 6px;text-align:left}small{color:#555}</style></head><body>
      <h1>ORBITAL — Medical Event Report</h1><small>Generated ${new Date().toISOString()} · Prototype decision-support output · Not a diagnosis</small>
      <h2>Crew member</h2><p>${esc(p.name)} (${esc(p.callsign)}), ${esc(p.role)} · Mission ${esc(p.missionName)} · Day ${missionDay() ?? '—'}</p>
      ${ev ? `<h2>Event</h2><p><b>${esc(ev.title)}</b> — level ${ev.level}, status ${ev.status}, started ${new Date(ev.ts).toISOString()}</p><p>Symptoms: ${esc((ev.symptoms || []).join('; ') || '—')}</p>
      <h3>Event log</h3><ul>${(ev.log || []).map(l => `<li>${new Date(l.ts).toISOString()} — ${esc(l.text)}</li>`).join('')}</ul>` : '<p>No specific event — status report.</p>'}
      <h2>Conversation with ORBI</h2><ul>${log.filter(m => m.who !== 'sys').map(m => `<li><b>${m.who === 'me' ? 'Astronaut' : 'ORBI'}:</b> ${esc(m.text)}</li>`).join('') || '<li>—</li>'}</ul>
      <h2>Latest available measurements</h2><table><tr><th>Indicator</th><th>Value</th><th>Time</th><th>Source</th></tr>${(ev?.snapshot || snapshot()).map(s => `<tr><td>${METRICS[s.type].label}</td><td>${s.value.toFixed(METRICS[s.type].dec)} ${METRICS[s.type].unit}</td><td>${new Date(s.ts).toISOString()}</td><td>${s.source}</td></tr>`).join('')}</table>
      <h2>Active ORBITAL alerts</h2><ul>${alerts.map(a => `<li><b>${esc(a.title)}</b> (${a.level}) — ${esc(a.what)}</li>`).join('') || '<li>None</li>'}</ul>
      <p><small>Data-source labels: observed = camera; estimated = camera estimate; reported = said by the astronaut; manual = device reading typed in; imported = from file; simulated = synthetic demo data (not real).</small></p></body></html>`;
  }
  async function report(ev = activeId ? state.emergencies.find(e => e.id === activeId) : null) {
    const html = reportHTML(ev);
    const name = `orbital-report-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
    download(name, html, 'text/html');
    const o = await saveItem('outbox', { ts: Date.now(), name, kind: ev ? 'emergency-report' : 'status-report', status: 'queued', eventId: ev?.id || null, html });
    if (linkUp()) await flushOutbox();
    await flag('exported');
    toast(linkUp() ? 'Report saved and sent to Mission Control.' : 'Report saved and queued — it will be sent when the link returns.');
    void o;
  }

  // ---------------------------------------------------------------- wiring
  $('#emgForm').onsubmit = e => { e.preventDefault(); const v = $('#emgIn').value.trim(); if (!v) return; $('#emgIn').value = ''; handle(v); };
  view.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => handle(SHORTCUTS[+b.dataset.sc]));
  $('#emgMic').onclick = async () => { if (voiceState.speaking) return stopSpeaking(); await ensureVoice(); syncMic(); };
  $('#linkToggle').onclick = async () => { await setLink(!linkUp()); add('sys', linkUp() ? '📡 Link to Earth restored — queued reports sent.' : '📡 Link to Earth lost (simulated). ORBI continues on its own.'); drawSide(); };
  $('#linkAuto').onclick = async () => { await setLink(null); drawSide(); };
  function syncMic() {
    $('#emgMic')?.classList.toggle('primary', isListening());
    const el = $('#emgListen'); if (!el) return;
    el.textContent = !support.stt ? 'Voice needs Chrome or Edge — type instead.' : voiceState.error ? '⚠ ' + voiceState.error : voiceState.state === 'listening' ? (voiceState.interim ? '…' + voiceState.interim.slice(-80) : `🎙 Listening — ${voiceState.owner}`) : voiceState.state === 'processing' ? 'Thinking…' : voiceState.state === 'speaking' ? 'ORBI is speaking…' : 'Voice off — press 🎙';
  }
  const offs = [onVoice(syncMic), onProtocol(drawProto), onAI(drawSide), onComm(() => drawSide()), on(w => { if (['emergencies', 'outbox', 'records'].includes(w)) drawSide(); })];
  chat(); drawSide(); drawProto(protoRun); syncMic(); refreshAI();
  window.orbitalEmergencySay = t => handle(t); // test hook
  return () => { alive = false; clearTimeout(silenceTimer); cancelCheck(); setEmergencyHandler(null); setOwner(null); offs.forEach(f => f()); delete window.orbitalEmergencySay; };
}
