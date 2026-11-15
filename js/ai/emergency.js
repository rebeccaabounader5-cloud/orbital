// ORBI — offline emergency-response engine (used when the live AI is unavailable, and ALWAYS for instant red flags).
// It understands free descriptions of an emergency, gives the first life-saving actions immediately, asks only the most
// relevant question (one at a time), adapts to the answers and decides when to start a validated step-by-step protocol
// (content/protocols.js). It is not a language model and ORBITAL labels it as such. It never diagnoses.
import { state, latest, addRecord } from '../store.js';
import { EARTH_BASELINE } from '../companion/content.js';
import { assess } from '../companion/wellbeing.js';

const lc = s => s.toLowerCase().replace(/[’]/g, "'");
const YES = /\b(yes|yeah|yep|it is|it does|it did|i do|i am|i can'?t|i have|correct|a lot|really bad|getting worse|worse)\b/;
const NO = /\b(no|nope|not really|it'?s not|it isn'?t|it doesn'?t|i don'?t|i didn'?t|i can|none|nothing|fine|better)\b/;
const recent = (t, h) => { const r = latest(t); return r && Date.now() - r.ts < h * 3600e3 ? r : null; };
const SRC = { estimated: 'a camera estimate', observed: 'observed by camera', simulated: 'a simulated demo value', reported: 'reported by you', manual: 'a device reading entered manually', imported: 'from a connected device' };

// ---------------------------------------------------------------- situations
// immediate: spoken at once (before any question). ask: [question, answer-check → protocol id or null].
const S = [
  { id: 'arrest', match: /\b(not breathing|isn'?t breathing|no pulse|unconscious|unresponsive|not responding|won'?t wake|collapsed and)\b/, protocol: 'arrest', severity: 'life_threatening', label: 'Unresponsive person' },
  { id: 'stroke', unless: /\b(fell|fall|fallen|hit|twist\w*|injur\w*|crash\w*|broke\w*|fractur\w*|bumped|landed|sprain\w*)\b/, match: /(face (is )?droop|can'?t (move|feel) (my )?(arm|leg|face)|slurred|can'?t speak|numb(ness)? on one side|one side .*(weak|numb)|sudden(ly)? (can'?t see|blind|double vision|confus))/, protocol: 'stroke', severity: 'life_threatening', label: 'Possible stroke signs' },
  { id: 'toxic', match: /\b(smoke|fire|fumes|ammonia|toxic|chemical smell|burning smell|alarm (is )?going off)\b/, protocol: 'breathing', severity: 'life_threatening', label: 'Possible toxic atmosphere', immediate: 'Put on your emergency breathing mask now and move away from the source.' },
  { id: 'allergy', match: /(swollen (lips|tongue|throat|face)|throat (is )?(closing|swelling|tight)|anaphyla|allergic reaction)/, protocol: 'anaphylaxis', severity: 'life_threatening', label: 'Severe allergic reaction' },
  { id: 'crisis', match: /(suicid|kill myself|end my life|hurt myself|self.?harm|want to die)/, protocol: 'crisis', severity: 'urgent', label: 'Mental-health crisis' },
  { id: 'chest', match: /(chest\b.{0,25}\b(pain|pressure|tight\w*|hurt\w*|ache\w*|heavy|squeez\w*)|pain in my chest|heart attack|crushing|squeez\w* (in|on) my chest|my heart (hurts|is racing))/, severity: 'urgent', label: 'Chest pain',
    severe: /(sudden\w*|severe|crushing|squeez|worst|spread\w*|\barm\b|jaw|sweat|can'?t breathe|short of breath|heart attack)/, protocol: 'chest',
    immediate: 'Stop what you are doing and hold still at a restraint. Breathe slowly.',
    ask: [['Does the pain spread to your arm, jaw or back, or are you sweating or short of breath?', 'chest'], ['When did it start, and is it getting worse?', null], ['Are you feeling dizzy or faint?', 'chest']] },
  { id: 'breath', match: /(can'?t breathe|cannot breathe|struggling to breathe|short of breath|hard to breathe|difficulty breathing|trouble breathing|choking|suffocat|out of breath)/, severity: 'urgent', label: 'Breathing difficulty',
    severe: /(can'?t (talk|speak)|blue|gasping|worse|really bad|choking)/, protocol: 'breathing',
    immediate: 'Sit upright, move next to an air vent, and put on an oxygen mask if one is in reach.',
    ask: [['Can you speak in full sentences?', 'breathing', true], ['Are your lips or fingertips turning blue, or did any alarm go off?', 'breathing'], ['Did it start suddenly, or during exercise?', null]] },
  { id: 'bleeding', match: /\b(bleed\w*|blood|cut myself|deep cut|gash|wound)\b/, severity: 'urgent', label: 'Bleeding',
    severe: /(spurt|won'?t stop|a lot|heavy|soak|pouring|everywhere)/, protocol: 'bleeding',
    immediate: 'Press a gauze pad or cloth firmly on the wound right now and keep pressing.',
    ask: [['Is the blood spurting, or soaking through what you are pressing with?', 'bleeding'], ['Where is the wound?', null]] },
  { id: 'faint', match: /(faint|pass(ing)? out|black(ing)? out|light.?headed|going to collapse|about to collapse|room is spinning|very dizzy)/, severity: 'urgent', label: 'Feeling faint',
    immediate: 'Secure yourself to a restraint or lie flat in your sleeping station now, so you cannot be hurt if you pass out.',
    ask: [['Do you have any chest pain or trouble breathing?', 'chest'], ['Have you eaten and had water today?', null]], watchSilence: true },
  { id: 'head', match: /(hit my head|head injury|banged my head|knocked my head)/, protocol: 'head', severity: 'urgent', label: 'Head injury', severe: /(confus|vomit|threw up|passed out|blacked out|worst|sleepy|can'?t remember)/,
    immediate: 'Hold still and don\'t move your neck.', ask: [['Did you lose consciousness, or do you feel confused, sick or very sleepy?', 'head']] },
  { id: 'injury', match: /(\bfell\b|\bfall\b|hit my|banged|crash\w*|can'?t move my (leg|arm|foot|hand)|broke|broken|fracture|twisted|dislocat|crushed my)/, severity: 'moderate', label: 'Injury',
    immediate: 'Keep still and don\'t move the injured part.',
    ask: [['Did you hit your head, or do you feel numbness or tingling anywhere?', 'head'], ['Is it bleeding, or is the limb an odd shape?', 'bleeding'], ['How bad is the pain from zero to ten?', null]],
    after: ['Support the injured limb in the position you found it, padding it with clothing.', 'Apply a cold pack from the medical kit, wrapped in cloth, for fifteen minutes.', 'Don\'t push off or put load on it.', 'The crew medical officer should examine it — a possible fracture needs a splint from the medical kit.'] },
  { id: 'burn', match: /\bburn(ed|t|s)?\b/, protocol: 'burn', severity: 'moderate', label: 'Burn', severe: /(electric|chemical|large|big|blister\w* all|face|hands)/,
    immediate: 'Cool the burn with cool clean water for twenty minutes, and remove anything tight near it.', ask: [['Was it electrical or chemical, or is it bigger than your hand?', 'burn']] },
  { id: 'eye', match: /(in my eye|eye (is )?burning|chemical.*eye|splash.*eye)/, protocol: 'eye', severity: 'urgent', label: 'Eye injury', immediate: 'Don\'t rub it.' },
  { id: 'abdominal', match: /(stomach|belly|abdom|flank|kidney)/, severity: 'moderate', label: 'Abdominal pain', severe: /(severe|unbearable|blood|fever|vomit|worst|getting worse)/, protocol: 'abdominal',
    ask: [['Is it severe and getting worse, or do you have fever, vomiting or blood in your urine?', 'abdominal']] },
  { id: 'radiation', match: /(radiation (alarm|alert|warning)|solar (storm|flare|particle))/, protocol: 'radiation', severity: 'urgent', label: 'Radiation alert' },
];
const VAGUE = /(something (is )?(seriously |really )?wrong|something'?s wrong|i don'?t feel (well|right|good)|feel (really )?(weird|strange|terrible|awful)|help me|emergency|i need help)/;

// ---------------------------------------------------------------- reported measurements ("my oxygen is 88")
function readVitals(s) {
  const out = [];
  const m1 = s.match(/(oxygen|o2|sat\w*|spo2)\D{0,12}(\d{2,3})/); if (m1) out.push(['spo2', +m1[2]]);
  const m2 = s.match(/(heart ?rate|pulse|hr)\D{0,12}(\d{2,3})/); if (m2) out.push(['hr', +m2[2]]);
  const m3 = s.match(/(\d{2,3})\s*(over|\/)\s*(\d{2,3})/); if (m3) { out.push(['bp_sys', +m3[1]]); out.push(['bp_dia', +m3[3]]); }
  const m4 = s.match(/(temperature|temp|fever)\D{0,12}(3\d(\.\d)?)/); if (m4) out.push(['temp', +m4[2]]);
  return out;
}

// ---------------------------------------------------------------- what ORBI knows (vitals with honest labels)
export function vitalsSummary() {
  const B = EARTH_BASELINE.values; const out = [];
  const add = (t, label, unit, h, base) => { const r = recent(t, h); if (r) out.push({ t, label, value: r.value, unit, src: r.source, ts: r.ts, base }); };
  add('hr', 'Heart rate', 'bpm', 6, B.hr); add('spo2', 'SpO₂', '%', 6); add('rr', 'Breathing rate', '/min', 6, B.rr); add('bp_sys', 'BP systolic', 'mmHg', 24); add('temp', 'Body temperature', '°C', 24); add('skin_temp', 'Skin temperature', '°C', 6, B.skin_temp); add('env_co2', 'Cabin CO₂', 'mmHg', 12); add('env_o2', 'Cabin O₂', 'kPa', 12);
  return out;
}
function vitalLine(conv) {
  const v = vitalsSummary(); const bits = [];
  const hr = v.find(x => x.t === 'hr'), sp = v.find(x => x.t === 'spo2'), rr = v.find(x => x.t === 'rr');
  if (hr) bits.push(`your latest heart rate is ${Math.round(hr.value)} — ${SRC[hr.src] || hr.src}${hr.base ? `, against ${hr.base} on Earth` : ''}`);
  if (sp) bits.push(`oxygen saturation ${Math.round(sp.value)} percent (${SRC[sp.src] || sp.src})`);
  if (rr && ['breath', 'toxic', 'faint'].includes(conv.sit?.id)) bits.push(`breathing about ${Math.round(rr.value)} per minute (${SRC[rr.src] || rr.src})`);
  if (!bits.length) return conv.vitalsSaid ? '' : 'I don\'t have a recent heart-rate or oxygen measurement. If the pulse oximeter is in reach, clip it on and tell me the numbers.';
  return 'From my sensors: ' + bits.join('; ') + '.';
}

// ---------------------------------------------------------------- conversation state
const fresh = () => ({ sit: null, asked: 0, severity: 'unknown', symptoms: [], protocol: null, vitalsSaid: false, lastQ: null, afterIdx: 0 });
let C = fresh();
export const resetEmergency = () => { C = fresh(); };
export const emergencyState = () => C;

/**
 * One turn. Returns { say: string, protocol: id|null, severity, symptoms, actions: [string], watchSilence }.
 * protocolActive: a step-by-step protocol is already running (answers then focus on support, not new questions).
 */
export async function emergencyTurn(raw, { protocolActive = false } = {}) {
  const s = lc(raw.trim()); const out = [];
  // reported measurements are stored (labelled "reported") and used immediately
  for (const [t, v] of readVitals(s)) { await addRecord(t, v, 'reported', { context: 'Emergency Center conversation' }); C.symptoms.push(`${t} ${v} (reported)`); }
  const spo2 = readVitals(s).find(x => x[0] === 'spo2');
  if (spo2 && spo2[1] < 90 && !C.protocol) return start('breathing', 'life_threatening', `An oxygen saturation of ${spo2[1]} percent is dangerously low.`);

  // a new or more specific situation?
  const hit = S.find(x => x.match.test(s) && !(x.unless && x.unless.test(s)));
  // "No, I didn't hit my head" / "no bleeding" answer the question — they must not switch the situation
  const negatedAnswer = C.sit && C.lastQ && /\b(no|not|didn'?t|don'?t|isn'?t|wasn'?t|nothing|none)\b/.test(s);
  if (hit && !negatedAnswer && (!C.sit || hit.id !== C.sit.id)) { C.sit = hit; C.asked = 0; C.severity = hit.severity; C.symptoms.push(hit.label); }
  const sit = C.sit;

  // a NEW life-threatening situation overrides whatever protocol is running (e.g. chest pain → crewmate stops breathing)
  if (protocolActive && hit && !negatedAnswer && hit.protocol && hit.protocol !== protocolActive && (hit.severity === 'life_threatening' || (hit.severe && hit.severe.test(s))))
    return start(hit.protocol, 'life_threatening', 'This is a new emergency — switching to it now.');
  // during a running protocol: support, don't interrogate
  if (protocolActive) {
    if (/heart|pulse|oxygen|vitals|reading|breathing rate/.test(s)) return { say: vitalLine(C) || 'No new readings yet.', severity: C.severity, symptoms: C.symptoms };
    if (/worse|can'?t|help|not working|scared/.test(s)) return { say: 'Stay with me. Keep following the step — say "repeat" to hear it again. Call the crew medical officer and any crewmate now; I\'ve already logged this and alerted Mission Control.', severity: C.severity, symptoms: C.symptoms, actions: ['Follow the current step', 'Call the crew medical officer'] };
    if (/better|fine|okay|ok\b|improv/.test(s)) return { say: 'Good. Keep going with the steps and stay still for now; I\'ll keep monitoring. Tell me straight away if anything changes.', severity: C.severity, symptoms: C.symptoms, actions: ['Continue monitoring'] };
    return { say: 'I\'m here. Say "next" when you\'ve done the current step, or "repeat" to hear it again.', severity: C.severity, symptoms: C.symptoms };
  }

  // immediately life-threatening → protocol now, no questions
  if (sit && sit.protocol && (sit.severity === 'life_threatening' || (sit.severe && sit.severe.test(s)))) return start(sit.protocol, sit.severity === 'life_threatening' ? 'life_threatening' : 'urgent', sit.immediate || '');

  if (!sit) {
    if (VAGUE.test(s) || C.lastQ === 'what') { C.lastQ = 'what'; C.severity = 'unknown'; return { say: 'I\'m here and I\'m staying with you. Tell me what you feel right now — chest pain, trouble breathing, bleeding, feeling faint, or an injury?', severity: 'unknown', symptoms: C.symptoms, actions: ['Tell ORBI what is happening'] }; }
    return { say: 'Tell me what is happening, in your own words. If it\'s serious, call the crew medical officer at the same time.', severity: 'unknown', symptoms: C.symptoms };
  }

  // answer to the previous question
  if (C.lastQ && sit.ask) {
    const [q, escalate, inverted] = sit.ask[C.asked - 1] || [];
    // "positive" = the answer points to danger. For "Can you speak in full sentences?" a NO is the dangerous answer.
    const positive = inverted ? /\b(no|can'?t|cannot|not really|barely|hardly)\b/.test(s) : YES.test(s) && !/^\s*(no|nope|not)\b/.test(s);
    if (q && escalate && positive) return start(escalate, 'urgent', 'Thank you — that changes things.');
    if (sit.severe && sit.severe.test(s) && sit.protocol) return start(sit.protocol, 'urgent', '');
  }

  // first contact with this situation: immediate action first, then ONE relevant question
  if (C.asked === 0 && sit.immediate) out.push(sit.immediate);
  if (C.asked === 0) { const vl = vitalLine(C); if (vl) { out.push(vl); C.vitalsSaid = true; } }
  const next = sit.ask?.[C.asked];
  if (next) { C.asked++; C.lastQ = next[0]; out.push(next[0]); return { say: out.join(' '), severity: C.severity, symptoms: C.symptoms, actions: [sit.immediate, 'Answer ORBI\'s question'].filter(Boolean), watchSilence: !!sit.watchSilence }; }

  // no red flags found after the relevant questions → guided care without a full emergency protocol
  C.lastQ = null; C.severity = 'moderate';
  const steps = sit.after || [];
  if (steps.length && C.afterIdx < steps.length) { const st = steps.slice(C.afterIdx, C.afterIdx + 2); C.afterIdx += 2; out.push('From what you\'ve told me, this doesn\'t sound immediately life-threatening, but let\'s treat it carefully.', ...st, C.afterIdx < steps.length ? 'Tell me when that\'s done.' : 'Let the crew medical officer examine it as soon as possible.'); }
  else out.push('From what you\'ve told me, I don\'t see signs of an immediate life-threatening problem — but I can\'t examine you, so please tell the crew medical officer now, and tell me at once if anything gets worse. I\'ll keep monitoring your readings.');
  return { say: out.join(' '), severity: C.severity, symptoms: C.symptoms, actions: ['Rest and stay still', 'Inform the crew medical officer', 'Report any change to ORBI'] };

  function start(pid, severity, lead) {
    C.protocol = pid; C.severity = severity; C.lastQ = null;
    return { say: lead, protocol: pid, severity, symptoms: C.symptoms, actions: ['Follow ORBI\'s spoken steps', 'Call the crew medical officer'] };
  }
}

/** Context for the live AI: vitals with source labels, recent events, sleep & exercise, Earth link. */
export function emergencyContext(link, run) {
  const v = vitalsSummary(); const a = assess();
  const ev = state.emergencies.filter(e => Date.now() - e.ts < 30 * 86400e3).sort((x, y) => y.ts - x.ts).slice(0, 5);
  return [
    'Measurements (never invent others): ' + (v.length ? v.map(x => `${x.label} ${Math.round(x.value * 10) / 10} ${x.unit} [${SRC[x.src] || x.src}, ${Math.round((Date.now() - x.ts) / 60000)} min ago${x.base ? `; Earth baseline ${x.base}` : ''}]`).join('; ') : 'none recent') + '.',
    a.sleep ? `Last night's sleep ${a.sleep.h.toFixed(1)} h (simulated thermal-eye data in this demo).` : '', a.fatigue.flagged ? 'Fatigue pattern observed.' : '',
    `Exercise today: ${a.ex.today}.`,
    ev.length ? 'Recent health events: ' + ev.map(e => `${new Date(e.ts).toLocaleDateString()} ${e.title} (${e.status})`).join('; ') + '.' : 'No recent emergency events.',
    `Link to Mission Control: ${link ? 'available (one-way delay ≈12 min; replies take ≥24 min)' : 'LOST — reports are queued; the astronaut must be guided without Earth'}.`,
    run?.active ? `A protocol is running: "${run.proto.title}", step ${run.step + 1} of ${run.proto.steps.length}: ${run.proto.steps[run.step]}` : 'No protocol is running.',
  ].filter(Boolean).join('\n');
}
