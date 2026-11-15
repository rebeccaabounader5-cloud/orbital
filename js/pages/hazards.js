// ORBITAL — Spaceflight Hazards (simplified): the hazards that most affect the astronaut's health, each with what it
// does to the body, what ORBITAL watches, the current status and the related alerts.
import { on, byType, DAY, latest } from '../store.js';
import { current, mean } from '../analysis.js';
import { METRICS, RAD_CAREER_LIMIT_MSV, srcBadge } from '../metrics.js';
import { esc, alertHTML } from '../ui.js';

const CARDS = [
  { key: 'radiation', icon: '☢', name: 'Space radiation', color: '#f5b942', link: '#/hazards',
    body: 'Cosmic rays and solar particle events can damage DNA, raise long-term cancer risk and harm the eyes.',
    watch: 'Daily dose from the spacecraft radiation monitors, against the 600 mSv career limit.', act: 'During a solar particle event: go to the storm shelter and wear your dosimeter.' },
  { key: 'gravity', icon: '⇵', name: 'Microgravity', color: '#60a5fa', link: '#/physical',
    body: 'Without gravity, muscles and bones weaken, fluid shifts to the head, and balance is disturbed after landing.',
    watch: 'Daily exercise (camera-verified), posture, movement speed and face puffiness.', indicators: ['exercise_min', 'posture', 'move_speed', 'puffiness'], act: 'Do the daily exercise programme; report dizziness or vision changes.' },
  { key: 'environment', icon: '◎', name: 'Cabin environment', color: '#34d399', link: '#/environment',
    body: 'A closed cabin can build up CO₂, lose pressure or oxygen, or become too dry, hot or cold.',
    watch: 'Temperature, pressure, oxygen, CO₂ and humidity.', indicators: ['env_co2', 'env_o2', 'env_pressure'], act: 'High CO₂ or headache: move near a fan or vent and check the readings.' },
  { key: 'isolation', icon: '☾', name: 'Isolation & distance', color: '#a78bfa', link: '#/mental',
    body: 'Months of confinement far from Earth affect sleep, mood and stress — and help from Earth can be hours away.',
    watch: 'Sleep, fatigue, behaviour and stress signs (ORBI cameras); emergency help works without Earth.', indicators: ['sleep_h', 'perclos'], act: 'Keep regular sleep; talk to ORBI or the crew when things feel heavy.' },
];
const LBL = { ok: 'Nominal', caution: 'Caution', warning: 'Warning', emergency: 'Emergency' };

export async function render(view) {
  const draw = () => {
    const { alerts, status } = current();
    const rad = byType('env_rad'); const total = rad.reduce((s, r) => s + r.value, 0);
    const last7 = byType('env_rad', Date.now() - 7 * DAY); const rate = last7.length ? mean(last7.map(r => r.value)) : null;
    const health = alerts.filter(a => a.level !== 'info').slice(0, 6);
    const age = ts => { const h = (Date.now() - ts) / 3600e3; return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };
    const ind = t => { const r = latest(t); const m = METRICS[t]; return r ? `<tr><td>${m.label}</td><td><b>${(+r.value).toFixed(m.dec)}</b> ${m.unit} ${srcBadge(r.source)} <span class="dim small">${age(r.ts)}</span></td></tr>` : `<tr><td>${m.label}</td><td class="dim">no data</td></tr>`; };
    view.innerHTML = `
    <p class="page-intro">The spaceflight hazards that matter most for your health, what each one does, and what ORBITAL is watching right now.</p>
    <div class="grid g2">
      ${CARDS.map(c => { const st = status.hazards[c.key] || 'ok'; const n = alerts.filter(a => (a.hazards || []).includes(c.key)).length; return `<div class="card hz-card">
        <div class="card-h"><h2 style="color:${c.color}">${c.icon} ${c.name}</h2><span class="pill lv-${st === 'ok' ? 'ok' : st}">${LBL[st] || st}${n ? ` · ${n} alert${n > 1 ? 's' : ''}` : ''}</span></div>
        <p class="small">${esc(c.body)}</p>
        <p class="small"><b>ORBITAL watches:</b> ${esc(c.watch)}</p>
        ${c.key === 'radiation' ? `<div class="small">Mission dose <b>${total.toFixed(1)} mSv</b> (${(total / RAD_CAREER_LIMIT_MSV * 100).toFixed(1)}% of the 600 mSv limit) · 7-day average ${rate != null ? rate.toFixed(2) + ' mSv/day' : '—'} ${[...new Set(rad.map(r => r.source))].map(srcBadge).join(' ')}</div>
          <div class="gauge" style="height:10px;margin-top:6px"><i style="width:${Math.min(100, total / RAD_CAREER_LIMIT_MSV * 100)}%;background:linear-gradient(90deg,var(--ok),var(--caution))"></i></div>`
        : `<table class="table small">${c.indicators.map(ind).join('')}</table>`}
        <p class="small muted" style="margin-top:6px">→ ${esc(c.act)}</p>
        ${c.key !== 'radiation' ? `<a class="btn sm" href="${c.link}">Open ${c.key === 'gravity' ? 'Physical Health' : c.key === 'environment' ? 'Mission Environment' : 'Mental Health'} →</a>` : ''}
      </div>`; }).join('')}
    </div>
    <div class="card" style="margin-top:16px"><h2>Health & safety alerts</h2>
      ${health.length ? health.map(a => alertHTML(a, { compact: true })).join('') : '<p class="muted">No active health or safety alerts.</p>'}
      <p class="small dim">Earlier events are kept in Profile &amp; Data → Health event history. Sources: NASA Human Research Program; NASA-STD-3001 (2022).</p>
    </div>`;
  };
  draw();
  const off = on(w => { if (w === 'records') draw(); });
  return () => off();
}
