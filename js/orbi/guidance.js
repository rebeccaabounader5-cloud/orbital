// ORBI — timed step-by-step guidance (Virtual Body). A small state machine:
//
//   SPEAKING_STEP → WAITING_FOR_RESPONSE ──"next"──→ next step
//                        │  └─"repeat"──→ SPEAKING_STEP (same step)
//                        └─ 30 s silence → REPEATING_STEP (once) → MOVING_TO_NEXT_STEP → next step
//   after the last step: GUIDANCE_COMPLETED → WAITING_FOR_FINAL_CONFIRMATION (30 s)
//        → CHECKING_ASTRONAUT ("Are you still there?", 20 s to answer)
//        → no answer: camera evidence → awake-but-silent (no alarm) | collapse / unconscious / UNCERTAIN → EMERGENCY_ESCALATION
//
// Rules: the 30-s timer only starts after ORBI has finished speaking; there is never more than one timer; while the
// astronaut is mid-sentence the timer waits; any answer cancels the check; stop() cleans everything up.
// Silence alone is never treated as unconsciousness — the camera evidence decides, and "cannot tell" is reported as
// UNCERTAIN, not guessed.
import { voiceState } from '../voice.js';

export const STATES = ['IDLE', 'SPEAKING_STEP', 'WAITING_FOR_RESPONSE', 'REPEATING_STEP', 'MOVING_TO_NEXT_STEP', 'GUIDANCE_COMPLETED', 'WAITING_FOR_FINAL_CONFIRMATION', 'CHECKING_ASTRONAUT', 'EMERGENCY_ESCALATION', 'ENDED'];
const ORD = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
export const NEXT_RE = /\b(next|done|i'?m done|finished|ok(ay)?|go on|continue|ready|did it|got it|what'?s next|and then|move on)\b/;
export const REPEAT_RE = /\b(repeat|again|say (that|it) again|one more time|what was that|pardon|come again|didn'?t (hear|catch))\b/;
export const BACK_RE = /\b(go back|previous( step)?|back one)\b/;
export const STOP_RE = /\b(stop( the)? (guid\w*|steps?|instructions?)|stop|cancel|that'?s enough|enough|end (it|the guidance))\b/;

export class Guidance {
  /**
   * steps: [string]; speak(text) → Promise (resolves when ORBI has finished speaking);
   * getEvidence() → Promise<{ status: 'responsive'|'collapse'|'unconscious'|'uncertain', detail, source }>;
   * onEscalate(evidence) → called once for an emergency; onState(state, info) → UI updates.
   * waitMs / checkMs are 30 s / 20 s (configurable for tests).
   */
  constructor({ steps, speak, getEvidence, onEscalate, onState, onEnd, waitMs = 30000, checkMs = 20000 }) {
    Object.assign(this, { steps: steps.slice(0, 5), speak, getEvidence, onEscalate, onState, onEnd, waitMs, checkMs });
    this.state = 'IDLE'; this.step = 0; this.timer = 0; this.token = 0; this.repeated = false; this.log = [];
  }
  set(state) { this.state = state; this.log.push({ t: Date.now(), state, step: this.step }); this.onState?.(state, { step: this.step, total: this.steps.length }); }
  clear() { clearTimeout(this.timer); this.timer = 0; }
  /** One timer at a time; it waits while the astronaut is talking. */
  arm(ms, fn) {
    this.clear(); const my = this.token;
    const tick = () => {
      if (my !== this.token) return;
      if (voiceState.interim || voiceState.state === 'speaking' || voiceState.state === 'processing') { this.timer = setTimeout(tick, 1500); return; }
      fn();
    };
    this.timer = setTimeout(tick, ms);
  }
  async say(text) { const my = ++this.token; await this.speak(text); return my === this.token; } // false if interrupted meanwhile

  start() { this.step = 0; return this.speakStep(); }
  async speakStep(prefix = '') {
    if (this.step >= this.steps.length) return this.completed();
    this.repeated = false; this.set('SPEAKING_STEP');
    const last = this.step === this.steps.length - 1;
    if (!await this.say(`${prefix}Step ${ORD[this.step]}. ${this.steps[this.step]} ${last ? 'That\'s the last one — tell me when you\'re done.' : 'Say "next" when you\'re ready, or "repeat".'}`)) return;
    this.set('WAITING_FOR_RESPONSE');
    this.arm(this.waitMs, () => this.noAnswer());
  }
  async noAnswer() {
    if (this.state !== 'WAITING_FOR_RESPONSE') return;
    if (!this.repeated) {
      this.repeated = true; this.set('REPEATING_STEP');
      if (!await this.say(`Here's step ${ORD[this.step]} again. ${this.steps[this.step]}`)) return;
      this.set('MOVING_TO_NEXT_STEP'); this.step++;
      return this.speakStep(this.step < this.steps.length ? 'Moving on. ' : '');
    }
  }
  async completed() {
    this.set('GUIDANCE_COMPLETED');
    if (!await this.say('That was the last step. How do you feel now?')) return;
    this.set('WAITING_FOR_FINAL_CONFIRMATION');
    this.arm(this.waitMs, () => this.checkIn());
  }
  async checkIn() {
    if (this.state !== 'WAITING_FOR_FINAL_CONFIRMATION') return;
    this.set('CHECKING_ASTRONAUT');
    if (!await this.say('Are you still there? Can you hear me?')) return;
    this.arm(this.checkMs, () => this.evaluate());
  }
  async evaluate() {
    if (this.state !== 'CHECKING_ASTRONAUT') return;
    const my = this.token;
    const ev = await this.getEvidence().catch(e => ({ status: 'uncertain', detail: 'camera check failed: ' + e.message, source: 'none' }));
    if (my !== this.token || this.state !== 'CHECKING_ASTRONAUT') return; // the astronaut answered meanwhile
    this.evidence = ev;
    if (ev.status === 'responsive') {
      this.set('ENDED');
      await this.say('I can see you, so I won\'t raise an alarm. Just tell me if you need anything.');
      return this.onEnd?.('awake but silent', ev);
    }
    this.set('EMERGENCY_ESCALATION'); this.clear(); this.token++;
    this.onEscalate?.(ev);
  }
  /** The astronaut said something while guidance is active. Returns true if guidance handled it. */
  async hear(text) {
    const s = text.toLowerCase();
    if (['CHECKING_ASTRONAUT', 'WAITING_FOR_FINAL_CONFIRMATION', 'GUIDANCE_COMPLETED'].includes(this.state)) {
      // any answer means the astronaut is responsive — the check is over, the conversation continues normally
      this.stop('astronaut answered'); return false;
    }
    if (STOP_RE.test(s) && !NEXT_RE.test(s.replace(/\bstop\b/, ''))) { this.stop('stopped by astronaut'); await this.speak('Okay, we\'ll stop the steps there. I\'m still here.'); return true; }
    if (REPEAT_RE.test(s)) { this.clear(); this.token++; await this.speakStep(); return true; }
    if (BACK_RE.test(s)) { this.clear(); this.token++; this.step = Math.max(0, this.step - 1); await this.speakStep(); return true; }
    if (NEXT_RE.test(s) && s.split(/\s+/).length <= 6) { this.clear(); this.token++; this.step++; await this.speakStep(); return true; }
    // something else (a question, a new symptom): let the conversation answer, then wait again for this step
    this.clear(); this.token++;
    return false;
  }
  /** After the conversation answered a side question, resume waiting on the current step. */
  resumeWaiting() { if (['WAITING_FOR_RESPONSE', 'SPEAKING_STEP', 'REPEATING_STEP'].includes(this.state)) { this.set('WAITING_FOR_RESPONSE'); this.arm(this.waitMs, () => this.noAnswer()); } }
  get active() { return !['IDLE', 'ENDED', 'EMERGENCY_ESCALATION'].includes(this.state); }
  stop(reason = 'stopped') { this.clear(); this.token++; if (this.state !== 'ENDED') { this.set('ENDED'); this.onEnd?.(reason); } }
}
