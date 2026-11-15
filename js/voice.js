// ORBITAL — voice session manager: speech output (speechSynthesis) + continuous two-way speech recognition (Web Speech API).
//
// One persistent voice SESSION, one recognizer at a time, four states:
//   idle        — voice off (the astronaut switched it off, or the browser cannot recognise speech)
//   listening   — the microphone is open; partial words are collected until the astronaut stops talking
//   processing  — the utterance is finished and ORBI is thinking (microphone paused)
//   speaking    — ORBI is talking (microphone paused so ORBI never hears — and answers — its own voice)
// After ORBI finishes speaking the microphone re-opens by itself: the astronaut never has to press the button again.
// The recogniser is restarted automatically when Chrome ends it (silence time-outs, network blips, tab switches),
// with a back-off so a broken microphone or a missing speech service does not cause a restart storm.
//
// Speech recognition: Chrome/Edge. Chrome's standard recognition uses an online speech service. On-device (offline)
// recognition can be switched on in Profile & Data (Chrome 139+; see README).
const listeners = new Set();
export const voiceState = { owner: 'Well-being companion', state: 'idle', active: false, listening: false, speaking: false, processing: false, interim: '', error: null, onDevice: null, fallback: false, heard: 0 };
const emitV = () => { voiceState.listening = voiceState.state === 'listening'; voiceState.speaking = voiceState.state === 'speaking'; voiceState.processing = voiceState.state === 'processing'; listeners.forEach(f => { try { f(voiceState); } catch (e) { console.error(e); } }); };
/** Which assistant currently owns the microphone (one recogniser is shared; the page decides who answers). */
export function setOwner(name) { voiceState.owner = name || 'Well-being companion'; emitV(); }
export const onVoice = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const support = { tts: 'speechSynthesis' in window, stt: !!SR };

// ---------------------------------------------------------------- speech output
let voice = null, voice2 = null;
/** Two personas: the Well-being companion ('mind') and the medical assistants ('body', default). */
const PERSONA = { body: { rate: 1, pitch: 0.97 }, mind: { rate: 1.03, pitch: 1.1 } };
function pickVoice2() {
  if (!support.tts) return null; const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang) && v !== voice);
  const local = vs.filter(v => v.localService); const pref = /natural|aria|jenny|zira|samantha|serena|karen|moira|libby|sonia/i;
  return local.find(v => pref.test(v.name)) || local[0] || vs[0] || null;
}
function pickVoice() {
  if (!support.tts) return null;
  const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  if (!vs.length) return null;
  const pref = [/natural/i, /aria|jenny|guy|zira|samantha|daniel|serena|karen|moira/i];
  const local = vs.filter(v => v.localService);
  for (const re of pref) { const v = local.find(x => re.test(x.name)); if (v) return v; }
  return local[0] || vs[0];
}
if (support.tts) { voice = pickVoice(); voice2 = pickVoice2(); try { speechSynthesis.addEventListener('voiceschanged', () => { voice = pickVoice(); voice2 = pickVoice2(); }); } catch (e) { /* old browser */ } }

const plain = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, 'and').replace(/&[a-z]+;/g, ' ').replace(/[•·→—]/g, ', ').replace(/\s+/g, ' ').trim();

let speakToken = 0, speakDepth = 0, lastSpoken = '', speechEndedAt = 0, pendingFinish = null;
/** Speak text. Resolves when finished (or immediately if TTS unavailable / cancelled). The microphone is paused meanwhile. */
export function speak(text, { rate, pitch, persona = 'body' } = {}) {
  const P = PERSONA[persona] || PERSONA.body; rate = rate ?? P.rate; pitch = pitch ?? P.pitch; const vv = persona === 'mind' && voice2 ? voice2 : voice;
  const t = plain(text); if (!t || !support.tts) return Promise.resolve();
  const my = ++speakToken;
  // A new sentence replaces the one being spoken: finish the old one now (don't rely on the browser's end event,
  // which some browsers never fire after cancel() — that left the session stuck in "speaking" with the mic closed).
  if (pendingFinish) pendingFinish();
  speechSynthesis.cancel();
  lastSpoken = (lastSpoken + ' ' + t).slice(-600);
  // Chrome cuts long utterances: speak sentence by sentence.
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/).filter(Boolean);
  speakDepth++; enter('speaking'); pauseRecognition();
  return new Promise(resolve => {
    let i = 0, watchdog = 0, finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(watchdog); if (pendingFinish === finish) pendingFinish = null; speakDepth = Math.max(0, speakDepth - 1); if (my === speakToken) afterSpeech(); resolve(); };
    pendingFinish = finish;
    const next = () => {
      clearTimeout(watchdog);
      if (my !== speakToken || i >= parts.length) return finish();
      const part = parts[i++].trim();
      const u = new SpeechSynthesisUtterance(part);
      if (vv) u.voice = vv; u.rate = rate; u.pitch = pitch; u.lang = vv?.lang || 'en-US';
      let done = false; const go = () => { if (!done) { done = true; next(); } };
      u.onend = go; u.onerror = go;
      // Watchdog: some Chrome builds never fire onend (e.g. after a device change) — never let the session hang in "speaking".
      watchdog = setTimeout(go, 2500 + part.length * 95 / rate);
      speechSynthesis.speak(u);
    };
    next();
  });
}
export function stopSpeaking() { speakToken++; const pf = pendingFinish; pendingFinish = null; pf?.(); speakDepth = 0; if (support.tts) speechSynthesis.cancel(); if (voiceState.state === 'speaking') afterSpeech(); }
function afterSpeech() {
  if (speakDepth > 0) return;
  speechEndedAt = Date.now();
  if (busy) enter('processing'); else if (wantOn) { enter('listening'); resumeSoon(350); } else enter('idle');
}

// ---------------------------------------------------------------- speech recognition (session)
let rec = null, wantOn = false, handler = null, busy = false, restartTimer = 0, endTimer = 0;
let finals = '', interim = '', failures = 0, startedAt = 0, gotResult = false, netErrors = 0;
let tryLocal = false;
try { tryLocal = localStorage.getItem('orbital.sttLocal') === 'on'; } catch (e) { /* ignore */ }
export const localRecognition = () => tryLocal;
/** Opt-in: ask Chrome for on-device (offline) recognition. Takes effect on the next recogniser restart. */
export function setLocalRecognition(on) { tryLocal = !!on; try { localStorage.setItem('orbital.sttLocal', on ? 'on' : 'off'); } catch (e) { /* ignore */ } if (rec) { killRec(); resumeSoon(100); } }
// NOTE: SpeechRecognition.available()/install() are deliberately not called — they crash some Chromium builds.

const SILENCE_AFTER_FINAL = 1100;   // ms of silence after a finished phrase before ORBI answers (natural pauses are allowed)
const SILENCE_AFTER_INTERIM = 1900; // if Chrome still holds unfinished words, wait a little longer

function enter(s) { if (voiceState.state !== s) { voiceState.state = s; emitV(); } }

/** Start the continuous voice session. handler(text) is called once per finished utterance (it may be async). */
export async function startListening(onText) {
  if (onText) handler = onText;
  if (!SR) { voiceState.error = 'Speech recognition is not available in this browser — please use Google Chrome or Microsoft Edge. You can type instead.'; voiceState.fallback = true; emitV(); return false; }
  if (await micBlocked()) { voiceState.error = 'Microphone access is blocked for this site. Click the lock icon next to the address, allow the microphone, then reload.'; voiceState.fallback = true; emitV(); return false; }
  wantOn = true; voiceState.active = true; voiceState.error = null; failures = 0; netErrors = 0;
  if (voiceState.state === 'idle') enter(busy ? 'processing' : 'listening');
  if (voiceState.state === 'listening') resumeSoon(0);
  emitV();
  return true;
}
export function stopListening() {
  wantOn = false; voiceState.active = false; clearTimeout(restartTimer); clearTimeout(endTimer); finals = ''; interim = ''; voiceState.interim = '';
  killRec();
  if (voiceState.state === 'listening') enter('idle'); else emitV();
}
export function setVoiceHandler(fn) { handler = fn; }
export const isListening = () => wantOn;

async function micBlocked() {
  try { const p = await navigator.permissions?.query({ name: 'microphone' }); return p?.state === 'denied'; } catch (e) { return false; }
}
function killRec() { const r = rec; rec = null; if (!r) return; r.onresult = r.onerror = r.onend = r.onstart = null; try { r.abort(); } catch (e) { /* not started */ } }
function pauseRecognition() { clearTimeout(restartTimer); if (rec) killRec(); }
function resumeSoon(ms) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => { if (wantOn && !busy && speakDepth === 0 && !rec && !document.hidden) create(); }, ms);
}

function create() {
  killRec();
  const r = new SR(); rec = r;
  r.lang = 'en-US'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  const local = tryLocal && 'processLocally' in SR.prototype;
  if (local) r.processLocally = true;
  startedAt = Date.now(); gotResult = false;
  r.onstart = () => { if (rec !== r) return; voiceState.onDevice = !!local; if (voiceState.error && !/blocked|not available/.test(voiceState.error)) voiceState.error = null; enter('listening'); emitV(); };
  r.onresult = e => {
    if (rec !== r || voiceState.state !== 'listening') return;
    gotResult = true; failures = 0; netErrors = 0; voiceState.fallback = false;
    let inter = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tx = e.results[i][0].transcript;
      if (e.results[i].isFinal) finals = (finals + ' ' + tx).trim(); else inter += tx;
    }
    interim = inter.trim(); voiceState.interim = (finals + ' ' + interim).trim(); emitV();
    clearTimeout(endTimer);
    endTimer = setTimeout(endOfUtterance, interim ? SILENCE_AFTER_INTERIM : SILENCE_AFTER_FINAL);
  };
  r.onerror = e => {
    if (rec !== r) return;
    const er = e.error;
    if (er === 'language-not-supported' && local) { tryLocal = false; voiceState.onDevice = false; return; }
    if (er === 'not-allowed' || er === 'service-not-allowed') {
      wantOn = false; voiceState.active = false; voiceState.fallback = true;
      voiceState.error = er === 'not-allowed' ? 'Microphone permission was refused. Allow the microphone for this site (lock icon next to the address), then switch voice on again.' : 'This browser does not allow its speech service here. Use Google Chrome or Microsoft Edge, or type instead.';
    } else if (er === 'audio-capture') voiceState.error = 'No microphone was found. Check that a microphone is connected and not used by another program — ORBI keeps trying.';
    else if (er === 'network') { netErrors++; voiceState.error = 'The browser speech service cannot be reached (no internet?). ORBI keeps retrying — you can type meanwhile, or enable on-device recognition in Profile & Data.'; if (netErrors >= 2) voiceState.fallback = true; }
    else if (er !== 'no-speech' && er !== 'aborted') voiceState.error = 'Speech recognition error: ' + er;
    emitV();
  };
  r.onend = () => {
    if (rec !== r) return; // a recogniser we replaced or paused on purpose
    rec = null;
    if (finals || interim) { clearTimeout(endTimer); endOfUtterance(); return; } // Chrome ended mid-phrase: use what we heard
    if (!wantOn) { enter('idle'); return; }
    // Restart. Quick, result-less ends (errors) back off: 0.3 s → 0.6 → 1.2 … max 10 s.
    const quick = !gotResult && Date.now() - startedAt < 1500;
    failures = quick ? failures + 1 : 0;
    resumeSoon(failures ? Math.min(10000, 300 * 2 ** Math.min(failures, 6)) : 80); // clean end: reopen at once so no words are lost
  };
  try { r.start(); } catch (e) { console.warn('[voice] start failed', e); rec = null; resumeSoon(1000); }
}

/** The astronaut stopped talking: hand the whole utterance to the active conversation, then listen again. */
async function endOfUtterance() {
  clearTimeout(endTimer);
  const text = (finals + ' ' + interim).replace(/\s+/g, ' ').trim(); finals = ''; interim = ''; voiceState.interim = '';
  if (!text) return;
  if (isEcho(text)) { emitV(); return; }
  busy = true; pauseRecognition(); enter('processing'); voiceState.heard++;
  try { await handler?.(text); } catch (e) { console.error('[voice] handler failed', e); }
  busy = false;
  if (speakDepth > 0) return;           // still speaking → afterSpeech() will resume listening
  if (wantOn) { enter('listening'); resumeSoon(250); } else enter('idle');
}
/** Drop recognised text that is just the tail of ORBI's own voice (loudspeakers instead of headphones). The microphone
 *  is closed while ORBI speaks, so only the first moment after it reopens can contain echo: a few words that appear,
 *  word for word, at the end of what ORBI just said. Anything else — even a phrase ORBI suggested — is the astronaut. */
function isEcho(text) {
  if (Date.now() - speechEndedAt > 900 || !lastSpoken) return false;
  const n = s => ' ' + s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const h = n(text); if (h.trim().split(' ').length < 2) return false;
  return n(lastSpoken.slice(-160)).includes(h);
}

// Chrome stops recognition in background tabs; re-open the microphone when the astronaut comes back.
document.addEventListener('visibilitychange', () => { if (!document.hidden && wantOn && voiceState.state === 'listening' && !rec) resumeSoon(200); });
