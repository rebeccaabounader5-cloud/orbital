// ORBITAL — synthetic demonstration dataset. EVERY record here is tagged source:'simulated'.
// The scenario intentionally contains a few developing issues so the analysis engine can be demonstrated:
//  - a solar particle event (radiation spike) around mission day 18
//  - a CO₂ excursion around days 20–24 with headaches reported
//  - a gradual decline in sleep, mood and reaction time over the last week
import { DB } from './db.js';
import { state, DAY, startOfDay, addRecords, saveProfile, DEFAULT_PROFILE, loadAll } from './store.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export async function seedDemo({ days = 30 } = {}) {
  const R = rng(20261113);
  const n = (mu, sd) => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const today = startOfDay(Date.now());
  const start = today - days * DAY;
  const recs = [];
  const add = (type, value, ts, meta) => recs.push({ type, value: +value.toFixed(3), source: 'simulated', ts, meta: meta || {} });

  for (let d = 0; d < days; d++) {
    const day = start + d * DAY;
    const md = d + 1;
    const late = Math.max(0, (d - (days - 8)) / 7); // 0..1 over last week
    const co2Event = md >= 20 && md <= 24;
    const spe = md === 18 || md === 19;

    // sleep (logged at wake 07:00)
    add('sleep_h', Math.max(3.5, n(6.7 - 1.2 * late, 0.35)), day + 7 * 3600e3);
    add('sleep_q', Math.min(10, Math.max(1, n(7 - 2 * late - (co2Event ? 0.8 : 0), 0.6))), day + 7 * 3600e3 + 60e3);
    add('puffiness', Math.max(-2, n(14 * Math.exp(-d / 8) + 6, 1.2)), day + 9 * 3600e3 + 300e3, { via: 'RGB face shape (simulated)' });
    add('skin_temp', n(34.8 + (co2Event ? 0.15 : 0), 0.15), day + 9 * 3600e3 + 310e3, { via: 'thermal camera (simulated)' });
    add('move_speed', Math.min(100, n(82 - 7 * late, 3)), day + 16 * 3600e3, { via: 'RGB pose tracking (simulated)' });
    // 24/7 camera well-being observations (simulated)
    add('sleep_latency', Math.max(4, n(14 + 22 * late, 5)), day + 7 * 3600e3 + 90e3);
    add('sleep_wakes', Math.max(0, Math.round(n(1 + 2 * late, 0.7))), day + 7 * 3600e3 + 100e3);
    add('sleep_restless', Math.min(100, Math.max(5, n(25 + 18 * late, 6))), day + 7 * 3600e3 + 110e3);
    add('tension', Math.min(100, Math.max(5, n(28 + 22 * late + (co2Event ? 8 : 0), 7))), day + 17 * 3600e3);
    add('affect_low', Math.min(100, Math.max(3, n(20 + 28 * late, 6))), day + 19 * 3600e3);
    add('silence_h', Math.max(0.3, n(1.8 + 2.4 * late, 0.5)), day + 21 * 3600e3, { crewPresent: true });
    add('social_min', Math.max(5, n(80 - 35 * late, 12)), day + 21 * 3600e3 + 10e3);
    add('kss', Math.round(Math.min(9, Math.max(1, n(3.2 + 2.2 * late, 0.7)))), day + 8 * 3600e3);
    // check-ins (evening)
    add('mood', Math.min(10, Math.max(1, n(7.3 - 1.8 * late, 0.5))), day + 20 * 3600e3);
    add('stress', Math.min(10, Math.max(1, n(3.4 + 2.6 * late + (co2Event ? 0.6 : 0), 0.5))), day + 20 * 3600e3 + 30e3);
    add('concentration', Math.min(10, Math.max(1, n(7.5 - 1.6 * late - (co2Event ? 0.9 : 0), 0.5))), day + 20 * 3600e3 + 60e3);
    if (d % 3 === 0) add('loneliness', Math.round(Math.min(9, Math.max(3, n(4 + 2 * late, 0.6)))), day + 20 * 3600e3 + 90e3);
    // physiology
    add('hr', n(63 + 5 * late + (md <= 4 ? 4 : 0), 2.2), day + 9 * 3600e3, { method: 'simulated resting HR' });
    add('rr', n(14 + (co2Event ? 1.5 : 0), 0.8), day + 9 * 3600e3 + 120e3);
    if (d % 2 === 0) { add('bp_sys', n(118 + 3 * late, 4), day + 9 * 3600e3 + 200e3); add('bp_dia', n(76, 3), day + 9 * 3600e3 + 200e3); }
    if (d % 2 === 0) add('spo2', Math.min(100, n(98, 0.6)), day + 9 * 3600e3 + 240e3);
    if (d % 4 === 0) add('temp', n(36.7, 0.15), day + 9 * 3600e3 + 260e3);
    if (d % 7 === 0) add('body_mass', n(74.5 - d * 0.03, 0.2), day + 7.5 * 3600e3);
    // performance
    add('reaction_ms', n(282 + 48 * late + (co2Event ? 15 : 0), 12), day + 10 * 3600e3);
    add('pvt_lapses', Math.max(0, Math.round(n(0.4 + 2.5 * late, 0.7))), day + 10 * 3600e3 + 10e3);
    add('blink_rate', n(15 + 3 * late, 2), day + 10 * 3600e3 + 20e3);
    add('perclos', Math.max(0, n(5 + 7 * late, 1.5)), day + 10 * 3600e3 + 30e3);
    if (d % 2 === 1) add('coordination', Math.min(100, n(86 - (md <= 5 ? 8 : 0) - 6 * late, 3)), day + 10 * 3600e3 + 40e3);
    if (d % 2 === 0) add('gaze_stability', Math.min(100, n(84 - (md <= 5 ? 9 : 0) - 4 * late, 3)), day + 10 * 3600e3 + 50e3);
    if (d % 3 === 0) add('posture', Math.min(100, n(85 - (md <= 5 ? 10 : 0) - 4 * late, 3)), day + 11 * 3600e3);
    add('exercise_min', Math.max(0, n(120 - 45 * late, 15)), day + 15 * 3600e3, { kind: d % 2 ? 'Resistance (ARED-type)' : 'Treadmill + cycle' });
    if (d % 2 === 0) add('relax_min', Math.max(0, n(12 - 6 * late, 3)), day + 21 * 3600e3);

    // symptoms
    if (md <= 3) add('symptom', 2, day + 12 * 3600e3, { symptom: 'nausea', note: 'Space motion sickness, early adaptation' });
    if (md <= 6 && md % 2) add('symptom', 1, day + 12.5 * 3600e3, { symptom: 'congestion', note: 'Facial fullness' });
    if (co2Event && md !== 22) add('symptom', 2, day + 14 * 3600e3, { symptom: 'headache' });
    if (md === 9 || md === 15) add('symptom', 1, day + 18 * 3600e3, { symptom: 'back_pain' });
    if (d >= days - 4) add('symptom', 1, day + 22 * 3600e3, { symptom: 'insomnia' });

    // environment (4 samples / day)
    for (let h = 0; h < 4; h++) {
      const ts = day + (3 + h * 6) * 3600e3;
      add('env_co2', Math.max(1, n(co2Event ? 3.7 : 2.2, 0.3)), ts);
      add('env_temp', n(22.4, 0.6), ts + 1e3);
      add('env_humidity', n(45, 4), ts + 2e3);
      add('env_pressure', n(101.3, 0.25), ts + 3e3);
      add('env_o2', n(21.2, 0.3), ts + 4e3);
      add('env_voc', Math.max(0, n(0.8, 0.25)), ts + 5e3);
      add('env_pm', Math.max(0, n(9, 3)), ts + 6e3);
      add('env_noise', n(h === 0 ? 50 : 57, 2.5), ts + 7e3, { area: h === 0 ? 'crew quarters' : 'work area' });
      add('env_lux', Math.max(0, n(h === 0 ? 5 : 420, h === 0 ? 2 : 60)), ts + 8e3);
    }
    add('env_rad', Math.max(0.2, spe ? n(md === 18 ? 6.8 : 2.9, 0.2) : n(1.75, 0.12)), day + 23.5 * 3600e3, { dosimeter: 'simulated personal dosimeter' });
  }
  // lab panels (simulated)
  const labs = (ts, late) => [
    ['Hemoglobin', 14.6 - late * 0.5, 'g/dL', '13.5–17.5'], ['White blood cells', 6.4 - late * 0.6, '×10⁹/L', '4.0–11.0'],
    ['Lymphocytes', 1.9 - late * 0.3, '×10⁹/L', '1.0–4.8'], ['Vitamin D (25-OH)', 34 - late * 6, 'ng/mL', '30–100'],
    ['Urinary calcium (24 h)', 190 + late * 70, 'mg/day', '100–300'], ['Cortisol (salivary, AM)', 0.45 + late * 0.15, 'µg/dL', '0.1–0.8'],
  ].forEach(([name, v, unit, ref]) => add('lab', v, ts, { name, unit, refRange: ref }));
  labs(start + 1 * DAY + 8 * 3600e3, 0);
  labs(start + 28 * DAY + 8 * 3600e3, 1);

  const p = { ...DEFAULT_PROFILE, ...(state.profile || {}) };
  p.missionStart = new Date(start).toISOString().slice(0, 10);
  await saveProfile(p);
  await addRecords(recs);
  return recs.length;
}

export async function clearSimulated() {
  const keep = state.records.filter(r => r.source !== 'simulated');
  await DB.clear('records');
  await DB.putMany('records', keep);
  await loadAll();
}
