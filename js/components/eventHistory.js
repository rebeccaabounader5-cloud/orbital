// ORBITAL — Health event history (shown in Profile & Data). A read-only log built from the records ORBITAL already
// stores: alerts, emergency events, symptom reports, radiation events and assessments. Nothing is deleted or copied —
// new events appear here automatically as they are recorded.
import { state, on, DAY, startOfDay, byType } from '../store.js';
import { METRICS, SYMPTOMS, srcBadge } from '../metrics.js';
import { $, esc, fmtTime } from '../ui.js';

const KINDS = ['all', 'emergency', 'alert', 'symptom', 'environment', 'assessment'];
function events() {
  return [
    ...state.alerts.map(a => ({ ts: a.ts, kind: 'alert', level: a.level, title: a.title, detail: a.what })),
    ...state.emergencies.map(e => ({ ts: e.ts, kind: 'emergency', level: 'emergency', title: e.title, detail: e.summary || (e.log || []).slice(-1)[0]?.text || '' })),
    ...state.records.filter(r => r.type === 'symptom').map(r => ({ ts: r.ts, kind: 'symptom', level: r.value >= 3 ? 'warning' : 'info', title: 'Symptom: ' + (SYMPTOMS.find(s => s.id === r.meta?.symptom)?.label || r.meta?.symptom || 'reported'), detail: r.meta?.note || '', src: r.source })),
    ...byType('env_rad').filter(r => r.value > METRICS.env_rad.warn).map(r => ({ ts: r.ts, kind: 'environment', level: 'caution', title: `Radiation dose ${r.value.toFixed(1)} mSv/day`, detail: 'Possible solar particle event', src: r.source })),
    ...state.assessments.map(a => ({ ts: a.ts, kind: 'assessment', level: 'info', title: a.name + ' completed', detail: a.summary, src: a.source })),
  ].sort((a, b) => b.ts - a.ts);
}
/** Mount the history card into `el`. Returns a cleanup function. */
export function mountEventHistory(el) {
  let filter = 'all';
  const p = state.profile; const ms0 = p?.missionStart ? startOfDay(new Date(p.missionStart).getTime()) : startOfDay(Date.now());
  const dayOf = ts => Math.floor((startOfDay(ts) - ms0) / DAY) + 1;
  const draw = () => {
    const all = events(); const shown = all.filter(e => filter === 'all' || e.kind === filter);
    const count = k => all.filter(e => e.kind === k).length;
    el.innerHTML = `<div class="card-h"><h2>Health event history</h2>
        <select id="evFilter" style="width:auto">${KINDS.map(k => `<option value="${k}" ${k === filter ? 'selected' : ''}>${k === 'all' ? `all (${all.length})` : `${k} (${count(k)})`}</option>`).join('')}</select></div>
      <p class="small muted">Every alert, emergency, symptom report, radiation event and assessment recorded by ORBITAL, newest first. Severity and source labels are kept as recorded.</p>
      <div class="table-wrap" style="max-height:420px"><table class="table"><tr><th>When</th><th>Mission day</th><th>Type</th><th>Event</th><th>Details</th></tr>
      ${shown.slice(0, 300).map(e => `<tr><td>${fmtTime(e.ts)}</td><td>${dayOf(e.ts)}</td><td><span class="pill lv-${e.level === 'emergency' ? 'emergency' : e.level}">${e.kind}</span></td><td>${esc(e.title)} ${e.src ? srcBadge(e.src) : ''}</td><td class="small muted">${esc(e.detail || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No events recorded.</td></tr>'}</table></div>`;
    $('#evFilter', el).onchange = e => { filter = e.target.value; draw(); };
  };
  draw();
  return on(w => { if (['records', 'alerts', 'emergencies', 'assessments'].includes(w)) draw(); });
}
