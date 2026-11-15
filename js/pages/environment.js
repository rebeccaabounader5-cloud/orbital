// ORBITAL — Mission Environment (simplified): only the cabin conditions that matter directly for the astronaut's health —
// temperature, pressure, oxygen, carbon dioxide and humidity — with an overall status and environmental alerts.
// Values come from imported spacecraft data, manual entries or clearly labelled simulated telemetry; the webcam is never
// used to measure the environment.
import { on, addRecord, addRecords, byType, latest, daily, DAY } from '../store.js';
import { current, mean } from '../analysis.js';
import { METRICS, srcBadge } from '../metrics.js';
import { $, esc, alertHTML, destroyCharts, toast, fmtTime, makeChart } from '../ui.js';
import { importFile } from '../importer.js';

const CORE = ['env_temp', 'env_pressure', 'env_o2', 'env_co2', 'env_humidity'];
const HEALTH = { env_temp: 'Too warm or cold disturbs sleep and performance.', env_pressure: 'Pressure loss is an immediate safety emergency.', env_o2: 'Low oxygen causes dizziness, confusion and loss of consciousness.', env_co2: 'High CO₂ causes headaches, breathlessness and poor concentration.', env_humidity: 'Very dry air irritates eyes, skin and airways.' };

function level(t, v) {
  const m = METRICS[t];
  if (m.crit != null && v > m.crit) return 'warning';
  if (m.warn != null && v > m.warn) return 'caution';
  if (m.ref && (v < m.ref[0] || v > m.ref[1])) return 'caution';
  return 'ok';
}
const LBL = { ok: 'Nominal', caution: 'Caution', warning: 'Warning', na: 'No data' };

export async function render(view) {
  const draw = () => {
    destroyCharts();
    const { alerts } = current();
    const rel = alerts.filter(a => (a.hazards || []).includes('environment'));
    const rows = CORE.map(t => { const l = latest(t); const day = byType(t, Date.now() - DAY); return { t, m: METRICS[t], l, avg: day.length ? mean(day.map(r => r.value)) : null, lv: l ? level(t, l.value) : 'na' }; });
    const worst = rows.some(r => r.lv === 'warning') ? 'warning' : rows.some(r => r.lv === 'caution') ? 'caution' : rows.every(r => r.lv === 'na') ? 'na' : 'ok';
    view.innerHTML = `
    <div class="card env-status lv-${worst}">
      <div class="card-h" style="margin:0"><h2><span class="dot ${worst}"></span> Cabin environment: ${LBL[worst]}</h2>${[...new Set(rows.filter(r => r.l).map(r => r.l.source))].map(srcBadge).join(' ')}</div>
      <p class="small muted" style="margin:.4em 0 0">${worst === 'ok' ? 'All five health-relevant readings are within their limits.' : worst === 'na' ? 'No cabin data yet — import spacecraft data or add a reading below.' : rows.filter(r => r.lv === 'warning' || r.lv === 'caution').map(r => `${r.m.label}: ${LBL[r.lv].toLowerCase()}`).join(' · ')}</p>
    </div>

    <div class="grid g5 env-grid" style="margin-top:14px">
      ${rows.map(({ t, m, l, avg, lv }) => `<div class="card env-card">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:.06em">${m.label}</div>
        ${l ? `<div class="v"><span class="dot ${lv}"></span>${l.value.toFixed(m.dec)} <small class="muted" style="font-size:.8rem">${m.unit}</small></div>
        <div class="small muted">${m.ref ? `Normal ${m.ref[0]}–${m.ref[1]}` : `Caution above ${m.warn}`} · 24-h avg ${avg != null ? avg.toFixed(m.dec) : '—'}</div>
        <div class="small dim">${fmtTime(l.ts)} ${srcBadge(l.source)}</div>` : '<div class="v muted">—</div><div class="small dim">No reading</div>'}
        <div class="small dim" style="margin-top:4px">${esc(HEALTH[t])}</div></div>`).join('')}
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Environmental alerts</h2>
        ${rel.length ? rel.map(a => alertHTML(a, { compact: true })).join('') : '<p class="muted">No environmental alerts — readings are within configured limits.</p>'}
      </div>
      <div class="card"><h2>CO₂ — last 14 days</h2><div class="chart-box"><canvas id="co2Chart"></canvas></div></div>
    </div>

    <details class="card" style="margin-top:16px"><summary><b>Add or import cabin data</b> <span class="small muted">(manual entry, spacecraft file, demo telemetry)</span></summary>
      <form id="envForm" class="form-grid" style="margin-top:10px">
        <div class="field"><label>Measurement</label><select name="type">${CORE.map(t => `<option value="${t}">${METRICS[t].label} (${METRICS[t].unit})</option>`).join('')}</select></div>
        <div class="field"><label>Value</label><input name="value" type="number" step="any" required></div>
        <div class="field"><label>Time</label><input name="ts" type="datetime-local"></div>
        <div class="field"><button class="btn primary" type="submit">Save ${srcBadge('manual')}</button></div>
      </form>
      <div class="btn-row" style="margin-top:8px"><label class="btn sm">⇪ Import spacecraft data (JSON/CSV)<input type="file" id="envFile" accept=".json,.csv" hidden></label>
        <button class="btn sm" id="simNormal">+ Nominal sample ${srcBadge('simulated')}</button><button class="btn sm" id="simCo2">+ CO₂ excursion ${srcBadge('simulated')}</button></div>
      <p class="small dim">CSV columns <code>timestamp,type,value</code> (type ids like <code>env_co2</code>; see <code>samples/environment-sample.csv</code>). Demo telemetry is labelled simulated. Radiation is shown in Spaceflight Hazards.</p>
    </details>`;

    const c = daily('env_co2', 14);
    makeChart($('#co2Chart'), { type: 'line', data: { labels: c.map(x => x.day.slice(5)), datasets: [{ label: 'CO₂ (mmHg)', data: c.map(x => x.value), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.12)', fill: true, tension: .3, pointRadius: 2, spanGaps: true }] }, options: { plugins: { legend: { display: false } }, scales: { y: { min: 0 } } } });

    $('#envForm').onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const ts = fd.ts ? new Date(fd.ts).getTime() : Date.now(); await addRecord(fd.type, Number(fd.value), 'manual', { entry: 'crew manual entry' }, ts); toast('Reading saved.'); };
    $('#envFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const r = await importFile(f, { allowed: t => t.startsWith('env_') }); toast(`Imported ${r.imported} environmental reading(s)${r.skipped ? `, skipped ${r.skipped}` : ''}.`); } catch (err) { toast('Import failed: ' + esc(err.message), true); } e.target.value = ''; };
    const sim = async kind => {
      const r = (a, b) => a + Math.random() * (b - a); const meta = { generator: 'ORBITAL demo telemetry' };
      const base = { env_co2: kind === 'co2' ? r(4.2, 6.0) : r(1.8, 2.6), env_o2: r(20.8, 21.6), env_pressure: r(101, 101.6), env_temp: r(21.5, 23.5), env_humidity: r(38, 52) };
      await addRecords(Object.entries(base).map(([type, value]) => ({ type, value: +value.toFixed(2), ts: Date.now(), source: 'simulated', meta })));
      toast(kind === 'co2' ? 'Simulated CO₂ excursion added.' : 'Simulated nominal sample added.');
    };
    $('#simNormal').onclick = () => sim('normal'); $('#simCo2').onclick = () => sim('co2');
  };
  draw();
  const off = on(w => { if (w === 'records') draw(); });
  return () => off();
}
