// ORBI — global voice companion panel (available on every page) + intervention handling.
// It stays silent unless (a) the astronaut calls it ("ORBITAL…", the orb button, or the Mental Health page), or
// (b) the well-being rules detect very bad signs (persistent low-mood signs, long silence / withdrawal, skipped exercise).
import { $, esc, toast } from '../ui.js';
import { speak, stopSpeaking, startListening, stopListening, isListening, onVoice, voiceState, support } from '../voice.js';
import { reply, proactive, setActions, welcomeLine, memoryItem, setPending } from './chat.js';
import { play, stop as stopMusic, onPlayer, player, pause as pauseMusic, resume as resumeMusic, next as nextSong, volumeDown, volumeUp, unavailableText, duck, library, purgeOldLibrary } from './music.js';
import { LIBRARY } from './content.js';
import { aiKind, askAI, said, addFact, setMindSummary, refreshAI, onAI, ai, aiLabel } from '../ai/brain.js';
import { newsToday, newsSpeech, setAdaptation } from './daily.js';
import { onIntervention, startWatching, opsMode, setOps, onOps } from './wellbeing.js';
import { emit } from '../store.js';
import { DB } from '../db.js';
import { mountRelax } from './relax.js';
import { run, protocolCommand } from '../orbi/protocol.js';
import { flag, markToday } from '../game.js';

const WAKE = /\b(orbi|orby|orbee|orbie|orbit|orbital)\b/i;
const WAKE_STRIP = /^\s*(hey |ok |okay )?(orbi|orby|orbee|orbie|orbit|orbital)[,!.]?\s*/i;
const log = []; // shared transcript {who, text}
const subs = new Set(); const emitLog = () => subs.forEach(f => f());
export const onTranscript = fn => { subs.add(fn); return () => subs.delete(fn); };
export const transcript = () => log;
let bodyHandler = null, override = null, emergencyHandler = null;
/** The Emergency Center's conversation handler (gets all speech on that page, including protocol commands). */
export function setEmergencyHandler(fn) { emergencyHandler = fn; }
/** Temporarily capture all speech (e.g. ORBI's "are you okay?" check). Pass null to release. */
export function setVoiceOverride(fn) { override = fn; }
export function setBodyHandler(fn) { bodyHandler = fn; }

function say(who, text) { log.push({ who, text, ts: Date.now() }); if (log.length > 80) log.shift(); emitLog(); }

export async function companionSay(text, { store = true } = {}) { if (!text) return; say('bot', text); if (store) await said('mind', text); await speak(text, { persona: 'mind' }); }

// ---------- music: the crew's five songs, controlled by natural requests (any page) ----------
// Explicit requests play straight away ("I need motivation", "play something that makes me happy", "I'm stressed",
// "I want to relax", "I'm lonely, can you play something?"). A feeling on its own ("I feel lonely") stays a
// conversation — ORBI may offer the song, and respects a "no".
const CONTROL = [
  ['stop', /\b(stop|turn off|switch off|end)\b.{0,12}\b(music|song|playing)\b|^(stop|stop it|stop that|silence)[.!]?$/],
  ['pause', /\bpause\b/],
  ['resume', /\b(resume|unpause|continue (the )?(music|song)|keep playing)\b/],
  ['skip', /\b(skip( this| the)?( song| track| one)?|next (song|track)|another song|different song|change (the )?song|play something else)\b/],
  ['down', /\b(turn (it|the music|the volume|that) down|volume down|lower the volume|quieter|too loud|softer)\b/],
  ['up', /\b(turn (it|the music|the volume|that) up|volume up|raise the volume|louder)\b/],
];
const MOOD_WORDS = [
  ['sad', /\b(lonely|loneliness|alone|sad|down|miss(ing)? (home|earth|my|them|everyone)|homesick)\b/],
  ['stressed', /\b(stress\w*|anxious|anxiety|overwhelm\w*|tense|on edge|panick\w*)\b/],
  ['motivation', /\b(motivat\w*|unmotivated|push me|pump(ed)? (me )?up|energ(y|ise|ize|etic)|give up|keep going)\b/],
  ['happy', /\b(happy|happier|cheer (me )?up|good mood|upbeat|fun|uplifting|joy\w*)\b/],
  ['relax', /\b(relax\w*|calm\w*|chill|unwind|rest|wind down|soothing|peaceful|sleep\w*)\b/],
];
const ASKS_MUSIC = /\b(play|put on|put something on|can you play|could you play|hear|listen to|song|music|tune)\b/;
const DIRECT = [ // requests that clearly ask for the song even without the word "music"
  ['motivation', /^(i (really )?need (some )?motivation|motivate me|give me (some )?motivation)\b/],
  ['happy', /\b(make me (feel )?happy|i want to (feel|be) happy|cheer me up)\b/],
  ['relax', /^(i (just )?want to relax|i need to relax|help me (to )?relax)\b/],
  ['stressed', /^(i'?m|i am|i feel|i'?m feeling|i am feeling) (so |really |very |a bit |kind of )?stress(ed)?\b|^i'?m (so )?(stressed|overwhelmed)( out)?[.!]?$/],
];
const CAT_LINE = { sad: 'for when you feel low or lonely', stressed: 'for stressful moments', motivation: 'for a bit of motivation', happy: 'to lift your mood', relax: 'to help you relax' };
async function musicCommand(raw) {
  const t = raw.replace(WAKE_STRIP, '').trim().toLowerCase().replace(/[’]/g, "'");
  if (/suicid|kill myself|end (it all|my life)|hurt myself|self.?harm|want to die|don'?t want to (live|be here)/.test(t)) return false; // never treat crisis words as music
  const ctl = CONTROL.find(([, re]) => re.test(t));
  if (ctl) {
    const [cmd] = ctl;
    if (!player.playing) { if (cmd === 'stop' && /music|song/.test(t)) { say('me', raw); await companionSay('Nothing is playing right now.', { store: false }); return true; } if (cmd !== 'skip') return false; }
    say('me', raw.replace(WAKE_STRIP, '').trim());
    if (cmd === 'stop') { stopMusic(); await companionSay(pickOne(['Okay, music off.', 'Stopped.', 'Done — it\'s quiet again.'])); return true; }
    if (cmd === 'pause') { pauseMusic(); await companionSay('Paused. Say "resume" when you want it back.'); return true; }
    if (cmd === 'resume') { const ok = await resumeMusic(); await companionSay(ok ? 'Here it is again.' : 'I couldn\'t resume it.', { store: false }); return true; }
    if (cmd === 'down') { const v = volumeDown(); say('sys', `🔉 Volume ${Math.round(v * 100)}%`); await companionSay('Turned down.', { store: false }); return true; }
    if (cmd === 'up') { const v = volumeUp(); say('sys', `🔊 Volume ${Math.round(v * 100)}%`); await companionSay('Turned up.', { store: false }); return true; }
    if (cmd === 'skip') { await skipAndSay(); return true; }
  }
  // a song by name?
  const named = LIBRARY.find(x => t.includes(x.title.toLowerCase()) || (ASKS_MUSIC.test(t) && t.includes(x.artist.toLowerCase())));
  if (named && /\bplay|put on|hear\b/.test(t)) { say('me', raw); await playAndSay({ id: named.id }); return true; }
  // a mood + an explicit music request, or a direct request
  const direct = DIRECT.find(([, re]) => re.test(t));
  const mood = MOOD_WORDS.find(([, re]) => re.test(t));
  if (direct || (ASKS_MUSIC.test(t) && /\b(play|put on|listen|hear|song|music|something)\b/.test(t) && !/\b(game|chess|cards|catch|play with)\b/.test(t))) {
    if (!direct && !mood && !/\b(play|put on)\b.{0,25}\b(music|song|something|tune)\b|\b(some|a) (music|song)\b/.test(t)) return false;
    say('me', raw.replace(WAKE_STRIP, '').trim());
    await playAndSay({ category: direct ? direct[0] : mood ? mood[0] : 'happy' });
    return true;
  }
  return false;
}
const pickOne = a => a[Math.floor(Math.random() * a.length)];
async function skipAndSay() {
  const r = await nextSong();
  if (!r.ok) return companionSay(unavailableText(r));
  markToday('music'); say('sys', `♪ ${r.song.title} — ${r.song.artist}`);
  companionSay(`Next: "${r.song.title}" by ${r.song.artist}.`, { store: false });
}
/** Play one of the five songs. ORBI announces it only after the audio has really started. */
async function playAndSay(opts, announce = true) {
  if (voiceState.speaking) stopSpeaking();
  const r = await play(opts);
  if (!r.ok) { await companionSay(unavailableText(r)); return r; }
  const s = r.song; markToday('music');
  say('sys', `♪ ${s.title} — ${s.artist} (playing)`);
  if (announce) companionSay(`Here's "${s.title}" by ${s.artist} — ${CAT_LINE[s.cat]}. Say stop any time.`, { store: false });
  return r;
}
async function musicContext() {
  const lib = await library();
  return `Mission music library (exactly five real songs, chosen by the crew): ${lib.map(x => `"${x.title}" by ${x.artist} — ${x.mood}${x.source ? '' : ' [audio file not loaded]'}`).join('; ')}. ${player.playing ? `Now playing: "${player.playing.title}"${player.paused ? ' (paused)' : ''}.` : 'Nothing is playing.'}`;
}

async function runAction(a, arg) {
  if (a === 'song') return playAndSay({ category: 'happy' });
  if (a?.startsWith?.('song:')) return playAndSay({ category: a.slice(5) });
  const MOODACT = { play_sad_lonely: 'sad', play_stressed: 'stressed', play_motivation: 'motivation', play_happy: 'happy', play_relax: 'relax' };
  if (MOODACT[a]) return playAndSay({ category: MOODACT[a] }, false);
  if (a === 'play_specific') { const n = LIBRARY.find(x => (arg || '').toLowerCase().includes(x.title.toLowerCase())); return n ? playAndSay({ id: n.id }, false) : companionSay('That song isn\'t in the mission library — only the five songs your crew chose are on board.'); }
  if (a === 'stopMusic' || a === 'stop_music') return stopMusic();
  if (a === 'pause_music') return pauseMusic();
  if (a === 'resume_music') return resumeMusic();
  if (a === 'skip_song') return skipAndSay();
  if (a === 'volume_down') return volumeDown();
  if (a === 'volume_up') return volumeUp();
  if (a === 'share_memory') { const { m, text } = await memoryItem(); showMemoryMedia(m); return companionSay(text); }
  if (a === 'news' || a === 'read_news') { markToday('news'); const n = await newsToday(); return companionSay(newsSpeech(n)); }
  if (a === 'startExercise' || a === 'start_exercise') { location.hash = '#/physical'; setTimeout(() => window.dispatchEvent(new Event('orbi:startExercise')), 900); return; }
  if (a === 'lighter_exercise') { await setAdaptation('light'); return runAction('adapted'); }
  if (a === 'exercise_pain') { const area = /leg|knee|ankle|hip|foot|calf|thigh/.test(arg) ? 'legs' : /back|spine/.test(arg) ? 'back' : /arm|shoulder|wrist|elbow|hand|neck/.test(arg) ? 'arms' : /head/.test(arg) ? 'head' : null; await setAdaptation('pain', area); return runAction('adapted'); }
  if (a === 'showHR' || a === 'show_heart_rate') { if (!location.hash.startsWith('#/camera')) location.hash = '#/camera'; return; }
  if (a === 'adapted') { emit('records'); toast('Today\'s exercise routine was adapted by ORBI.'); return; }
  if (a === 'relax' || a === 'start_relaxation') return openRelax();
  if (a === 'crisis' || a === 'crisis_support') { toast('Please contact the Crew Medical Officer now. Emergency Center → Mental-health crisis protocol.', true); const { companionMem, saveMem } = await import('./wellbeing.js'); const m = await companionMem(); m.log.push({ ts: Date.now(), reason: 'crisis-disclosure' }); await saveMem(); }
}
/** Handle something the astronaut said or typed to the Well-being Assistant (its own conversation context). */
export async function hear(text) {
  if (run.active) { say('me', text); return protocolCommand(text); }
  const t = text.replace(WAKE_STRIP, '').trim();
  if (!location.hash.startsWith('#/mental')) open(); // the Mental Health page shows the same conversation itself
  if (!t) return companionSay(welcomeLine());
  if (await musicCommand(t)) return;
  say('me', t);
  stopSpeaking(); flag('talked');
  const live = await askAI('mind', t, { extra: await musicContext() + (pendingCheckIn ? ` ORBI started this conversation itself (check-in about: ${pendingCheckIn}).` : '') });
  pendingCheckIn = null;
  if (live) {
    if (live.remember) addFact(live.remember);
    if (live.mood && live.mood !== 'unknown') setMindSummary(`mood seemed ${live.mood}`);
    await companionSay(live.say, { store: true });
    if (live.action && live.action !== 'none') await runAction(live.action, live.action_arg);
    return;
  }
  const r = await reply(t);
  if (r.memory) showMemoryMedia(r.memory);
  if (r.text) await companionSay(r.text);
  if (r.action && r.action !== 'memory') await runAction(r.action);
}
let pendingCheckIn = null;
setActions({});

// ---------- DOM ----------
let panel, relaxCtl = null;
function build() {
  document.body.insertAdjacentHTML('beforeend', `
  <button class="orb-btn" id="orbBtn" title="Talk to ORBI"><span class="orb"></span><span class="orb-l">ORBI</span></button>
  <section class="companion hidden" id="companion" aria-label="ORBI companion">
    <header><span class="orb sm" id="cOrb"></span><div><b>ORBI</b> <button type="button" class="chip" id="cOps" title="Mission-critical operation in progress: ORBI holds non-urgent support until it ends">⏸ Mission ops</button><span class="pill" id="cAI"></span><div class="small muted" id="cState">Quietly watching over you</div></div><button class="icon-btn" id="cClose" aria-label="Close">✕</button></header>
    <div class="now hidden" id="cNow"></div>
    <div class="chat" id="cChat"></div>
    <div id="cMedia" class="hidden"></div>
    <div id="cRelax" class="hidden"></div>
    <form id="cForm" class="btn-row" style="flex-wrap:nowrap"><button type="button" class="btn" id="cMic" title="Voice on/off">🎙</button><input id="cIn" placeholder="Say “ORBI…” or type here" autocomplete="off"><button class="btn primary">Send</button></form>
    <p class="small dim" id="cNote"></p>
  </section>`);
  panel = $('#companion');
  $('#orbBtn').onclick = () => { panel.classList.contains('hidden') ? (open(), log.length || companionSay(welcomeLine())) : close(); };
  $('#cClose').onclick = close;
  $('#cForm').onsubmit = e => { e.preventDefault(); const v = $('#cIn').value.trim(); if (!v) return; $('#cIn').value = ''; hear(v); };
  $('#cMic').onclick = toggleVoice;
  renderChat($('#cChat')); onTranscript(() => renderChat($('#cChat')));
  onVoice(v => { updateState(); duck(v.state === 'speaking'); }); onPlayer(updateNow); onAI(updateState); refreshAI(); updateState(); updateNow();
}
export function renderChat(el) {
  if (!el) return;
  el.innerHTML = log.map(m => `<div class="msg ${m.who === 'me' ? 'me' : m.who === 'sys' ? 'sys' : 'bot'}">${esc(m.text)}</div>`).join('') || '<div class="msg sys">ORBI only speaks when you call it — or if it is really worried about you.</div>';
  el.scrollTop = el.scrollHeight;
}
function updateState() {
  const st = voiceState.state === 'speaking' ? 'Speaking…' : voiceState.state === 'processing' ? 'Thinking…' : voiceState.state === 'listening' ? (voiceState.interim ? '…' + voiceState.interim.slice(-50) : `Listening — ${voiceState.owner}`) : 'Quietly watching over you';
  if ($('#cState')) $('#cState').textContent = st;
  document.body.classList.toggle('v-speaking', voiceState.speaking); document.body.classList.toggle('v-listening', voiceState.listening);
  if ($('#cMic')) $('#cMic').classList.toggle('primary', isListening());
  if ($('#cAI')) { $('#cAI').textContent = aiLabel('mind'); $('#cAI').className = 'pill ' + (aiKind('mind') !== 'offline' ? 'lv-ok' : 'lv-caution'); }
  if ($('#cNote')) $('#cNote').textContent = voiceState.error ? '⚠ ' + voiceState.error : !support.stt ? 'Voice input needs Chrome or Edge — you can type instead.' : voiceState.onDevice === false && voiceState.listening ? 'Voice recognition is using the browser speech service (on-device recognition not available in this Chrome).' : '';
}
function updateNow() {
  const el = $('#cNow'); if (!el) return;
  if (!player.playing) { el.classList.add('hidden'); document.body.classList.remove('music-on'); return; }
  document.body.classList.toggle('music-on', !player.paused);
  el.classList.remove('hidden');
  const s = player.playing;
  el.innerHTML = `<span class="eq ${player.paused ? 'paused' : ''}"><i></i><i></i><i></i></span><span class="now-t"><b>${esc(s.title)}</b> — ${esc(s.artist)}<br><span class="small dim">${esc(s.mood)} · ${s.from === 'loaded' ? 'your loaded MP3' : 'music folder MP3'}</span></span>
    <span class="now-c"><button class="btn sm" id="cPP" title="${player.paused ? 'Play' : 'Pause'}">${player.paused ? '▶' : '❚❚'}</button><button class="btn sm" id="cSkip" title="Next song">⏭</button><button class="btn sm" id="cVd" title="Volume down">−</button><button class="btn sm" id="cVu" title="Volume up">+</button><button class="btn sm" id="cStop" title="Stop">■</button></span>`;
  $('#cPP').onclick = () => player.paused ? resumeMusic() : pauseMusic();
  $('#cSkip').onclick = () => skipAndSay();
  $('#cVd').onclick = () => volumeDown(); $('#cVu').onclick = () => volumeUp();
  $('#cStop').onclick = () => stopMusic();
}
/** A gentle, natural question from elsewhere in the app (e.g. the Form coach noticed slower movement). */
export async function askAstronaut(text, pending = null) { open(); if (pending) setPending(pending); pendingCheckIn = 'exercise observation'; await companionSay(text); }
export function open() { panel?.classList.remove('hidden'); }
export function close() { panel?.classList.add('hidden'); $('#cMedia')?.classList.add('hidden'); relaxCtl?.stop(); $('#cRelax')?.classList.add('hidden'); }
export function openRelax(mode) {
  open(); const el = $('#cRelax'); el.classList.remove('hidden');
  relaxCtl = mountRelax(el, { mode: mode || 'box', onDone: () => setTimeout(() => el.classList.add('hidden'), 2500) });
  relaxCtl.start(mode || 'box');
}
export async function toggleVoice() {
  if (isListening()) { stopListening(); try { localStorage.setItem('orbital.voice', 'off'); } catch (e) { /* ignore */ } }
  else { await startListening(route); try { localStorage.setItem('orbital.voice', 'on'); } catch (e) { /* ignore */ } }
  updateState();
}
export async function ensureVoice() { if (!isListening()) await startListening(route); updateState(); return isListening(); }
async function route(text) {
  if (override) return override(text);
  if (location.hash.startsWith('#/emergency') && emergencyHandler) return emergencyHandler(text);
  if (run.active) return protocolCommand(text);
  if (await musicCommand(text)) return;
  if (location.hash.startsWith('#/body') && bodyHandler) return bodyHandler(text);
  const panelOpen = panel && !panel.classList.contains('hidden');
  if (location.hash.startsWith('#/mental') || panelOpen || WAKE.test(text)) return hear(text);
  // not addressed to ORBITAL → stay silent (it never interrupts unless asked or very worried)
}

// ---------- interventions ----------
async function intervene(reason, a, data) {
  if (reason === 'stress') { toast(`ORBI noticed signs of tension${a?.stress?.thermal ? ' (thermal: ' + a.stress.thermal + ')' : ''} — a relaxation exercise is suggested in Mental Health. Or say “ORBI, help me relax”.`); return; }
  if (reason === 'sleep') { toast('ORBI sleep watch: signs of insomnia / sleep discomfort last night — see Mental Health.'); return; }
  if (reason === 'fatigue') { toast('ORBI: fatigue pattern (eye closure, slower movement, short sleep). Rest when you can — say “ORBI, make it lighter” to adapt today\'s exercise.'); return; }
  if (!location.hash.startsWith('#/mental')) open(); pendingCheckIn = reason;
  await companionSay(proactive(reason, data));
  if (reason === 'safety') toast('ORBI safety check: ' + (data?.kind === 'temp' ? 'raised skin temperature' : 'unusual heart-rate reading') + ' — please respond.', true);
}
async function showMemoryMedia(m) {
  const el = $('#cMedia'); if (!el || !m.mediaId) return;
  const blob = await DB.kvGet('memMedia:' + m.mediaId); if (!blob) return;
  const url = URL.createObjectURL(blob); const tp = (blob.type || '').split('/')[0];
  el.innerHTML = tp === 'image' ? `<img src="${url}" alt="Memory from ${esc(m.from)}">` : tp === 'video' ? `<video src="${url}" controls autoplay></video>` : `<audio src="${url}" controls autoplay></audio>`;
  el.classList.remove('hidden');
}

export function initCompanion() {
  build(); purgeOldLibrary();
  window.addEventListener('orbi:interrupt', () => { relaxCtl?.stop(); $('#cRelax')?.classList.add('hidden'); $('#cMedia')?.classList.add('hidden'); });
  onIntervention((reason, a, data) => intervene(reason, a, data));
  const syncOps = () => $('#cOps')?.classList.toggle('on', opsMode()); onOps(v => { syncOps(); toast(v ? 'Mission-ops mode: ORBI will hold non-urgent support until you finish.' : 'Mission-ops mode off — ORBI is available again.'); });
  $('#cOps').onclick = () => setOps(!opsMode());
  startWatching();
  let pref = null; try { pref = localStorage.getItem('orbital.voice'); } catch (e) { /* ignore */ }
  if (pref === 'on' && support.stt) startListening(route).then(updateState);
}
