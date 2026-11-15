// ORBI — emergency escalation when the astronaut stops responding AND the camera evidence is worrying (or unclear).
//   1. record the emergency event (with the evidence and how certain it is)
//   2. SOS to Mission Control — sent now if the link is up, otherwise queued and sent automatically when it returns
//   3. crew alarm — loud audible alarm + on-screen alert for crewmates, only if crewmates are on board
//   4. follow the protocol: confirmed collapse / unconsciousness → unresponsive-person protocol (spoken steps);
//      UNCERTAIN → crewmates are asked to check on the astronaut; nothing is invented
//   5. keep monitoring: ORBI keeps calling the astronaut and re-checking the camera every 30 s until someone answers.
// Test runs (SIMULATION) are labelled as such in the event, the SOS and the alarm — and nothing leaves this computer.
import { state, saveItem, missionDay } from '../store.js';
import { linkUp, flushOutbox, startProtocol, run as protoRun } from './protocol.js';
import { speak, stopSpeaking } from '../voice.js';
import { stop as stopMusic } from '../companion/music.js';
import { assessResponsiveness } from './observer.js';
import { toast, esc } from '../ui.js';
import { ONE_WAY_DELAY_MIN } from '../companion/daily.js';

const subs = new Set();
export const escalation = { active: false, event: null, sos: null, alarm: false, level: null, evidence: null, test: false, rechecks: 0 };
const emitE = () => subs.forEach(f => { try { f(escalation); } catch (e) { console.error(e); } });
export const onEscalation = fn => { subs.add(fn); return () => subs.delete(fn); };

let actx = null, siren = null, monitor = 0;
function sirenOn() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    if (siren) return;
    const o = actx.createOscillator(), g = actx.createGain(), lfo = actx.createOscillator(), lg = actx.createGain();
    o.type = 'square'; o.frequency.value = 760; lfo.frequency.value = 1.6; lg.gain.value = 260; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.value = 0.12; o.connect(g); g.connect(actx.destination); o.start(); lfo.start(); siren = { o, lfo, g };
  } catch (e) { /* no audio output */ }
}
function sirenOff() { if (siren) { try { siren.o.stop(); siren.lfo.stop(); } catch (e) { /* stopped */ } siren = null; } }
function banner(html) {
  let el = document.getElementById('crewAlarm');
  if (!html) { el?.remove(); return; }
  if (!el) { document.body.insertAdjacentHTML('beforeend', '<div class="crew-alarm" id="crewAlarm" role="alert"></div>'); el = document.getElementById('crewAlarm'); }
  el.innerHTML = html;
  el.querySelector('#alarmSilence')?.addEventListener('click', () => { sirenOff(); escalation.alarm = false; emitE(); el.querySelector('#alarmSilence').textContent = 'Alarm silenced'; });
  el.querySelector('#alarmResolve')?.addEventListener('click', () => resolveEscalation('Crew confirmed the astronaut is responsive.'));
}

/**
 * Start the escalation. evidence: { status: 'collapse'|'unconscious'|'uncertain', detail, source, simulated }.
 */
export async function escalate(evidence, { context = 'Virtual Body guidance', organ = 'heart' } = {}) {
  if (escalation.active) return escalation;
  const test = !!evidence.simulated;
  const level = evidence.status === 'uncertain' ? 'uncertain' : 'confirmed';
  const crew = state.profile?.crewOnBoard !== false;
  const tag = test ? '[SIMULATION] ' : '';
  Object.assign(escalation, { active: true, level, evidence, test, rechecks: 0, alarm: false });
  stopMusic(); stopSpeaking(); window.dispatchEvent(new Event('orbi:interrupt'));
  // 1) record the event
  const what = level === 'uncertain' ? 'Astronaut not responding — condition UNCERTAIN (camera cannot confirm)' : evidence.status === 'collapse' ? 'Astronaut not responding — possible collapse seen by camera' : 'Astronaut not responding — possibly unconscious (camera)';
  escalation.event = await saveItem('emergencies', { ts: Date.now(), updated: Date.now(), status: 'active', level: 'emergency', title: tag + what, symptoms: ['No response to voice', evidence.detail], vitals: {}, organs: [organ], missionDay: missionDay(), test,
    evidence, log: [{ ts: Date.now(), text: `${tag}${context}: no answer after the final step and the check-in. Camera evidence (${evidence.source}): ${evidence.detail}` }] });
  // 2) SOS to Mission Control
  const up = linkUp();
  escalation.sos = await saveItem('outbox', { ts: Date.now(), name: `${tag}SOS — ${what}`, kind: 'SOS', status: 'queued', eventId: escalation.event.id, test,
    html: `<p><b>${esc(tag)}SOS</b> — ${esc(what)}.</p><p>Evidence: ${esc(evidence.detail)} (${esc(evidence.source)}). Certainty: ${level}.</p><p>ORBI is continuing local emergency procedures.</p>` });
  if (up) await flushOutbox();
  // 3) crew alarm
  if (crew) { sirenOn(); escalation.alarm = true; }
  banner(`<b>${test ? 'SIMULATION — ' : ''}⚠ CREW ALERT</b><div>${esc(what)}.</div><div class="small">${esc(evidence.detail)}</div>
    <div class="small">${up ? `SOS sent to Mission Control${test ? ' (simulated transmission — nothing left this computer)' : ''} · arrives in ≈${ONE_WAY_DELAY_MIN} min` : 'No link to Earth — SOS queued, sent automatically when the link returns'} · ${crew ? 'crew alarm sounding' : 'no crewmates on board — no alarm'}</div>
    <div class="btn-row" style="margin-top:6px">${crew ? '<button class="btn sm" id="alarmSilence">Silence alarm</button>' : ''}<button class="btn sm ok" id="alarmResolve">Astronaut is responsive — stand down</button></div>`);
  toast(`${tag}⚠ Emergency escalation: ${what}`, true);
  emitE();
  // 4) protocol: only start CPR-type guidance when the camera supports it; uncertain → crew must check
  if (level === 'confirmed') await startProtocol('arrest', { source: 'camera', organ, test, intro: `${test ? 'This is a simulation. ' : ''}Crew alert! The astronaut is not responding.` });
  else await speak(`${test ? 'This is a simulation. ' : ''}Crew alert. The astronaut is not answering and my camera cannot tell why. ${crew ? 'Crewmates, please go and check on them now.' : ''} I've ${up ? 'sent' : 'queued'} an SOS for Mission Control.`);
  // 5) keep monitoring
  clearInterval(monitor);
  monitor = setInterval(recheck, 30000);
  return escalation;
}
async function recheck() {
  if (!escalation.active || protoRun.active) return;
  escalation.rechecks++;
  await speak('Can you hear me? Say "I\'m okay" if you can.');
  const ev = escalation.test ? escalation.evidence : await assessResponsiveness({ ms: 4000 });
  escalation.evidence = ev; emitE();
  if (escalation.event) { escalation.event.log = [...escalation.event.log, { ts: Date.now(), text: `Re-check ${escalation.rechecks}: ${ev.detail}` }]; await saveItem('emergencies', escalation.event); }
  if (ev.status === 'responsive') resolveEscalation('Camera shows the astronaut awake again.');
}
/** The astronaut (or a crewmate) confirmed the astronaut is responsive. */
export async function resolveEscalation(reason = 'Astronaut responded.') {
  if (!escalation.active) return;
  clearInterval(monitor); sirenOff(); banner(null);
  if (escalation.event) { escalation.event.status = 'resolved'; escalation.event.log = [...escalation.event.log, { ts: Date.now(), text: reason }]; await saveItem('emergencies', escalation.event); }
  Object.assign(escalation, { active: false, alarm: false });
  emitE();
}
export const stopAlarm = () => { sirenOff(); escalation.alarm = false; emitE(); };
