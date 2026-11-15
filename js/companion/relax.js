// ORBITAL — voice-guided relaxation exercises (offered only when stress / muscle tension is observed, or on request).
import { addRecord } from '../store.js';
import { speak, stopSpeaking } from '../voice.js';
import { toast } from '../ui.js';

export const REL = {
  box: { name: 'Box breathing', intro: 'Let\'s do box breathing. In for four, hold for four, out for four, hold for four.', dur: 180, steps: [['Breathe in', 4, 1.8], ['Hold', 4, 1.8], ['Breathe out', 4, 1], ['Hold', 4, 1]] },
  slow: { name: 'Slow breathing', intro: 'Slow breathing. In through your nose for four, and out slowly for six.', dur: 180, steps: [['Breathe in', 4, 1.8], ['Breathe out', 6, 1]] },
  neck: { name: 'Neck relaxation', intro: 'Neck relaxation. Hold a handrail lightly, keep your shoulders low, and move slowly.', dur: 120, steps: [['Tilt your head toward your right shoulder', 8, 1.3], ['Back to centre', 4, 1], ['Tilt your head toward your left shoulder', 8, 1.3], ['Back to centre', 4, 1], ['Bring your chin gently toward your chest', 8, 1.3], ['Lift your head slowly', 4, 1]] },
  shoulders: { name: 'Shoulder relaxation', intro: 'Shoulder relaxation. We will lift, hold and drop the tension away.', dur: 120, steps: [['Lift your shoulders up to your ears', 5, 1.5], ['Hold', 3, 1.5], ['Drop them and breathe out', 6, 1], ['Roll your shoulders slowly backwards', 8, 1.2], ['Squeeze your shoulder blades together', 5, 1.3], ['Release', 5, 1]] },
  stretch: { name: 'Gentle stretching', intro: 'Gentle stretching, safe for the cabin. Keep a foot in the restraint.', dur: 150, steps: [['Reach both arms overhead and lengthen', 10, 1.6], ['Relax your arms', 5, 1], ['Hug your shoulders and round your upper back', 10, 1.3], ['Release', 5, 1], ['Pull one knee gently toward your chest', 10, 1.3], ['Now the other knee', 10, 1.3]] },
  pmr: { name: 'Muscle relaxation', intro: 'Progressive muscle relaxation. I\'ll name a body area. Tense it for five seconds, then let it go completely.', dur: 240, steps: ['hands', 'arms', 'shoulders', 'jaw and face', 'neck', 'back', 'stomach', 'legs', 'feet'].flatMap(a => [[`Tense your ${a}`, 5, 1.4], [`And release your ${a}`, 10, 1]]) },
};

/** Mount a breathing exercise into el. Returns { start(mode), stop() }. */
export function mountRelax(el, { mode = 'box', onDone } = {}) {
  el.innerHTML = `<div class="breath-wrap"><div class="breath" data-b>Ready</div></div>
    <div class="btn-row" style="justify-content:center"><button class="btn primary" data-s>▶ Start</button><button class="btn" data-x disabled>■ Stop</button></div>`;
  const b = el.querySelector('[data-b]'), bs = el.querySelector('[data-s]'), bx = el.querySelector('[data-x]');
  let timer = 0, t0 = 0;
  async function start(m = mode) {
    mode = m; const R = REL[mode]; bs.disabled = true; bx.disabled = false;
    await speak(R.intro); t0 = Date.now(); let i = 0, stepEnd = 0;
    const tick = () => {
      const now = Date.now(); if ((now - t0) / 1000 >= R.dur) return finish(true);
      if (now >= stepEnd) { const [label, sec, scale] = R.steps[i % R.steps.length]; b.style.transitionDuration = sec + 's'; b.style.transform = `scale(${scale})`; b.textContent = /^(and )?release/i.test(label) ? 'Release' : /^tense/i.test(label) ? 'Tense' : label.split(' ').length > 3 ? label.split(' ').slice(0, 2).join(' ') : label; speak(label, { rate: 0.9 }); stepEnd = now + sec * 1000; i++; }
    };
    timer = setInterval(tick, 200); tick();
  }
  async function finish(done) {
    clearInterval(timer); timer = 0; b.style.transform = 'scale(1)'; b.textContent = done ? 'Done' : 'Ready'; bs.disabled = false; bx.disabled = true;
    const min = Math.round((Date.now() - t0) / 60000 * 10) / 10;
    if (done) speak('Well done. Notice how your body feels now.'); else stopSpeaking();
    if (t0 && min >= 1) { await addRecord('relax_min', min, 'simulated', { via: 'camera-observed session (simulated)', exercise: mode }); toast(`Relaxation session logged (${min} min).`); }
    t0 = 0; onDone?.(done);
  }
  bs.onclick = () => start(); bx.onclick = () => finish(false);
  return { start, stop: () => { if (timer) finish(false); } };
}

/** Pick the exercise that fits what the cameras observed. */
export function relaxFor(stress) {
  const n = (stress?.notes || '').toLowerCase();
  if (/shoulder/.test(n)) return 'shoulders';
  if (/neck|jaw/.test(n)) return 'neck';
  if (stress?.muscle) return 'pmr';
  return 'box';
}
