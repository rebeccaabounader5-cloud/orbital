// ORBITAL — import of spacecraft / medical-record data (JSON or CSV). Imported rows are tagged source:'imported'.
import { addRecords, state } from './store.js';
import { METRICS } from './metrics.js';

/** Accepts:
 *  JSON: [{type, value, timestamp|ts, name?, unit?, refRange?}] or {records:[...]}
 *  CSV : header row with columns timestamp,type,value[,name,unit,refRange]
 */
export async function importFile(file, { allowed = null } = {}) {
  const text = await file.text();
  let rows = [];
  if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    const j = JSON.parse(text); rows = Array.isArray(j) ? j : (j.records || j.data || []);
  } else {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const head = lines.shift().split(',').map(h => h.trim().toLowerCase());
    rows = lines.map(l => { const c = l.split(','); const o = {}; head.forEach((h, i) => o[h] = (c[i] ?? '').trim()); return o; });
  }
  const out = []; const skipped = [];
  for (const r of rows) {
    const type = String(r.type || '').trim(); const value = Number(r.value);
    const ts = r.ts ? Number(r.ts) : Date.parse(r.timestamp || r.time || r.date);
    if (!type || !Number.isFinite(value) || !Number.isFinite(ts)) { skipped.push(r); continue; }
    if (type !== 'lab' && !METRICS[type]) { skipped.push(r); continue; }
    if (allowed && !allowed(type)) { skipped.push(r); continue; }
    if (ts > Date.now() + 3600e3) { skipped.push(r); continue; }
    const meta = { file: file.name };
    if (type === 'lab') Object.assign(meta, { name: r.name || 'Lab value', unit: r.unit || '', refRange: r.refRange || r.ref || '' });
    out.push({ type, value, ts, source: 'imported', meta });
  }
  if (out.length) await addRecords(out);
  return { imported: out.length, skipped: skipped.length };
}

export function exportRecordsCSV(filter = () => true) {
  const rows = state.records.filter(filter);
  const head = 'timestamp,type,label,value,unit,source,details';
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return [head, ...rows.map(r => [new Date(r.ts).toISOString(), r.type, esc(r.type === 'lab' ? r.meta?.name : METRICS[r.type]?.label || r.type), typeof r.value === 'number' ? r.value : esc(r.value), esc(METRICS[r.type]?.unit || r.meta?.unit || ''), r.source, esc(JSON.stringify(r.meta || {}))].join(','))].join('\n');
}
