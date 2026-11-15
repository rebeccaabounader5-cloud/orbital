// ORBI daily comparison: today vs yesterday vs previous days vs the pre-mission (Earth) baseline, with multi-day trend.
// A single unusual reading → "check"; the same direction on ≥2 of the last 3 days → "investigate"; critical limits are
// handled immediately by the safety checks in wellbeing.js (no waiting for trends).
import { state, startOfDay, DAY, daily } from '../store.js';
import { METRICS } from '../metrics.js';
import { mean, sd, linreg } from '../analysis.js';
import { EARTH_BASELINE } from './content.js';

export const COMPARE_SET = ['hr', 'rr', 'skin_temp', 'sleep_h', 'blink_rate', 'perclos', 'posture', 'move_speed', 'puffiness', 'reaction_ms', 'coordination', 'social_min'];

export function compareMetric(t) {
  const m = METRICS[t]; const today = startOfDay(Date.now());
  const d = daily(t, 15); const todayV = d.at(-1).value, yest = d.at(-2).value;
  const prev = d.slice(0, -1).filter(x => x.value != null).map(x => x.value);
  const p7 = prev.slice(-7); const avg7 = p7.length ? mean(p7) : null; const s7 = p7.length > 2 ? sd(p7) : null;
  const earth = EARTH_BASELINE.values[t] ?? null;
  const cur = todayV ?? yest; // most recent day available
  const pts = d.filter(x => x.value != null).slice(-7); const slope = pts.length >= 4 ? (linreg(pts.map(x => (x.ts - today) / DAY), pts.map(x => x.value))?.slope ?? null) : null;
  const worseDir = m.better === 'lower' ? 1 : m.better === 'higher' ? -1 : 0;
  const tol = Math.max(s7 ? 2 * s7 : 0, Math.abs(earth ?? avg7 ?? 1) * (t === 'puffiness' ? 0 : 0.08), t === 'puffiness' ? 4 : 0, t === 'skin_temp' ? 0.5 : 0);
  const devFrom = ref => (cur == null || ref == null) ? 0 : (cur - ref);
  const isWorse = dv => worseDir === 0 ? Math.abs(dv) > tol : dv * worseDir > tol;
  const last3 = d.slice(-3).map(x => x.value).filter(v => v != null);
  const persistent = last3.filter(v => isWorse(v - (avg7 ?? earth ?? v))).length >= 2;
  let status = 'ok';
  if (cur != null && (isWorse(devFrom(avg7)) || isWorse(devFrom(earth)))) status = persistent ? 'investigate' : 'check';
  const src = state.records.filter(r => r.type === t).at(-1)?.source || null;
  return { t, label: m.label, unit: m.unit, dec: m.dec, today: todayV, yest, avg7, earth, cur, slope, status, persistent, src };
}
export const compareAll = (set = COMPARE_SET) => set.map(compareMetric);
export function fmtV(v, dec) { return v == null ? '—' : Number(v).toFixed(dec); }
export function comparisonTable(rows, srcBadge) {
  const st = { ok: ['ok', 'Normal'], check: ['caution', 'Check'], investigate: ['warning', 'Investigate'] };
  return `<div class="table-wrap"><table class="table cmp"><tr><th>Indicator</th><th>Earth baseline</th><th>Previous 7 days</th><th>Yesterday</th><th>Today</th><th>7-day trend</th><th>ORBI</th></tr>
  ${rows.map(r => `<tr><td>${r.label} ${r.src ? srcBadge(r.src) : ''}</td><td class="muted">${fmtV(r.earth, r.dec)} ${r.earth != null ? r.unit : ''}</td><td>${fmtV(r.avg7, r.dec)}</td><td>${fmtV(r.yest, r.dec)}</td><td><b>${fmtV(r.today, r.dec)}</b></td><td>${r.slope == null ? '—' : Math.abs(r.slope * 7) < 0.04 * Math.max(1, Math.abs(r.avg7 ?? r.cur ?? 1)) ? '→ stable' : r.slope > 0 ? '↗ rising' : '↘ falling'}</td><td><span class="dot ${st[r.status][0]}"></span>${st[r.status][1]}</td></tr>`).join('')}</table></div>
  <p class="small dim">Earth baseline: ${EARTH_BASELINE.recorded}. “Check” = one unusual day; “Investigate” = the same change on 2 of the last 3 days. Critical single readings trigger an immediate safety check instead.</p>`;
}
