// ORBITAL companion — music player for the crew's five songs (content.js → LIBRARY). Real MP3 playback only.
// Where the audio comes from, in this order:
//   1. the copy loaded in Profile & Data (stored in the browser's database — plays offline, on any computer/host);
//   2. the MP3 with exactly the library file name in ORBITAL's music/ folder (served by serve.py or any web host).
// ORBI only reports a song as playing once the browser has actually started the audio. If the file is missing or
// cannot be decoded, play() returns { ok:false, reason } with an honest message — nothing is ever substituted.
import { DB } from '../db.js';
import { LIBRARY } from './content.js';

const subs = new Set();
export const player = { playing: null, paused: false, volume: 0.8, category: null, error: null };
const emitP = () => subs.forEach(f => { try { f(player); } catch (e) { console.error(e); } });
export const onPlayer = fn => { subs.add(fn); return () => subs.delete(fn); };
try { const v = parseFloat(localStorage.getItem('orbital.volume')); if (v >= 0 && v <= 1) player.volume = v; } catch (e) { /* ignore */ }

const audio = typeof Audio !== 'undefined' ? new Audio() : null;
let objUrl = null, ducked = false;
export const CATS = ['sad', 'stressed', 'motivation', 'happy', 'relax'];
const ALIAS = { lonely: 'sad', loneliness: 'sad', stress: 'stressed', anxious: 'stressed', motivated: 'motivation', happiness: 'happy', relaxing: 'relax', rest: 'relax', calm: 'relax' };
export const catOf = c => ALIAS[c] || c;

// ---------------------------------------------------------------- where is each song's audio?
const fileUrl = s => 'music/' + encodeURIComponent(s.file);
const blobKey = s => 'song:' + s.id;
let availCache = null, availAt = 0;
/** For each of the five songs: is a real audio file available, and where from? */
export async function library(force = false) {
  if (!force && availCache && Date.now() - availAt < 15000) return availCache;
  const meta = (await DB.kvGet('songFiles')) || {};
  availCache = await Promise.all(LIBRARY.map(async s => {
    if (meta[s.id]) return { ...s, source: 'loaded', sourceLabel: `Loaded in Profile & Data (${meta[s.id].name})`, duration: meta[s.id].duration || null };
    try { const r = await fetch(fileUrl(s), { method: 'HEAD', cache: 'no-store' }); if (r.ok) return { ...s, source: 'folder', sourceLabel: 'music/ folder', duration: null }; } catch (e) { /* offline / no server */ }
    return { ...s, source: null, sourceLabel: 'Audio file not loaded' };
  }));
  availAt = Date.now();
  return availCache;
}
export const songFor = cat => LIBRARY.find(s => s.cat === catOf(cat)) || null;
/** Load (or replace) a song's MP3 from a file the crew picked in Profile & Data. */
export async function loadSongFile(id, file) {
  const s = LIBRARY.find(x => x.id === id); if (!s || !file) return null;
  await DB.kvSet(blobKey(s), file);
  const meta = (await DB.kvGet('songFiles')) || {};
  meta[id] = { name: file.name, size: file.size, duration: await durationOf(file), ts: Date.now() };
  await DB.kvSet('songFiles', meta); availCache = null;
  return meta[id];
}
export async function removeSongFile(id) {
  const meta = (await DB.kvGet('songFiles')) || {}; delete meta[id]; await DB.kvSet('songFiles', meta);
  const s = LIBRARY.find(x => x.id === id); if (s) await DB.kvSet(blobKey(s), null); availCache = null;
}
/** Remove everything from the old music libraries (previous versions stored other songs in the browser). */
export async function purgeOldLibrary() {
  if (await DB.kvGet('musicPurged5')) return;
  const old = (await DB.kvGet('musicFiles')) || [];
  for (const f of old) await DB.kvSet('musicBlob:' + f.id, null);
  await DB.kvSet('musicFiles', []); await DB.kvSet('ytTitles', null); await DB.kvSet('musicFav', null);
  await DB.kvSet('musicPurged5', true);
}
function durationOf(blob) {
  return new Promise(res => { try { const a = new Audio(); const u = URL.createObjectURL(blob); a.preload = 'metadata'; const done = v => { res(v); URL.revokeObjectURL(u); }; a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration) : null); a.onerror = () => done(null); a.src = u; setTimeout(() => done(null), 4000); } catch (e) { res(null); } });
}

// ---------------------------------------------------------------- playback
/**
 * Play one of the five songs. opts: { category } (sad / stressed / motivation / happy / relax) or { id } or { query }.
 * Resolves { ok:true, song } once audio is really playing, or { ok:false, reason, song, message }.
 */
export async function play(opts = {}) {
  if (!audio) return { ok: false, reason: 'unsupported', message: 'This browser cannot play audio.' };
  let s = null;
  if (opts.id) s = LIBRARY.find(x => x.id === opts.id);
  else if (opts.category) s = songFor(opts.category);
  else if (opts.query) { const q = opts.query.toLowerCase(); s = LIBRARY.find(x => q.includes(x.title.toLowerCase()) || q.includes(x.artist.toLowerCase().split(' ').pop())); if (!s) return { ok: false, reason: 'unknown', message: `"${opts.query.trim()}" is not one of the five songs in the mission library.` }; }
  else s = LIBRARY.find(x => x.cat === 'happy');
  if (!s) return { ok: false, reason: 'unknown', message: 'That song is not in the mission library.' };
  stop(false);
  let src = null; const blob = await DB.kvGet(blobKey(s));
  if (blob) { objUrl = URL.createObjectURL(blob); src = objUrl; }
  else src = fileUrl(s);
  const song = { ...s, from: blob ? 'loaded' : 'folder' };
  const result = await new Promise(resolve => {
    let settled = false; const done = r => { if (!settled) { settled = true; resolve(r); } };
    audio.onerror = () => done({ ok: false, reason: 'missing', song, message: `I can't play "${s.title}" — its audio file isn't loaded. Add "${s.file}" in Profile and Data, or copy it into ORBITAL's music folder.` });
    audio.onplaying = () => done({ ok: true, song });
    audio.src = src; audio.volume = ducked ? player.volume * 0.25 : player.volume;
    audio.play().catch(e => { if (e?.name === 'NotAllowedError') done({ ok: false, reason: 'blocked', song, message: 'The browser blocked the music from starting by itself. Click once anywhere on the page, then ask again.' }); /* other errors arrive through onerror */ });
    setTimeout(() => done({ ok: false, reason: 'missing', song, message: `"${s.title}" did not start — the audio file may be missing or damaged.` }), 8000);
  });
  if (!result.ok) { stop(false); player.playing = null; player.error = result.message; emitP(); return result; }
  audio.onended = () => { if (player.playing?.id === s.id) stop(); };
  audio.onerror = () => { player.error = 'The audio stopped: the file could not be read.'; stop(); };
  player.playing = song; player.paused = false; player.category = s.cat; player.error = null; emitP();
  return result;
}
/** Skip → the next of the five songs. */
export async function next() {
  const i = LIBRARY.findIndex(x => x.id === player.playing?.id);
  return play({ id: LIBRARY[(i + 1) % LIBRARY.length].id });
}
export function pause() { if (audio && player.playing && !player.paused) { audio.pause(); player.paused = true; emitP(); return true; } return false; }
export async function resume() { if (audio && player.playing && player.paused) { try { await audio.play(); player.paused = false; emitP(); return true; } catch (e) { return false; } } return false; }
export function duck(on) { ducked = !!on; if (audio && player.playing) audio.volume = ducked ? player.volume * 0.25 : player.volume; }
export function setVolume(v) { player.volume = Math.max(0.05, Math.min(1, Math.round(v * 100) / 100)); if (audio) audio.volume = ducked ? player.volume * 0.25 : player.volume; try { localStorage.setItem('orbital.volume', String(player.volume)); } catch (e) { /* ignore */ } emitP(); return player.volume; }
export const volumeDown = () => setVolume(player.volume - 0.2);
export const volumeUp = () => setVolume(player.volume + 0.2);
export function stop(notify = true) {
  if (audio) { audio.onended = null; audio.onerror = null; audio.onplaying = null; audio.pause(); audio.removeAttribute('src'); try { audio.load(); } catch (e) { /* ignore */ } }
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
  if (notify) { player.playing = null; player.paused = false; emitP(); }
}
export const position = () => audio && player.playing ? { t: audio.currentTime || 0, d: isFinite(audio.duration) ? audio.duration : 0 } : { t: 0, d: 0 };
export const unavailableText = r => r.message || 'Sorry — that song could not be played.';
