// ORBITAL — application bootstrap and hash router
import { state, loadAll, on, missionDay, stageFor } from './store.js';
import { seedDemo } from './seed.js';
import { $, $$, closeModal, initChartDefaults, destroyCharts, toast } from './ui.js';
import { current, logAlerts, invalidate } from './analysis.js';
import { evaluate, level } from './game.js';
import { initCompanion } from './companion/overlay.js';

const PAGES = {
  dashboard: { title: 'Dashboard', load: () => import('./pages/dashboard.js') },
  camera: { title: 'AI Camera — ORBI', load: () => import('./pages/camera.js') },
  body: { title: 'Virtual Body', load: () => import('./pages/body.js') },
  physical: { title: 'Physical Health', load: () => import('./pages/physical.js') },
  mental: { title: 'Mental Health', load: () => import('./pages/mental.js') },
  emergency: { title: 'Emergency Center', load: () => import('./pages/emergency.js') },
  environment: { title: 'Mission Environment', load: () => import('./pages/environment.js') },
  hazards: { title: 'Spaceflight Hazards', load: () => import('./pages/hazards.js') },
  settings: { title: 'Profile & Data', load: () => import('./pages/settings.js') },
};

let cleanup = null, currentPage = null, renderToken = 0;

async function route() {
  const [, name = 'dashboard', ...rest] = location.hash.replace(/^#/, '').split('/');
  if (name === 'timeline') { location.replace('#/settings/history'); return; } // Health Timeline was removed; its event history lives in Profile & Data
  const page = PAGES[name] ? name : 'dashboard';
  const token = ++renderToken;
  if (cleanup) { try { await cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  destroyCharts();
  currentPage = page;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  $('#pageTitle').textContent = PAGES[page].title;
  $('#sidebar').classList.remove('open');
  const view = $('#view');
  view.innerHTML = '<div class="muted">Loading…</div>';
  try {
    const mod = await PAGES[page].load();
    if (token !== renderToken) return;
    view.innerHTML = '';
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    cleanup = (await mod.render(view, rest)) || null;
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (/does not provide an export|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(e)) && !sessionStorage.getItem('orbital.repaired')) {
      // Old and new app files mixed (stale offline cache from a previous version): clear the cache and reload once.
      sessionStorage.setItem('orbital.repaired', '1'); location.replace('reset.html'); return;
    }
    view.innerHTML = `<div class="card"><h2>Page failed to load</h2><pre class="small">${String(e.stack || e)}</pre></div>`;
  }
}

function updateTop() {
  const p = state.profile || {};
  $('#missionName').textContent = p.missionName || '—';
  const md = missionDay(); const st = md ? stageFor(md) : null;
  $('#missionDay').textContent = md ? `${md}${st ? ' · ' + st.name : ''}` : '—';
  const g = state.game || { xp: 0 };
  const lv = level(g.xp); const into = g.xp % 150;
  $('#xpBox').innerHTML = `<div style="display:flex;justify-content:space-between"><span>Health engagement · Lv ${lv}</span><span class="muted">${g.xp} XP</span></div><div class="xp-bar"><i style="width:${(into / 150) * 100}%"></i></div>`;
  const banner = $('#banner');
  const emg = state.emergencies.filter(e => e.status === 'active');
  if (emg.length) { banner.classList.remove('hidden'); banner.innerHTML = `⚠ <b>Active emergency event:</b> ${emg[emg.length - 1].title} — <a href="#/emergency">open Emergency Center</a>`; }
  else banner.classList.add('hidden');
}

function clock() {
  const d = new Date(); $('#clock').textContent = d.toISOString().slice(11, 19);
  const online = navigator.onLine;
  $('#netStatus').innerHTML = online ? '<span class="dot ok"></span>Available' : '<span class="dot caution"></span>No link (offline)';
}

async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
export const hashPin = pin => sha('orbital::' + pin);

async function lockGate() {
  if (!state.profile?.pinHash) return;
  const lock = $('#lock'); lock.classList.remove('hidden');
  await new Promise(res => {
    const go = async () => {
      if (await hashPin($('#lockPin').value) === state.profile.pinHash) { lock.classList.add('hidden'); res(); }
      else { $('#lockMsg').textContent = 'Incorrect PIN'; $('#lockPin').value = ''; }
    };
    $('#lockBtn').onclick = go; $('#lockPin').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#lockPin').focus();
  });
}

async function boot() {
  initChartDefaults();
  await loadAll();
  if (!state.profile) { await seedDemo(); toast('Demo mission loaded with <b>simulated</b> data. Manage it under Profile &amp; Data.'); }
  await lockGate();
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#modalX').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  on(async what => {
    if (what === 'records') { invalidate(); await evaluate(); logAlerts(current().alerts); }
    updateTop();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', clock); window.addEventListener('offline', clock);
  setInterval(clock, 1000); clock(); updateTop();
  logAlerts(current().alerts);
  evaluate();
  route();
  initCompanion();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => console.info('[ORBITAL] service worker registered', r.scope)).catch(e => console.warn('SW registration failed', e));
  }
}

export const getCurrentPage = () => currentPage;
boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<pre style="color:#f88;padding:20px">ORBITAL failed to start: ${e}</pre>`); });
