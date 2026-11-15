// ORBI — floating-robot simulation (side view of a spacecraft module). The astronaut moves between stations over a
// compressed day/night cycle; ORBI (a spherical free-flyer with an RGB eye and a thermal eye, inspired by the ISS
// Int-Ball2 concept) follows with spring dynamics, keeps a safe distance and points the active eye at the astronaut.
const STATIONS = [
  { id: 'work', x: 0.22, y: 0.55, label: 'Working at the science rack', pose: 'stand' },
  { id: 'exercise', x: 0.47, y: 0.62, label: 'Daily exercise (resistance device)', pose: 'squat' },
  { id: 'galley', x: 0.68, y: 0.5, label: 'Meal with the crew', pose: 'float' },
  { id: 'window', x: 0.84, y: 0.42, label: 'Looking at Earth through the window', pose: 'float' },
  { id: 'sleep', x: 0.12, y: 0.32, label: 'Sleeping (lights off)', pose: 'sleep' },
];
const SCHEDULE = ['work', 'exercise', 'galley', 'window', 'work', 'sleep']; // one compressed day ≈ 72 s

export class OrbiScene {
  constructor(canvas, { onStatus } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onStatus = onStatus;
    this.t = 0; this.a = { x: 0.22, y: 0.55 }; this.o = { x: 0.35, y: 0.4, vx: 0, vy: 0 }; this.idx = 0; this.stay = 0; this.run = false;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); this.resize();
  }
  resize() { const r = this.cv.getBoundingClientRect(); this.cv.width = Math.max(300, r.width) * devicePixelRatio; this.cv.height = Math.max(200, r.height) * devicePixelRatio; }
  start() { if (this.run) return; this.run = true; let last = performance.now(); const loop = now => { if (!this.run) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; this.step(dt); this.draw(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.run = false; cancelAnimationFrame(this.raf); }
  dispose() { this.stop(); this.ro.disconnect(); }
  get station() { return STATIONS.find(s => s.id === SCHEDULE[this.idx]); }
  get night() { return this.station.id === 'sleep' && Math.hypot(this.a.x - this.station.x, this.a.y - this.station.y) < 0.03; }
  step(dt) {
    this.t += dt; const st = this.station;
    const dx = st.x - this.a.x, dy = st.y - this.a.y, d = Math.hypot(dx, dy);
    if (d > 0.005) { const sp = 0.09 * dt; this.a.x += dx / d * Math.min(sp, d); this.a.y += dy / d * Math.min(sp, d); }
    else { this.stay += dt; if (this.stay > (st.id === 'sleep' ? 18 : 10)) { this.stay = 0; this.idx = (this.idx + 1) % SCHEDULE.length; } }
    // ORBI target: ~1.2 m away (0.13 of module width), above and to the side, never in the path
    const side = this.a.x > 0.5 ? -1 : 1;
    const tx = this.a.x + side * 0.12, ty = this.a.y - 0.17 + Math.sin(this.t * 0.8) * 0.015;
    const k = 2.2, c = 2.0; this.o.vx += ((tx - this.o.x) * k - this.o.vx * c) * dt; this.o.vy += ((ty - this.o.y) * k - this.o.vy * c) * dt;
    this.o.x += this.o.vx * dt; this.o.y += this.o.vy * dt;
    const dist = Math.hypot(this.a.x - this.o.x, (this.a.y - this.o.y) * 0.6) * 9; // module ≈ 9 m long
    this.onStatus?.({ activity: d > 0.005 ? 'Moving to: ' + st.label.toLowerCase() : st.label, night: this.night, eye: this.night ? 'thermal' : 'rgb', dist });
  }
  draw() {
    const { ctx } = this; const W = this.cv.width, H = this.cv.height; const night = this.night; const s = W / 1000;
    // module interior
    const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, night ? '#03060f' : '#0f2142'); bg.addColorStop(1, night ? '#020409' : '#081327'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = night ? '#0b1a33' : '#234478'; ctx.lineWidth = 3 * s; ctx.strokeRect(10 * s, 0.12 * H, W - 20 * s, 0.76 * H);
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * W / 8, 0.12 * H); ctx.lineTo(i * W / 8, 0.88 * H); ctx.globalAlpha = 0.25; ctx.stroke(); ctx.globalAlpha = 1; }
    const label = (txt, x, y) => { ctx.fillStyle = night ? '#24324d' : '#5d7398'; ctx.font = `${13 * s * 1.4}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(txt, x, y); };
    // racks / stations
    ctx.fillStyle = night ? '#0a1426' : '#13284d'; ctx.fillRect(0.15 * W, 0.62 * H, 0.14 * W, 0.24 * H); label('science rack', 0.22 * W, 0.84 * H);
    ctx.fillRect(0.42 * W, 0.74 * H, 0.1 * W, 0.12 * H); label('resistance device', 0.47 * W, 0.84 * H);
    ctx.fillRect(0.62 * W, 0.62 * H, 0.12 * W, 0.08 * H); label('galley', 0.68 * W, 0.84 * H);
    ctx.fillStyle = night ? '#061024' : '#0b3a66'; ctx.beginPath(); ctx.arc(0.86 * W, 0.3 * H, 0.06 * H, 0, 7); ctx.fill(); ctx.strokeStyle = '#2a5b95'; ctx.stroke();
    if (!night) { ctx.fillStyle = '#1d6fb8'; ctx.beginPath(); ctx.arc(0.87 * W, 0.31 * H, 0.03 * H, 0, 7); ctx.fill(); } label('window', 0.86 * W, 0.42 * H);
    ctx.fillStyle = night ? '#0a1426' : '#13284d'; ctx.fillRect(0.04 * W, 0.18 * H, 0.16 * W, 0.24 * H); label('sleep station', 0.12 * W, 0.47 * H);
    if (!night) { ctx.fillStyle = 'rgba(255,240,200,.05)'; ctx.fillRect(10 * s, 0.12 * H, W - 20 * s, 0.76 * H); }
    // astronaut
    const ax = this.a.x * W, ay = this.a.y * H; const st = this.station; const sleeping = night;
    const thermal = night; // at night the astronaut is only "visible" through the thermal eye
    ctx.save(); ctx.translate(ax, ay);
    if (sleeping) ctx.rotate(-Math.PI / 2);
    const col = thermal ? '#f97316' : '#e6f0ff';
    const bob = st.pose === 'squat' && !this.moving ? Math.abs(Math.sin(this.t * 2.5)) * 8 * s : 0;
    ctx.fillStyle = thermal ? 'rgba(249,115,22,.85)' : '#cfd8e8'; ctx.strokeStyle = col; ctx.lineWidth = 6 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -46 * s + bob, 13 * s, 0, 7); ctx.fill(); // head
    if (thermal) { ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(0, -46 * s + bob, 6 * s, 0, 7); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(0, -32 * s + bob); ctx.lineTo(0, 4 * s + bob); ctx.stroke(); // torso
    const arm = st.pose === 'float' ? Math.sin(this.t * 1.3) * 0.4 : st.pose === 'stand' ? 0.9 + Math.sin(this.t * 3) * 0.1 : 0.2;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, -26 * s + bob); ctx.lineTo(sd * 22 * s * Math.cos(arm), (-26 + 22 * Math.sin(arm)) * s + bob); ctx.stroke(); }
    const knee = st.pose === 'squat' ? 10 * s - bob : 0;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 4 * s + bob); ctx.lineTo(sd * 8 * s, 22 * s + knee * 0.3); ctx.lineTo(sd * 9 * s, 40 * s); ctx.stroke(); }
    ctx.restore();
    // ORBI
    const ox = this.o.x * W, oy = this.o.y * H, R = 22 * s; const ang = Math.atan2(ay - 30 * s - oy, ax - ox);
    // field of view cone from the active eye
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang);
    const cone = ctx.createLinearGradient(0, 0, 260 * s, 0); const cc = night ? '249,115,22' : '34,211,238'; cone.addColorStop(0, `rgba(${cc},.35)`); cone.addColorStop(1, `rgba(${cc},0)`);
    ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(R * 0.6, 0); ctx.lineTo(260 * s, -70 * s); ctx.lineTo(260 * s, 70 * s); ctx.closePath(); ctx.fill(); ctx.restore();
    // body (white sphere with blue panel ring, like a small free-flyer)
    const body = ctx.createRadialGradient(ox - R * 0.4, oy - R * 0.4, R * 0.1, ox, oy, R); body.addColorStop(0, '#ffffff'); body.addColorStop(0.7, night ? '#8a94a8' : '#d9e3f2'); body.addColorStop(1, night ? '#3b4558' : '#8fa4c4');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(ox, oy, R, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.ellipse(ox, oy, R, R * 0.32, 0, 0, 7); ctx.stroke();
    // two eyes, oriented toward the astronaut
    const ex = Math.cos(ang), ey = Math.sin(ang);
    const eye = (off, colr, on) => { const px = ox + ex * R * 0.55 - ey * off, py = oy + ey * R * 0.55 + ex * off; ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.arc(px, py, R * 0.3, 0, 7); ctx.fill(); ctx.fillStyle = on ? colr : '#334155'; ctx.shadowColor = colr; ctx.shadowBlur = on ? 14 * s : 0; ctx.beginPath(); ctx.arc(px, py, R * 0.15, 0, 7); ctx.fill(); ctx.shadowBlur = 0; };
    eye(-R * 0.33, '#22d3ee', !night); eye(R * 0.33, '#f97316', true);
    // propeller vents
    ctx.fillStyle = 'rgba(59,130,246,.5)'; for (const v of [-1, 1]) { ctx.fillRect(ox - R * 0.12 + v * R * 0.75, oy - 2 * s, R * 0.24, 4 * s); }
    ctx.fillStyle = night ? '#f97316' : '#22d3ee'; ctx.font = `${12 * s * 1.4}px Orbitron, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('ORBI', ox, oy - R - 8 * s);
    if (night) { ctx.fillStyle = 'rgba(249,115,22,.9)'; ctx.font = `${11 * s * 1.4}px Inter, sans-serif`; ctx.fillText('RGB too dark → thermal eye', ox, oy + R + 18 * s); }
  }
}
