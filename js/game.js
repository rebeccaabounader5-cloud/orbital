// ORBITAL — health engagement (gamification). Rewards healthy actions; never penalises health results.
import { state, todays, saveGame, startOfDay, DAY } from './store.js';
import { toast } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

export const MISSIONS = [
  { id: 'exercise', label: 'Complete today\'s exercise session (camera-verified)', xp: 40, href: '#/physical', done: () => todays('exercise_min').some(r => r.value > 0) },
  { id: 'sleep', label: 'Sleep 7 h or more (observed overnight)', xp: 20, href: '#/mental', done: () => todays('sleep_h').some(r => r.value >= 7) },
  { id: 'observe', label: 'Let the camera complete an automatic observation', xp: 15, href: '#/camera', done: () => ['blink_rate', 'posture', 'gaze_stability', 'reaction_ms'].some(t => todays(t).length) },
  { id: 'news', label: 'Listen to today\'s news from Earth', xp: 10, href: '#/mental', done: () => !!state.game.log?.[today()]?.news },
  { id: 'review', label: 'Review a health recommendation', xp: 10, href: '#/dashboard', done: () => !!state.game.log?.[today()]?.reviewed },
];

export const BADGES = [
  { id: 'first_obs', icon: '◉', name: 'Sensor Online', desc: 'First automatic camera observation', test: () => state.records.some(r => r.source === 'observed') },
  { id: 'ex3', icon: '🔥', name: 'Steady Orbit', desc: 'Exercise done 3 days in a row', test: () => exStreak() >= 3 },
  { id: 'ex7', icon: '★', name: 'Full Rotation', desc: '7-day exercise streak', test: () => exStreak() >= 7 },
  { id: 'calm5', icon: '≋', name: 'Calm Pilot', desc: '5 relaxation sessions', test: () => state.records.filter(r => r.type === 'relax_min' && r.source !== 'simulated').length >= 5 || state.records.filter(r => r.type === 'relax_min' && r.meta?.via).length >= 5 },
  { id: 'listener', icon: '☾', name: 'Good Company', desc: 'Talked with the ORBITAL companion', test: () => !!state.game.flags?.talked },
  { id: 'earthling', icon: '🌍', name: 'Earthling', desc: 'Listened to news from Earth', test: () => Object.values(state.game.log || {}).some(l => l.news) },
  { id: 'prepared', icon: '✚', name: 'Prepared', desc: 'Reviewed emergency protocols', test: () => !!state.game.flags?.protocols },
  { id: 'archivist', icon: '⇪', name: 'Archivist', desc: 'Exported a health report', test: () => !!state.game.flags?.exported },
  { id: 'perfect_day', icon: '✦', name: 'Mission Complete', desc: 'All daily health missions in one day', test: () => Object.values(state.game.log || {}).some(l => (l.done || []).length >= MISSIONS.length) },
];

function exStreak() {
  const days = new Set(state.records.filter(r => r.type === 'exercise_min' && r.value > 0).map(r => startOfDay(r.ts)));
  let s = 0, d = startOfDay(Date.now()); if (!days.has(d)) d -= DAY;
  while (days.has(d)) { s++; d -= DAY; }
  return s;
}
export async function markToday(key) { const l = state.game.log[today()] = state.game.log[today()] || { done: [] }; if (!l[key]) { l[key] = true; await saveGame(); } await evaluate(); }

function streak(type) {
  const days = new Set(state.records.filter(r => r.type === type && r.source === 'reported').map(r => startOfDay(r.ts)));
  let s = 0, d = startOfDay(Date.now()); if (!days.has(d)) d -= DAY;
  while (days.has(d)) { s++; d -= DAY; }
  return s;
}

export const level = xp => Math.floor(xp / 150) + 1;

/** Re-evaluate missions & badges; award XP once per mission per day. */
export async function evaluate() {
  const g = state.game; g.log = g.log || {}; g.badges = g.badges || []; g.flags = g.flags || {};
  const l = g.log[today()] = g.log[today()] || { done: [] };
  let changed = false;
  for (const m of MISSIONS) if (!l.done.includes(m.id) && m.done()) { l.done.push(m.id); g.xp += m.xp; changed = true; toast(`✓ Daily mission complete: ${m.label} <b>+${m.xp} XP</b>`); }
  for (const b of BADGES) if (!g.badges.includes(b.id) && b.test()) { g.badges.push(b.id); g.xp += 50; changed = true; toast(`${b.icon} Badge earned: <b>${b.name}</b> (+50 XP)`); }
  if (changed) await saveGame();
  return changed;
}

export async function flag(name) { state.game.flags = state.game.flags || {}; if (!state.game.flags[name]) { state.game.flags[name] = Date.now(); await saveGame(); } await evaluate(); }
export async function markReviewed() { const l = state.game.log[today()] = state.game.log[today()] || { done: [] }; if (!l.reviewed) { l.reviewed = true; await saveGame(); } await evaluate(); }
export { streak, exStreak };
