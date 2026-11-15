// ORBI — responsiveness check. An unconscious astronaut cannot answer questions, so when ORBI suspects a collapse
// (camera fall detection, or someone who said they might faint going silent) it asks out loud and waits a short time
// for a spoken "I'm okay" or a button press. No answer → the unresponsive-person protocol starts by itself.
import { speak } from '../voice.js';
import { setVoiceOverride } from '../companion/overlay.js';
import { startProtocol, run } from './protocol.js';

let active = null;
export const checking = () => !!active;
/** opts: { seconds = 15, reason, onTick(secondsLeft), onDone(responded:boolean) } */
export function responsivenessCheck({ seconds = 15, reason = 'ORBI is checking on you', onTick, onDone } = {}) {
  if (active || run.active) return false;
  let left = seconds; const st = { done: false };
  active = st;
  const finish = async ok => {
    if (st.done) return; st.done = true; clearInterval(st.timer); setVoiceOverride(null); active = null;
    onDone?.(ok);
    if (ok) await speak('Thank you. I\'m glad you can hear me. Stay where you are for a moment — I\'m still watching.');
    else await startProtocol('arrest', { source: 'camera', intro: 'Crew alert! Crew alert! The astronaut is not responding.' });
  };
  st.answer = () => finish(true);
  setVoiceOverride(t => { if (/\b(i'?m (ok|okay|fine|alright|here|awake)|okay|fine|yes|i can hear you)\b/i.test(t)) finish(true); });
  speak(`${reason}. Are you okay? Say "I'm okay", or press the button.`);
  st.timer = setInterval(() => { left--; onTick?.(left); if (left <= 0) finish(false); }, 1000);
  return st;
}
export const answerCheck = () => active?.answer();
export const cancelCheck = () => { if (active) { active.done = true; clearInterval(active.timer); setVoiceOverride(null); active = null; } };
