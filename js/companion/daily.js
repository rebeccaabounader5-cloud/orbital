// ORBITAL companion — daily news packet from Earth and daily exercise prescription.
import { state, startOfDay, DAY, missionDay, stageFor, dayKey, addRecord } from '../store.js';
import { FAMILY_MESSAGES, EXERCISES, PLANS, GENTLE } from './content.js';
import { DB } from '../db.js';

// ---------- news ----------
// Real articles from public news feeds (NASA, ESA, ScienceDaily, BBC, Positive News, …), fetched by ORBITAL's server
// whenever the internet (the link to Earth) is available, and stored on board so the latest news is readable offline.
// Every calendar day gets a fresh selection of articles that have never been shown before (identified by their URL).
// If nothing new could be received, ORBITAL says so — it never recycles old stories as "today's news".
const hash = s => [...s].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
export const ONE_WAY_DELAY_MIN = 12; // simulated light-time for uplinked files (Mars ranges ≈3–22 min)
const PER_DAY = 4;
const CAT_ORDER = ['positive', 'space', 'science', 'environment', 'technology', 'culture'];
const CAT_LABEL = { positive: 'Good news', space: 'Space', science: 'Science', environment: 'Environment', technology: 'Technology', culture: 'Culture' };
export const catLabel = c => CAT_LABEL[c] || c || 'News';
const keyOf = a => String(a.id || a.url || a.headline).split('?')[0].replace(/\/$/, '');
/** Publication date for display (accepts YYYY-MM-DD or a full ISO timestamp). */
export function pubDate(d) {
  if (!d) return 'date unknown';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) + (/T/.test(d) ? ', ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
}
async function store() { return (await DB.kvGet('newsStore')) || { articles: {}, sync: null }; }

let syncing = null;
/** Ask ORBITAL's server for the latest articles (needs internet). Safe to call often: at most every 30 min unless forced. */
export async function syncNews(force = false) {
  const st = await store();
  if (!force && st.sync && Date.now() - st.sync.ts < 30 * 60e3) return st.sync;
  if (syncing) return syncing;
  syncing = (async () => {
    let res = null, err = null;
    try { const r = await fetch('api/news/fetch', { cache: 'no-store' }); if (!r.ok) throw new Error('server ' + r.status); res = await r.json(); }
    catch (e) { err = navigator.onLine === false ? 'This computer is offline.' : 'ORBITAL\'s news receiver (python serve.py) could not be reached.'; }
    const now = Date.now(); let added = 0;
    if (res) {
      for (const it of res.items || []) { const k = keyOf(it); if (!st.articles[k]) { st.articles[k] = { ...it, key: k, receivedTs: now }; added++; } }
      // keep the store small: articles older than 60 days that were never shown are dropped
      for (const [k, a] of Object.entries(st.articles)) if (!a.shownDay && now - new Date(a.date).getTime() > 60 * DAY) delete st.articles[k];
    }
    const okSources = res ? res.sources.filter(x => x.ok).length : 0;
    st.sync = { ts: now, ok: !!res && okSources > 0, added, sources: res?.sources || [], error: err || (res && !okSources ? 'None of the news services could be reached (no internet connection?).' : null), lastOk: res && okSources ? now : st.sync?.lastOk || null };
    await DB.kvSet('newsStore', st);
    return st.sync;
  })();
  try { return await syncing; } finally { syncing = null; }
}

/** Pick today's articles: never shown before, most recent first, uplifting topics first, varied categories. */
function selectFor(st, key) {
  const fresh = Object.values(st.articles).filter(a => !a.shownDay).sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = fresh.filter(a => Date.now() - new Date(a.date).getTime() < 10 * DAY);
  const pool = recent.length >= PER_DAY ? recent : fresh;
  const out = [];
  for (const c of CAT_ORDER) { const a = pool.find(x => x.cat === c && !out.includes(x)); if (a && out.length < PER_DAY) out.push(a); }
  for (const a of pool) if (out.length < PER_DAY && !out.includes(a)) out.push(a);
  out.sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
  out.forEach(a => { a.shownDay = key; });
  return out;
}

/** Today's news packet. ts lets tests (and the Mission timeline) look at another day. */
export async function newsToday(ts = Date.now()) {
  const day = startOfDay(ts); const key = dayKey(day);
  const st = await store();
  let items = Object.values(st.articles).filter(a => a.shownDay === key).sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat));
  if (!items.length) { items = selectFor(st, key); if (items.length) await DB.kvSet('newsStore', st); }
  const uplink = (await DB.kvGet('newsUplink')) || [];
  const arrived = uplink.filter(u => u.queuedTs + ONE_WAY_DELAY_MIN * 60e3 <= ts).map(u => ({ ...u, receivedTs: u.queuedTs + ONE_WAY_DELAY_MIN * 60e3, kind: 'uplink' }));
  const transit = uplink.filter(u => u.queuedTs + ONE_WAY_DELAY_MIN * 60e3 > ts).map(u => ({ ...u, arrivesTs: u.queuedTs + ONE_WAY_DELAY_MIN * 60e3 }));
  const family = FAMILY_MESSAGES[hash(key) % FAMILY_MESSAGES.length];
  const unseen = Object.values(st.articles).filter(a => !a.shownDay).length;
  return { key, items: [...arrived.filter(a => a.receivedTs >= day), ...items.map(a => ({ ...a, kind: 'feed' }))], transit, family, delayMin: ONE_WAY_DELAY_MIN, sync: st.sync, unseen, total: Object.keys(st.articles).length };
}
export function newsStatusText(n) {
  const s = n.sync;
  if (!s) return 'News has not been received yet — ORBITAL checks the news services when the link to Earth (internet) is available.';
  const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!s.ok) return `⚠ The news feed has not been updated: ${s.error || 'no connection.'} ${s.lastOk ? 'Last successful update ' + when(s.lastOk) + '.' : ''}`;
  return `Updated ${when(s.ts)} from ${s.sources.filter(x => x.ok).length} of ${s.sources.length} news services${s.added ? ` · ${s.added} new article${s.added > 1 ? 's' : ''}` : ''}.`;
}
export function newsSpeech(n) {
  if (!n.items.length) return n.sync && !n.sync.ok ? 'The news feed has not been updated — I couldn\'t reach Earth\'s news services, and there are no new articles stored on board. I won\'t repeat old stories as new ones.' : 'There are no new articles from Earth yet today.';
  return 'Here is today\'s news from Earth. ' + n.items.map(i => `${i.headline}. ${i.summary} Published ${pubDate(i.date)} by ${i.source}.`).join(' ') + ' That is all for today.';
}
/** Uplink: import a JSON news file prepared on Earth: [{headline, summary, date:'YYYY-MM-DD', source, cat}] */
export async function importNews(file) {
  const arr = JSON.parse(await file.text()); if (!Array.isArray(arr)) throw new Error('Expected a JSON array of stories');
  const ok = arr.filter(x => x && x.headline && x.summary && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && x.source);
  const up = (await DB.kvGet('newsUplink')) || [];
  ok.forEach((x, k) => up.push({ id: 'u-' + Date.now() + '-' + k, cat: x.cat || 'News', headline: String(x.headline), summary: String(x.summary), date: x.date, source: String(x.source), queuedTs: Date.now() }));
  await DB.kvSet('newsUplink', up);
  return { queued: ok.length, skipped: arr.length - ok.length };
}

// ---------- exercise ----------
// Adapted routine for today (set by ORBI after the astronaut reports pain or exhaustion).
let adapt = null;
export async function loadAdaptation() { adapt = (await DB.kvGet('exAdapt')) || null; return adapt; }
export async function setAdaptation(mode, area = null) { adapt = mode ? { day: dayKey(Date.now()), mode, area } : null; await DB.kvSet('exAdapt', adapt); }
const AREA_SKIP = { legs: ['squat', 'lunge', 'heel', 'balance', 'deadlift'], back: ['deadlift', 'plank', 'squat'], arms: ['row', 'press', 'shoulders'], head: ['gaze', 'bike', 'balance'] };
export function planFor(ts = Date.now()) {
  const md = missionDay(ts) || 1; const st = stageFor(md);
  const preLanding = st && /approach|preparation|surface/i.test(st.name);
  const p = PLANS[(md - 1) % PLANS.length];
  let keys = [...p.keys], title = p.title, note = '';
  if (preLanding && !keys.includes('gaze')) keys = [...keys, 'gaze'];
  if (preLanding && !keys.includes('balance') && keys.length < 6) keys = [...keys, 'balance'];
  const a = adapt && adapt.day === dayKey(ts) ? adapt : null;
  if (a?.mode === 'light') { keys = [...GENTLE]; title = 'Gentle recovery routine (adapted)'; note = 'Adapted by ORBI because you reported exhaustion: light mobility only.'; }
  if (a?.mode === 'pain') { const skip = AREA_SKIP[a.area] || []; keys = [...keys.filter(k => !skip.includes(k)), ...GENTLE.filter(k => !keys.includes(k))].slice(0, 6); title += ' (adapted for pain)'; note = `Adapted by ORBI because you reported ${({ legs: 'leg', arms: 'arm or shoulder', back: 'back', head: 'head' })[a.area] || ''} pain: exercises loading that area were removed.`; }
  const items = keys.map(k => ({ key: k, ...EXERCISES[k] }));
  return { title, items, minutes: items.reduce((s, x) => s + x.min, 0), preLanding, stage: st?.name || '', adapted: !!a, note };
}
const isExercise = r => r.type === 'exercise_min' && r.value > 0;
export function dayStatus(day) {
  const recs = state.records.filter(r => r.ts >= day && r.ts < day + DAY);
  const ex = recs.filter(isExercise);
  if (ex.some(r => (r.meta?.fraction ?? 1) >= 0.8)) return 'done';
  if (ex.length) return 'partial';
  if (recs.some(r => r.type === 'exercise_skip')) return 'missed';
  if (day === startOfDay(Date.now())) return new Date().getHours() >= DUE_HOUR ? 'overdue' : 'pending';
  return recs.length ? 'missed' : 'nodata';
}
export const DUE_HOUR = 18; // if nothing observed by 18:00 ship time, today's session counts as overdue
export function adherence(days = 7) {
  const today = startOfDay(Date.now());
  return Array.from({ length: days }, (_, i) => { const d = today - (days - 1 - i) * DAY; return { day: d, status: dayStatus(d) }; });
}
/** Consecutive missed days up to today (overdue today counts). */
export function missedStreak() {
  let n = 0;
  for (const a of adherence(14).reverse()) { if (a.status === 'missed' || a.status === 'overdue') n++; else if (a.status === 'partial') { n++; break; } else if (a.status === 'pending') continue; else break; }
  return n;
}
export async function recordExerciseObserved(minutes, how, extra = {}, source = 'simulated') {
  return addRecord('exercise_min', minutes, source, { via: source === 'observed' ? 'ORBI RGB eye — pose tracking' : 'ORBI camera (simulated detection)', kind: planFor().title, how, ...extra });
}
export async function recordSkip() {
  return addRecord('exercise_skip', 1, 'simulated', { via: 'camera (simulated detection)', note: 'No exercise movement observed during the scheduled session' });
}
