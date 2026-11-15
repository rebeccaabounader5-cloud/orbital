// ORBITAL — application state: in-memory cache over IndexedDB + event bus.
import { DB, uid } from './db.js';

const listeners = new Set();
export const state = {
  records: [],      // {id, ts, type, value, source, meta}
  alerts: [],       // persisted alert history
  emergencies: [],
  outbox: [],
  assessments: [],
  profile: null,
  game: null,
  settings: null,
};

export const DAY = 86400000;
export const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

export const DEFAULT_PROFILE = {
  name: 'Demo Astronaut', callsign: 'ORB-1', role: 'Mission Specialist', age: 38, sex: '',
  missionName: 'ARES TRANSIT DEMO',
  missionStart: null, // ISO date (set by seed)
  stages: [
    { name: 'Launch & adaptation', startDay: 0, gravity: '0 g' },
    { name: 'Interplanetary cruise', startDay: 7, gravity: '0 g' },
    { name: 'Approach & preparation', startDay: 24, gravity: '0 g' },
    { name: 'Surface operations', startDay: 40, gravity: '0.38 g (Mars)' },
  ],
  baselineDays: 7,
  pinHash: null,
  crewOnBoard: true, approvedMeds: '', allergies: '',
};

export async function loadAll() {
  const [records, alerts, emergencies, outbox, assessments, profile, game, settings] = await Promise.all([
    DB.all('records'), DB.all('alerts'), DB.all('emergencies'), DB.all('outbox'), DB.all('assessments'),
    DB.kvGet('profile'), DB.kvGet('game'), DB.kvGet('settings'),
  ]);
  records.sort((a, b) => a.ts - b.ts);
  Object.assign(state, { records, alerts, emergencies, outbox, assessments });
  state.profile = profile || null;
  state.game = game || { xp: 0, badges: [], log: {} };
  state.settings = settings || { simTelemetry: true };
}

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }

export async function addRecord(type, value, source, meta = {}, ts = Date.now()) {
  const r = { id: uid(), ts, type, value, source, meta };
  state.records.push(r);
  if (state.records.length > 1 && state.records[state.records.length - 2].ts > ts) state.records.sort((a, b) => a.ts - b.ts);
  await DB.put('records', r);
  emit('records');
  return r;
}

export async function addRecords(list) {
  const out = list.map(x => ({ id: uid(), ts: x.ts ?? Date.now(), type: x.type, value: x.value, source: x.source, meta: x.meta || {} }));
  state.records.push(...out);
  state.records.sort((a, b) => a.ts - b.ts);
  await DB.putMany('records', out);
  emit('records');
  return out;
}

export async function deleteRecord(id) {
  state.records = state.records.filter(r => r.id !== id);
  await DB.del('records', id);
  emit('records');
}

export async function saveProfile(p) { state.profile = p; await DB.kvSet('profile', p); emit('profile'); }
export async function saveGame() { await DB.kvSet('game', state.game); emit('game'); }
export async function saveSettings() { await DB.kvSet('settings', state.settings); emit('settings'); }

export async function saveItem(store, obj) {
  if (!obj.id) obj.id = uid();
  if (!obj.ts) obj.ts = Date.now();
  const arr = state[store];
  const i = arr.findIndex(x => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  await DB.put(store, obj);
  emit(store);
  return obj;
}

// ---- queries ----
export const byType = (type, sinceTs = 0) => state.records.filter(r => r.type === type && r.ts >= sinceTs && typeof r.value === 'number');
export const latest = type => { for (let i = state.records.length - 1; i >= 0; i--) if (state.records[i].type === type) return state.records[i]; return null; };

/** Daily aggregate series: [{day, ts, value, n, sources:Set}] (mean per day; sum for additive metrics) */
const SUM_TYPES = new Set(['exercise_min', 'relax_min', 'env_rad']);
export function daily(type, days = 30, endTs = Date.now()) {
  const start = startOfDay(endTs) - (days - 1) * DAY;
  const buckets = new Map();
  for (const r of state.records) {
    if (r.type !== type || r.ts < start || r.ts > endTs + DAY || typeof r.value !== 'number') continue;
    const k = startOfDay(r.ts);
    let b = buckets.get(k); if (!b) { b = { ts: k, sum: 0, n: 0, sources: new Set() }; buckets.set(k, b); }
    b.sum += r.value; b.n++; b.sources.add(r.source);
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const k = start + i * DAY; const b = buckets.get(k);
    out.push({ ts: k, day: dayKey(k), value: b ? (SUM_TYPES.has(type) ? b.sum : b.sum / b.n) : null, n: b ? b.n : 0, sources: b ? b.sources : new Set() });
  }
  return out;
}

export function missionDay(ts = Date.now()) {
  const p = state.profile; if (!p || !p.missionStart) return null;
  return Math.floor((startOfDay(ts) - startOfDay(new Date(p.missionStart).getTime())) / DAY) + 1;
}
export function stageFor(day) {
  const st = (state.profile?.stages || []).slice().sort((a, b) => a.startDay - b.startDay);
  let cur = st[0] || null;
  for (const s of st) if (day - 1 >= s.startDay) cur = s;
  return cur;
}

export const todays = type => state.records.filter(r => r.type === type && r.ts >= startOfDay(Date.now()));
