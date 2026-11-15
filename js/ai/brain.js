// ORBI — AI layer shared by the Virtual Body (section "body") and the Well-being Assistant (section "mind").
//
// • Live AI: Claude, called through ORBITAL's local server (serve.py /api/ai/chat). The API key lives only on that
//   computer — never in this front-end code. Each request carries the conversation of ONE section (the two
//   conversations are kept apart) plus a compact summary of what ORBI knows: camera / thermal estimates, sleep,
//   exercise, cabin environment, Earth baseline, and — if the crew allows sharing — a short summary of the other section.
// • If the live AI is not configured or unreachable, ORBITAL says so honestly (badge: "Offline rules — not a live AI")
//   and the section uses its built-in offline engine instead.
import { state, latest } from '../store.js';
import { DB } from '../db.js';
import { assess } from '../companion/wellbeing.js';
import { EARTH_BASELINE } from '../companion/content.js';
import { adherence, planFor } from '../companion/daily.js';
import { SECTIONS, GEMINI_MODELS } from './prompts.js';

const subs = new Set();
export const ai = { status: 'checking', server: null, mode: null, provider: null, model: null, message: '', lastError: null };
const emitA = () => subs.forEach(f => { try { f(ai); } catch (e) { console.error(e); } });
export const onAI = fn => { subs.add(fn); return () => subs.delete(fn); };

let checkedAt = 0;
/** Ask the local server whether the live AI is configured. */
export async function refreshAI(force = false) {
  if (!force && Date.now() - checkedAt < 60000 && ai.status !== 'checking') return ai;
  checkedAt = Date.now();
  try {
    const r = await fetch('api/ai/status', { cache: 'no-store' });
    if (!r.ok) throw new Error('status ' + r.status);
    const s = await r.json();
    Object.assign(ai, { status: s.available ? 'live' : 'offline', provider: s.provider || null, model: s.model || null, message: s.message || '', lastError: s.last_error || null });
    ai.server = true;
  } catch (e) {
    // No local server (public website such as GitHub Pages, or opened from another network): use a Gemini key that
    // this visitor saved in THIS browser, if any. It is never part of the code or the repository.
    ai.server = false;
    if (browserKey()) Object.assign(ai, { status: 'live', provider: 'gemini', mode: 'browser', model: GEMINI_MODELS[0], message: '' });
    else Object.assign(ai, { status: 'offline', provider: null, mode: null, model: null, message: 'No live AI on this website yet. Paste your own free Gemini API key below (it stays in this browser only).' });
  }
  if (ai.server) ai.mode = 'server';
  emitA(); return ai;
}
// ---------------------------------------------------------------- Gemini straight from the browser (no server)
const KEY_LS = 'orbital.geminiKey';
export function browserKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } }
export function setBrowserKey(k) { try { if (k) localStorage.setItem(KEY_LS, k); else localStorage.removeItem(KEY_LS); } catch (e) { /* storage blocked */ } }
async function geminiBrowser(section, msgs, ctx, signal) {
  const { system, schema } = SECTIONS[section];
  const merged = [];
  for (const m of msgs) {
    const role = m.role === 'assistant' ? 'model' : 'user'; const text = String(m.content || '').slice(0, 4000).trim(); if (!text) continue;
    if (merged.length && merged[merged.length - 1].role === role) merged[merged.length - 1].parts[0].text += '\n' + text; else merged.push({ role, parts: [{ text }] });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  if (!merged.length || merged[merged.length - 1].role !== 'user') return { error: 'The conversation must end with the astronaut speaking.' };
  const last = merged[merged.length - 1].parts[0];
  if (ctx) last.text = `<orbi_observations>\n${ctx.slice(0, 6000)}\n</orbi_observations>\n\n` + last.text;
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: merged, generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192, temperature: 0.7 } });
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': browserKey() }, body });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) continue;
    if (!r.ok) { const d = j.error?.message || ''; return { error: r.status === 429 ? 'Gemini free-tier limit reached — try again later.' : (r.status === 400 && /API key/i.test(d)) || r.status === 403 ? 'The Gemini API key was rejected.' : `Gemini error ${r.status}.` }; }
    const c = j.candidates?.[0] || {}; const text = (c.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('');
    try { const out = JSON.parse(text); out.model = j.modelVersion || model; return out; }
    catch (e) { return { error: c.finishReason === 'MAX_TOKENS' ? 'The AI answer was incomplete.' : text ? 'The AI answer could not be read.' : 'The AI declined to answer this turn.' }; }
  }
  return { error: 'None of the Gemini models is available to this key.' };
}
const GEMINI_BASE = (typeof window !== 'undefined' && window.__GEMINI_BASE) || 'https://generativelanguage.googleapis.com/v1beta';
export const aiLabel = (section = 'mind') => ai.status === 'live' ? `Live AI · ${ai.provider === 'gemini' ? 'Gemini' : 'Claude'}` : section === 'mind' && device.status === 'available' ? 'On-device AI · Chrome (free)' : ai.status === 'checking' ? 'Checking AI…' : 'Offline rules — not a live AI';
export const aiKind = (section = 'mind') => ai.status === 'live' ? 'live' : section === 'mind' && device.status === 'available' ? 'device' : 'offline';

// ---------------------------------------------------------------- free on-device AI (Chrome's built-in Gemini Nano)
// Used by the Well-being companion when the Claude server AI isn't configured. It runs on this computer, needs no key
// and costs nothing — but only some Chrome versions/computers have it, and it must be downloaded once (user click).
export const device = { status: 'unknown', progress: null, error: null };
const LMopts = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
export async function checkDevice() {
  const LM = window.LanguageModel;
  if (!LM?.availability) { device.status = 'unavailable'; device.error = 'This browser has no built-in AI model (it needs a recent Google Chrome on a desktop computer with enough memory).'; emitA(); return device; }
  try { device.status = await LM.availability(LMopts); } catch (e) { device.status = 'unavailable'; device.error = e.message; }
  emitA(); return device;
}
/** Must be called from a click: downloads the model once if needed. */
export async function enableDevice() {
  const LM = window.LanguageModel; if (!LM) return checkDevice();
  try {
    device.status = 'downloading'; emitA();
    const sess = await LM.create({ ...LMopts, monitor(m) { m.addEventListener('downloadprogress', e => { device.progress = e.loaded; emitA(); }); } });
    sess.destroy?.(); device.status = 'available'; device.error = null;
  } catch (e) { device.status = 'unavailable'; device.error = e.message; }
  emitA(); return device;
}
const DEVICE_SYSTEM = `You are ORBI, the warm, curious companion of an astronaut on a long, isolated space mission. You talk by voice.
Talk like a thoughtful friend, not a therapist: natural spoken English, usually one to three short sentences, at most one question, and not every reply needs a question.
Any topic is welcome (home, family, food, books, work, jokes, nothing in particular). Follow the conversation and remember what they told you.
Do not keep asking if they are okay, do not push relaxation exercises, do not force positivity, never diagnose, never assume depression.
Example: "I miss home." -> "Yeah, I imagine there are moments when Earth feels especially far away. Is there something specific you've been missing lately?"
Music: only these five songs exist: "Count on Me" (Bruno Mars) for sad or lonely, "A Sky Full of Stars" (Coldplay) for stress, "Hall of Fame" (The Script) for motivation, "Firework" (Katy Perry) for happiness, "Piano Man" (Billy Joel) to relax. Play one only when they ask or accept your offer.
If they mention physical pain, suggest the Virtual Body. If they mention suicide or self-harm, urge them warmly to tell the crew medical officer or a crewmate now (action crisis_support).
Reply ONLY as JSON: {"say": "...", "action": "none|play_sad_lonely|play_stressed|play_motivation|play_happy|play_relax|stop_music|share_memory|read_news|start_relaxation|crisis_support"}.`;
const DEVICE_SCHEMA = { type: 'object', properties: { say: { type: 'string' }, action: { type: 'string', enum: ['none', 'play_sad_lonely', 'play_stressed', 'play_motivation', 'play_happy', 'play_relax', 'stop_music', 'share_memory', 'read_news', 'start_relaxation', 'crisis_support'] } }, required: ['say', 'action'] };
const sessions = {};
async function askDevice(section, userText, extra) {
  if (device.status === 'unknown') await checkDevice();
  if (device.status !== 'available') return null;
  try {
    if (!sessions[section]) {
      const past = (await convo(section)).slice(-12, -1).map(m => ({ role: m.role, content: m.content }));
      sessions[section] = await window.LanguageModel.create({ ...LMopts, initialPrompts: [{ role: 'system', content: DEVICE_SYSTEM }, ...past] });
    }
    const obs = (await observations(section, extra)).slice(0, 1500);
    const raw = await Promise.race([sessions[section].prompt(`(What ORBI currently knows — use only if relevant: ${obs})\nAstronaut: ${userText}`, { responseConstraint: DEVICE_SCHEMA }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
    const j = JSON.parse(raw); if (!j.say) return null;
    return { say: j.say, action: j.action || 'none', action_arg: '', mood: 'unknown', remember: '', model: 'on-device (Chrome)' };
  } catch (e) { ai.lastError = 'On-device AI: ' + e.message; delete sessions[section]; emitA(); return null; }
}

// ---------------------------------------------------------------- conversation memory (per section)
const convos = { body: null, mind: null };
async function convo(section) { if (!convos[section]) convos[section] = (await DB.kvGet('convo:' + section)) || []; return convos[section]; }
async function push(section, role, content) { const c = await convo(section); c.push({ role, content, ts: Date.now() }); if (c.length > 60) c.splice(0, c.length - 60); await DB.kvSet('convo:' + section, c); }
export async function remember(section, role, content) { if (content) await push(section, role, content); }
export async function history(section) { return (await convo(section)).slice(); }
export async function clearConversation(section) { delete sessions[section]; convos[section] = []; await DB.kvSet('convo:' + section, []); }

// Long-term facts the astronaut shared ("my daughter Mia loves pancakes").
export async function facts() { return (await DB.kvGet('orbiFacts')) || []; }
export async function addFact(f) { if (!f) return; const l = await facts(); if (!l.includes(f)) { l.push(f); await DB.kvSet('orbiFacts', l.slice(-40)); } }

// Body-section summary for the companion (and vice versa), when sharing is allowed.
export const sharing = () => state.settings?.shareSections !== false;
export async function setBodySummary(s) { await DB.kvSet('bodySummary', { text: s, ts: Date.now() }); }
export async function setMindSummary(s) { await DB.kvSet('mindSummary', { text: s, ts: Date.now() }); }

// ---------------------------------------------------------------- observations sent with each turn
const recent = (t, h) => { const r = latest(t); return r && Date.now() - r.ts < h * 3600e3 ? r : null; };
const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const SRC = { estimated: 'camera estimate', observed: 'observed by camera', simulated: 'SIMULATED demo value', reported: 'reported by astronaut', manual: 'entered manually', imported: 'imported device data' };
function line(label, t, h, unit, base) {
  const r = recent(t, h); if (!r) return null;
  return `${label}: ${Math.round(r.value * 10) / 10}${unit} (${SRC[r.source] || r.source}, ${ago(r.ts)}${base != null ? `; Earth baseline ${base}${unit}` : ''})`;
}
export async function observations(section, extra = '') {
  const B = EARTH_BASELINE.values; const a = assess(); const out = [];
  const p = state.profile || {};
  out.push(`Astronaut: ${p.name && !/^demo$/i.test(p.name) ? p.name : 'unnamed'}${p.age ? ', age ' + p.age : ''}. Ship time ${new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`);
  const vit = [line('Heart rate', 'hr', 12, ' bpm', B.hr), line('Breathing rate (thermal eye)', 'rr', 12, '/min', B.rr), line('Skin temperature (thermal eye; not core temperature)', 'skin_temp', 12, ' °C', B.skin_temp),
    line('Face puffiness vs pre-flight', 'puffiness', 72, ' %', 0), line('Movement speed', 'move_speed', 48, '/100', B.move_speed), line('Posture score', 'posture', 48, '/100', B.posture),
    line('Eye closure (PERCLOS)', 'perclos', 24, ' %', B.perclos), line('Cabin CO2', 'env_co2', 24, ' mmHg'), line('SpO2', 'spo2', 24, ' %'), line('Blood pressure systolic', 'bp_sys', 72, ' mmHg')].filter(Boolean);
  if (vit.length) out.push('Measurements:\n- ' + vit.join('\n- '));
  if (a.sleep) out.push(`Last night (ORBI thermal eye${a.sleep.ts ? ', ' + SRC[latest('sleep_h')?.source] : ''}): ${a.sleep.h.toFixed(1)} h sleep, fell asleep after ${Math.round(a.sleep.latency ?? 0)} min, ${a.sleep.wakes ?? 0} awakenings, restlessness ${Math.round(a.sleep.restless ?? 0)}/100; 7-night average ${a.sleep.avg7?.toFixed(1) ?? 'unknown'} h; Earth ${a.sleep.earth} h.${a.sleep.insomnia ? ' Possible insomnia signs.' : ''}${a.sleep.repeated ? ' Repeated on 3+ of the last 4 nights.' : ''}`);
  else out.push('Sleep: no overnight observation available.');
  const ad = adherence(5).map(d => d.status);
  out.push(`Daily exercise, last 5 days (oldest→today): ${ad.join(', ')}. Today's plan: ${planFor().title}.`);
  if (a.stress.tension != null) out.push(`Muscle tension/stress (camera${a.stress.thermal ? ' + thermal' : ''}): ${Math.round(a.stress.tension)}/100${a.stress.detected ? ' — tension detected' : ''}.`);
  if (a.fatigue.flagged) out.push('Fatigue pattern seen (eye closure, slower movement and/or short sleep).');
  if (a.mood.affectLow != null || a.mood.silence != null) out.push(`Behaviour today: ${a.mood.silence != null ? `silent ${a.mood.silence.toFixed(1)} h (context: ${a.mood.context})` : ''}${a.mood.social != null ? `, crew conversation ${Math.round(a.mood.social)} min (usual about ${Math.round(a.mood.usualSocial)})` : ''}${a.mood.affectLow != null ? `, low-affect expression score ${Math.round(a.mood.affectLow)}/100` : ''}. Warning-sign level: ${a.mood.severity}. These are possible signs only, never a diagnosis.`);
  const f = await facts(); if (f.length) out.push('Things the astronaut told ORBI before: ' + f.slice(-12).join('; ') + '.');
  if (sharing()) {
    const other = await DB.kvGet(section === 'body' ? 'mindSummary' : 'bodySummary');
    if (other && Date.now() - other.ts < 3 * 86400e3) out.push(`${section === 'body' ? 'Well-being conversation' : 'Virtual Body conversation'} summary (${ago(other.ts)}): ${other.text}`);
  }
  if (section === 'body') out.push(`CMO-approved medication list: ${p.approvedMeds ? p.approvedMeds.replace(/\n+/g, '; ') : 'none on file'}. Recorded allergies: ${p.allergies || 'none recorded'}.`);
  if (extra) out.push(extra);
  return out.join('\n');
}

// ---------------------------------------------------------------- ask the live AI
/**
 * Send the astronaut's words to the live AI. Returns the structured answer, or null when the live AI is not
 * available (the caller then uses its offline engine). The turn is stored in the section's conversation either way.
 */
export async function askAI(section, userText, { extra = '', timeout = 30000 } = {}) {
  await push(section, 'user', userText);
  if (ai.status === 'checking' || (ai.status === 'offline' && Date.now() - checkedAt > 60000)) await refreshAI(true);
  if (ai.status !== 'live') return section === 'mind' ? askDevice(section, userText, extra) : null; // the companion can use the free on-device model
  const msgs = (await convo(section)).slice(-30).map(m => ({ role: m.role, content: m.content }));
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
  if (ai.mode === 'browser') {
    try {
      const data = await geminiBrowser(section, msgs, await observations(section, extra), ctl.signal);
      if (!data.say) { ai.lastError = data.error || 'The AI did not answer.'; emitA(); return null; }
      ai.lastError = null; emitA(); return data;
    } catch (e) { ai.lastError = e.name === 'AbortError' ? 'The AI took too long to answer.' : 'Gemini could not be reached (internet?).'; emitA(); return null; }
    finally { clearTimeout(tm); }
  }
  try {
    const r = await fetch('api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ section, messages: msgs, context: await observations(section, extra) }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.say) { ai.lastError = data.message || data.error || 'The AI did not answer.'; if (r.status === 503) ai.status = 'offline'; emitA(); return null; }
    ai.lastError = null; emitA();
    return data;
  } catch (e) {
    ai.lastError = e.name === 'AbortError' ? 'The AI took too long to answer.' : 'The AI service could not be reached.'; emitA();
    return null;
  } finally { clearTimeout(tm); }
}
/** Store what ORBI said (live or offline) so the conversation stays coherent. */
export const said = (section, text) => remember(section, 'assistant', text);
