// ORBITAL — Virtual Body, voice only. The astronaut talks to ORBI freely ("my head has been hurting since yesterday,
// it gets worse when I move"). ORBI understands the whole description, highlights and zooms to the body part while it
// speaks, asks one relevant question at a time (where, how bad, then only what matters), lets the astronaut choose the
// help they want (reasons, solutions, step-by-step guidance, advice, or everything) and uses ORBI's own data.
// Red flags start the shared, spoken step-by-step emergency protocol immediately.
// Brain: the live AI (Claude via the local server) when configured; otherwise the offline engine (js/ai/medical.js),
// clearly labelled as such. The microphone stays open between turns (js/voice.js session manager).
import { $, esc } from '../ui.js';
import { speak, stopSpeaking, support, voiceState, onVoice, isListening, setOwner } from '../voice.js';
import { setBodyHandler, ensureVoice } from '../companion/overlay.js';
import { startProtocol, onProtocol, run as protoRun, protocolCommand } from '../orbi/protocol.js';
import { medicalTurn, medicalSummary, resetMedical, medicalTopic, guidanceEnded } from '../ai/medical.js';
import { Guidance } from '../orbi/guidance.js';
import { assessResponsiveness, simulateEvidence, simulation } from '../orbi/observer.js';
import { escalate, escalation, resolveEscalation, onEscalation } from '../orbi/escalate.js';
import { aiKind, askAI, said, remember, refreshAI, onAI, ai, aiLabel, setBodySummary, clearConversation } from '../ai/brain.js';

const pick2 = a => a[Math.floor(Math.random() * a.length)];
const ORGAN_LAYER = { muscles: 'muscles', bones: 'skeleton', vessels: 'vessels', skin: 'skin' };
const ORGAN_NAME = { brain: 'head', eyes: 'eyes', inner_ear: 'inner ear', ears: 'ears', heart: 'heart', lungs: 'lungs', digestive: 'digestion', kidneys: 'kidneys', bones: 'bones & joints', muscles: 'muscles', skin: 'skin', vessels: 'circulation', blood: 'blood & immunity' };

export async function render(view) {
  view.innerHTML = `
  <div class="vbody">
    <div class="body-canvas vb-canvas" id="bodyCanvas"></div>
    <div class="vb-hud">
      <button class="vb-mic" id="vbMic" aria-label="Talk to ORBI"><span class="orb xl"></span></button>
      <div class="vb-status" id="vbStatus"></div>
      <div class="vb-heard hidden" id="vbHeard"></div>
      <div class="vb-steps hidden" id="vbSteps"></div>
      <div class="vb-guide hidden" id="vbGuide"></div>
      <div class="vb-cap hidden" id="vbCap"></div>
    </div>
    <div class="vb-top"><span class="pill" id="vbAI"></span><span class="pill lv-info hidden" id="vbPart"></span></div>
    <button class="chip vb-cc" id="vbCC" title="Captions">CC</button>
    <button class="chip vb-new" id="vbNew" title="Start a new conversation">New</button>
    <details class="vb-test" id="vbTest"><summary>Safety test</summary>
      <div class="small">Simulates what ORBI's camera would see if you stop answering after guidance. Labelled SIMULATION everywhere; nothing is sent anywhere.</div>
      <label class="small">Camera evidence <select id="vbSim"><option value="">Real camera check</option><option value="collapse">Simulate: collapsed</option><option value="unconscious">Simulate: eyes closed, no movement</option><option value="responsive">Simulate: awake, just silent</option><option value="uncertain">Simulate: can't see the astronaut</option></select></label>
      <label class="small"><input type="checkbox" id="vbFast"> Fast timers (5 s instead of 30 s) for a demo</label>
      <button class="btn sm" id="vbTryGuide">Start a 5-step guidance (neck & shoulders)</button>
    </details>
    <form class="vb-type hidden" id="vbType"><input id="vbIn" placeholder="Voice unavailable — type what you feel" autocomplete="off"><button class="btn sm primary">Ask</button></form>
  </div>`;

  let body = null, captions = false, alive = true, turn = 0, idleTimer = 0;
  try { const { createBody } = await import('../body3d.js'); body = createBody($('#bodyCanvas'), {}); }
  catch (e) { $('#bodyCanvas').innerHTML = '<div class="cam-placeholder">3D view unavailable (WebGL required)</div>'; }
  body?.setLayer('muscles', false);

  const cap = t => { const el = $('#vbCap'); if (!el) return; el.textContent = t; el.classList.toggle('hidden', !captions || !t); };
  const talk = async t => { if (!alive || !t) return; cap(t); await speak(t); };
  let shown = [];
  /** Highlight the body parts being discussed — kept visible while ORBI speaks, changed when the topic changes. */
  const show = (parts, level) => {
    if (!body || !parts?.length) return;
    const p = parts.filter(x => ORGAN_NAME[x]); if (!p.length) return;
    shown = p; clearTimeout(idleTimer);
    body.setLayer('muscles', false); p.forEach(o => { const L = ORGAN_LAYER[o]; if (L) body.setLayer(L, true); });
    body.select(p[0]); body.zoomTo(p[0]);
    body.setHighlights(Object.fromEntries(p.map((o, i) => [o, level || (i ? 'caution' : 'warning')])));
    const el = $('#vbPart'); if (el) { el.textContent = '● ' + p.map(o => ORGAN_NAME[o]).join(' · '); el.classList.remove('hidden'); }
  };
  const reset = () => { shown = []; body?.select(null); body?.setHighlights({}); body?.resetView(); body?.setLayer('muscles', false); $('#vbPart')?.classList.add('hidden'); };
  const stepsUI = r => {
    const el = $('#vbSteps'); if (!el) return;
    if (!r.active) { el.classList.add('hidden'); return; }
    show([r.organ || 'heart'], 'emergency'); el.classList.remove('hidden');
    el.innerHTML = r.proto.steps.map((_, i) => `<i class="${i < r.step ? 'done' : i === r.step ? 'on' : ''}"></i>`).join('');
  };
  const offP = onProtocol(stepsUI); stepsUI(protoRun);
  const syncAI = () => { const el = $('#vbAI'); if (!el) return; el.textContent = aiLabel('body'); el.className = 'pill ' + (aiKind('body') !== 'offline' ? 'lv-ok' : 'lv-caution'); el.title = ai.status === 'live' ? `ORBI is using ${ai.model} through the ORBITAL server.` : (ai.message || '') + ' ORBI uses its built-in offline conversation rules — they understand free speech but are not a large language model.'; };
  const offA = onAI(syncAI); syncAI(); refreshAI();

  // ---------------------------------------------------------------- timed step-by-step guidance
  let guide = null;
  const GSTATE = { SPEAKING_STEP: 'Speaking the step', WAITING_FOR_RESPONSE: 'Waiting for you — say "next" or "repeat"', REPEATING_STEP: 'No answer — repeating the step once', MOVING_TO_NEXT_STEP: 'Moving to the next step', GUIDANCE_COMPLETED: 'All steps done', WAITING_FOR_FINAL_CONFIRMATION: 'Waiting to hear how you feel', CHECKING_ASTRONAUT: 'Checking on you…', EMERGENCY_ESCALATION: 'EMERGENCY ESCALATION', ENDED: 'Guidance ended' };
  function startGuidance(steps, organ) {
    guide?.stop('replaced');
    const fast = $('#vbFast')?.checked;
    guide = new Guidance({
      steps, speak: t => talk(t), waitMs: fast ? 5000 : 30000, checkMs: fast ? 5000 : 20000,
      getEvidence: () => { const sim = $('#vbSim')?.value || null; simulateEvidence(sim); return assessResponsiveness(); },
      onState: (st, info) => {
        const el = $('#vbGuide'); if (!el) return;
        el.classList.toggle('hidden', st === 'ENDED' || st === 'IDLE');
        el.textContent = `${st.includes('STEP') || st === 'WAITING_FOR_RESPONSE' ? `Step ${Math.min(info.step + 1, info.total)} of ${info.total} · ` : ''}${GSTATE[st] || st}`;
        const dots = $('#vbSteps'); if (dots && !protoRun.active) { dots.classList.toggle('hidden', st === 'ENDED'); dots.innerHTML = Array.from({ length: info.total }, (_, i) => `<i class="g ${i < info.step ? 'done' : i === info.step ? 'on' : ''}"></i>`).join(''); }
      },
      onEscalate: ev => { $('#vbGuide').textContent = `⚠ ${ev.status === 'uncertain' ? 'No answer — camera cannot confirm (UNCERTAIN)' : 'No answer — camera: ' + ev.status}`; escalate(ev, { context: 'Virtual Body guidance', organ: organ || 'heart' }); },
      onEnd: () => { guidanceEnded(); if (!protoRun.active) $('#vbSteps')?.classList.add('hidden'); },
    });
    guide.start();
  }
  $('#vbTryGuide').onclick = async () => { resetMedical(); await ensureVoice().catch(() => {}); show(['muscles']); medicalTurn('my neck is stiff'); medicalTurn('uncomfortable'); medicalTurn('it started during exercise'); const r = medicalTurn('guide me step by step'); await talk(r.say.join(' ')); startGuidance(r.guidance || [], 'muscles'); };

  async function handle(text) {
    if (!alive) return;
    const heard = $('#vbHeard'); if (heard) { heard.textContent = '“' + text + '”'; heard.classList.remove('hidden'); }
    // an answer during an escalation means the astronaut is responsive
    if (escalation.active && !protoRun.active) { await resolveEscalation('Astronaut answered by voice: “' + text + '”'); await talk('I hear you — I\'m standing down the alarm. Tell me how you feel.'); return; }
    const my = ++turn; clearTimeout(idleTimer);
    // guidance commands (next / repeat / back / stop) — but an emergency statement always wins
    const topicBefore = medicalTopic();
    if (guide?.active) {
      const wasState = guide.state;
      const handled = await guide.hear(text);
      if (handled) return;
      stopSpeaking();
      // an answer after the last step / to "are you still there?" — the astronaut is responsive
      if (['CHECKING_ASTRONAUT', 'WAITING_FOR_FINAL_CONFIRMATION', 'GUIDANCE_COMPLETED'].includes(wasState) && !/\b(pain|hurt|ache|can'?t|help|dizzy|chest|breath|bleed|faint|numb|weak)\b/i.test(text)) {
        const t = text.toLowerCase();
        return talk(wasState === 'CHECKING_ASTRONAUT' ? 'Good — I hear you. How do you feel?' : /\b(worse|not better|still (hurts|bad))\b/.test(t) ? 'Okay. Since it isn\'t better, please tell the crew medical officer. I\'m here if you need me.' : pick2(['Good — glad that helped. Tell me if it comes back.', 'Great. I\'m here if anything changes.']));
      }
    } else stopSpeaking();
    // Safety first: the rule-based red-flag check runs on every turn, instantly, even when the live AI is used.
    const r = medicalTurn(text);
    let sayText, parts, emergency, steps = null;
    if (r.emergency && r.instant) { sayText = r.intro ? r.say[0] : ''; parts = r.parts; emergency = r.emergency; await remember('body', 'user', text); }
    else {
      const live = await askAI('body', text);
      if (!alive || my !== turn) return;
      if (live) {
        sayText = live.say; parts = live.body_parts || []; emergency = live.emergency && live.emergency !== 'none' ? live.emergency : null;
        if (live.assist_mode === 'guidance' && live.steps?.length) steps = live.steps;
        const f = live.facts || {}; setBodySummary([f.location, f.intensity, f.onset, f.pattern, f.worse_with && 'worse with ' + f.worse_with].filter(Boolean).join(', '));
      } else {
        sayText = r.say.filter(Boolean).join(' '); parts = r.parts; emergency = r.emergency;
        if (r.intro) sayText = r.say[0]; else if (emergency) sayText = '';
        if (r.guidance?.length) steps = r.guidance;
        setBodySummary(medicalSummary());
      }
    }
    if (parts?.length) show(parts, emergency ? 'emergency' : null);
    if (emergency) {
      guide?.stop('emergency'); // emergencies override any guidance immediately
      if (sayText) await said('body', sayText);
      return startProtocol(emergency, { organ: parts?.[0], intro: sayText || undefined, source: 'voice' });
    }
    const newComplaint = guide?.active && medicalTopic() !== topicBefore;
    if (newComplaint) { guide.stop('new complaint'); sayText = 'Okay, stopping the steps. ' + (sayText || ''); }
    if (sayText) { await said('body', sayText); await talk(sayText); }
    if (steps?.length) startGuidance(steps, parts?.[0]);
    else if (guide?.active) guide.resumeWaiting(); // a side question during guidance: answer it, then keep waiting on the step
    idleTimer = setTimeout(() => { if (!protoRun.active && !guide?.active && voiceState.state !== 'speaking') reset(); }, 120000);
  }
  setBodyHandler(handle); setOwner('Virtual Body assistant');
  const mic = $('#vbMic');
  const syncMic = () => {
    mic.classList.toggle('listening', voiceState.listening); mic.classList.toggle('speaking', voiceState.speaking); mic.classList.toggle('thinking', voiceState.processing);
    const st = $('#vbStatus'); if (st) st.textContent = !support.stt ? 'Voice needs Chrome or Edge' : voiceState.state === 'speaking' ? 'ORBI is speaking…' : voiceState.state === 'processing' ? 'Thinking…' : voiceState.state === 'listening' ? (voiceState.interim ? '…' + voiceState.interim.slice(-60) : `Listening — ${voiceState.owner}`) : isListening() ? 'Starting microphone…' : 'Microphone off — tap ORBI';
    if (voiceState.error) $('#vbStatus').textContent = '⚠ ' + voiceState.error;
    $('#vbType')?.classList.toggle('hidden', !(voiceState.fallback || !support.stt));
  };
  $('#vbType').onsubmit = e => { e.preventDefault(); const v = $('#vbIn').value.trim(); if (v) { $('#vbIn').value = ''; protoRun.active ? protocolCommand(v) : handle(v); } };
  const offV = onVoice(syncMic); syncMic();
  mic.onclick = async () => {
    if (voiceState.speaking) { stopSpeaking(); return; }
    if (!support.stt) return talk('Voice recognition needs Google Chrome or Microsoft Edge on this computer. You can type below.');
    if (!isListening()) { await ensureVoice(); if (isListening() && !protoRun.active) talk('I\'m listening. Tell me what you\'re feeling.'); }
  };
  $('#vbCC').onclick = () => { captions = !captions; $('#vbCC').classList.toggle('on', captions); if (!captions) cap(''); };
  $('#vbNew').onclick = async () => { guide?.stop('new conversation'); resetMedical(); await clearConversation('body'); reset(); talk('Okay, fresh start. What\'s bothering you?'); };
  if (!protoRun.active) {
    if (support.stt && !isListening()) ensureVoice().then(ok => { if (ok && alive) talk('Virtual body ready. Tell me what you\'re feeling, in your own words.'); });
    else if (isListening()) setTimeout(() => talk('Virtual body ready. Tell me what you\'re feeling, in your own words.'), 400);
    else setTimeout(() => talk('Voice recognition is not available in this browser. Please open ORBITAL in Google Chrome or Microsoft Edge, or type below.'), 400);
  }
  window.orbitalBodyVoice = t => protoRun.active ? protocolCommand(t) : handle(t); // test hook
  const offE = onEscalation(e => { const el = $('#vbGuide'); if (el && !e.active && guide?.state === 'EMERGENCY_ESCALATION') el.classList.add('hidden'); });
  return () => { alive = false; guide?.stop('page closed'); offE(); clearTimeout(idleTimer); if (!protoRun.active) stopSpeaking(); setBodyHandler(null); setOwner(null); offV(); offP(); offA(); body?.dispose(); delete window.orbitalBodyVoice; };
}
