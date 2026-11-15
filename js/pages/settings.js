import { state, saveProfile, loadAll, emit, DEFAULT_PROFILE, saveItem, saveSettings } from '../store.js';
import { DB, uid } from '../db.js';
import { library, loadSongFile, removeSongFile, play as playSong, stop as stopMusic, player } from '../companion/music.js';
import { refreshAI, ai, device, checkDevice, enableDevice, onAI, setBrowserKey } from '../ai/brain.js';
import { mountEventHistory } from '../components/eventHistory.js';
import { DEFAULT_MEMORIES } from '../companion/content.js';
import { localRecognition, setLocalRecognition } from '../voice.js';
import { importNews, ONE_WAY_DELAY_MIN } from '../companion/daily.js';
import { seedDemo, clearSimulated } from '../seed.js';
import { METRICS, SOURCES, srcBadge, RAD_CAREER_LIMIT_MSV } from '../metrics.js';
import { $, esc, toast, download } from '../ui.js';
import { exportRecordsCSV } from '../importer.js';
import { flag } from '../game.js';
import { hashPin } from '../app.js';

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });

export async function render(view, rest = []) {
  let offHist = null;
  const draw = async () => {
    const p = { ...DEFAULT_PROFILE, ...(state.profile || {}) };
    const counts = {}; state.records.forEach(r => counts[r.source] = (counts[r.source] || 0) + 1);
    let est = null; try { est = await navigator.storage?.estimate?.(); } catch { }
    let cacheInfo = 'unknown';
    try { const keys = await caches.keys(); const orb = keys.filter(k => k.startsWith('orbital')); if (orb.length) { const c = await caches.open(orb[0]); cacheInfo = `${(await c.keys()).length} files cached (${orb[0]})`; } else cacheInfo = 'not cached yet'; } catch { cacheInfo = 'Cache API unavailable'; }
    const sw = navigator.serviceWorker?.controller ? 'active — app works offline' : ('serviceWorker' in navigator ? 'registering… reload once to activate offline mode' : 'not supported');
    view.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <h2>Astronaut profile &amp; mission</h2>
        <form id="profForm" class="form-grid">
          <div class="field"><label>Name</label><input name="name" value="${esc(p.name)}"></div>
          <div class="field"><label>Call sign</label><input name="callsign" value="${esc(p.callsign)}"></div>
          <div class="field"><label>Role</label><input name="role" value="${esc(p.role)}"></div>
          <div class="field"><label>Age</label><input name="age" type="number" value="${esc(p.age)}"></div>
          <div class="field"><label>Mission name</label><input name="missionName" value="${esc(p.missionName)}"></div>
          <div class="field"><label>Mission start date</label><input name="missionStart" type="date" value="${esc(p.missionStart || '')}"></div>
          <div class="field"><label>Planned duration (days)</label><input name="plannedDays" type="number" value="${esc(p.plannedDays || 500)}"></div>
          <div class="field"><label>Baseline window starts (mission day)</label><input name="baselineFrom" type="number" min="1" value="${esc(p.baselineFrom || 5)}"></div>
          <div class="field"><label>Baseline length (days)</label><input name="baselineDays" type="number" min="3" value="${esc(p.baselineDays || 7)}"></div>
          <div class="field" style="grid-column:1/-1"><label>Mission stages (one per line: start day | name | gravity)</label><textarea name="stages" rows="4">${esc(p.stages.map(s => `${s.startDay} | ${s.name} | ${s.gravity}`).join('\n'))}</textarea></div>
          <div class="field" style="grid-column:1/-1"><label>Medications approved by the crew medical officer (one per line: name — dose — use)</label><textarea name="approvedMeds" rows="3" placeholder="e.g. Paracetamol 500 mg — 1–2 tablets every 6 h, max 8 a day — headache, pain, fever">${esc(p.approvedMeds || '')}</textarea></div>
          <div class="field"><label>Allergies (comma-separated)</label><input name="allergies" value="${esc(p.allergies || '')}" placeholder="e.g. ibuprofen"></div>
          <div class="field"><label><input type="checkbox" name="crewOnBoard" ${p.crewOnBoard !== false ? 'checked' : ''}> Crewmates on board (sound the crew alarm in an emergency)</label></div>
          <div class="field"><button class="btn primary" type="submit">Save profile</button></div>
        </form>
        <p class="small dim">The personal baseline is the median of each indicator during the baseline window (default: mission days 5–11, after initial adaptation).</p>
      </div>

      <div class="card">
        <h2>Privacy &amp; access control</h2>
        <p class="small">All data is stored only in this browser's IndexedDB on this device. Camera frames are processed in memory and never stored or sent. No analytics, no cloud.</p>
        <form id="pinForm" class="form-grid"><div class="field"><label>${p.pinHash ? 'New PIN' : 'Set a PIN (4–8 digits)'}</label><input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}"></div><div class="field"><button class="btn" type="submit">${p.pinHash ? 'Change PIN' : 'Enable PIN lock'}</button></div>${p.pinHash ? '<div class="field"><button class="btn ghost" type="button" id="pinOff">Remove PIN</button></div>' : ''}</form>
        <p class="small dim">PIN lock prevents casual access on a shared crew device (SHA-256 hashed). Limitation: data in IndexedDB is not encrypted at rest in this prototype.</p>

        <h2 style="margin-top:16px">Offline status</h2>
        <dl class="kv"><dt>Service worker</dt><dd>${esc(sw)}</dd><dt>App cache</dt><dd>${esc(cacheInfo)}</dd><dt>Storage used</dt><dd>${est ? (est.usage / 1048576).toFixed(1) + ' MB of ' + (est.quota / 1073741824).toFixed(1) + ' GB' : '—'}</dd><dt>Network</dt><dd>${navigator.onLine ? 'online' : 'offline'}</dd></dl>
        <div class="btn-row" style="margin-top:8px">${deferredInstall ? '<button class="btn primary" id="installBtn">⇩ Install ORBITAL app</button>' : '<span class="small muted">To install: use the browser menu → "Install ORBITAL" (Chrome/Edge).</span>'}<button class="btn sm" id="persistBtn">Request persistent storage</button></div>
      </div>
    </div>


    <div class="card" style="margin-top:16px" id="aiCard">
      <div class="card-h"><h2>ORBI live AI</h2><span class="pill" id="aiPill">Checking…</span></div>
      <p class="small muted">With the live AI, ORBI's conversations in the Virtual Body and the Well-being Assistant are generated by a live AI, using ORBI's observations as context. <b>Free:</b> get a Google Gemini key at <b>aistudio.google.com</b> → <i>Get API key</i> (starts with <code>AIza</code>; Google's free tier has daily limits). Paid alternative: an Anthropic Claude key (<code>sk-ant-…</code>, needs <code>python -m pip install anthropic</code>). ORBITAL detects which one you pasted. The key is sent once to the ORBITAL server on <b>this computer</b> and stored in <code>orbi_ai_key.txt</code> next to <code>serve.py</code>; it is never stored in the web page and never served to the browser. While the live AI is on, conversations and ORBI's observation summary are sent to Google (Gemini) or Anthropic (Claude) — needs internet. On Gemini's free tier Google may use the text to improve its products, so avoid personal details you don't want to share. Without it, ORBI uses its built-in offline rules and says so.</p>
      <p class="small" id="aiMsg"></p><p class="small muted" id="aiWeb" hidden><b>Public website mode</b> (no ORBITAL server here): each visitor pastes their <b>own</b> free Gemini key; it is saved only in that visitor’s browser, never in the website code or the repository.</p>
      <form id="aiForm" class="btn-row" style="flex-wrap:nowrap"><input id="aiKey" type="password" placeholder="Gemini key (AIza…) or Anthropic key (sk-ant-…)" autocomplete="off" style="flex:1"><button class="btn sm primary">Save on this computer</button><button type="button" class="btn sm ghost" id="aiRemove">Remove key</button></form>
      <div class="callout" style="margin-top:10px"><b>Free option for the Well-being companion: Chrome's on-device AI</b> <span class="pill" id="devPill">checking…</span>
        <div class="small muted">Recent Google Chrome versions include a small AI model (Gemini Nano) that runs on this computer: no key, no cost, nothing leaves the computer. It needs a desktop computer with enough memory and free disk space, and is downloaded once. The Virtual Body and Emergency Center keep using the live AI (Gemini/Claude) or their safety rules — a small on-device model is not used for medical decisions.</div>
        <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="devBtn">Enable on-device AI</button><span class="small" id="devMsg"></span></div></div>
      <label class="small" style="display:block;margin-top:8px"><input type="checkbox" id="shareSec"> Share a short health summary between the Virtual Body and the Well-being Assistant (each keeps its own conversation)</label>
    </div>

    <div class="card" style="margin-top:16px" id="libCard">
      <div class="card-h"><h2>Pre-mission personal library</h2><span class="pill lv-info">Loaded before launch · offline</span></div>
      <div class="callout" style="margin-bottom:10px"><label style="margin:0"><input type="checkbox" id="sttLocal"> <b>Use on-device (offline) voice recognition</b></label><div class="small muted">Requires a recent Google Chrome (139 or newer) with the on-device English speech model; Chrome may download it once. If it isn't available, ORBITAL falls back to Chrome's standard recognition, which needs a network connection. Voice output always works offline.</div></div>
      <div class="section-title" style="margin-top:4px">Music library — the crew's five songs</div>
      <p class="small muted">These are the only songs ORBI plays. Load each MP3 once with “⇪ Load MP3” (it is stored in this browser and plays offline), or copy the files with exactly these names into ORBITAL's <code>music</code> folder. If a file is missing, ORBI says so — it never plays anything else.</p>
      <table class="table small" id="songList"><tr><td>Loading…</td></tr></table>
      <div class="section-title">Earth news uplink</div>
      <p class="small muted">The pre-mission archive holds real, dated stories with sources. New stories prepared on Earth are uplinked as a JSON file — <code>[{"headline","summary","date":"YYYY-MM-DD","source","cat"}]</code> — and become available on board after the light-time delay.</p>
      <label class="btn sm">⇪ Uplink news file (JSON)<input type="file" id="newsFile" accept=".json,application/json" hidden></label>
      <div>
        <div><div class="section-title" style="margin-top:4px">Happy memories (recorded by family &amp; friends)</div><div id="memList" class="small"></div>
          <form id="memForm" class="form-grid" style="margin-top:8px"><div class="field"><label>From</label><input name="from" placeholder="e.g. Your daughter" required></div><div class="field" style="grid-column:1/-1"><label>Memory (ORBI will speak it)</label><textarea name="text" rows="3" required></textarea></div><div class="field" style="grid-column:1/-1"><label>Photo, video or voice message (optional)</label><input type="file" name="media" accept="image/*,video/*,audio/*"></div><div class="field"><button class="btn sm primary">Add memory</button></div></form></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px" id="evHistory"></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card">
        <h2>Data management</h2>
        <table class="table"><tr><th>Source</th><th>Records</th><th>Meaning</th></tr>${Object.keys(SOURCES).map(s => `<tr><td>${srcBadge(s)}</td><td>${counts[s] || 0}</td><td class="small muted">${esc(SOURCES[s].desc)}</td></tr>`).join('')}</table>
        <p class="small">Assessments: ${state.assessments.length} · Alerts logged: ${state.alerts.length} · Emergency events: ${state.emergencies.length} · Queued reports: ${state.outbox.filter(o => o.status !== 'sent').length}</p>
        <div class="btn-row">
          <button class="btn" id="expJson">⇩ Full backup (JSON)</button><button class="btn" id="expCsv">⇩ Records (CSV)</button><button class="btn" id="expReal">⇩ Non-simulated records (CSV)</button>
          <label class="btn">⇪ Restore backup<input type="file" id="impJson" accept=".json" hidden></label>
          <button class="btn" id="queueSync">Prepare sync package</button>
        </div>
        <div class="section-title">Demonstration data</div>
        <div class="btn-row"><button class="btn" id="clearSim">Remove simulated data</button><button class="btn" id="reseed">Reload demo data</button><button class="btn danger" id="wipe">Erase everything</button></div>
      </div>
      <div class="card">
        <h2>Configured reference values</h2>
        <p class="small muted">Prototype defaults from public literature — <b>not</b> official NASA flight rules or clinical thresholds. A mission medical team must configure these before operational use.</p>
        <div class="table-wrap"><table class="table"><tr><th>Indicator</th><th>Reference</th><th>Note</th></tr>
        ${Object.entries(METRICS).filter(([, m]) => m.ref || m.warn != null || m.refNote).map(([k, m]) => `<tr><td>${m.label}</td><td class="mono small">${m.ref ? m.ref.join('–') : m.warn != null ? `>${m.warn} / >${m.crit}` : 'personal baseline'} ${m.unit}</td><td class="small muted">${esc(m.refNote || '')}</td></tr>`).join('')}
        <tr><td>Career radiation limit</td><td class="mono small">${RAD_CAREER_LIMIT_MSV} mSv</td><td class="small muted">NASA-STD-3001 (2022)</td></tr></table></div>
      </div>
    </div>`;

    $('#profForm').onsubmit = async e => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
      const stages = fd.stages.split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a[0] !== '' && !isNaN(+a[0])).map(([d, n, g]) => ({ startDay: +d, name: n || 'Stage', gravity: g || '' }));
      await saveProfile({ ...p, ...fd, crewOnBoard: !!fd.crewOnBoard, age: +fd.age, plannedDays: +fd.plannedDays, baselineFrom: +fd.baselineFrom, baselineDays: +fd.baselineDays, stages: stages.length ? stages : p.stages });
      emit('records'); toast('Profile saved.');
    };
    $('#pinForm').onsubmit = async e => { e.preventDefault(); const pin = new FormData(e.target).get('pin'); if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4–8 digits.', true); await saveProfile({ ...p, pinHash: await hashPin(pin) }); toast('PIN lock enabled.'); draw(); };
    $('#pinOff') && ($('#pinOff').onclick = async () => { await saveProfile({ ...p, pinHash: null }); toast('PIN removed.'); draw(); });
    $('#installBtn') && ($('#installBtn').onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; draw(); });
    $('#persistBtn').onclick = async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Persistent storage granted.' : 'Browser did not grant persistent storage.', !ok); };
    const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    $('#expJson').onclick = async () => { download(`orbital-backup-${stamp()}.json`, JSON.stringify({ app: 'ORBITAL', version: 1, exported: new Date().toISOString(), profile: { ...state.profile, pinHash: undefined }, records: state.records, assessments: state.assessments, alerts: state.alerts, emergencies: state.emergencies, outbox: state.outbox.map(o => ({ ...o, html: undefined })), game: state.game }, null, 1)); await flag('exported'); };
    $('#expCsv').onclick = async () => { download(`orbital-records-${stamp()}.csv`, exportRecordsCSV(), 'text/csv'); await flag('exported'); };
    $('#expReal').onclick = async () => { download(`orbital-real-records-${stamp()}.csv`, exportRecordsCSV(r => r.source !== 'simulated'), 'text/csv'); await flag('exported'); };
    $('#queueSync').onclick = async () => {
      const real = state.records.filter(r => r.source !== 'simulated');
      const pkg = { app: 'ORBITAL', kind: 'sync-package', created: new Date().toISOString(), crew: state.profile?.callsign, records: real, assessments: state.assessments, emergencies: state.emergencies, alerts: state.alerts };
      const name = `orbital-sync-${stamp()}.json`; download(name, JSON.stringify(pkg));
      await saveItem('outbox', { ts: Date.now(), name, kind: 'sync-package', status: 'queued' });
      toast(`Sync package with ${real.length} non-simulated records queued. Transmit via the mission data link.`);
    };
    $('#impJson').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const j = JSON.parse(await f.text()); if (j.app !== 'ORBITAL') throw new Error('Not an ORBITAL backup');
        if (!confirm('Restore will merge the backup into current data. Continue?')) return;
        await DB.putMany('records', j.records || []); await DB.putMany('assessments', j.assessments || []); await DB.putMany('alerts', j.alerts || []); await DB.putMany('emergencies', j.emergencies || []);
        if (j.profile) await DB.kvSet('profile', { ...j.profile, pinHash: state.profile?.pinHash || null });
        await loadAll(); emit('records'); toast('Backup restored.'); draw();
      } catch (err) { toast('Restore failed: ' + esc(err.message), true); }
    };
    $('#clearSim').onclick = async () => { if (!confirm('Remove all simulated demo records? Your own entries are kept.')) return; await clearSimulated(); emit('records'); toast('Simulated data removed.'); draw(); };
    $('#reseed').onclick = async () => { await clearSimulated(); await seedDemo(); emit('records'); toast('Demo data reloaded.'); draw(); };
    $('#wipe').onclick = async () => { if (!confirm('Erase ALL ORBITAL data on this device? This cannot be undone.')) return; await DB.wipeAll(); await DB.kvSet('profile', { ...DEFAULT_PROFILE, missionStart: new Date().toISOString().slice(0, 10) }); location.reload(); };

    wireLibrary(); wireAI();
    offHist?.(); offHist = mountEventHistory($('#evHistory'));
    $('#sttLocal').checked = localRecognition(); $('#sttLocal').onchange = e => { setLocalRecognition(e.target.checked); toast(e.target.checked ? 'On-device recognition will be tried.' : 'Using standard recognition.'); };
  };
  async function wireAI() {
    const show = () => {
      const p = $('#aiPill'); if (!p) return;
      p.textContent = ai.status === 'live' ? 'Live AI ready' : 'Offline rules (not a live AI)'; p.className = 'pill ' + (ai.status === 'live' ? 'lv-ok' : 'lv-caution');
      $('#aiMsg').textContent = ai.status === 'live' ? `Connected: ${ai.provider === 'gemini' ? 'Google Gemini' : 'Claude'} (${ai.model})${ai.mode === 'browser' ? ' — key stored in this browser only; do not save it on a shared computer' : ''}.${ai.lastError ? ' Last problem: ' + ai.lastError : ''}` : ai.message;
    };
    await refreshAI(true); show(); $('#aiWeb').hidden = ai.server !== false;
    $('#aiForm').onsubmit = async e => { e.preventDefault(); const key = $('#aiKey').value.trim(); if (!key) return;
      if (ai.server) { try { const r = await fetch('api/ai/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'rejected'); $('#aiKey').value = ''; toast('Key saved on this computer.'); } catch (err) { toast('Could not save the key: ' + esc(err.message), true); } }
      else { if (!/^AIza[A-Za-z0-9_\-]{20,}$/.test(key)) { toast('On the public website only a Google Gemini key (starts with AIza) can be used.', true); return; } setBrowserKey(key); $('#aiKey').value = ''; toast('Gemini key saved in this browser only.'); }
      await refreshAI(true); show(); };
    $('#aiRemove').onclick = async () => { setBrowserKey(''); if (ai.server) { try { await fetch('api/ai/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: '' }) }); } catch (e) { /* server not running */ } } toast('Saved key removed.'); await refreshAI(true); show(); };
    const showDev = () => { const P = $('#devPill'); if (!P) return; const L = { available: ['lv-ok', 'Ready'], downloadable: ['lv-info', 'Available — needs a one-time download'], downloading: ['lv-info', 'Downloading…'], unavailable: ['lv-caution', 'Not available in this browser'], unknown: ['', 'checking…'] }[device.status] || ['', device.status]; P.className = 'pill ' + L[0]; P.textContent = L[1]; $('#devMsg').textContent = device.status === 'downloading' && device.progress != null ? `${Math.round(device.progress * 100)}%` : device.status === 'unavailable' ? (device.error || '') : ''; $('#devBtn').disabled = !['downloadable', 'available'].includes(device.status); $('#devBtn').textContent = device.status === 'available' ? 'On-device AI ready ✓' : 'Enable on-device AI'; };
    checkDevice().then(showDev); onAI(showDev);
    $('#devBtn').onclick = async () => { if (device.status === 'available') return; await enableDevice(); showDev(); toast(device.status === 'available' ? 'Chrome on-device AI ready — the Well-being companion now uses it.' : 'On-device AI could not be enabled: ' + (device.error || 'not supported'), device.status !== 'available'); };
    $('#shareSec').checked = state.settings?.shareSections !== false;
    $('#shareSec').onchange = async e => { state.settings = { ...(state.settings || {}), shareSections: e.target.checked }; await saveSettings(); };
  }
  async function wireLibrary() {
    const lib = await library(true); const mems = (await DB.kvGet('memories')) || [];
    const dur = d => d ? ` · ${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : '';
    $('#songList').innerHTML = `<tr><th>Mood</th><th>Song</th><th>File</th><th>Audio</th><th></th></tr>${lib.map(t => `<tr><td>${esc(t.mood)}</td><td><b>${esc(t.title)}</b> — ${esc(t.artist)}</td><td class="small mono">${esc(t.file)}</td><td>${t.source ? `<span class="pill lv-ok">${esc(t.sourceLabel)}${dur(t.duration)}</span>` : '<span class="pill lv-caution">not loaded</span>'}</td>
      <td style="white-space:nowrap"><label class="btn sm">⇪ Load MP3<input type="file" accept="audio/mpeg,.mp3,audio/*" data-song="${t.id}" hidden></label> ${t.source === 'loaded' ? `<button class="btn sm ghost" data-rm="${t.id}" title="Remove the loaded copy">✕</button>` : ''} ${t.source ? `<button class="btn sm ghost" data-play="${t.id}">▶</button>` : ''}</td></tr>`).join('')}`;
    $('#memList').innerHTML = [...mems.map(m => ({ ...m, mine: true })), ...DEFAULT_MEMORIES].map(m => `<div class="task"><span class="tx"><b>${esc(m.from)}</b> ${m.mediaType ? `<span class="pill lv-info">${m.mediaType}</span>` : ''} — ${esc(m.text.slice(0, 110))}${m.text.length > 110 ? '…' : ''} ${m.mine ? '' : '<span class="src src-simulated">Example</span>'}</span>${m.mine ? `<button class="btn sm ghost" data-mrm="${m.id}">✕</button>` : ''}</div>`).join('');
    $('#libCard').querySelectorAll('[data-song]').forEach(i => i.onchange = async () => { const f = i.files[0]; if (!f) return; const s = lib.find(x => x.id === i.dataset.song); if (!/\.mp3$/i.test(f.name) && !/audio/.test(f.type)) return toast('Please choose an MP3 audio file.', true); await loadSongFile(s.id, f); toast(`"${s.title}" loaded — it now plays offline.`); wireLibrary(); });
    $('#libCard').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await removeSongFile(b.dataset.rm); wireLibrary(); });
    $('#libCard').querySelectorAll('[data-play]').forEach(b => b.onclick = async () => { if (player.playing?.id === b.dataset.play) return stopMusic(); const r = await playSong({ id: b.dataset.play }); if (!r.ok) toast(r.message, true); });
    $('#libCard').querySelectorAll('[data-mrm]').forEach(b => b.onclick = async () => { await DB.kvSet('memories', mems.filter(m => m.id !== b.dataset.mrm)); wireLibrary(); });
    $('#memForm').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const id = uid(); const file = fd.get('media'); let mediaId = null; if (file && file.size) { mediaId = id; await DB.kvSet('memMedia:' + id, file); } await DB.kvSet('memories', [...mems, { id, from: String(fd.get('from')).trim(), text: String(fd.get('text')).trim(), mediaId, mediaType: mediaId ? file.type.split('/')[0] : null }]); e.target.reset(); toast('Memory added to the library.'); wireLibrary(); };
    $('#newsFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const r = await importNews(f); toast(`${r.queued} stor${r.queued === 1 ? 'y' : 'ies'} uplinked — on board in ${ONE_WAY_DELAY_MIN} min${r.skipped ? `; ${r.skipped} skipped (missing headline/summary/date/source)` : ''}.`); } catch (err) { toast('News file rejected: ' + esc(err.message), true); } e.target.value = ''; };
  }
  await draw();
  if (rest[0] === 'history') setTimeout(() => $('#evHistory')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  return () => offHist?.();
}

