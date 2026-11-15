// ORBI — offline medical conversation engine for the Virtual Body (used when the live AI is not available).
// It is NOT a large language model and ORBITAL labels it as such. It still holds a real conversation state:
// it understands free descriptions (several symptoms, intensity words, timing, triggers, corrections, side questions),
// remembers what was already said, asks only the next relevant question (one at a time), lets the astronaut choose the
// kind of help, and starts the validated emergency protocol immediately on red flags.
import { latest, state } from '../store.js';
import { COMPLAINTS } from '../content/voicebody.js';
import { assess } from '../companion/wellbeing.js';
import { EARTH_BASELINE } from '../companion/content.js';
import { adherence } from '../companion/daily.js';

// ---------------------------------------------------------------- helpers
const used = new Map();
function pick(key, arr) { let u = used.get(key); if (!u || u.size >= arr.length) { u = new Set(); used.set(key, u); } const free = arr.map((_, i) => i).filter(i => !u.has(i)); const i = free[Math.floor(Math.random() * free.length)]; u.add(i); return typeof arr[i] === 'function' ? arr[i]() : arr[i]; }
const recent = (t, h) => { const r = latest(t); return r && Date.now() - r.ts < h * 3600e3 ? r : null; };
const srcWord = r => r.source === 'simulated' ? ' (that\'s a simulated demo value)' : r.source === 'estimated' ? ' (a camera estimate)' : '';
const lc = s => s.toLowerCase().replace(/[’]/g, "'");
const RED_YES = /\b(yes|yeah|yep|it did|it does|it was|i do|i am|i have|i did|correct|that'?s right|exactly)\b/; // explicit answers only — "maybe a 4" is not a yes
const AFFIRM = /\b(yes|yeah|yep|it is|it was|it does|it did|i do|i did|i am|correct|right|kind of|sort of|a bit|a little|somewhat|maybe|i think so)\b/;
const DENY = /\b(no|nope|nah|not really|not at all|it'?s not|it isn'?t|it wasn'?t|it doesn'?t|it didn'?t|i don'?t|i didn'?t|none|nothing like that|neither|gradual(ly)?)\b/;
const ORD = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const NUMW = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// ---------------------------------------------------------------- understanding
const BODY = COMPLAINTS.filter(c => !c.mental && !(c.critical && !c.ask)); // complaints with a red-flag question are normal topics
const INSTANT = COMPLAINTS.filter(c => c.critical && !c.ask && !c.mental); // unresponsive, stroke, allergy: always an emergency
const EXTRA_RED = [
  [/crush|squeez|elephant on my chest|pain (spreads|going|goes|radiat)\w* (to|into|down) my (left )?(arm|jaw)/, 'chest', 'heart'],
  [/can'?t (breathe|catch my breath)|lips (are |look )?blue|choking|can'?t get air/, 'breathing', 'lungs'],
  [/worst headache (of my life|ever)|thunderclap/, 'stroke', 'brain'],
  [/won'?t stop bleeding|bleeding (a lot|heavily)|spurting/, 'bleeding', 'vessels'],
  [/(hit|bumped|banged|smashed) my head.*(confus|vomit|threw up|passed out|blacked out)|(confus|vomit).*(hit|bumped) my head/, 'head', 'brain'],
  [/chemical.*(in|into) my eye|splash.*eye/, 'eye', 'eyes'],
];
const SYMPTOMS = [['nausea', /nause|sick to my stomach|queasy|feel(ing)? (a bit |a little |kind of )?sick/], ['vomiting', /vomit|throw(ing)? up|threw up/], ['fever', /fever|feverish|chills|shiver/], ['dizziness', /dizz|light.?headed|vertigo/], ['blurred vision', /blurr|vision|seeing double/], ['sensitivity to light', /light hurts|sensitive to light|bright light/], ['a stiff neck', /stiff neck/], ['numbness or tingling', /numb|tingl|pins and needles/], ['shortness of breath', /short of breath|breathless/], ['sweating', /sweat/], ['a cough', /cough/], ['tiredness', /tired|exhausted|fatigue/]];

function bodyMentions(s) {
  const hits = [];
  for (const c of BODY) {
    const m = s.match(c.match); if (!m) continue;
    if (/\b(not|isn'?t|it'?s not)\s+(my|the|in my|in the)?\s*$/.test(s.slice(Math.max(0, m.index - 14), m.index))) continue; // "not my stomach"
    hits.push({ c, at: m.index });
  }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set(); return hits.filter(h => !seen.has(h.c.id) && seen.add(h.c.id)).map(h => h.c);
}
function intensityOf(raw, expecting) {
  // "not really painful all the time" is not a statement of strong pain
  const s = raw.replace(/\bnot (really |that |too |very |so )?(painful|bad|severe|strong)\b/g, 'mild').replace(/\bnot (really |that |too )?(a lot|much)\b/g, 'mild');
  const num = s.match(/\b(\d{1,2})(?:\.\d)?\s*(?:out of|\/|on a scale of)\s*10\b/) || (expecting && (s.match(/\b(?:a|an|about|maybe|like|it'?s|its)\s+(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/) || s.match(/^\s*(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/)));
  let n = null; if (num) { const v = num[1]; n = NUMW[v] ?? parseInt(v, 10); if (!(n >= 0 && n <= 10)) n = null; }
  let word = null, lvl = n;
  if (/unbearable|excruciating|worst|agoni|can'?t stand it|terrible|horrible|awful|severe|extremely|really (bad|painful|hurts)|very (bad|painful)|so (bad|painful)|killing me/.test(s)) { word = 'severe'; lvl = lvl ?? 8; }
  else if (/pretty (bad|painful)|quite (bad|painful)|hurts a lot|a lot of pain|strong|\bbad\b/.test(s)) { word = 'quite strong'; lvl = lvl ?? 6; }
  else if (/uncomfortable|manageable|annoying|moderate|bothers?|bothering|noticeable|medium/.test(s)) { word = 'uncomfortable but manageable'; lvl = lvl ?? 4; }
  else if (/barely|hardly|slight|mild|a little|not (that|too|very) bad|tolerable|minor|small/.test(s)) { word = 'mild'; lvl = lvl ?? 2; }
  if (lvl != null && !word) word = lvl >= 8 ? 'severe' : lvl >= 6 ? 'quite strong' : lvl >= 3 ? 'moderate' : 'mild';
  return word ? { word, lvl } : null;
}
function onsetOf(s) {
  const m = s.match(/\b(since (yesterday|this morning|last night|today|the morning|breakfast|lunch|i woke up|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\w+ days? ago)|for (the )?(last |past )?(a few|several|two|three|four|five|\d+|a couple of) (days|hours|weeks)|(an?|one|two|three|\d+) (hours?|days?|weeks?) ago|(yesterday|this morning|last night|today)|all (day|week)|(started|began) (suddenly|gradually|slowly))/);
  const sudden = /\b(suddenly|all of a sudden|out of nowhere|came on fast|in seconds)\b/.test(s);
  return m ? { text: m[0].replace(/^since /, 'since ').trim(), sudden } : sudden ? { text: 'suddenly', sudden } : null;
}
function patternOf(s) {
  if (/comes and goes|on and off|off and on|sometimes|now and then|intermittent|in waves|not (all the time|constant)|it'?s not really painful all the time/.test(s)) return 'comes and goes';
  if (/constant|all the time|nonstop|non-stop|doesn'?t (go away|stop)|never stops/.test(s)) return 'constant';
  return null;
}
const clause = (s, re) => { const m = s.match(re); return m ? m[m.length - 1].replace(/\b(and|but)\b.*$/, '').replace(/[.,!?].*$/, '').trim() : null; };
const you = t => t && t.replace(/\bi'?m\b/g, 'you\'re').replace(/\bi\b/g, 'you').replace(/\bmy\b/g, 'your').replace(/\bme\b/g, 'you');
const worseOf = s => you(worseRaw(s));
const worseRaw = s => clause(s, /(?:gets?|getting|goes|feels?|is) worse (?:when|if|with|after|while|as)\s+([^.,!?]+)/) || clause(s, /hurts? more (?:when|if|with|after|while)\s+([^.,!?]+)/) || (/moving makes it worse|when i move/.test(s) ? 'i move' : null);
const betterOf = s => clause(s, /(?:gets?|getting|feels?|is) better (?:when|if|with|after|while)\s+([^.,!?]+)/) || clause(s, /(?:helps?|eases?|relieves?)\b(?: it)?(?: when| if)?\s*([^.,!?]*)/) || (/nothing helps|nothing makes it better/.test(s) ? 'nothing so far' : null);
const beforeOf = s => /never (had|felt)|first time|not before|never happened|new for me/.test(s) ? 'no' : /had (this|it|that) before|happened before|again\b|used to get|i get (these|them)|usual|same as (before|last time)/.test(s) ? 'yes' : null;
const activityOf = s => /\b(during|after|while|doing)\b (the |my |a )?(exercis\w*|workout|work ?out|training|squats?|deadlifts?|lifting|running|run|cycling|treadmill|session|bench press)/.test(s) ? 'during or after exercise' : /resting|at rest|while (sleeping|working|sitting)|woke up with/.test(s) ? 'at rest' : null;
function modeOf(s) {
  if (/\b(everything|all of it|the whole (thing|picture)|full explanation|both|all three|understand everything|explain everything|all of (that|them))\b/.test(s)) return 'full';
  if (/guide me|walk me through|step by step|step-by-step|through it|take me through|guidance|show me how/.test(s)) return 'guidance';
  if (/\badvice\b|advise|recommend|tips?\b|suggest/.test(s)) return 'advice';
  if (/what (should|can|do) i do|what to do|just tell me what|how (do|can) i (fix|stop|get rid|make it)|get rid of|solutions?|make it (stop|better|go away)|treat (it|this)|what helps/.test(s)) return 'solutions';
  if (/\bwhy\b|cause|reason|what'?s (causing|going on|happening)|what is (causing|going on)|explain|could it be|understand (it|this)|possible reasons/.test(s)) return 'reasons';
  return null;
}

// ---------------------------------------------------------------- personal context from ORBI's data
function personal(c, S) {
  const a = assess(); const out = []; const B = EARTH_BASELINE.values; const id = c.id;
  const co2 = recent('env_co2', 24), hr = recent('hr', 12), rr = recent('rr', 12), puff = recent('puffiness', 72), st = recent('skin_temp', 12), mv = recent('move_speed', 48);
  const missed = adherence(5).filter(d => ['missed', 'partial'].includes(d.status)).length;
  if (['head', 'tired', 'eyes', 'dizzy', 'neck'].includes(id) && a.sleep) {
    if (a.sleep.h < 6 || (a.sleep.avg7 && a.sleep.avg7 < 6.5)) out.push(`One thing I did measure: you slept only about ${a.sleep.h.toFixed(1)} hours last night${a.sleep.avg7 ? `, and around ${a.sleep.avg7.toFixed(1)} on average over the past week` : ''}, against ${a.sleep.earth} on Earth. Short sleep is a common trigger for exactly this.`);
    else out.push(`Your sleep last night looked reasonable, about ${a.sleep.h.toFixed(1)} hours, so lack of sleep is less likely to be the main reason.`);
  }
  if (['head', 'breath', 'tired', 'dizzy'].includes(id) && co2) out.push(co2.value > 3 ? `The cabin carbon dioxide reading is ${co2.value.toFixed(1)} millimetres of mercury${srcWord(co2)}, which is higher than ideal and can cause headaches and breathlessness.` : `Cabin carbon dioxide is normal at ${co2.value.toFixed(1)}, so the air is probably not the cause.`);
  if (['chest', 'breath', 'dizzy'].includes(id) && hr) out.push(`Your latest heart rate is about ${Math.round(hr.value)} beats per minute${srcWord(hr)}; on Earth your resting value was ${B.hr}.`);
  if (id === 'breath' && rr) out.push(`My thermal eye last estimated ${Math.round(rr.value)} breaths per minute${srcWord(rr)}; your normal is about ${B.rr}.`);
  if (['face', 'head', 'nose'].includes(id) && puff && Math.abs(puff.value) >= 3) out.push(`Compared with your pre-flight picture, your face looks about ${Math.abs(puff.value).toFixed(0)} percent ${puff.value >= 0 ? 'fuller' : 'slimmer'}${srcWord(puff)} — that fits the fluid shift toward the head.`);
  if (['fever', 'head', 'tired'].includes(id) && st && st.value > B.skin_temp + 0.7) out.push(`My thermal eye sees your skin a little warmer than usual, ${st.value.toFixed(1)} degrees${srcWord(st)}. Skin temperature isn't body temperature, so the thermometer in the medical kit is worth using.`);
  if (['legs', 'back', 'muscles', 'joints'].includes(id)) { if (missed) out.push(`You missed or shortened your exercise on ${missed} of the last 5 days, and these muscles weaken quickly without it.`); if (mv && mv.value < 70) out.push('I\'ve also noticed you moving more slowly than usual.'); }
  if (['back', 'neck'].includes(id) && a.sleep?.discomfort) out.push('Last night you were very restless in your sleeping bag, which fits with back or neck discomfort.');
  if (['tired', 'head', 'neck'].includes(id) && a.stress.detected) out.push('I\'ve also seen signs of muscle tension and stress today.');
  if (S.f.activity === 'during or after exercise' && ['legs', 'back', 'muscles', 'joints', 'neck'].includes(id)) out.push('Since it started with exercise, a strained muscle or overloaded joint is more likely than anything internal.');
  if (/move|moving/.test(S.f.worse || '') && id === 'head') out.push('A headache that gets worse when you move your head can come from the extra fluid pressure in your head, or from tight neck and shoulder muscles.');
  return out;
}

// ---------------------------------------------------------------- conversation state
function fresh() { return { c: null, more: [], f: {}, asked: new Set(), stage: 'gather', want: null, step: 0, lastQ: null, redOk: null, done: [], extra: [], lastSay: null, lastWhy: null, brief: S?.brief || false }; }
let S = null; S = fresh();
export const resetMedical = () => { S = fresh(); };
/** Called by the Virtual Body when a guided step-by-step session ends. */
export const guidanceEnded = () => { if (S.stage === 'guide') { S.stage = 'done'; S.done.push('guidance'); } };
export const severityOf = () => !S.c ? null : (S.f.intensity?.lvl ?? 0) >= 7 ? 'severe' : (S.f.intensity?.lvl ?? 0) >= 4 ? 'moderate' : S.f.intensity ? 'minor' : 'unknown';
export const medicalTopic = () => S.c;
export function medicalSummary() {
  if (!S.c) return '';
  const f = S.f; return `${S.c.label}${f.intensity ? ', ' + f.intensity.word : ''}${f.onset ? ', ' + f.onset.text : ''}${f.pattern ? ', ' + f.pattern : ''}${f.worse ? ', worse when ' + f.worse : ''}${S.more.length ? '; also ' + S.more.map(c => c.label).join(', ') : ''}`;
}

// ---------------------------------------------------------------- questions (one at a time)
const Q = {
  where: () => pick('q.where', ['Can you show me where you\'re feeling the discomfort? Just describe the area in your own words.', 'Where do you feel it? Describe it however comes naturally.', 'Tell me where in your body it\'s bothering you.']),
  intensity: () => pick('q.int', ['Is the pain mild, moderate, or severe?', 'How bad is it right now — mild, moderate or severe? A number out of ten works too.', 'How strong is it at the moment?']),
  onset: () => pick('q.on', ['When did it start?', 'How long has it been going on?', 'When did you first notice it?']),
  pattern: () => pick('q.pat', ['Is it there all the time, or does it come and go?', 'Is it constant, or does it come in waves?']),
  worse: () => pick('q.worse', ['Does anything make it worse — moving, bending, screens, lying in the sleeping bag?', 'Have you noticed anything that sets it off or makes it worse?']),
  activity: () => pick('q.act', ['Did it start during exercise, or while you were resting?', 'Were you exercising or lifting something when it started?']),
  other: () => pick('q.other', ['Are you noticing anything else alongside it — nausea, dizziness, changes in your vision, fever?', 'Anything else going on with it, like feeling sick, dizzy or feverish?']),
  before: () => pick('q.before', ['Have you had this before, on Earth or earlier in the mission?', 'Is this new for you, or have you felt it before?']),
  sudden: () => 'Did it start suddenly, like a thunderclap, or build up over time?',
  neuro: () => 'Any weakness, numbness, confusion, trouble speaking, or changes in your vision?',
};
const SIMPLE = { intensity: 'Is it a little pain, medium pain, or a lot of pain?', onset: 'When did it start? Today, yesterday, or longer ago?', pattern: 'Is it there all the time, or only sometimes?', worse: 'Does something make it hurt more?', activity: 'Were you exercising when it started?', other: 'Do you feel anything else, like sick or dizzy?', before: 'Have you had this before?', sudden: 'Did it start all at once, or slowly?', neuro: 'Can you move and feel both arms and legs, speak normally, and see clearly?', where: 'Where does it hurt?' };
const WHY = { intensity: 'It tells me how urgent this is.', onset: 'Pain that starts suddenly matters more than pain that built up slowly.', pattern: 'Pain that comes and goes usually has different causes than constant pain.', worse: 'What makes it worse points to the cause.', activity: 'Pain that starts with exercise is usually muscular.', other: 'Other symptoms change what is likely.', before: 'Something familiar is less worrying than something new.', sudden: 'A sudden, explosive headache can be a sign of bleeding in the brain and needs action right away.', neuro: 'Those signs together with a bad headache can mean a stroke.', red: 'Those warning signs can mean something serious that needs action right away.', where: 'So I can look at the right part of your body.' };
const PLAN = { head: ['onset', 'pattern', 'worse', 'other'], eyes: ['onset', 'other'], dizzy: ['onset', 'other'], chest: ['onset', 'activity', 'pattern'], breath: ['onset', 'activity'], stomach: ['onset', 'other', 'pattern'], back: ['activity', 'onset', 'worse'], neck: ['activity', 'onset'], legs: ['onset', 'activity'], muscles: ['activity', 'onset'], joints: ['activity', 'onset'], kidney: ['onset', 'other'], tired: ['onset', 'other'], fever: ['onset', 'other'], throat: ['onset', 'other'], skin: ['onset', 'before'], ears: ['onset', 'before'], nose: ['onset'], face: ['onset', 'other'], bleeding: [] };
const known = k => k === 'worse' ? S.f.worse : k === 'other' ? (S.f.other && S.f.other.length) : S.f[k];
function nextQuestion() {
  if (!S.c) return 'where';
  if (['chest', 'breath'].includes(S.c.id) && S.c.ask && S.redOk == null && !S.asked.has('red')) return 'red'; // heart & breathing: warning signs first
  if (!S.f.intensity && !S.asked.has('intensity')) return 'intensity';
  // Severe symptoms: only the urgent questions — no long assessment.
  if ((S.f.intensity?.lvl ?? 0) >= 7) {
    if (S.c.id === 'head') { for (const k of ['sudden', 'neuro']) if (!S.asked.has(k)) return k; return null; }
    if (S.c.ask && S.redOk == null && !S.asked.has('red')) return 'red';
    return null;
  }
  if (S.c.id === 'head' && !S.asked.has('sudden')) return 'sudden'; // one question at a time, not a compound checklist
  if (S.c.id !== 'head' && S.c.ask && S.redOk == null && !S.asked.has('red')) return 'red';
  const plan = PLAN[S.c.id] || ['onset'];
  const followUps = [...S.asked].filter(k => !['intensity', 'red', 'where'].includes(k)).length;
  if (followUps >= 2) return null;
  for (const k of plan) if (!known(k) && !S.asked.has(k)) return k;
  return null;
}
function askLine(k) { S.asked.add(k); S.lastQ = k; S.lastWhy = WHY[k] ? 'I ask because ' + WHY[k].charAt(0).toLowerCase() + WHY[k].slice(1) : null; return k === 'red' ? S.c.ask : Q[k](); }

// ---------------------------------------------------------------- acknowledgements (never just repeating the words back)
function ack(prevStage) {
  const f = S.f; const parts = [];
  if (f.intensity && f.intensity.lvl >= 7) { if (S.lastQ === 'intensity') parts.push('Okay — let\'s take that seriously.'); }
  else if (f.intensity && S.lastQ === 'intensity') parts.push(pick('ack.int', f.intensity.lvl <= 3 ? ['Okay, fairly mild then.', 'Good, at least it\'s on the lighter side.'] : ['Okay, so it\'s really bothering you.', 'Got it — enough to get in the way.', 'Understood.']));
  else if (f.trend === 'worse') parts.push('If it\'s getting worse, that matters — thank you for telling me.');
  else if (prevStage === 'gather' && S.lastQ && S.lastQ !== 'where') parts.push(pick('ack', ['Okay.', 'That helps.', 'Thanks, that\'s useful.', 'Got it.', 'Mm, okay.']));
  return parts.join(' ');
}
function summaryLine() {
  const f = S.f;
  return `So: ${S.c.label}${f.intensity ? ', ' + f.intensity.word : ''}${f.onset ? ', ' + f.onset.text : ''}${f.pattern ? ', ' + f.pattern : ''}${f.worse ? ', worse when ' + f.worse : ''}.`;
}
const OFFER = () => pick('offer', [
  'Do you want to know why it\'s happening, what to do about it, or should I guide you step by step?',
  'Would you like the likely reasons, what to do, or step-by-step guidance?',
]);

// ---------------------------------------------------------------- delivering the chosen help — short, more on request
const take = (list, n) => { const head = list.slice(0, n); S.extra = list.slice(n); return head; };
const MORE = () => S.extra.length ? pick('more?', ['Want more detail?', 'Should I go on?', '']) : '';
function reasonList() {
  const c = S.c; const pc = personal(c, S);
  return [...pc, ...(c.causes || []), unknowns(), S.more.length ? `Your ${S.more.map(m => m.label.replace(/^your /, '')).join(' and ')} could be connected, or separate.` : ''].filter(Boolean);
}
function reasons() {
  const list = reasonList(); const n = S.brief ? 1 : 2;
  S.lastWhy = 'That\'s based on what you told me and what my sensors measured — but I can\'t examine you, so these are possibilities, not a diagnosis.';
  return [pick('r.open', ['Most likely:', 'My best guess:', 'Probably this:']), ...take(list, n), MORE() || 'Want to know what to do about it?'];
}
function unknowns() {
  const c = S.c;
  const tests = { head: 'your blood pressure or eye pressure', chest: 'your heart rhythm — that needs the ECG in the medical kit', breath: 'your blood oxygen — the pulse oximeter would tell us', kidney: 'what an ultrasound would show', fever: 'your core temperature', eyes: 'the pressure behind your eyes', stomach: 'what\'s happening inside your abdomen', legs: 'whether there is a clot — a swollen, painful calf would need checking', joints: 'whether anything is damaged inside the joint', back: 'whether a nerve is involved' };
  return tests[c.id] ? `What I can't tell from here is ${tests[c.id]}.` : '';
}
function solutions() {
  const f = [...(S.c.fixes || []), medLine()].filter(Boolean); const n = S.brief ? 1 : 2;
  S.lastWhy = S.c.causes?.[0] ? 'Because ' + S.c.causes[0].charAt(0).toLowerCase() + S.c.causes[0].slice(1) : null;
  const out = take(f, n);
  if ((S.f.intensity?.lvl ?? 0) >= 7 || S.f.trend === 'worse') out.push('Also tell the crew medical officer today.');
  return [...out, MORE() || 'Want me to guide you through it?'];
}
function advice() { const f = S.c.fixes || []; return [f[0], (S.f.intensity?.lvl ?? 0) >= 6 ? 'Tell the crew medical officer today.' : 'If it isn\'t better by tomorrow, mention it to the crew medical officer.'].filter(Boolean); }
/** Medication: only from the CMO-approved list in Profile & Data, checked against recorded allergies. */
function medLine(short = false) {
  const c = S.c; if (!c || !['head', 'back', 'neck', 'muscles', 'joints', 'fever', 'legs', 'throat', 'ears'].includes(c.id)) return '';
  const meds = String(state.profile?.approvedMeds || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const allergies = String(state.profile?.allergies || '').toLowerCase();
  if (!meds.length) return short ? 'No painkillers until the medical officer says so — there\'s no approved list on file.' : 'Don\'t take a painkiller on your own — there\'s no approved medication list on file, so ask the crew medical officer first.';
  const need = c.id === 'fever' ? /fever|temperature/i : /pain|ache|headache/i;
  const m = meds.find(x => need.test(x)) || null;
  if (!m) return 'Nothing on your approved medication list is meant for this — ask the crew medical officer.';
  const name = m.split(/[—–:-]/)[0].trim();
  if (allergies && allergies.split(/[,;\n]+/).some(a => a.trim() && name.toLowerCase().includes(a.trim()))) return `Your list has ${name}, but your record shows an allergy to it — don't take it; ask the crew medical officer.`;
  return `Your approved list has ${name} for this — use only the dose written on that list, and check with the crew medical officer first.`;
}
function severeNext() {
  S.stage = 'done'; S.done.push('severe');
  const bp = recent('bp_sys', 24);
  const out = ['No warning signs so far — but pain this strong needs a proper check, so tell the crew medical officer now.'];
  out.push(S.c.id === 'head' ? 'Meanwhile, rest somewhere dark and quiet and sip water.' : S.c.fixes?.[0] ? 'Meanwhile: ' + S.c.fixes[0] : '');
  const ml = medLine(true); if (ml) out.push(ml);
  if (bp) out.push(`Your last blood pressure was ${Math.round(bp.value)}${srcWord(bp)}.`);
  out.push('Tell me at once if it gets worse.');
  S.lastWhy = 'Severe pain needs the medical officer to examine you — I can only go by what you tell me and my sensors.';
  return out.filter(Boolean);
}
/** Guidance is run by the Virtual Body's timed step runner (guidance.js); this only returns the steps. */
const EXTRA_STEPS = ['Take three slow breaths: in for four, out for six.', 'Sip some water.', 'Now notice how it feels compared with before you started.'];
function guidanceSteps() { const f = (S.c.fixes || []).slice(0, 5); for (const x of EXTRA_STEPS) if (f.length < 5) f.push(x); return f; }
function deliver(mode) {
  S.stage = 'done'; S.done.push(mode); S.want = null;
  if (mode === 'reasons') return reasons();
  if (mode === 'solutions') return solutions();
  if (mode === 'advice') return advice();
  if (mode === 'guidance') { S.stage = 'guide'; return [pick('g.open', ['Okay, step by step.', 'Let\'s do it together.'])]; }
  const r = reasonList(); const f = S.c.fixes || [];
  S.extra = [...r.slice(1), ...f.slice(1)];
  return [r[0], f[0], 'Want more, or should I guide you step by step?'].filter(Boolean);
}

// ---------------------------------------------------------------- side questions (answered with data, context kept)
function sideQuestion(s) {
  const a = assess(); const B = EARTH_BASELINE.values;
  if (/heart ?rate|pulse|heartbeat/.test(s)) { const hr = recent('hr', 24); return hr ? `Your latest heart rate is about ${Math.round(hr.value)} beats per minute${srcWord(hr)}, against ${B.hr} on Earth.` : 'I don\'t have a recent heart-rate reading. The AI Camera page can estimate it if your face is in good light.'; }
  if (/(how (did|have) i (sleep|slept)|my sleep|sleep (last night|lately)|because i (didn'?t|haven'?t) slept?|could it be (my |the )?sleep|from (bad|poor|not enough) sleep|lack of sleep)/.test(s)) {
    if (!a.sleep) return 'I don\'t have a full night of sleep observations yet, so I can\'t say.';
    const link = S.c && ['head', 'tired', 'eyes', 'dizzy', 'neck'].includes(S.c.id);
    return `Last night I measured about ${a.sleep.h.toFixed(1)} hours of sleep${a.sleep.avg7 ? `, and ${a.sleep.avg7.toFixed(1)} on average this week` : ''}. ${link ? (a.sleep.h < 6.5 ? 'So yes — that could well be contributing to what you\'re feeling.' : 'That\'s fairly normal, so sleep probably isn\'t the main driver here.') : ''}`.trim();
  }
  if (/\b(co2|carbon dioxide|the air)\b/.test(s)) { const c = recent('env_co2', 24); return c ? `Cabin CO2 is ${c.value.toFixed(1)} millimetres of mercury${srcWord(c)}${c.value > 3 ? ', which is on the high side' : ', which is fine'}.` : 'I don\'t have a recent CO2 reading.'; }
  if (/temperature|do i have (a )?fever|am i (hot|warm)/.test(s)) { const t = recent('skin_temp', 12); return t ? `My thermal eye estimates your skin at ${t.value.toFixed(1)} degrees${srcWord(t)}. That's skin, not core temperature — the medical-kit thermometer gives the real number.` : 'I don\'t have a recent thermal reading.'; }
  if (/(is (it|this|that) (serious|dangerous|bad)|should i (be )?worr(y|ied)|am i (ok|okay|going to be ok))/.test(s)) {
    if (!S.c) return 'I can\'t say yet — tell me what you\'re feeling and where.';
    return S.redOk === false || !S.c.ask ? 'Nothing you\'ve told me points to an emergency — but I can\'t examine you. Tell me straight away if it changes.' : `Let me rule something out first. ${S.c.ask}`;
  }
  if (/(can i|should i|is it ok(ay)? to) (still )?(exercise|work ?out|train|work)/.test(s)) return S.f.intensity?.lvl >= 6 ? 'I\'d skip heavy exercise today and stick to gentle movement until it settles. I can adapt your routine in Physical Health.' : 'Gentle exercise is fine and may even help — just stop anything that makes it worse.';
  if (/(painkiller|medicine|medication|ibuprofen|paracetamol|acetaminophen|tylenol|pill|take something)/.test(s)) return S.c ? (medLine() || 'Ask the crew medical officer before taking anything.') : 'Tell me what hurts first, then I\'ll check your approved medication list.';
  if (/how long (will|until|does) (it|this)/.test(s)) return S.c ? 'Most episodes like this settle within a day or two with the right steps. If it hasn\'t improved by tomorrow, let the crew medical officer take a look.' : null;
  return null;
}

// ---------------------------------------------------------------- main turn
/**
 * One conversational turn. Returns { say: [sentences], parts: [organ ids], emergency: protocolId|null, mode }.
 */
export function medicalTurn(raw) {
  const askedBefore = S.asked.size;
  const r = turn(raw);
  if (r.say?.length && !r.meta) { S.lastSay = r.say.filter(Boolean); S.lastAsked = S.asked.size > askedBefore; }
  if (r.mode === 'guidance' && S.c) r.guidance = guidanceSteps();
  return r;
}
function turn(raw) {
  const s = lc(raw.trim());
  const prevStage = S.stage;
  // 1) immediate emergencies — never delayed by the conversation
  for (const c of INSTANT) if (c.match.test(s)) return { say: [c.intro], parts: [c.organ], emergency: c.critical, intro: true, instant: true };
  for (const [re, pid, organ] of EXTRA_RED) if (re.test(s)) return { say: [], parts: [organ], emergency: pid, instant: true };
  const mentions = bodyMentions(s);
  const adding = /\b(too|also|as well|and also|on top of)\b/.test(s);
  const correcting = !adding && /\b(no,? i meant|not my|i meant|i mean|sorry,? (it'?s|my)|wrong|no wait|actually (it'?s|it is) (my|in))\b/.test(s) && mentions.length;
  // red-flag question answered
  if (S.lastQ === 'red' && S.c) {
    const denies = DENY.test(s);
    if (S.c.askNow && S.c.askNow.test(s) && !denies) return { say: [], parts: [S.c.organ], emergency: S.c.critical };
    if (RED_YES.test(s) && !denies) return { say: [], parts: [S.c.organ], emergency: S.c.critical };
    if (denies) S.redOk = false; // otherwise unanswered: it will be asked again before any reassurance
  }
  if (S.lastQ === 'sudden' && S.c) {
    if (/\b(sudden\w*|thunder\w*|out of nowhere|all at once|instant\w*|seconds|like a bang|yes)\b/.test(s) && !/\b(gradual\w*|slow\w*|built|over time|not sudden\w*|no)\b/.test(s)) return { say: [], parts: ['brain'], emergency: 'stroke' };
    S.f.onset = { ...(S.f.onset || {}), text: S.f.onset?.text || 'built up gradually', sudden: false };
    if ((S.f.intensity?.lvl ?? 0) < 7) S.redOk = false; // gradual and not severe: the main warning sign is ruled out
  }
  if (S.lastQ === 'neuro' && S.c) {
    const denies = DENY.test(s) && !/\b(can'?t|cannot)\b/.test(s);
    if (!denies && (RED_YES.test(s) || /\b(weak\w*|numb\w*|confus\w*|slur\w*|can'?t (speak|talk|see|move)|blurr\w*|double|vision|tingl\w*)\b/.test(s))) return { say: [], parts: ['brain'], emergency: 'stroke' };
    if (denies) S.redOk = false;
  }
  for (const c of mentions) if (c.askNow && c.askNow.test(s) && c.critical && /\b(sudden|worst|blood|spurt|crush|squeez|chemical|can'?t talk|blue|smoke)/.test(s)) return { say: [], parts: [c.organ], emergency: c.critical };
  // 2) conversation control — understood naturally, at any point
  const partsNow = S.c ? [S.c.organ, ...S.more.map(m => m.organ)] : [];
  if (/^(please )?(explain|say) (that|it) again|^repeat( that)?\b|^come again|^what did you say|^can you repeat/.test(s)) return { say: S.lastSay || ['I haven\'t said anything yet — tell me what you\'re feeling.'], parts: partsNow, meta: true };
  if (/\b(keep it short|shorter|be brief|briefly|too long|less detail|short answers?)\b/.test(s)) { S.brief = true; return { say: ['Sure — short answers from now on.'], parts: partsNow }; }
  if (/\b(more detail|tell me more|explain more|go on|what else|keep going|more please|in detail)\b/.test(s) && !mentions.length) { S.brief = false; const more = S.extra.splice(0, 2); return { say: more.length ? [...more, S.extra.length ? 'There\'s a bit more if you want it.' : ''] : ['That\'s everything I have on it.'], parts: partsNow }; }
  if (/^(why|why\?|why is that|why do you ask|how come|why not)\b/.test(s) && s.length < 25) return { say: [S.lastWhy || 'Because of what you described — but tell me what you\'d like me to explain.'], parts: partsNow };
  if (/\b(i don'?t understand|i didn'?t understand|what do you mean|that'?s confusing|i'?m confused about|simpler)\b/.test(s)) { const q = S.lastAsked && S.lastQ && SIMPLE[S.lastQ]; return { say: [q ? 'Let me put it simply: ' + q : 'In short: ' + (S.lastSay?.[0] || 'tell me what hurts and how much.')], parts: partsNow }; }
  if (/\b(let'?s move on|move on|never ?mind|forget it|skip that)\b/.test(s) && !mentions.length) { S.stage = 'done'; S.lastQ = null; return { say: [pick('mo', ['Okay. Anything else?', 'Sure. What else is on your mind?'])], parts: partsNow }; }
  if (/\b(another problem|something else (hurts|is wrong|is bothering)|different problem|new problem|other problem|one more thing)\b/.test(s) && !mentions.length) { const brief = S.brief; S = fresh(); S.brief = brief; return { say: ['Okay — what\'s the other problem?'], parts: [] }; }
  // 3) topic tracking (new body part, several at once, or a correction)
  let newTopic = false;
  if (mentions.length) {
    if (S.c && adding && !correcting && S.stage !== 'done') { for (const m of mentions) if (m !== S.c && !S.more.includes(m)) S.more.push(m); } // "…and my neck too": added, main topic kept
    else if (!S.c || correcting || (!mentions.includes(S.c) && S.stage !== 'gather')) {
      const keepFacts = S.c && correcting && S.stage === 'gather';
      const f = keepFacts ? S.f : {};
      const prev = adding && S.c ? [S.c, ...S.more] : [];
      S = { ...fresh(), c: mentions[0], more: [...mentions.slice(1), ...prev.filter(x => !mentions.includes(x))], f };
      newTopic = true;
    } else for (const m of mentions) if (m !== S.c && !S.more.includes(m)) S.more.push(m);
  }
  // 4) facts from free speech
  const f = S.f;
  // Intensity is only (re)set when the astronaut is talking about the pain itself — "a little tired" must not overwrite it.
  const it = intensityOf(s, S.lastQ === 'intensity');
  if (it && (S.lastQ === 'intensity' || !f.intensity || /pain|hurt|ache|sore|now it'?s|it'?s (now|gotten|getting)|out of 10|\/10/.test(s))) f.intensity = it;
  const on = onsetOf(s); if (on) f.onset = on;
  const pt = patternOf(s); if (pt) f.pattern = pt;
  if (/getting worse|worse and worse|keeps getting worse|worsening|increasing/.test(s)) f.trend = 'worse';
  if (/getting better|easing|improving|less than before/.test(s)) f.trend = 'better';
  const w = worseOf(s); if (w) f.worse = w;
  const b = betterOf(s); if (b) f.better = b;
  const bf = beforeOf(s); if (bf) f.before = bf;
  const ac = activityOf(s); if (ac) f.activity = ac;
  const syms = SYMPTOMS.filter(([, re]) => re.test(s)).map(([n]) => n); if (syms.length) f.other = [...new Set([...(f.other || []), ...syms])];
  if (S.lastQ === 'other' && !syms.length && (DENY.test(s) || /nothing else|that'?s (it|all)/.test(s))) f.other = ['none'];
  if (S.lastQ === 'before' && !bf) { if (DENY.test(s)) f.before = 'no'; else if (AFFIRM.test(s)) f.before = 'yes'; }
  if (S.lastQ === 'activity' && !ac) { if (/rest|sitting|working|sleep/.test(s)) f.activity = 'at rest'; else if (/exercis|workout|training|lifting/.test(s)) f.activity = 'during or after exercise'; }
  if (S.lastQ === 'onset' && !on && s.length < 60) f.onset = { text: raw.trim().replace(/[.!]$/, ''), sudden: false };
  if (S.lastQ === 'pattern' && !pt && /all|constant|always/.test(s)) f.pattern = 'constant';
  if (S.lastQ === 'worse' && !w && !DENY.test(s)) f.worse = you(s.replace(/^(when|if|with|after)\s+/, '').replace(/[.!]$/, '').slice(0, 60));
  if (f.onset?.sudden && S.c?.id === 'head') return { say: [], parts: ['brain'], emergency: 'stroke' };
  const parts = S.c ? [S.c.organ, ...S.more.map(m => m.organ)].filter((x, i, a) => a.indexOf(x) === i) : [];

  // 5) what does the astronaut want?
  const mode = modeOf(s);
  const side = sideQuestion(s);
  if (/another question|i have a question|can i ask (you )?something/.test(s) && !side) return { say: [pick('aq', ['Sure, go ahead.', 'Of course — what is it?'])], parts };
  if (S.stage !== 'gather' && /\b(that'?s all|nothing else|i'?m (fine|good) now|thanks?,? (that'?s|it'?s) (all|enough)|thank you)\b/.test(s) && !mentions.length && !mode) return { say: [pick('bye', ['You\'re welcome. I\'m right here if anything changes.', 'Anytime. Tell me if it gets worse or something new comes up.'])], parts };
  if (side && !newTopic) {
    const tail = S.stage === 'gather' && S.c ? nextQuestion() : null;
    const out = [side];
    if (tail) out.push(pick('back', [`And coming back to ${S.c.label} — `, 'Back to what you\'re feeling: ', '']) + askLine(tail));
    else if (S.stage === 'offer') out.push('Whenever you\'re ready: reasons, what to do, advice, or step-by-step guidance?');
    return { say: out, parts };
  }
  if (!S.c && /^(hi|hello|hey|good (morning|afternoon|evening)|orbi)\b/.test(s) && s.length < 30) return { say: [pick('hi', ['Hi. What are you feeling?', 'Hello. Tell me what\'s bothering you, in your own words.', 'Hey — I\'m listening. What\'s going on?'])], parts };
  if (!S.c) {
    if (mode || side) return { say: [side || 'Happy to — first tell me what you\'re feeling and where.'], parts };
    return { say: [askLine('where')], parts };
  }
  if (mode) {
    // Safety first: the red-flag question is always asked before reassurance or advice.
    if (S.c.ask && S.redOk == null) { S.want = mode; return { say: ['I will — one important question first.', askLine('red')], parts }; }
    return { say: deliver(mode), parts, mode };
  }
  if (S.want && S.lastQ === 'red' && S.redOk === false) { const m = S.want; return { say: ['Okay, good — that makes something serious less likely.', ...deliver(m)], parts, mode: m }; }
  if (S.stage === 'done') {
    if (newTopic || !S.done.length) { /* fall through to gathering for the new topic */ }
    else if (AFFIRM.test(s) && !DENY.test(s)) { const nxt = S.done.includes('reasons') && !S.done.includes('solutions') ? 'solutions' : S.done.includes('solutions') && !S.done.includes('guidance') ? 'guidance' : 'advice'; return { say: deliver(nxt), parts, mode: nxt }; }
    else if (DENY.test(s)) return { say: [pick('nomore', ['Okay. I\'m here if you need me.', 'Alright. Just tell me if anything changes.'])], parts };
    else if (it || on || pt || w || syms.length) return { say: [pick('upd', ['Thanks, I\'ve noted that.', 'Okay, that adds to the picture.']), f.intensity?.lvl >= 7 || f.trend === 'worse' ? 'Since it\'s strong or getting worse, please let the crew medical officer know now.' : 'Would you like me to go over what helps again?'], parts };
  }
  // 6) gathering — one relevant question at a time
  if (S.stage === 'gather' || newTopic) {
    S.stage = 'gather';
    const lead = [];
    if (newTopic) {
      lead.push(adding && S.more.length ? pick('add', [`${S.c.label.replace(/^your/, 'Your')} as well — okay.`, `Okay, ${S.c.label} too.`]) : correcting ? pick('corr', [`Ah, ${S.c.label} — thanks for correcting me.`, `Got it, ${S.c.label} then.`]) : (f.intensity?.lvl ?? 0) >= 7 ? '' : pick('open.' + S.c.id, ['That sounds uncomfortable.', 'Okay.', 'I\'m sorry, that\'s no fun.']));
      if (S.more.length && !adding) lead.push(`I heard ${S.more.map(m => m.label).join(' and ')} too — I'll keep that in mind.`);

    } else { const a = ack(prevStage); if (a) lead.push(a); }
    if (f.intensity?.lvl >= 7 && !S.asked.has('severe-note')) { S.asked.add('severe-note'); lead.length = 0; lead.push(pick('sev', ['That sounds really bad — let\'s take it seriously.', 'Okay, that\'s a lot of pain. Let\'s be careful.'])); }
    const k = nextQuestion();
    if (k) return { say: [...lead.filter(Boolean), askLine(k)], parts, severity: severityOf() };
    if ((f.intensity?.lvl ?? 0) >= 7) { S.lastQ = null; return { say: [...lead.filter(Boolean), ...severeNext()], parts, severity: 'severe' }; }
    S.stage = 'offer'; S.lastQ = 'offer';
    return { say: [...lead.filter(Boolean), OFFER()], parts, mode: 'ask_preference' };
  }
  if (S.stage === 'offer' && (syms.length || mentions.length)) return { say: [`Noted — ${[...syms, ...mentions.filter(m => m !== S.c).map(m => m.label)].join(' and ')} as well.`, pick('reoffer2', ['Now, would you like the possible reasons, what to do about it, advice, or step-by-step guidance?', 'With that in mind — reasons, solutions, advice, or guidance?'])], parts };
  if (S.stage === 'offer') return { say: [pick('reoffer', ['Would you like the possible reasons, what to do about it, practical advice, or step-by-step guidance?', 'Just tell me: reasons, solutions, advice, guidance — or everything.'])], parts };
  return { say: [pick('fallback', ['Tell me more about what you\'re feeling.', 'I\'m listening — what else is going on?'])], parts };
}
