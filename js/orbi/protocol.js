// ORBI — spoken emergency-protocol runner (shared by the Virtual Body, the AI Camera collapse demo and voice commands).
// 1 recognise → 2 interrupt non-essential activity → 3 alert verbally → 4 start the protocol from the onboard reference
// cards (general first-aid / BLS guidance — the vehicle's approved checklists take precedence) → 5 one step at a time,
// waiting for "next" / "repeat" / "back" / "stop" → 6 read available vital-sign estimates → 7 queue a report to Earth
// and send it when the (simulated) link is available → 8 keep guiding without waiting for Earth.
import { state, saveItem, missionDay } from '../store.js';
import { PROTOCOLS } from '../content/protocols.js';
import { speak, stopSpeaking } from '../voice.js';
import { stop as stopMusic } from '../companion/music.js';
import { toast } from '../ui.js';
import { ONE_WAY_DELAY_MIN } from '../companion/daily.js';

export const run = { active: false, proto: null, step: 0, event: null, organ: null, source: null };
const subs = new Set(); const emitR = () => subs.forEach(f => { try { f(run); } catch (e) { console.error(e); } });
export const onProtocol = fn => { subs.add(fn); return () => subs.delete(fn); };
const CMD = { next: /\b(next|done|ok(ay)?|finished|go on|continue|ready|did it)\b/, repeat: /\b(repeat|again|what|say that|pardon|sorry)\b/, back: /\b(back|previous|go back)\b/, stop: /\b(stop|cancel|end( it)?|false alarm|i'?m fine now|abort)\b/ };
let remind = 0, actx = null;

function alarm() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const t0 = actx.currentTime;
    for (let i = 0; i < 3; i++) { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = i % 2 ? 660 : 880; g.gain.setValueAtTime(0.08, t0 + i * 0.35); g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.35 + 0.3); o.connect(g); g.connect(actx.destination); o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.32); }
  } catch (e) { /* audio unavailable */ }
}
export function latestVitals() {
  const pick = t => state.records.filter(r => r.type === t && Date.now() - r.ts < 6 * 3600e3).at(-1);
  const hr = pick('hr'), rr = pick('rr'), st = pick('skin_temp');
  const lbl = r => r.source === 'estimated' ? 'camera estimate' : r.source === 'simulated' ? 'simulated' : r.source;
  return { hr, rr, st, text: [hr && `heart rate about ${Math.round(hr.value)} (${lbl(hr)})`, rr && `breathing about ${Math.round(rr.value)} per minute (${lbl(rr)})`, st && `skin temperature ${st.value.toFixed(1)} degrees (${lbl(st)})`].filter(Boolean).join(', ') };
}

// ---- link to Mission Control (simulated deep-space link; follows the network unless the crew sets it) ----
export const comm = { manual: null };
export const linkUp = () => comm.manual != null ? comm.manual : navigator.onLine !== false;
const commSubs = new Set(); export const onComm = fn => { commSubs.add(fn); return () => commSubs.delete(fn); };
/** Set the link state (true/false), or null to follow the network. Queued reports are sent when the link returns. */
export async function setLink(v) { comm.manual = v; commSubs.forEach(f => f(linkUp())); if (linkUp()) await flushOutbox(); }
export async function flushOutbox() {
  for (const o of state.outbox.filter(x => x.status === 'queued')) { o.status = 'sent'; o.sentTs = Date.now(); o.note = `Sent when the link returned; arrives in ≈${ONE_WAY_DELAY_MIN} min (light delay)`; await saveItem('outbox', o); }
}
window.addEventListener('online', () => { if (linkUp()) flushOutbox(); commSubs.forEach(f => f(linkUp())); });
window.addEventListener('offline', () => commSubs.forEach(f => f(linkUp())));
export const isProtocolCommand = text => Object.values(CMD).some(re => re.test(text.toLowerCase()));

async function notifyEarth(p, ev, test = false) {
  const link = linkUp();
  const o = await saveItem('outbox', { ts: Date.now(), name: `${test ? '[SIMULATION] ' : ''}URGENT — ${p.title}`, test, kind: 'emergency-report', status: 'queued', eventId: ev.id, html: `<p>${p.title} — protocol started by ORBI at ${new Date().toLocaleTimeString()}.</p>` });
  if (link) setTimeout(async () => { if (!linkUp() || o.status === 'sent') return; o.status = 'sent'; o.sentTs = Date.now(); o.note = `Arrives at Mission Control in ≈${ONE_WAY_DELAY_MIN} min (simulated light delay)`; await saveItem('outbox', o); }, 3000);
  return link;
}

/** Start a protocol. opts: { organ, intro, source: 'voice'|'camera', unresponsive } */
export async function startProtocol(pid, opts = {}) {
  const p = PROTOCOLS.find(x => x.id === pid); if (!p) return;
  clearTimeout(remind); stopMusic(); stopSpeaking(); window.dispatchEvent(new Event('orbi:interrupt'));
  Object.assign(run, { active: true, proto: p, step: 0, organ: opts.organ || p.organs[0], source: opts.source || 'voice' });
  const ev = await saveItem('emergencies', { ts: Date.now(), updated: Date.now(), status: 'active', level: 'emergency', title: `${opts.test ? '[SIMULATION] ' : ''}${p.title} (${opts.source === 'camera' ? 'detected by ORBI cameras' : 'voice-reported'})`, test: !!opts.test, symptoms: [p.title], vitals: {}, protocols: [p.id], organs: p.organs, missionDay: missionDay(), log: [{ ts: Date.now(), text: opts.source === 'camera' ? 'Detected by ORBI (no response to voice check). Protocol started automatically.' : 'Reported by voice; ORBI started the protocol.' }] });
  run.event = ev; emitR(); alarm();
  toast('⚠ ORBI emergency protocol: ' + p.title, true);
  const sent = await notifyEarth(p, ev, !!opts.test);
  const v = latestVitals();
  await speak(`${opts.intro ? opts.intro + ' ' : ''}This could be serious. I'm starting the emergency procedure for ${p.title.toLowerCase()}. I've logged the event${sent ? ' and sent an urgent report to Mission Control. It will take about ' + ONE_WAY_DELAY_MIN + ' minutes to reach Earth, so we won\'t wait — I\'ll guide you now' : '. Earth is out of contact right now; the report is queued and I\'ll guide you now'}. One step at a time. Say "next" when each step is done, or "repeat".${v.text ? ' Latest readings: ' + v.text + '.' : ''}`);
  return sayStep();
}
async function sayStep() {
  clearTimeout(remind); emitR();
  if (!run.active) return;
  const p = run.proto;
  if (run.step >= p.steps.length) {
    await speak(`That was the last step.${p.dont?.length ? ' Remember: ' + p.dont.join(' ') : ''} Keep monitoring, and tell the crew medical officer everything. Say "repeat" to go through it again, or "stop" to end.`);
    run.event.log = [...run.event.log, { ts: Date.now(), text: 'All protocol steps completed.' }]; await saveItem('emergencies', run.event);
    run.step = p.steps.length - 1; emitR(); return;
  }
  const vit = run.step > 0 && run.step % 3 === 0 ? latestVitals().text : '';
  await speak(`Step ${run.step + 1} of ${p.steps.length}. ${p.steps[run.step]}${vit ? ' — Current readings: ' + vit + '.' : ''}`);
  remind = setTimeout(() => { if (run.active) speak('When you\'re ready, say next. Or say repeat.'); }, 40000);
}
/** Handle a spoken command while a protocol is active. Returns true if it was consumed. */
export async function protocolCommand(text) {
  if (!run.active) return false; const s = text.toLowerCase();
  if (CMD.stop.test(s)) { await endProtocol('Stopped by voice'); await speak('Okay, I\'ve stopped the guided procedure. The event stays logged in the Emergency Center.'); return true; }
  if (CMD.back.test(s)) { run.step = Math.max(0, run.step - 1); await sayStep(); return true; }
  if (CMD.repeat.test(s)) { if (/(start|beginning|all)/.test(s)) run.step = 0; await sayStep(); return true; }
  if (CMD.next.test(s)) { run.event.log = [...run.event.log, { ts: Date.now(), text: `Step ${run.step + 1} confirmed by voice.` }]; saveItem('emergencies', run.event); run.step++; await sayStep(); return true; }
  await speak('Say next, repeat, back, or stop.'); return true;
}
export async function endProtocol(reason) { clearTimeout(remind); if (run.event) { run.event.log = [...run.event.log, { ts: Date.now(), text: reason || 'Protocol ended.' }]; await saveItem('emergencies', run.event); } Object.assign(run, { active: false, proto: null, step: 0 }); emitR(); }
