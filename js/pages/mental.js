// ORBITAL — Mental Health: no questionnaires. ORBI (floating RGB + thermal camera) observes sleep, expression, behaviour
// and social contact 24/7 (simulated observations in this prototype); the Well-being Assistant speaks only when asked or
// when significant, persistent warning signs are seen. ORBI never diagnoses.
import { state, on, daily } from '../store.js';
import { current } from '../analysis.js';
import { srcBadge } from '../metrics.js';
import { $, esc, alertHTML, makeChart, destroyCharts, fmtTime } from '../ui.js';
import { assess, SCENARIOS, simulate, companionMem, opsMode, setOps, onOps } from '../companion/wellbeing.js';
import { renderChat, onTranscript, hear, toggleVoice, open as openCompanion } from '../companion/overlay.js';
import { isListening, onVoice, voiceState, speak } from '../voice.js';
import { newsToday, newsSpeech, pubDate, syncNews, newsStatusText, catLabel } from '../companion/daily.js';
import { onPlayer, player, stop as stopMusic, pause as pauseMusic, resume as resumeMusic, library } from '../companion/music.js';
import { onAI, ai, aiLabel, aiKind, refreshAI, checkDevice } from '../ai/brain.js';
import { mountRelax, relaxFor, REL } from '../companion/relax.js';
import { markToday } from '../game.js';

const REASON = { low_mood: 'Persistent low-mood signs → gentle check-in + song', withdrawal: 'Withdrawal with crew present → offered company / a memory', exercise: 'Exercise skipped → asked why', stress: 'Tension detected → relaxation suggested', sleep: 'Insomnia / sleep discomfort noted', fatigue: 'Fatigue pattern → rest suggested', safety: 'Critical reading → immediate safety check', 'crisis-disclosure': 'Crisis words → urged CMO / flight-surgeon contact' };
const lvl = b => b ? 'warning' : 'ok';
const tm = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function hypnogram(periods) {
  if (!periods?.length) return '<p class="small dim">Detailed sleep/wake timeline available for nights observed by ORBI\'s thermal eye.</p>';
  const W = periods.at(-1).e; const col = { asleep: '#6d28d9', restless: '#f5b942', awake: '#ef4444' };
  const hh = h => { const x = (22.5 + h) % 24; return `${String(Math.floor(x)).padStart(2, '0')}:${String(Math.round((x % 1) * 60)).padStart(2, '0')}`; };
  return `<div class="hypno">${periods.map(p => `<i style="left:${p.s / W * 100}%;width:${(p.e - p.s) / W * 100}%;background:${col[p.st]}" title="${p.st} ${hh(p.s)}–${hh(p.e)}"></i>`).join('')}</div>
    <div class="hypno-ax"><span>${hh(0)}</span><span>${hh(W / 2)}</span><span>${hh(W)}</span></div>
    <div class="small muted"><span class="dot" style="background:#6d28d9"></span>Asleep <span class="dot" style="background:#f5b942"></span>Restless <span class="dot" style="background:#ef4444"></span>Awake</div>`;
}

export async function render(view) {
  let relaxCtl = null, relaxMode = null;
  const draw = async () => {
    destroyCharts(); relaxCtl?.stop(); relaxCtl = null;
    const a = assess(); const { alerts } = current();
    const rel = alerts.filter(x => (x.hazards || []).includes('isolation')).slice(0, 3);
    const mem = await companionMem(); const news = await newsToday(); const S = a.sleep;
    const showRelax = a.stress.detected || relaxMode;
    const mode = relaxMode || relaxFor(a.stress);
    view.innerHTML = `
    <p class="page-intro">No questionnaires. <b>ORBI</b>, the floating companion camera, observes sleep (thermal eye in darkness), facial expression, behaviour and conversation <b>24/7</b> and compares them with your own baseline. The Well-being Assistant stays quiet unless <b>you ask</b> or ORBI sees <b>significant, persistent warning signs</b>. ${srcBadge('simulated')} <span class="small dim">Overnight and behavioural observations in this demo come from the scenarios at the bottom. ORBI notices patterns — it never diagnoses.</span></p>

    <div class="grid g4">
      <div class="card"><div class="stat-l">Sleep last night</div><div class="stat-v">${S ? S.h.toFixed(1) + '<small> h</small>' : '—'}</div><div class="small muted">${S ? (S.change ? esc(S.change) : `7-night avg ${S.avg7?.toFixed(1) ?? '—'} h · Earth ${S.earth} h`) : 'No overnight observation yet'}</div></div>
      <div class="card"><div class="stat-l">Insomnia / discomfort</div><div class="stat-v sm"><span class="dot ${S ? lvl(S.insomnia || S.discomfort) : 'na'}"></span>${!S ? '—' : S.insomnia && S.discomfort ? 'Both' : S.insomnia ? 'Insomnia signs' : S.discomfort ? 'Discomfort' : 'None seen'}</div><div class="small muted">${S ? `Fell asleep after ${Math.round(S.latency ?? 0)} min · ${S.wakes ?? 0} awakenings` : ''}</div></div>
      <div class="card"><div class="stat-l">Stress & muscle tension</div><div class="stat-v sm"><span class="dot ${a.stress.tension == null ? 'na' : lvl(a.stress.detected)}"></span>${a.stress.tension == null ? '—' : a.stress.detected ? 'Tension detected' : 'Relaxed'}</div><div class="small muted">${a.stress.tension != null ? `Tension ${Math.round(a.stress.tension)}/100` : 'No observation today'}</div></div>
      <div class="card"><div class="stat-l">Behaviour & contact</div><div class="stat-v sm"><span class="dot ${a.mood.severity === 'severe' ? 'warning' : a.mood.severity === 'watch' ? 'caution' : a.mood.affectLow == null && a.mood.silence == null ? 'na' : 'ok'}"></span>${a.mood.severity === 'severe' ? 'Significant warning signs' : a.mood.severity === 'watch' ? 'Quieter than usual' : a.mood.normalSilence ? 'Quiet — focused work' : a.mood.affectLow == null && a.mood.silence == null ? '—' : 'Steady'}</div><div class="small muted">${a.mood.silence != null ? `Silent ${a.mood.silence.toFixed(1)} h (${esc(a.mood.context)}) · crew talk ${Math.round(a.mood.social ?? 0)} min (usual ≈${Math.round(a.mood.usualSocial)})` : 'No observation today'}</div></div>
    </div>

    <div class="grid g3" style="margin-top:16px">
      <div class="card span2">
        <div class="card-h"><h2>Well-being Assistant — ORBI</h2><div class="btn-row"><button class="chip ${opsMode() ? 'on' : ''}" id="mOps" title="While a mission-critical operation is in progress, ORBI holds non-urgent support">⏸ Mission ops ${opsMode() ? 'ON' : 'off'}</button><span class="pill" id="mAI"></span></div></div>
        <div class="comp-head"><span class="orb lg"></span><div><b id="mState">Quietly watching over you</b><div class="small muted">On this page just talk — no wake word needed, and the microphone stays on between replies. Anything goes: your day, home, a book, a joke. Music: “play something happy”, “play something more relaxing”, “play my favourite song”, “skip this song”, “turn the volume down”, “stop the music”.</div></div></div>
        <div class="small dim" id="mAINote"></div>
        <div class="chat" id="mChat" style="height:280px"></div>
        <form id="mForm" class="btn-row" style="margin-top:8px;flex-wrap:nowrap"><button type="button" class="btn" id="mMic">🎙 Voice</button><input id="mIn" placeholder="…or type to ORBI" autocomplete="off"><button class="btn primary">Send</button></form>
        <p class="small dim">A companion, not a therapist. If you ever mention thoughts of self-harm, ORBI urges you to contact the crew medical officer and flight surgeon.</p>
      </div>
      <div class="card">
        <div class="card-h"><h2>Last night — ORBI sleep watch</h2>${srcBadge('simulated')}</div>
        ${S ? `<p class="small"><b>Monitored by:</b> ${esc(S.monitor)}</p>${hypnogram(S.periods)}
          <p class="small" style="margin-top:8px">${esc(S.notes || '')}</p>
          <table class="table"><tr><th></th><th>Last night</th><th>7 nights</th><th>Earth</th></tr><tr><td>Sleep</td><td><b>${S.h.toFixed(1)} h</b></td><td>${S.avg7?.toFixed(1) ?? '—'} h</td><td>${S.earth} h</td></tr><tr><td>Fall asleep</td><td><b>${Math.round(S.latency ?? 0)} min</b></td><td>${S.lat7 != null ? Math.round(S.lat7) + ' min' : '—'}</td><td>12 min</td></tr><tr><td>Awakenings</td><td><b>${S.wakes ?? 0}</b></td><td colspan="2" class="muted">restlessness ${Math.round(S.restless ?? 0)}/100</td></tr></table>
          ${S.insomnia ? `<div class="callout warn" style="margin-top:8px"><b>Possible insomnia signs.</b> ${S.repeated ? 'Seen on 3 or more of the last 4 nights — worth mentioning to the crew medical officer.' : 'Tonight: dim lights an hour before sleep, keep the sleep station cool and dark. Ask ORBI for slow breathing at bedtime.'}</div>` : ''}
          ${S.discomfort ? '<div class="callout warn" style="margin-top:8px"><b>Possible sleep discomfort.</b> Frequent repositioning. Check the sleeping-bag fit and temperature; if your back hurts, ask ORBI in the Virtual Body.</div>' : ''}`
        : '<p class="muted">No overnight observation yet. Try the night scenarios below.</p>'}
        <div class="chart-box" style="height:130px;margin-top:8px"><canvas id="sChart"></canvas></div>
      </div>
    </div>

    ${showRelax ? `<div class="card relax-card" style="margin-top:16px">
      <div class="card-h"><h2>${esc(REL[mode].name)} — ${relaxMode ? 'requested by you' : 'suggested by ORBI'}</h2>${a.stress.detected && !relaxMode ? '<span class="pill lv-warning">Tension detected</span>' : ''}<button class="btn sm ghost" id="relaxClose">✕</button></div>
      ${a.stress.detected && !relaxMode ? `<p class="small">${esc(a.stress.notes || 'ORBI noticed signs of stress.')} ${a.stress.thermal ? '<br>Thermal eye: ' + esc(a.stress.thermal) : ''}</p>` : ''}
      <div class="btn-row">${Object.entries(REL).map(([k, r]) => `<button class="chip ${k === mode ? 'on' : ''}" data-rm="${k}">${esc(r.name)}</button>`).join('')}</div>
      <div id="relaxBox"></div></div>` : `<div class="btn-row" style="margin-top:12px"><span class="small muted">No tension detected right now — relaxation exercises appear when ORBI sees stress, or on request:</span><button class="btn sm" id="relaxAsk">I'd like to relax</button></div>`}

    <div class="grid g3" style="margin-top:16px">
      <div class="card">
        <div class="card-h"><h2>Daily news from Earth</h2><div class="btn-row"><button class="btn sm" id="newsSync" title="Check the news services now (needs internet)">↻</button><button class="btn sm primary" id="newsBtn">🔊 Read aloud</button></div></div>
        <p class="small ${news.sync && !news.sync.ok ? 'warn-text' : 'muted'}" id="newsStatus">${esc(newsStatusText(news))}</p>
        ${news.items.length ? `<ul class="news">${news.items.map(i => `<li><span class="pill lv-info">${esc(i.kind === 'uplink' ? 'Uplink' : catLabel(i.cat))}</span> <b>${esc(i.headline)}</b><div class="small">${esc(i.summary)}</div><div class="small dim">Published ${esc(pubDate(i.date))} · ${esc(i.source)} · received by ORBITAL ${tm(i.receivedTs)}${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</div></li>`).join('')}</ul>` : `<p class="muted small">${news.sync && !news.sync.ok ? 'No new verified articles are stored on board, so there is no news today. ORBITAL does not repeat old stories as new ones.' : 'No new articles have been received yet today.'}</p>`}
        ${news.transit.length ? `<p class="small">📡 ${news.transit.length} uplinked stor${news.transit.length > 1 ? 'ies' : 'y'} in transit — arriving ${tm(news.transit[0].arrivesTs)} (${news.delayMin}-min light delay).</p>` : ''}
        <div class="small"><b>From home</b> <span class="src src-simulated">Example</span> ${esc(news.family)}</div>
        <p class="small dim">Real articles from public news services (NASA, ESA, Space.com, ScienceDaily, BBC, Positive News, Good News Network), stored on board so they stay readable offline. Each day shows articles never shown before; ${news.unseen} unread article${news.unseen === 1 ? '' : 's'} waiting.</p>
      </div>
      <div class="card">
        <h2>Music & happy memories</h2>
        <div id="nowBox"></div>
        <p class="small muted">Real recordings only — ORBI never generates or imitates music. It only <i>offers</i> music on its own after significant, persistent warning signs; otherwise just ask.</p>
        <div class="section-title" style="margin-top:6px">The crew's five songs</div>
        <table class="table small" id="selSongs"></table>
        <div class="btn-row" style="margin-top:6px"><button class="btn sm" id="memBtn">☺ Share a memory</button></div>
        <p class="small dim" style="margin-top:6px">Real MP3 recordings, played offline. Just ask: “I need motivation”, “play something that makes me happy”, “I'm stressed”, “I want to relax”, “I'm lonely — can you play something?”, “skip”, “pause”, “stop the music”.</p>
      </div>
      <div class="card">
        <h2>When ORBI stepped in</h2>
        ${mem.log.length ? `<ul class="obs-list">${mem.log.slice(-6).reverse().map(l => `<li><span class="small">${esc(REASON[l.reason] || l.reason)}${l.deferred ? ' <span class="pill lv-info">held during ops</span>' : ''}</span><span class="small muted">${fmtTime(l.ts)}</span></li>`).join('')}</ul>` : '<p class="muted small">Never — no significant warning signs so far.</p>'}
        ${rel.length ? `<div class="section-title">Persistent patterns</div>${rel.map(x => alertHTML(x, { compact: true })).join('')}` : ''}
      </div>
    </div>

    <div class="card" style="margin-top:16px"><h2>30 days — what ORBI observed</h2><div class="chart-box tall"><canvas id="mChart30"></canvas></div><p class="small dim">Older days include simulated demo history.</p></div>

    <div class="card demo-card" style="margin-top:16px">
      <div class="card-h"><h2>Demo: simulate what ORBI observes</h2>${srcBadge('simulated')}</div>
      <p class="small muted">Each button adds one example observation; ORBI then reacts exactly as it would in flight. Try “Long silence while concentrating” — ORBI recognises it as normal and stays quiet.</p>
      <div class="btn-row"><span class="small muted" style="width:60px">Night</span>${Object.entries(SCENARIOS).filter(([, s]) => s.group === 'sleep').map(([k, s]) => `<button class="btn sm" data-sim="${k}">${s.label}</button>`).join('')}</div>
      <div class="btn-row" style="margin-top:6px"><span class="small muted" style="width:60px">Day</span>${Object.entries(SCENARIOS).filter(([, s]) => s.group === 'day').map(([k, s]) => `<button class="btn sm ${['low_mood', 'withdrawal'].includes(k) ? 'danger' : ''}" data-sim="${k}">${s.label}</button>`).join('')}</div>
    </div>`;

    const sh = daily('sleep_h', 7), lat = daily('sleep_latency', 7);
    makeChart($('#sChart'), { type: 'bar', data: { labels: sh.map(x => x.day.slice(5)), datasets: [{ label: 'Sleep (h)', data: sh.map(x => x.value), backgroundColor: 'rgba(167,139,250,.6)', yAxisID: 'y' }, { type: 'line', label: 'Fall asleep (min)', data: lat.map(x => x.value), borderColor: '#f5b942', yAxisID: 'y1', spanGaps: true, pointRadius: 2 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10 }, y1: { position: 'right', min: 0, grid: { display: false } } } } });
    const d30 = t => daily(t, 30);
    makeChart($('#mChart30'), { type: 'line', data: { labels: d30('sleep_h').map(x => x.day.slice(5)), datasets: [
      { label: 'Low-mood signs (/100 ÷10)', data: d30('affect_low').map(x => x.value == null ? null : x.value / 10), borderColor: '#f97316', tension: .3, spanGaps: true, pointRadius: 2 },
      { label: 'Tension (/100 ÷10)', data: d30('tension').map(x => x.value == null ? null : x.value / 10), borderColor: '#f5b942', tension: .3, spanGaps: true, pointRadius: 2 },
      { label: 'Sleep (h)', data: d30('sleep_h').map(x => x.value), borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.12)', fill: true, tension: .3, spanGaps: true, pointRadius: 2 },
      { label: 'Crew conversation (h)', data: d30('social_min').map(x => x.value == null ? null : x.value / 60), borderColor: '#34d399', tension: .3, spanGaps: true, pointRadius: 2 },
    ] }, options: { interaction: { mode: 'index', intersect: false }, scales: { y: { min: 0, max: 10 } } } });

    renderChat($('#mChat'));
    $('#mForm').onsubmit = e => { e.preventDefault(); const v = $('#mIn').value.trim(); if (!v) return; $('#mIn').value = ''; hear(v); };
    $('#mMic').onclick = async () => { await toggleVoice(); syncState(); };
    $('#mOps').onclick = () => setOps(!opsMode());
    syncState();
    if ($('#relaxBox')) relaxCtl = mountRelax($('#relaxBox'), { mode });
    view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { relaxMode = b.dataset.rm; draw(); });
    $('#relaxAsk') && ($('#relaxAsk').onclick = () => { relaxMode = 'box'; draw(); });
    $('#relaxClose') && ($('#relaxClose').onclick = () => { relaxMode = null; relaxCtl?.stop(); if (!a.stress.detected) draw(); else $('.relax-card').remove(); });
    $('#newsBtn').onclick = () => { markToday('news'); speak(newsSpeech(news)); };
    $('#newsSync').onclick = async e => { e.target.disabled = true; $('#newsStatus').textContent = 'Checking the news services…'; await syncNews(true); draw(); };
    const drawSel = async () => { const el = $('#selSongs'); if (!el) return; const l = await library(); el.innerHTML = l.map(x => `<tr><td>${esc(x.mood)}</td><td><b>${esc(x.title)}</b> — ${esc(x.artist)}</td><td>${x.source ? '<span class="pill lv-ok">ready</span>' : '<span class="pill lv-caution" title="Load it in Profile &amp; Data">file not loaded</span>'}</td><td><button class="btn sm" data-sel="${x.id}" ${x.source ? '' : 'disabled'}>▶</button></td></tr>`).join(''); el.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => hear('play ' + l.find(x => x.id === b.dataset.sel).title)); };
    drawSel();
    $('#memBtn').onclick = () => hear('tell me a happy memory');
    drawNow();
    view.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => simulate(b.dataset.sim));
  };
  function syncState() {
    const st = $('#mState'); if (!st) return;
    st.textContent = voiceState.state === 'speaking' ? 'Speaking…' : voiceState.state === 'processing' ? 'Thinking…' : voiceState.state === 'listening' ? (voiceState.interim ? '…' + voiceState.interim.slice(-60) : `Listening — ${voiceState.owner}`) : isListening() ? 'Starting microphone…' : 'Voice off — tap 🎙 to talk';
    if (voiceState.error) st.textContent = '⚠ ' + voiceState.error;
    $('#mMic')?.classList.toggle('primary', isListening());
    const b = $('#mAI'); if (b) { b.textContent = aiLabel('mind'); b.className = 'pill ' + (aiKind('mind') !== 'offline' ? 'lv-ok' : 'lv-caution'); }
    const n = $('#mAINote'); const k = aiKind('mind');
    if (n) n.textContent = k === 'live' ? (ai.lastError ? '⚠ ' + ai.lastError + ' — this reply came from the offline rules.' : '') : k === 'device' ? 'The companion runs on Chrome\'s built-in AI on this computer — free, no key, nothing leaves the computer.' : ai.status === 'offline' ? 'Using ORBI\'s offline conversation rules (not a live AI). For a real AI companion for free, enable Chrome\'s on-device AI in Profile & Data.' : '';
  }
  function drawNow() {
    const el = $('#nowBox'); if (!el) return;
    const p = player.playing;
    el.innerHTML = p ? `<div class="now"><span class="eq ${player.paused ? 'paused' : ''}"><i></i><i></i><i></i></span><span><b>${esc(p.title)}</b> — ${esc(p.artist)}${p.album ? ' · ' + esc(p.album) : ''}<br><span class="small dim">${esc(p.mood)}</span></span><button class="btn sm" id="mPP">${player.paused ? '▶' : '❚❚'}</button><button class="btn sm" id="mStop">■</button></div>` : '';
    $('#mStop') && ($('#mStop').onclick = () => stopMusic());
    $('#mPP') && ($('#mPP').onclick = () => player.paused ? resumeMusic() : pauseMusic());
  }
  await draw();
  syncNews().then(st => { if (st && (st.added || !st.ok) && document.querySelector('#newsStatus')) draw(); });
  refreshAI(); checkDevice();
  const offs = [onAI(syncState), on(w => { if (w === 'records') draw(); }), onTranscript(() => renderChat($('#mChat'))), onVoice(syncState), onPlayer(drawNow), onOps(() => draw())];
  return () => { offs.forEach(f => f()); relaxCtl?.stop(); };
}
