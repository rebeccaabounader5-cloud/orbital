import { state, on, missionDay, stageFor, DAY } from '../store.js';
import { current } from '../analysis.js';
import { METRICS, HAZARDS, srcBadge, srcLegend, SYMPTOMS } from '../metrics.js';
import { $, $$, esc, alertHTML, statHTML, metricChart, fmtTime, destroyCharts } from '../ui.js';
import { MISSIONS, BADGES, markReviewed, exStreak } from '../game.js';

export async function render(view) {
  const draw = () => {
    destroyCharts();
    const { alerts, cmp, status } = current();
    const md = missionDay(); const st = md ? stageFor(md) : null; const p = state.profile;
    const idx = status.index; const col = idx >= 80 ? 'var(--ok)' : idx >= 60 ? 'var(--caution)' : 'var(--warn)';
    const today = new Date().toISOString().slice(0, 10);
    const done = state.game.log?.[today]?.done || [];
    const recentObs = state.records.filter(r => r.source !== 'simulated' || true).slice(-400).reverse()
      .filter(r => !r.type.startsWith('env_')).slice(0, 9);
    const top = alerts.filter(a => a.level !== 'info');

    view.innerHTML = `
    <p class="page-intro">Welcome back, <b>${esc(p?.name)}</b> (${esc(p?.callsign)}). Mission day <b>${md ?? '—'}</b>${st ? ` — ${esc(st.name)} (${esc(st.gravity)})` : ''}. All analysis runs locally on this device.</p>
    <div class="grid g3">
      <div class="card glow span2">
        <div class="hero">
          <div class="ring" style="--p:${idx};--c:${col}"><div><div class="rv">${idx}</div><div class="rl">Wellness index</div></div></div>
          <div>
            <h2>Health overview</h2>
            <p class="small muted">The wellness index summarises how many and how serious the current ORBITAL alerts are (100 = no alerts). It is a navigation aid, <b>not a clinical score</b>.</p>
            <div class="hz-tiles">${Object.entries(HAZARDS).map(([k, h]) => `<a class="hz-tile" href="#/hazards/${k}"><div class="t">${h.icon} ${h.name}</div><div><span class="dot ${status.hazards[k]}"></span><b style="text-transform:capitalize">${status.hazards[k] === 'ok' ? 'Nominal' : status.hazards[k]}</b></div></a>`).join('')}</div>
          </div>
        </div>
        <div class="section-title">Today's top recommendations</div>
        ${top.length ? `<ul class="obs-list">${top.slice(0, 3).map(a => `<li><span><b>${esc(a.next?.[0] || '')}</b><br><span class="small muted">Because: ${esc(a.title)}</span></span><span class="pill lv-${a.level}">${a.level}</span></li>`).join('')}</ul>` : '<p class="muted">No recommendations right now — keep up your routine.</p>'}
      </div>
      <div class="card">
        <div class="card-h"><h2>Daily health missions</h2><span class="small muted">${done.length}/${MISSIONS.length}</span></div>
        ${MISSIONS.map(m => { const d = done.includes(m.id); return `<a class="task ${d ? 'done' : ''}" href="${m.href}" style="text-decoration:none;color:inherit"><span class="chk">${d ? '✓' : ''}</span><span class="tx small">${m.label}</span><span class="xp">+${m.xp}</span></a>`; }).join('')}
        <p class="small dim">Exercise streak: ${exStreak()} day(s). Missions reward healthy habits — never results.</p>
      </div>
    </div>

    <div class="section-title">Key indicators — recent 3 days vs your baseline</div>
    <div class="grid g4">
      ${['hr', 'sleep_h', 'reaction_ms', 'mood', 'stress', 'exercise_min', 'coordination', 'perclos'].map(t => `<div class="card">${statHTML(t, null, cmp[t])}</div>`).join('')}
    </div>

    <div class="grid g3" style="margin-top:16px">
      <div class="card span2">
        <div class="card-h"><h2>Important alerts</h2><span class="small muted">${top.length} active · rule-based local analysis</span></div>
        ${top.length ? top.slice(0, 4).map(a => alertHTML(a, { compact: true })).join('') : '<p class="muted">No active alerts. Keep up your routine.</p>'}
        ${top.length > 4 ? `<a class="btn sm" href="#/settings/history">View all ${top.length} alerts in the event history</a>` : ''}
        <div class="btn-row" style="margin-top:8px"><button class="btn sm" id="reviewBtn">✓ I reviewed these recommendations</button></div>
      </div>
      <div class="card">
        <h2>Recent observations</h2>
        <ul class="obs-list">${recentObs.map(r => `<li><span><b>${esc(r.type === 'symptom' ? (SYMPTOMS.find(s => s.id === r.meta?.symptom)?.label || 'Symptom') : r.type === 'lab' ? r.meta?.name : (METRICS[r.type]?.label || r.type))}</b> <span class="muted">${r.type === 'symptom' ? 'severity ' + r.value : typeof r.value === 'number' ? r.value.toFixed(METRICS[r.type]?.dec ?? 1) + ' ' + (METRICS[r.type]?.unit || r.meta?.unit || '') : ''}</span><br><span class="dim small">${fmtTime(r.ts)}</span></span>${srcBadge(r.source)}</li>`).join('')}</ul>
      </div>
    </div>

    <div class="section-title">Recent health trends (14 days)</div>
    <div class="grid g3">
      <div class="card"><h3>Sleep duration</h3><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><h3>Reaction time</h3><div class="chart-box"><canvas id="c2"></canvas></div></div>
      <div class="card"><h3>Mood</h3><div class="chart-box"><canvas id="c3"></canvas></div></div>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Quick access</h2>
        <div class="btn-row">
          <a class="btn primary" href="#/camera">◉ Open AI camera</a><a class="btn" href="#/mental">☾ Talk to ORBITAL</a>
          <a class="btn" href="#/body">✦ Ask the virtual body</a><a class="btn" href="#/physical">♥ Today's exercise</a>
          <a class="btn" href="#/environment">☢ Environment</a><a class="btn danger" href="#/emergency">✚ Emergency</a>
        </div>
        <div class="section-title" style="margin-top:14px">Data-source labels used everywhere</div>${srcLegend()}
      </div>
      <div class="card"><h2>Achievements</h2><div class="badges">${BADGES.map(b => `<div class="badge ${state.game.badges?.includes(b.id) ? '' : 'locked'}"><div class="bi">${b.icon}</div><b>${b.name}</b><div class="dim">${b.desc}</div></div>`).join('')}</div></div>
    </div>`;
    metricChart($('#c1'), 'sleep_h', { days: 14, color: '#a78bfa' });
    metricChart($('#c2'), 'reaction_ms', { days: 14, color: '#22d3ee' });
    metricChart($('#c3'), 'mood', { days: 14, color: '#34d399' });
    $('#reviewBtn').onclick = () => markReviewed();
  };
  draw();
  const off = on(w => { if (['records', 'game', 'profile'].includes(w)) draw(); });
  return () => off();
}
