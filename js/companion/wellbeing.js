// ORBITAL / ORBI — 24/7 observation of sleep, behaviour and social contact, plus the rules that decide when ORBI steps in.
// In the mission concept ORBI's RGB eye (light) and thermal eye (darkness, sleep) observe continuously. In this
// prototype overnight and behavioural observations come from labelled demo scenarios ("Simulated").
// ORBI looks for PATTERNS against the astronaut's own baseline — it never diagnoses depression or any condition.
import { state, addRecords, latest, daily, startOfDay, DAY, dayKey, on } from '../store.js';
import { DB } from '../db.js';
import { missedStreak, dayStatus } from './daily.js';
import { EARTH_BASELINE } from './content.js';
import { mean, median } from '../analysis.js';

const H = 3600e3;
const within = (type, ms) => { const r = latest(type); return r && Date.now() - r.ts <= ms ? r : null; };
const val = (type, ms) => within(type, ms)?.value ?? null;
const prevNights = (type, n = 7) => { const today = startOfDay(Date.now()); return daily(type, n + 1).filter(d => d.value != null && d.ts < today - DAY * 0).slice(0, -1).slice(-n).map(d => d.value); };

export function assess() {
  // ---- sleep (last night) ----
  const sl = within('sleep_h', 40 * H);
  let sleep = null;
  if (sl) {
    sleep = { h: sl.value, q: val('sleep_q', 40 * H), latency: val('sleep_latency', 40 * H), wakes: val('sleep_wakes', 40 * H), restless: val('sleep_restless', 40 * H), notes: sl.meta?.notes || '', ts: sl.ts, periods: sl.meta?.periods || null, monitor: sl.meta?.monitor || 'thermal eye (darkness)' };
    sleep.insomnia = (sleep.latency ?? 0) >= 30 || ((sleep.wakes ?? 0) >= 3 && sleep.h < 6) || sleep.h < 5;
    sleep.discomfort = (sleep.restless ?? 0) >= 60;
    const prevH = state.records.filter(r => r.type === 'sleep_h' && r.ts < sl.ts - 12 * H).slice(-7).map(r => r.value);
    const prevL = state.records.filter(r => r.type === 'sleep_latency' && r.ts < sl.ts - 12 * H).slice(-7).map(r => r.value);
    sleep.avg7 = prevH.length ? mean(prevH) : null; sleep.lat7 = prevL.length ? mean(prevL) : null;
    sleep.earth = EARTH_BASELINE.values.sleep_h;
    sleep.repeated = state.records.filter(r => r.type === 'sleep_latency' && r.ts > Date.now() - 4 * DAY && r.value >= 30).length >= 3;
    sleep.change = sleep.avg7 != null && sleep.h < sleep.avg7 - 1.2 ? `${(sleep.avg7 - sleep.h).toFixed(1)} h less than your 7-night average (${sleep.avg7.toFixed(1)} h)` : sleep.avg7 != null && sleep.h > sleep.avg7 + 1.2 ? `${(sleep.h - sleep.avg7).toFixed(1)} h more than your 7-night average` : null;
  }
  // ---- stress & muscle tension (last 12 h) ----
  const tension = val('tension', 12 * H), stressV = val('stress', 12 * H), tRec = within('tension', 12 * H);
  const stress = { tension, stress: stressV, muscle: (tension ?? 0) >= 60, detected: (tension ?? 0) >= 60 || (stressV ?? 0) >= 7, notes: tRec?.meta?.notes || '', thermal: tRec?.meta?.thermal || null };
  // ---- mood, silence & social contact ----
  const today = startOfDay(Date.now());
  const aff = val('affect_low', 12 * H);
  const lowDays = daily('affect_low', 4).filter(d => d.value != null && d.value >= 65).length;
  const sil = state.records.filter(r => r.type === 'silence_h' && r.ts >= today).at(-1);
  const soc = state.records.filter(r => r.type === 'social_min' && r.ts >= today).at(-1);
  const socYest = state.records.filter(r => r.type === 'social_min' && r.ts >= today - DAY && r.ts < today).at(-1);
  const usualSocial = median(state.records.filter(r => r.type === 'social_min' && r.ts < today).slice(-14).map(r => r.value)) ?? EARTH_BASELINE.values.social_min;
  const context = sil?.meta?.context || 'idle';
  const crewPresent = sil?.meta?.crewPresent ?? true;
  const mood = { affectLow: aff, silence: sil?.value ?? null, social: soc?.value ?? null, usualSocial, crewPresent, context, lowDays, persistent: lowDays >= 3, notes: within('affect_low', 12 * H)?.meta?.notes || sil?.meta?.notes || '' };
  const socialLow = mood.social != null && mood.social < 0.4 * usualSocial;
  // normal silence: concentration on a task, or sleep, or nobody around → not withdrawal
  mood.normalSilence = (mood.silence ?? 0) >= 4 && (context === 'focused work' || context === 'sleep' || !crewPresent);
  mood.withdrawal = (mood.silence ?? 0) >= 6 && crewPresent && !mood.normalSilence && socialLow && ((aff ?? 0) >= 55 || (socYest && socYest.value < 0.4 * usualSocial));
  mood.severity = (mood.persistent || mood.withdrawal || (aff ?? 0) >= 80) ? 'severe' : ((aff ?? 0) >= 55 || (socialLow && !mood.normalSilence)) ? 'watch' : 'ok';
  // ---- physical fatigue pattern ----
  const per = val('perclos', 24 * H), mv = val('move_speed', 30 * H);
  const fatigue = { perclos: per, move: mv, flagged: ((per ?? 0) > 12 ? 1 : 0) + ((mv ?? 100) < 65 ? 1 : 0) + ((sleep?.h ?? 8) < 5.5 ? 1 : 0) >= 2 };
  const ex = { today: dayStatus(today), yesterday: dayStatus(today - DAY), missed: missedStreak() };
  return { sleep, stress, mood, fatigue, ex };
}

// ---------- demo scenarios (what ORBI's cameras would observe) ----------
const R = (type, value, meta = {}, dt = 0) => ({ type, value, source: 'simulated', ts: Date.now() - dt, meta: { via: 'ORBI 24/7 (simulated)', ...meta } });
function night({ onset, wakes, restless, end = 7 }) {
  // build a sleep/wake timeline from 22:30 to `end` (hours since 22:30 ≈ 8.5h window)
  const p = []; const bed = 0; let t = bed; const W = end + 1.5;
  p.push({ s: t, e: t + onset / 60, st: 'awake' }); t += onset / 60;
  const segs = wakes + 1; const left = W - t; const wakeLen = restless > 60 ? 0.25 : 0.35;
  for (let i = 0; i < segs; i++) {
    const len = (left - wakes * wakeLen) / segs;
    p.push({ s: t, e: t + len, st: restless > 60 && i % 2 ? 'restless' : 'asleep' }); t += len;
    if (i < wakes) { p.push({ s: t, e: t + wakeLen, st: 'awake' }); t += wakeLen; }
  }
  return p.map(x => ({ s: +x.s.toFixed(2), e: +x.e.toFixed(2), st: x.st }));
}
const asleepH = p => p.filter(x => x.st !== 'awake').reduce((s, x) => s + (x.e - x.s), 0);
function sleepRecs(label, cfg, notes) {
  const periods = night(cfg); const h = +Math.min(asleepH(periods), cfg.cap ?? 9).toFixed(1);
  return [R('sleep_h', h, { notes, periods, monitor: 'thermal eye (darkness) + RGB at lights-on', label }), R('sleep_q', cfg.q), R('sleep_latency', cfg.onset), R('sleep_wakes', cfg.wakes), R('sleep_restless', cfg.restless)];
}
export const SCENARIOS = {
  good_night: { label: 'Restful night', group: 'sleep', recs: () => sleepRecs('restful', { onset: 11, wakes: 1, restless: 18, q: 8.2 }, 'Thermal eye: still body position, regular breathing at 13/min, one brief awakening at 03:10.') },
  insomnia: { label: 'Insomnia night', group: 'sleep', recs: () => sleepRecs('insomnia', { onset: 75, wakes: 4, restless: 44, q: 3.1, end: 5.5 }, 'Thermal eye: eyes-open head movements in the dark for 75 minutes before sleep onset, awake again for long periods after 03:40.') },
  discomfort: { label: 'Sleep discomfort', group: 'sleep', recs: () => sleepRecs('discomfort', { onset: 22, wakes: 3, restless: 79, q: 4.2, end: 6.5 }, 'Thermal eye: frequent repositioning in the sleeping bag, hand on the lower back, cool feet and warm face.') },
  calm: { label: 'Calm, social day', group: 'day', recs: () => [R('tension', 18, { notes: 'Relaxed face and shoulders.' }), R('stress', 2.8), R('affect_low', 15, { notes: 'Frequent smiles, animated conversation.' }), R('mood', 7.8), R('silence_h', 1.2, { crewPresent: true, context: 'idle' }), R('social_min', 85)] },
  focused: { label: 'Long silence while concentrating (normal)', group: 'day', recs: () => [R('silence_h', 6.5, { crewPresent: true, context: 'focused work', notes: 'Silent but focused: hands busy on the experiment rack, steady gaze, normal posture, brief exchanges at meals.' }), R('social_min', 45), R('affect_low', 22), R('tension', 30)] },
  stress: { label: 'Stress & muscle tension', group: 'day', recs: () => [R('tension', 81, { notes: 'Jaw clenching, raised shoulders, frowning, fidgeting.', thermal: 'Forehead +0.6 °C, nose tip −0.8 °C vs baseline (typical acute-stress pattern).' }), R('stress', 7.9), R('affect_low', 40), R('mood', 5.6)] },
  withdrawal: { label: 'Long silence / withdrawal', group: 'day', recs: () => [R('social_min', 8, {}, DAY), R('silence_h', 9.5, { crewPresent: true, context: 'idle', notes: 'Crew present but no conversation for 9.5 h, meals eaten alone, long periods floating without activity.' }), R('social_min', 2), R('affect_low', 64, { notes: 'Flat expression, looking down, little eye contact.' }), R('mood', 4.2)] },
  low_mood: { label: 'Persistent low-mood signs', group: 'day', recs: () => [
    ...[3, 2, 1].map(d => R('affect_low', 70 + d * 2, { notes: 'Flat expression, slowed movement.' }, d * DAY)),
    R('affect_low', 84, { notes: 'Flat expression, slowed movements, long periods staring, tearfulness observed, skipped a shared meal.' }), R('mood', 3.1), R('silence_h', 6.5, { crewPresent: true, context: 'idle' }), R('social_min', 6)] },
};
export async function simulate(kind) { const s = SCENARIOS[kind]; if (!s) return; await addRecords(s.recs()); }

// ---------- mission-operations quiet mode ----------
// While a critical operation is in progress ORBI does not interrupt with non-urgent support; it waits until it ends.
let ops = false; const opsSubs = new Set();
export const opsMode = () => ops;
export const onOps = fn => { opsSubs.add(fn); return () => opsSubs.delete(fn); };
export async function setOps(v) { ops = !!v; opsSubs.forEach(f => f(ops)); if (!ops) await flushDeferred(); }

// ---------- interventions ----------
const subs = new Set();
export const onIntervention = fn => { subs.add(fn); return () => subs.delete(fn); };
let mem = null;
export async function companionMem() { if (!mem) mem = (await DB.kvGet('companion')) || { log: [], done: {} }; mem.deferred = mem.deferred || []; return mem; }
export async function saveMem() { await DB.kvSet('companion', mem); }
const URGENT = new Set(['safety']);
async function deliver(reason, a, data) { subs.forEach(f => { try { f(reason, a, data); } catch (e) { console.error(e); } }); }
async function flushDeferred() { const m = await companionMem(); const list = m.deferred; m.deferred = []; await saveMem(); for (const d of list) await deliver(d.reason, assess(), d.data); }

export async function check() {
  const m = await companionMem(); const a = assess(); const k = dayKey(Date.now());
  const fire = async (reason, data, key = reason) => {
    if (m.done[key] === k) return;
    m.done[key] = k; m.log.push({ ts: Date.now(), reason, deferred: ops && !URGENT.has(reason) }); m.log = m.log.slice(-60);
    if (ops && !URGENT.has(reason)) { m.deferred.push({ reason, data }); await saveMem(); return; }
    await saveMem(); await deliver(reason, a, data);
  };
  // immediate safety checks on critical single readings (never wait for multi-day patterns)
  const st = within('skin_temp', 2 * H); if (st && st.value >= 37.8) await fire('safety', { kind: 'temp', value: st.value }, 'safety-temp');
  const hr = within('hr', 10 * 60e3); if (hr && (hr.value >= 130 || hr.value <= 40) && hr.meta?.atRest !== false) await fire('safety', { kind: 'hr', value: hr.value }, 'safety-hr');
  // significant & persistent patterns
  if (a.mood.persistent || (a.mood.affectLow ?? 0) >= 80) await fire('low_mood');
  else if (a.mood.withdrawal) await fire('withdrawal');
  if (['missed', 'overdue', 'partial'].includes(a.ex.today)) await fire('exercise', { status: a.ex.today });
  if (a.stress.detected) await fire('stress');
  if (a.sleep?.insomnia || a.sleep?.discomfort) await fire('sleep');
  if (a.fatigue.flagged) await fire('fatigue');
  return a;
}
let started = false;
export function startWatching() {
  if (started) return; started = true;
  on(w => { if (w === 'records') check(); });
  setInterval(check, 60e3); check();
}
