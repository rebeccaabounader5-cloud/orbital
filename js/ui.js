// ORBITAL — shared UI helpers
import { METRICS, SOURCES, srcBadge, HAZARDS } from './metrics.js';
import { daily, state } from './store.js';
import { baseline, project } from './analysis.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = ts => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });

export function toast(msg, bad = false) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.innerHTML = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
}
export function modal(html) {
  $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden');
  return $('#modalBody');
}
export function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- alerts ----------
export function alertHTML(a, { compact = false } = {}) {
  const ev = (a.evidence || []).map(e => `<div class="evid">• ${esc(e.label)}: <b>${esc(e.value)}</b> ${e.sources.map(srcBadge).join(' ')}</div>`).join('');
  const hz = (a.hazards || []).map(h => HAZARDS[h] ? `<span class="pill lv-info">${HAZARDS[h].icon} ${HAZARDS[h].name}</span>` : '').join(' ');
  return `<div class="alert-item ${a.level}">
    <div class="card-h" style="margin:0"><h4>${esc(a.title)}</h4><span class="pill lv-${a.level}">${a.level}</span></div>
    <div class="small muted">${hz} ${a.correlation ? '<span class="pill lv-info" title="Indicators that change together — association, not proven cause">Pattern / association</span>' : ''} ${a.medical ? '<span class="pill lv-warning">Medical review advised</span>' : ''}</div>
    ${compact ? `<p class="small" style="margin:.4em 0 0">${esc(a.what)}</p><details class="small"><summary>Why &amp; what to do</summary>${detail(a, ev)}</details>` : detail(a, ev)}
  </div>`;
}
function detail(a, ev) {
  return `<div class="why"><b>What changed</b><span>${esc(a.what)}</span><b>Why it may matter</b><span>${esc(a.why)}</span>
  <b>Supporting data</b><span>${ev || '—'}</span><b>Next steps</b><span><ul style="margin:0;padding-left:16px">${(a.next || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul></span>
  <b>Rule</b><span class="dim">${esc(a.rule || '')}${a.correlation ? ' — correlation does not prove causation.' : ''} Not a diagnosis.</span></div>`;
}

// ---------- charts ----------
const SRC_COLORS = { observed: '#22d3ee', estimated: '#c084fc', reported: '#34d399', manual: '#60a5fa', imported: '#fbbf24', simulated: '#94a3b8' };
export function initChartDefaults() {
  if (!window.Chart) return;
  const C = window.Chart;
  C.defaults.color = '#8aa0c4';
  C.defaults.borderColor = 'rgba(35,68,120,.45)';
  C.defaults.font.family = 'Inter, system-ui, sans-serif';
  C.defaults.font.size = 11;
  C.defaults.plugins.legend.labels.boxWidth = 10;
  C.defaults.plugins.legend.labels.boxHeight = 10;
  C.defaults.plugins.tooltip.backgroundColor = '#0b1d3b';
  C.defaults.plugins.tooltip.borderColor = '#22d3ee';
  C.defaults.plugins.tooltip.borderWidth = 1;
  C.defaults.animation.duration = 400;
  C.defaults.maintainAspectRatio = false;
}

const charts = new Set();
export function destroyCharts() { charts.forEach(c => c.destroy()); charts.clear(); }
export function makeChart(canvas, cfg) { if (!window.Chart || !canvas) return null; const c = new window.Chart(canvas, cfg); charts.add(c); return c; }

/** Time-series chart for one metric: daily values (points colored by data source), baseline band, optional projection. */
export function metricChart(canvas, type, { days = 30, showBaseline = true, showProjection = false, color = '#22d3ee', kind = 'line' } = {}) {
  const m = METRICS[type]; const d = daily(type, days);
  const labels = d.map(x => x.day.slice(5));
  const ptColors = d.map(x => SRC_COLORS[[...x.sources][0]] || color);
  const datasets = [{ type: kind, label: `${m.label} (${m.unit})`, data: d.map(x => x.value == null ? null : +x.value.toFixed(2)), borderColor: color, backgroundColor: kind === 'bar' ? ptColors.map(c => c + '99') : color + '22', pointBackgroundColor: ptColors, pointBorderColor: ptColors, pointRadius: 3, tension: .3, spanGaps: true, fill: kind !== 'bar', borderWidth: 2 }];
  const b = showBaseline ? baseline(type) : null;
  if (b) {
    datasets.push({ type: 'line', label: 'Baseline ±2 var.', data: labels.map(() => +(b.value + 2 * b.spread).toFixed(2)), borderColor: 'rgba(52,211,153,.35)', borderDash: [4, 4], pointRadius: 0, fill: '+1', backgroundColor: 'rgba(52,211,153,.06)', borderWidth: 1 });
    datasets.push({ type: 'line', label: '_lo', data: labels.map(() => +(b.value - 2 * b.spread).toFixed(2)), borderColor: 'rgba(52,211,153,.35)', borderDash: [4, 4], pointRadius: 0, fill: false, borderWidth: 1 });
  }
  if (showProjection) {
    const p = project(type);
    if (p) {
      p.points.forEach(pt => labels.push(new Date(pt.ts).toISOString().slice(5, 10)));
      const pad = new Array(d.length - 1).fill(null);
      const lastVal = d[d.length - 1].value;
      datasets.push({ type: 'line', label: 'Projection (estimate)', data: [...pad, lastVal, ...p.points.map(x => +x.value.toFixed(2))], borderColor: '#f5b942', borderDash: [6, 4], pointRadius: 0, borderWidth: 2, fill: false });
      datasets.push({ type: 'line', label: '_phi', data: [...pad, lastVal, ...p.points.map(x => +x.hi.toFixed(2))], borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(245,185,66,.10)' });
      datasets.push({ type: 'line', label: '_plo', data: [...pad, lastVal, ...p.points.map(x => +x.lo.toFixed(2))], borderColor: 'transparent', pointRadius: 0, fill: false });
    }
  }
  return makeChart(canvas, {
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { filter: i => !i.text.startsWith('_') } },
        tooltip: { callbacks: { afterBody: items => { const i = items[0].dataIndex; const x = d[i]; return x && x.n ? 'Source: ' + [...x.sources].map(s => SOURCES[s]?.short).join(', ') + ` (${x.n} rec.)` : ''; } } },
      },
      scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: m.unit } } },
    },
  });
}

export function statHTML(type, label, cmp, { suffix = '' } = {}) {
  const m = METRICS[type];
  if (!cmp) return `<div class="stat"><span class="l">${label || m.label}</span><span class="v">—</span><span class="d dim">No data yet</span></div>`;
  const v = cmp.rec.value; const arrow = cmp.delta > 0 ? '▲' : cmp.delta < 0 ? '▼' : '■';
  const cls = !cmp.notable ? 'neutral' : cmp.worse ? 'up-bad' : 'good';
  return `<div class="stat"><span class="l">${label || m.label}</span><span class="v">${v.toFixed(m.dec)}<small>${m.unit}${suffix}</small></span>
  <span class="d ${cls}">${arrow} ${cmp.pct > 0 ? '+' : ''}${cmp.pct.toFixed(0)}% vs baseline ${cmp.base.value.toFixed(m.dec)}</span><span>${cmp.rec.sources.map(srcBadge).join(' ')}</span></div>`;
}

export function qualityBars(q) { // q 0..1
  const n = Math.round(q * 5); return `<span class="quality" title="Signal quality ${(q * 100).toFixed(0)}%">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}" style="height:${4 + i * 2.4}px"></i>`).join('')}</span>`;
}
