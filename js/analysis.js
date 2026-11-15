// ORBITAL — local, transparent rule-based health analysis engine.
// No network, no black box: every alert lists the rule, the data and the sources that triggered it.
// Correlations are reported as associations only — never as proven causes — and nothing here is a diagnosis.
import { state, byType, daily, DAY, startOfDay, latest, missionDay, saveItem } from './store.js';
import { METRICS, SYMPTOMS, RAD_CAREER_LIMIT_MSV, HAZARDS, SOURCES } from './metrics.js';

// ---------- statistics ----------
export const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
export const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export function linreg(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx, icpt = my - slope * mx;
  const res = ys.map((y, i) => y - (icpt + slope * xs[i]));
  const se = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2));
  return { slope, icpt, se, n, predict: x => icpt + slope * x };
}
export function pearson(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < 7) return null;
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return null;
  return { r: sxy / Math.sqrt(sxx * syy), n: xs.length };
}

// ---------- baseline ----------
/** Personal baseline: median of values in the baseline window (mission days `from` .. from+len-1).
 *  Falls back to the earliest half of the available history when the window has too few points. */
export function baseline(type) {
  const vals = byType(type); if (vals.length < 4) return null;
  const p = state.profile || {}; const len = p.baselineDays || 7; const from = p.baselineFrom || 5;
  let win = [];
  if (p.missionStart) {
    const s = startOfDay(new Date(p.missionStart).getTime());
    const a = s + (from - 1) * DAY, b = a + len * DAY;
    win = vals.filter(r => r.ts >= a && r.ts < b);
  }
  let method = `median of mission days ${from}–${from + len - 1}`;
  if (win.length < 3) { win = vals.slice(0, Math.max(3, Math.floor(vals.length / 2))); method = `median of earliest ${win.length} records (baseline still forming)`; }
  const xs = win.map(r => r.value);
  const med = median(xs);
  const mad = median(xs.map(x => Math.abs(x - med))) * 1.4826;
  const spread = Math.max(mad, sd(xs) * 0.5, Math.abs(med) * 0.03, 1e-6);
  return { value: med, spread, n: xs.length, method, sources: [...new Set(win.map(r => r.source))] };
}

export function recent(type, days = 3) {
  const since = Date.now() - days * DAY;
  const rs = byType(type, since);
  if (!rs.length) return null;
  return { value: mean(rs.map(r => r.value)), n: rs.length, sources: [...new Set(rs.map(r => r.source))], last: rs[rs.length - 1] };
}

export function compare(type, days = 3) {
  const b = baseline(type), r = recent(type, days), m = METRICS[type];
  if (!b || !r || !m) return null;
  const delta = r.value - b.value;
  const pct = b.value ? (delta / Math.abs(b.value)) * 100 : 0;
  const z = delta / b.spread;
  let worse = false;
  if (m.better === 'higher') worse = delta < 0;
  else if (m.better === 'lower') worse = delta > 0;
  else worse = Math.abs(z) > 0; // range metrics: any large deviation is notable
  const notable = Math.abs(z) >= 2 && Math.abs(pct) >= 8;
  return { type, base: b, rec: r, delta, pct, z, worse, notable, strong: Math.abs(z) >= 3 && Math.abs(pct) >= 12 };
}

// ---------- helpers ----------
const f = (v, t) => v == null ? '—' : Number(v).toFixed(METRICS[t]?.dec ?? 1);
const srcList = s => s.map(x => SOURCES[x]?.short || x).join(', ');
const ev = (label, value, sources) => ({ label, value, sources: Array.isArray(sources) ? sources : [sources] });
const symName = id => SYMPTOMS.find(s => s.id === id)?.label || id;

function symptomCounts(days = 7) {
  const since = Date.now() - days * DAY; const c = {};
  state.records.filter(r => r.type === 'symptom' && r.ts >= since).forEach(r => { const k = r.meta?.symptom; c[k] = (c[k] || 0) + 1; });
  return c;
}

const WHY = {
  hr: 'A sustained change in resting heart rate can reflect fatigue, stress, dehydration, illness or cardiovascular deconditioning in microgravity.',
  rr: 'A change in resting breathing rate can accompany exertion, anxiety, elevated CO₂ or respiratory illness.',
  reaction_ms: 'Slower reaction times are a sensitive marker of sleep loss and fatigue and can affect safety during critical tasks.',
  coordination: 'Reduced hand-eye accuracy may relate to sensorimotor adaptation, fatigue or reduced concentration.',
  posture: 'Changes in posture and balance can reflect vestibular adaptation, back muscle deconditioning or fatigue.',
  gaze_stability: 'Gaze-following quality depends on vestibular/oculomotor function and alertness; it changes during gravity transitions.',
  blink_rate: 'Blink behaviour changes with fatigue, eye dryness (low humidity) and screen work.',
  perclos: 'Longer eye-closure time is one of the best-studied visual signs of drowsiness.',
  sleep_h: 'Short sleep impairs attention, mood and immune function; spaceflight commonly disrupts sleep.',
  sleep_q: 'Poor sleep quality is linked to lower mood, slower reactions and higher stress.',
  mood: 'A persistent drop in mood during isolation can affect wellbeing, crew cohesion and performance.',
  stress: 'Sustained stress affects sleep, heart rate, immune function and decision-making.',
  concentration: 'Reduced concentration increases the risk of errors during complex procedures.',
  exercise_min: 'Exercise is the main countermeasure against muscle and bone loss and cardiovascular deconditioning in reduced gravity.',
  loneliness: 'Loneliness is a known psychosocial risk of isolation and confinement.',
  kss: 'Rising self-rated sleepiness indicates accumulating fatigue.',
};
const NEXT = {
  hr: ['Re-check resting heart rate with the onboard medical device', 'Review sleep, hydration and stress', 'Report to the crew medical officer if accompanied by symptoms'],
  rr: ['Re-check at rest with a validated device', 'Check cabin CO₂ readings', 'Report breathing difficulty immediately'],
  reaction_ms: ['Repeat the reaction test after rest', 'Prioritise sleep opportunity', 'Avoid scheduling critical tasks while lapses persist if mission allows'],
  coordination: ['Repeat the coordination test', 'Review sleep and exercise', 'Discuss persistent decline with the medical officer'],
  posture: ['Complete prescribed core/back exercises', 'Repeat the posture test', 'Report back pain or balance problems'],
  gaze_stability: ['Repeat the eye-tracking test when rested', 'Report vision changes or dizziness'],
  blink_rate: ['Take screen breaks', 'Check cabin humidity', 'Use lubricating eye drops if approved'],
  perclos: ['Consider a rest break or nap if schedule allows', 'Complete the fatigue & alertness test'],
  sleep_h: ['Protect the scheduled sleep period', 'Use light/noise controls in crew quarters', 'Discuss persistent insomnia with the medical officer'],
  sleep_q: ['Review evening light exposure and caffeine timing', 'Try a relaxation exercise before sleep'],
  mood: ['Try a relaxation or breathing exercise', 'Schedule a private family or psychological support conference', 'Talk with a crewmate you trust'],
  stress: ['Use a guided breathing exercise', 'Review workload with crew/mission control', 'Use the private wellbeing assistant'],
  concentration: ['Use checklists for critical tasks', 'Take short breaks', 'Review sleep'],
  exercise_min: ['Return to the prescribed exercise schedule', 'Ask mission control to protect exercise time'],
  loneliness: ['Schedule personal communication with family when available', 'Plan shared crew activities (meals, films)'],
  kss: ['Rest when possible', 'Avoid critical tasks while very sleepy'],
};

// ---------- main analysis ----------
export function analyze() {
  const alerts = [];
  const push = a => alerts.push({ medical: false, correlation: false, kind: 'wellness', ...a });
  const cmp = {};
  const personal = ['hr', 'rr', 'reaction_ms', 'coordination', 'posture', 'gaze_stability', 'blink_rate', 'perclos', 'sleep_h', 'sleep_q', 'mood', 'stress', 'concentration', 'exercise_min', 'loneliness', 'kss'];
  for (const t of personal) cmp[t] = compare(t, ['loneliness'].includes(t) ? 7 : 3);

  // R1 — personal baseline deviations
  for (const t of personal) {
    const c = cmp[t]; if (!c || !c.notable || !c.worse) continue;
    const m = METRICS[t];
    const dirWord = c.delta > 0 ? 'higher' : 'lower';
    push({
      key: 'dev-' + t, rule: 'R1 personal-baseline deviation', level: c.strong ? 'warning' : 'caution',
      title: `${m.label} ${dirWord} than your baseline`, hazards: m.hazards, organs: m.organs,
      what: `Recent average ${f(c.rec.value, t)} ${m.unit} vs. personal baseline ${f(c.base.value, t)} ${m.unit} (${c.pct > 0 ? '+' : ''}${c.pct.toFixed(0)}%, ${Math.abs(c.z).toFixed(1)}× your normal variation).`,
      why: WHY[t] || 'This differs noticeably from your own normal range.',
      evidence: [ev(`${m.label} – last ${t === 'loneliness' ? 7 : 3} days (${c.rec.n} records)`, `${f(c.rec.value, t)} ${m.unit}`, c.rec.sources), ev(`Baseline (${c.base.method})`, `${f(c.base.value, t)} ${m.unit}`, c.base.sources)],
      next: NEXT[t] || ['Keep monitoring'],
    });
  }

  // R2 — reference ranges for device measurements (manual / imported / simulated device data)
  const lastOf = t => latest(t);
  const spo2 = lastOf('spo2');
  if (spo2 && Date.now() - spo2.ts < 2 * DAY) {
    if (spo2.value < 90) push({ key: 'ref-spo2-low', rule: 'R2 reference range', level: 'warning', medical: true, kind: 'medical', title: 'Low blood-oxygen reading', hazards: ['environment'], organs: ['lungs', 'blood'], what: `SpO₂ ${f(spo2.value, 'spo2')}% recorded.`, why: 'Readings below 90% are commonly treated as significant low oxygen and need prompt checking.', evidence: [ev('Latest SpO₂', spo2.value + '%', spo2.source)], next: ['Re-measure with the pulse oximeter (warm hands, still)', 'Check cabin O₂/pressure readings', 'Contact the crew medical officer now', 'If breathing difficulty: open Emergency Center'] });
    else if (spo2.value < 95) push({ key: 'ref-spo2', rule: 'R2 reference range', level: 'caution', medical: true, title: 'Blood-oxygen reading below typical range', hazards: ['environment'], organs: ['lungs'], what: `SpO₂ ${f(spo2.value, 'spo2')}% (typical ≥95%).`, why: 'Could be a measurement artefact or reduced oxygenation.', evidence: [ev('Latest SpO₂', spo2.value + '%', spo2.source)], next: ['Re-measure', 'Report to medical officer if repeated'] });
  }
  const tmp = lastOf('temp');
  if (tmp && Date.now() - tmp.ts < 2 * DAY && tmp.value >= 38.0) push({ key: 'ref-temp', rule: 'R2 reference range', level: tmp.value >= 39.0 ? 'warning' : 'caution', medical: true, kind: 'medical', title: 'Elevated body temperature', hazards: ['environment', 'radiation'], organs: ['blood'], what: `Thermometer reading ${f(tmp.value, 'temp')} °C (≥38.0 °C is generally considered fever).`, why: 'Fever may indicate infection; immune function can be altered in spaceflight.', evidence: [ev('Latest temperature', tmp.value + ' °C', tmp.source)], next: ['Re-measure in 30 minutes', 'Hydrate and rest', 'Report to the crew medical officer', 'Note any other symptoms'] });
  const bs = lastOf('bp_sys'), bd = lastOf('bp_dia');
  if (bs && Date.now() - bs.ts < 3 * DAY && (bs.value >= 140 || (bd && bd.value >= 90))) push({ key: 'ref-bp', rule: 'R2 reference range', level: (bs.value >= 180 || (bd && bd.value >= 120)) ? 'warning' : 'caution', medical: true, title: 'Blood pressure above typical range', hazards: ['gravity'], organs: ['heart', 'vessels'], what: `BP ${f(bs.value, 'bp_sys')}/${bd ? f(bd.value, 'bp_dia') : '—'} mmHg.`, why: 'Readings ≥140/90 mmHg are above guideline ranges (ACC/AHA 2017) and should be confirmed by repeat measurement.', evidence: [ev('Latest BP', `${bs.value}/${bd?.value ?? '—'}`, bs.source)], next: ['Repeat after 5 min seated rest', 'Report to the crew medical officer if confirmed'] });
  const hrl = lastOf('hr');
  if (hrl && Date.now() - hrl.ts < DAY && hrl.source !== 'estimated' && hrl.value > 100) push({ key: 'ref-hr', rule: 'R2 reference range', level: 'caution', medical: true, title: 'Resting heart rate above 100 bpm', hazards: ['gravity'], organs: ['heart'], what: `Resting HR ${f(hrl.value, 'hr')} bpm.`, why: 'A resting rate above 100 bpm is above the usual adult range; confirm it was measured at rest.', evidence: [ev('Latest HR', hrl.value + ' bpm', hrl.source)], next: ['Re-measure after 5 min rest', 'Report if palpitations, chest pain or breathlessness'] });

  // R3 — environment thresholds (latest 24 h)
  for (const t of ['env_co2', 'env_voc', 'env_pm', 'env_noise', 'env_temp', 'env_humidity', 'env_pressure', 'env_o2']) {
    const m = METRICS[t]; const rs = byType(t, Date.now() - DAY); if (!rs.length) continue;
    const avg = mean(rs.map(r => r.value)); const mx = Math.max(...rs.map(r => r.value)); const srcs = [...new Set(rs.map(r => r.source))];
    if (m.warn != null && mx > m.warn) push({ key: 'env-' + t, rule: 'R3 environment threshold', level: mx > m.crit ? 'warning' : 'caution', hazards: ['environment'], organs: m.organs, title: `${m.label} above configured limit`, what: `Peak ${f(mx, t)} ${m.unit} in the last 24 h (24-h mean ${f(avg, t)}); configured caution limit ${m.warn} ${m.unit}.`, why: t === 'env_co2' ? 'Elevated CO₂ in spacecraft has been associated with headaches, lethargy and reduced concentration.' : 'Exceeding environmental limits can cause discomfort or health effects with prolonged exposure.', evidence: [ev('Readings (last 24 h)', `${rs.length} samples`, srcs)], next: ['Verify reading with a second sensor if available', 'Notify crew / environmental control (ECLSS) officer', 'Follow vehicle environmental procedures'] });
    if (m.ref && (avg < m.ref[0] || avg > m.ref[1])) push({ key: 'envr-' + t, rule: 'R3 environment range', level: 'caution', hazards: ['environment'], organs: m.organs, title: `${m.label} outside configured range`, what: `24-h mean ${f(avg, t)} ${m.unit}; configured range ${m.ref[0]}–${m.ref[1]}.`, why: m.refNote || '', evidence: [ev('Readings (last 24 h)', `${rs.length} samples`, srcs)], next: ['Check environmental control settings', 'Report to ECLSS officer'] });
  }

  // R4 — radiation
  const rad = byType('env_rad');
  if (rad.length) {
    const total = rad.reduce((s, r) => s + r.value, 0);
    const last = rad[rad.length - 1]; const m = METRICS.env_rad;
    const recentSpike = rad.filter(r => r.ts > Date.now() - 2 * DAY && r.value > m.warn);
    if (recentSpike.length) push({ key: 'rad-spike', rule: 'R4 radiation dose', level: Math.max(...recentSpike.map(r => r.value)) > m.crit ? 'warning' : 'caution', hazards: ['radiation'], organs: ['blood', 'eyes', 'skin'], title: 'Elevated daily radiation dose', what: `Daily dose up to ${f(Math.max(...recentSpike.map(r => r.value)), 'env_rad')} mSv/day in the last 48 h (configured caution ${m.warn}).`, why: 'Spikes can indicate a solar particle event. Total dose adds to long-term cancer and cataract risk.', evidence: [ev('Dosimeter (last 48 h)', `${recentSpike.length} elevated day(s)`, [...new Set(recentSpike.map(r => r.source))])], next: ['Follow the mission radiation shelter procedure if instructed', 'Keep wearing personal dosimeter', 'Log any nausea, fatigue or skin changes'] });
    const frac = total / RAD_CAREER_LIMIT_MSV;
    if (frac > 0.05) push({ key: 'rad-cum', rule: 'R4 cumulative dose', level: frac > 0.5 ? 'warning' : 'info', hazards: ['radiation'], organs: ['blood'], title: 'Cumulative mission radiation dose', what: `Mission total ${total.toFixed(1)} mSv = ${(frac * 100).toFixed(1)}% of the 600 mSv NASA career effective-dose limit (NASA-STD-3001).`, why: 'Dose accumulates over the mission; tracking supports long-term risk management and shielding decisions.', evidence: [ev('Dosimeter records', `${rad.length} days`, [...new Set(rad.map(r => r.source))])], next: ['Review dose with mission radiation specialist when link is available'] });
    // R4b — radiation event followed by lower lymphocytes (association, not causation)
    const lab = n => state.records.filter(r => r.type === 'lab' && r.meta?.name === n);
    const ly = lab('Lymphocytes');
    const spe = rad.find(r => r.value > m.crit);
    if (ly.length >= 2 && spe) {
      const a = ly[ly.length - 2], b = ly[ly.length - 1];
      if (b.ts > spe.ts && a.ts < spe.ts && b.value < a.value * 0.9) push({ key: 'x-rad-immune', rule: 'X1 cross-hazard: radiation × laboratory', level: 'caution', correlation: true, medical: true, hazards: ['radiation', 'environment'], organs: ['blood'], title: 'Lymphocyte count lower after a radiation event', what: `Lymphocytes ${a.value.toFixed(2)} → ${b.value.toFixed(2)} ×10⁹/L between lab panels; a dose spike of ${spe.value.toFixed(1)} mSv/day occurred in between.`, why: 'Radiation and spaceflight stress can both affect immune cells. This is a time association only — many factors change lymphocyte counts.', evidence: [ev('Lab panels', '2 panels', [...new Set(ly.map(r => r.source))]), ev('Dosimeter spike', spe.value.toFixed(1) + ' mSv/day', spe.source)], next: ['Medical officer review of the full lab panel', 'Repeat blood count per mission schedule', 'Report infections or fever promptly'] });
    }
  }

  // X2 — fatigue cluster (isolation × performance)
  const fat = [['sleep_h', cmp.sleep_h], ['kss', cmp.kss], ['perclos', cmp.perclos], ['reaction_ms', cmp.reaction_ms], ['concentration', cmp.concentration], ['sleep_q', cmp.sleep_q]].filter(([, c]) => c && c.worse && Math.abs(c.z) >= 1.5);
  if (fat.length >= 3) push({ members: fat.map(([t]) => t), key: 'x-fatigue', rule: 'X2 multi-indicator fatigue pattern', level: fat.length >= 4 ? 'warning' : 'caution', correlation: true, hazards: ['isolation', 'distance'], organs: ['brain', 'eyes'], title: 'Several fatigue indicators are changing together', what: `${fat.length} related indicators moved in the "more fatigued" direction: ${fat.map(([t]) => METRICS[t].label).join(', ')}.`, why: 'Changes that appear together are more meaningful than a single reading. This pattern is consistent with accumulating sleep debt but does not confirm fatigue medically.', evidence: fat.map(([t, c]) => ev(METRICS[t].label, `${f(c.rec.value, t)} vs ${f(c.base.value, t)} ${METRICS[t].unit}`, c.rec.sources)), next: ['Protect the next sleep period', 'Complete the Fatigue & Alertness camera test', 'Discuss workload with crew/mission control', 'Avoid critical solo tasks while very sleepy'] });

  // X3 — persistent mood/stress pattern
  const ps = ['mood', 'stress', 'loneliness', 'sleep_q'].map(t => [t, cmp[t]]).filter(([, c]) => c && c.worse && Math.abs(c.z) >= 1.5);
  if (ps.length >= 2) {
    const m5 = daily('mood', 5).filter(d => d.value != null), b = cmp.mood?.base?.value;
    const persistent = b != null && m5.length >= 4 && m5.every(d => d.value < b);
    push({ members: ps.map(([t]) => t), key: 'x-psych', rule: 'X3 persistent psychosocial pattern', level: persistent ? 'warning' : 'caution', correlation: true, hazards: ['isolation'], organs: ['brain'], title: persistent ? 'Lower mood has persisted for 5 days alongside other changes' : 'Mood-related indicators changing together', what: ps.map(([t, c]) => `${METRICS[t].label} ${f(c.rec.value, t)} (baseline ${f(c.base.value, t)})`).join('; ') + '.', why: 'Isolation and confinement can gradually affect mood, stress and sleep. This is a supportive check-in, not a psychological diagnosis.', evidence: ps.map(([t, c]) => ev(METRICS[t].label, f(c.rec.value, t), c.rec.sources)), next: ['Try a guided relaxation exercise', 'Use the private wellbeing assistant', 'Consider a private psychological support conference when the link allows', 'Plan a shared crew activity'] });
  }

  // X4 — environment × symptoms (CO2 vs headache days)
  const co2d = daily('env_co2', 30);
  const headDays = new Set(state.records.filter(r => r.type === 'symptom' && r.meta?.symptom === 'headache').map(r => startOfDay(r.ts)));
  const hiCo2 = co2d.filter(d => d.value != null && d.value > METRICS.env_co2.warn);
  if (hiCo2.length && headDays.size) {
    const overlap = hiCo2.filter(d => headDays.has(d.ts)).length;
    const pHi = overlap / hiCo2.length; const loDays = co2d.filter(d => d.value != null && d.value <= METRICS.env_co2.warn);
    const pLo = loDays.length ? loDays.filter(d => headDays.has(d.ts)).length / loDays.length : 0;
    if (overlap >= 2 && pHi > pLo + 0.3) push({ key: 'x-co2-headache', rule: 'X4 cross-hazard: environment × symptoms', level: 'caution', correlation: true, hazards: ['environment'], organs: ['brain', 'lungs'], title: 'Headaches were reported more often on high-CO₂ days', what: `Headache reported on ${overlap} of ${hiCo2.length} days with mean CO₂ > ${METRICS.env_co2.warn} mmHg (${(pHi * 100).toFixed(0)}%) vs ${(pLo * 100).toFixed(0)}% of other days.`, why: 'Elevated CO₂ has been associated with headaches in ISS crew reports (Law et al., 2014). This is an association in your data, not proof that CO₂ caused the headaches.', evidence: [ev('Cabin CO₂ daily means', `${hiCo2.length} high days`, [...new Set(hiCo2.flatMap(d => [...d.sources]))]), ev('Headache reports', `${headDays.size} days`, ['reported'])], next: ['Ask ECLSS officer to review CO₂ scrubber performance', 'Improve local ventilation (fans) at your work/sleep station', 'Keep logging headaches with time of onset'] });
  }

  // X5 — gravity: exercise × musculoskeletal/sensorimotor performance
  const gp = [['exercise_min', cmp.exercise_min], ['posture', cmp.posture], ['coordination', cmp.coordination], ['gaze_stability', cmp.gaze_stability]].filter(([, c]) => c && c.worse && Math.abs(c.z) >= 1.2);
  if (cmp.exercise_min?.worse && Math.abs(cmp.exercise_min.z) >= 1.5 && gp.length >= 2) push({ members: gp.map(([t]) => t), key: 'x-gravity', rule: 'X5 cross-hazard: gravity × performance', level: 'caution', correlation: true, hazards: ['gravity'], organs: ['muscles', 'bones', 'inner_ear'], title: 'Exercise volume and movement scores are both lower', what: gp.map(([t, c]) => `${METRICS[t].label} ${f(c.rec.value, t)} vs ${f(c.base.value, t)}`).join('; ') + '.', why: 'In reduced gravity, exercise is the main countermeasure for muscle, bone and cardiovascular deconditioning. Lower exercise and lower movement scores occurring together deserve attention — the link is not proven for you individually.', evidence: gp.map(([t, c]) => ev(METRICS[t].label, f(c.rec.value, t), c.rec.sources)), next: ['Return to the prescribed exercise prescription', 'Repeat the posture & coordination tests in 2–3 days', 'Report back pain or balance issues'] });

  // X6 — repeated symptoms
  const sc = symptomCounts(7);
  for (const [k, n] of Object.entries(sc)) if (n >= 3) {
    const s = SYMPTOMS.find(x => x.id === k);
    push({ key: 'sym-' + k, rule: 'X6 repeated symptom', level: 'caution', medical: true, hazards: s?.hazards || [], organs: s?.organs || [], title: `Repeated symptom: ${symName(k)}`, what: `Reported ${n} times in the past 7 days.`, why: 'A symptom that keeps returning should be reviewed, even when each episode is mild.', evidence: [ev('Symptom reports (7 days)', String(n), [...new Set(state.records.filter(r => r.type === 'symptom' && r.meta?.symptom === k).map(r => r.source))])], next: ['Describe the pattern to the crew medical officer', 'Note timing, triggers and severity'] });
  }

  // P1 — forward projections (estimates only)
  for (const t of ['sleep_h', 'reaction_ms', 'mood', 'stress', 'exercise_min']) {
    const pr = project(t); const b = cmp[t]?.base; if (!pr || !b) continue;
    const m = METRICS[t]; const end = pr.points[pr.points.length - 1].value;
    const lim = m.better === 'higher' ? b.value - 2.5 * b.spread : b.value + 2.5 * b.spread;
    const crosses = m.better === 'higher' ? end < lim : end > lim;
    if (crosses && Math.abs(pr.slope) > 0 && pr.r2 > 0.3) push({ key: 'proj-' + t, rule: 'P1 trend projection (estimate)', level: 'info', hazards: m.hazards, organs: m.organs, title: `Early warning (estimate): ${m.label} trending ${pr.slope > 0 ? 'up' : 'down'}`, what: `14-day trend ${pr.slope > 0 ? '+' : ''}${pr.slope.toFixed(METRICS[t].dec + 1)} ${m.unit}/day. If the trend continued, it would reach ≈${f(end, t)} ${m.unit} in 7 days — beyond your usual range.`, why: 'This is a simple statistical extrapolation, not a prediction of what will happen. Acting early can reverse the trend.', evidence: [ev('Linear trend (last 14 days)', `R² ${pr.r2.toFixed(2)}`, cmp[t].rec.sources)], next: NEXT[t] || [] });
  }

  // R5 — workout form & movement trends (pose-tracked sessions). Only recurring changes, never single repetitions.
  const sess = state.records.filter(r => r.type === 'ex_form' && r.meta?.exercise).sort((x, y) => x.ts - y.ts);
  for (const exk of [...new Set(sess.map(r => r.meta.exercise))]) {
    const S = sess.filter(r => r.meta.exercise === exk); if (S.length < 4) continue;
    const name = S.at(-1).meta.name || exk; const recent = S.slice(-3), earlier = S.slice(0, -3);
    const mean2 = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const fd = ts => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const srcs = [...new Set(S.map(r => r.source))];
    const baseSec = mean2(earlier.map(r => r.meta.repSec).filter(Boolean)), baseRom = mean2(earlier.map(r => r.meta.rom).filter(Boolean)), baseForm = mean2(earlier.map(r => r.value));
    const slowS = recent.filter(r => baseSec && r.meta.repSec > baseSec * 1.2);
    if (slowS.length >= 2) push({ key: 'ex-slow-' + exk, rule: 'R5 workout trend', kind: 'exercise', level: 'caution', hazards: ['gravity'], organs: ['muscles'],
      title: `${name}: moving more slowly than usual`,
      what: `Average repetition ${mean2(recent.map(r => r.meta.repSec)).toFixed(1)} s in the last 3 sessions vs ${baseSec.toFixed(1)} s before (+${Math.round((mean2(recent.map(r => r.meta.repSec)) / baseSec - 1) * 100)}%). Started on ${fd(slowS[0].ts)}; seen in ${slowS.length} of the last 3 sessions.`,
      why: 'Slower repetitions can come from fatigue, poor sleep, muscle soreness or discomfort — or simply a deliberate slower tempo. It is a pattern to ask about, not a diagnosis.',
      evidence: [ev(`${name} — last 3 sessions`, `${mean2(recent.map(r => r.meta.repSec)).toFixed(1)} s / rep`, srcs), ev('Earlier sessions', `${baseSec.toFixed(1)} s / rep (${earlier.length} sessions)`, srcs)],
      next: ['ORBI will ask whether you feel tired or uncomfortable', 'Check sleep and soreness', 'Lighten the load for a day if needed'] });
    const romS = recent.filter(r => baseRom && r.meta.rom < baseRom - 12);
    if (romS.length >= 2) push({ key: 'ex-rom-' + exk, rule: 'R5 workout trend', kind: 'exercise', level: 'caution', hazards: ['gravity'], organs: ['muscles', 'bones'],
      title: `${name}: smaller range of motion`,
      what: `Average range ${Math.round(mean2(recent.map(r => r.meta.rom)))}° recently vs ${Math.round(baseRom)}° before. Started on ${fd(romS[0].ts)}; in ${romS.length} of the last 3 sessions.`,
      why: 'A shrinking range of motion can reflect stiffness, pain, fatigue or deconditioning in microgravity.',
      evidence: [ev('Recent sessions', `${Math.round(mean2(recent.map(r => r.meta.rom)))}°`, srcs), ev('Earlier sessions', `${Math.round(baseRom)}°`, srcs)], next: ['Mention any pain to ORBI or the crew medical officer', 'Mobility warm-up before the set'] });
    const asymS = recent.filter(r => (r.meta.issues?.asym || 0) >= Math.max(2, (r.meta.reps || 0) / 3));
    if (asymS.length >= 2) push({ key: 'ex-asym-' + exk, rule: 'R5 workout trend', kind: 'exercise', level: 'caution', hazards: ['gravity'], organs: ['muscles'],
      title: `${name}: recurring left–right imbalance`, what: `Uneven movement on several repetitions in ${asymS.length} of the last 3 sessions (first on ${fd(asymS[0].ts)}).`,
      why: 'A recurring imbalance can mean one side is weaker, stiff or painful.', evidence: [ev('Sessions with imbalance', `${asymS.length} of 3`, srcs)], next: ['Tell ORBI if one side hurts', 'Slow controlled repetitions'] });
    const formNow = mean2(recent.map(r => r.value));
    if (baseForm != null && formNow < baseForm - 20) push({ key: 'ex-form-' + exk, rule: 'R5 workout trend', kind: 'exercise', level: 'caution', hazards: ['gravity'], organs: ['muscles', 'bones'],
      title: `${name}: form getting worse`, what: `Form score ${Math.round(formNow)}/100 recently vs ${Math.round(baseForm)}/100 before. Most common problem: ${(k => ({ depth: 'not going deep enough', back: 'leaning the back', knees: 'knee alignment', asym: 'uneven left vs right', fast: 'moving too fast', balance: 'losing balance', squatting: 'bending the knees too much', small: 'small movements', sag: 'hips sagging', pike: 'hips too high' })[k] || k)(Object.entries(recent.reduce((o, r) => { for (const [k, v] of Object.entries(r.meta.issues || {})) o[k] = (o[k] || 0) + v; return o; }, {})).sort((x, y) => y[1] - x[1])[0]?.[0] || '—')}.`,
      why: 'Form often slips with fatigue or discomfort.', evidence: [ev('Form score', `${Math.round(formNow)} vs ${Math.round(baseForm)}`, srcs)], next: ['Use the Form coach for real-time corrections', 'Reduce load until form is consistent'] });
  }

  // fold individual baseline deviations into the combined-pattern alert that already lists them as evidence
  const folded = new Set(alerts.filter(a => a.members).flatMap(a => a.members.map(t => 'dev-' + t)));
  for (const a of alerts) if (a.members) {
    const n = a.members.filter(t => alerts.some(x => x.key === 'dev-' + t)).length;
    if (n) a.what += ` (Combines ${n} individual baseline deviation${n > 1 ? 's' : ''}.)`;
    for (const t of a.members) { const d = alerts.find(x => x.key === 'dev-' + t); if (d && d.level === 'warning') a.level = 'warning'; }
  }
  const final = alerts.filter(a => !folded.has(a.key));
  const order = { emergency: 0, warning: 1, caution: 2, info: 3 };
  final.sort((a, b) => order[a.level] - order[b.level]);
  return { alerts: final, cmp };
}

export function project(type, histDays = 14, fwd = 7) {
  const d = daily(type, histDays).filter(x => x.value != null);
  if (d.length < 6) return null;
  const xs = d.map(x => (x.ts - d[0].ts) / DAY), ys = d.map(x => x.value);
  const lr = linreg(xs, ys); if (!lr) return null;
  const my = mean(ys); const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const r2 = sst ? 1 - ys.reduce((s, y, i) => s + (y - lr.predict(xs[i])) ** 2, 0) / sst : 0;
  const last = xs[xs.length - 1];
  const points = []; for (let i = 1; i <= fwd; i++) { const x = last + i; points.push({ ts: d[0].ts + x * DAY, value: lr.predict(x), lo: lr.predict(x) - 1.96 * lr.se, hi: lr.predict(x) + 1.96 * lr.se }); }
  return { slope: lr.slope, r2, points, se: lr.se };
}

export const CORRELATION_PAIRS = [
  ['sleep_h', 'reaction_ms', 'Isolation × performance'], ['sleep_q', 'mood', 'Isolation × fatigue'], ['stress', 'sleep_q', 'Isolation × fatigue'],
  ['env_co2', 'concentration', 'Environment × cognition'], ['exercise_min', 'posture', 'Gravity × movement'], ['env_rad', 'kss', 'Radiation × fatigue (exploratory)'],
  ['stress', 'hr', 'Isolation × cardiovascular'], ['env_noise', 'sleep_q', 'Environment × sleep'],
];
export function correlations(days = 30) {
  return CORRELATION_PAIRS.map(([a, b, label]) => {
    const r = pearson(daily(a, days).map(x => x.value), daily(b, days).map(x => x.value));
    return { a, b, label, ...(r || { r: null, n: 0 }) };
  });
}
export function describeR(r) {
  if (r == null) return 'insufficient data';
  const s = Math.abs(r); const w = s < 0.2 ? 'no clear' : s < 0.4 ? 'weak' : s < 0.6 ? 'moderate' : 'strong';
  return `${w} ${r > 0 ? 'positive' : 'negative'} association`;
}

// ---------- scores (for overview only — not clinical scores) ----------
export function systemStatus(alerts) {
  const lv = { info: 0, caution: 1, warning: 2, emergency: 3 }; const names = ['ok', 'caution', 'warning', 'emergency'];
  const byHaz = {}; for (const h of Object.keys(HAZARDS)) byHaz[h] = 0;
  for (const a of alerts) for (const h of a.hazards || []) byHaz[h] = Math.max(byHaz[h] ?? 0, lv[a.level]);
  const byOrgan = {}; for (const a of alerts) for (const o of a.organs || []) byOrgan[o] = Math.max(byOrgan[o] ?? 0, lv[a.level]);
  const pen = alerts.reduce((s, a) => s + ({ info: 1, caution: 6, warning: 14, emergency: 35 }[a.level]), 0);
  return { hazards: Object.fromEntries(Object.entries(byHaz).map(([k, v]) => [k, names[v]])), organs: Object.fromEntries(Object.entries(byOrgan).map(([k, v]) => [k, names[v]])), index: Math.round(100 * Math.exp(-pen / 90)) };
}

// persist alert history (new alert keys are logged once per day)
let lastLogged = '';
export async function logAlerts(alerts) {
  const today = new Date().toISOString().slice(0, 10);
  const sig = today + alerts.map(a => a.key + a.level).join('|');
  if (sig === lastLogged) return; lastLogged = sig;
  for (const a of alerts) {
    if (a.level === 'info') continue;
    const id = `${today}-${a.key}`;
    if (state.alerts.some(x => x.id === id)) continue;
    await saveItem('alerts', { id, ts: Date.now(), key: a.key, level: a.level, title: a.title, what: a.what, hazards: a.hazards, organs: a.organs, missionDay: missionDay() });
  }
}

let cache = null, cacheLen = -1;
export function current() {
  if (!cache || cacheLen !== state.records.length) { cache = analyze(); cacheLen = state.records.length; cache.status = systemStatus(cache.alerts); }
  return cache;
}
export function invalidate() { cacheLen = -1; }
