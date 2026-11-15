// ORBITAL — interactive 3D schematic anatomy (Three.js, procedurally generated, no external model files).
// LIMITATION: this is a simplified schematic built from geometric primitives — organ positions and proportions are
// approximate. It visualises health information; it is NOT an anatomically exact model or a medical scanner.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createBody(container, { onSelect, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  camera.position.set(0.9, 0.35, 2.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.05, 0); controls.enableDamping = true; controls.minDistance = 0.5; controls.maxDistance = 5; controls.autoRotate = true; controls.autoRotateSpeed = 0.8;

  scene.add(new THREE.AmbientLight(0x6688aa, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.PointLight(0x22d3ee, 3, 6); rim.position.set(-1.5, 1, -1.5); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5); fill.position.set(-2, -1, 2); scene.add(fill);

  // platform rings
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.44, 96), ringMat); ring1.rotation.x = -Math.PI / 2; ring1.position.y = -0.93; scene.add(ring1);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.555, 96), ringMat.clone()); ring2.material.opacity = 0.15; ring2.rotation.x = -Math.PI / 2; ring2.position.y = -0.93; scene.add(ring2);
  const scan = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.003, 6, 96), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6 })); scan.rotation.x = Math.PI / 2; scene.add(scan);

  const root = new THREE.Group(); scene.add(root);
  const layers = { skin: new THREE.Group(), skeleton: new THREE.Group(), muscles: new THREE.Group(), organs: new THREE.Group(), vessels: new THREE.Group() };
  Object.values(layers).forEach(g => root.add(g));
  const organMeshes = {}; const mats = {};

  const mat = (id, color, opts = {}) => {
    if (!mats[id]) mats[id] = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, emissive: 0x000000, ...opts });
    mats[id].userData.base = { color: mats[id].color.clone(), opacity: mats[id].opacity };
    return mats[id];
  };
  const add = (layer, organ, mesh) => { mesh.userData.organ = organ; (organMeshes[organ] = organMeshes[organ] || []).push(mesh); layers[layer].add(mesh); return mesh; };
  const sphere = (r = 1, w = 32, h = 24) => new THREE.SphereGeometry(r, w, h);
  const ell = (layer, organ, m, pos, scale, rot) => { const s = new THREE.Mesh(sphere(), m); s.position.copy(pos); s.scale.set(...scale); if (rot) s.rotation.set(...rot); return add(layer, organ, s); };
  function limb(layer, organ, m, a, b, r, cap = true) {
    const len = a.distanceTo(b);
    const g = cap ? new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r * 0.2), 8, 16) : new THREE.CylinderGeometry(r, r, len, 16);
    const mesh = new THREE.Mesh(g, m); mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    return add(layer, organ, mesh);
  }
  const tube = (layer, organ, m, pts, r) => add(layer, organ, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, r, 10, false), m));

  // ---------- skeleton key points ----------
  const J = {
    head: V(0, 0.72, 0), neckB: V(0, 0.57, -0.01), shL: V(0.19, 0.5, -0.01), shR: V(-0.19, 0.5, -0.01),
    elL: V(0.28, 0.24, -0.02), elR: V(-0.28, 0.24, -0.02), wrL: V(0.36, 0.0, 0.02), wrR: V(-0.36, 0.0, 0.02),
    hpL: V(0.09, -0.05, 0), hpR: V(-0.09, -0.05, 0), knL: V(0.1, -0.47, 0.01), knR: V(-0.1, -0.47, 0.01), anL: V(0.1, -0.86, -0.01), anR: V(-0.1, -0.86, -0.01),
  };

  // ---------- skin (translucent shell) ----------
  const skinM = mat('skin', 0x7fd8ff, { transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.3, side: THREE.DoubleSide });
  ell('skin', 'skin', skinM, J.head, [0.095, 0.118, 0.105]);
  limb('skin', 'skin', skinM, V(0, 0.54, 0), V(0, 0.64, 0), 0.05, false);
  const prof = [[0.001, -0.12], [0.15, -0.1], [0.175, -0.02], [0.16, 0.08], [0.145, 0.16], [0.16, 0.28], [0.18, 0.4], [0.2, 0.48], [0.14, 0.55], [0.055, 0.58], [0.001, 0.585]].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), skinM); torso.scale.z = 0.62; add('skin', 'skin', torso);
  for (const [a, b, r] of [[J.shL, J.elL, 0.05], [J.shR, J.elR, 0.05], [J.elL, J.wrL, 0.04], [J.elR, J.wrR, 0.04], [J.hpL, J.knL, 0.075], [J.hpR, J.knR, 0.075], [J.knL, J.anL, 0.055], [J.knR, J.anR, 0.055]]) limb('skin', 'skin', skinM, a, b, r);
  for (const s of [1, -1]) { ell('skin', 'skin', skinM, V(0.385 * s, -0.07, 0.03), [0.035, 0.07, 0.02]); ell('skin', 'skin', skinM, V(0.1 * s, -0.89, 0.05), [0.045, 0.03, 0.1]); }

  // ---------- skeleton ----------
  const boneM = mat('bones', 0xe9e1cf, { roughness: 0.7 });
  ell('skeleton', 'bones', mat('bones_skull', 0xe9e1cf, { transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.5 }), V(0, 0.735, -0.005), [0.085, 0.1, 0.095]);
  ell('skeleton', 'bones', boneM, V(0, 0.645, 0.04), [0.05, 0.03, 0.045]); // jaw
  for (let i = 0; i < 24; i++) { const y = 0.6 - i * 0.026; const v = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.018, 10), boneM); v.position.set(0, y, -0.07 + Math.sin(i / 23 * Math.PI * 1.5) * 0.015); add('skeleton', 'bones', v); }
  for (let i = 0; i < 10; i++) for (const s of [1, -1]) {
    const y0 = 0.47 - i * 0.03, Rx = 0.1 + Math.sin((i + 2) / 13 * Math.PI) * 0.05, Rz = 0.085;
    const pts = []; for (let k = 0; k <= 12; k++) { const t = 0.15 + k / 12 * (i < 7 ? 2.75 : 2.2); pts.push(V(s * Rx * Math.sin(t), y0 - 0.04 * (t / Math.PI), -0.07 + Rz * (1 - Math.cos(t)) - 0.0)); }
    tube('skeleton', 'bones', boneM, pts, 0.006);
  }
  limb('skeleton', 'bones', boneM, V(0, 0.47, 0.1), V(0, 0.3, 0.1), 0.012); // sternum
  for (const s of [1, -1]) limb('skeleton', 'bones', boneM, V(0.02 * s, 0.52, 0.06), V(0.18 * s, 0.52, -0.01), 0.01); // clavicles
  const pel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 10, 32), boneM); pel.position.set(0, -0.02, -0.01); pel.rotation.x = Math.PI / 2.4; pel.scale.set(1.25, 1, 0.8); add('skeleton', 'bones', pel);
  for (const [a, b] of [[J.shL, J.elL], [J.shR, J.elR], [J.elL, J.wrL], [J.elR, J.wrR], [J.hpL, J.knL], [J.hpR, J.knR], [J.knL, J.anL], [J.knR, J.anR]]) limb('skeleton', 'bones', boneM, a, b, 0.016);
  for (const s of [1, -1]) { ell('skeleton', 'bones', boneM, V(0.1 * s, -0.47, 0.03), [0.025, 0.025, 0.012]); ell('skeleton', 'bones', boneM, V(0.1 * s, -0.885, 0.04), [0.03, 0.015, 0.08]); ell('skeleton', 'bones', boneM, V(0.385 * s, -0.07, 0.03), [0.025, 0.05, 0.01]); ell('skeleton', 'bones', boneM, V(0.17 * s, 0.44, -0.08), [0.06, 0.07, 0.01], [0, 0.3 * s, 0]); }

  // ---------- muscles ----------
  const musM = mat('muscles', 0xc2414b, { roughness: 0.6, transparent: true, opacity: 0.9 });
  for (const s of [1, -1]) {
    ell('muscles', 'muscles', musM, V(0.2 * s, 0.48, 0), [0.055, 0.06, 0.06]); // deltoid
    ell('muscles', 'muscles', musM, V(0.085 * s, 0.42, 0.085), [0.075, 0.05, 0.025]); // pectoral
    limb('muscles', 'muscles', musM, V(0.215 * s, 0.4, 0.015), V(0.27 * s, 0.27, 0.01), 0.038); // biceps
    limb('muscles', 'muscles', musM, V(0.285 * s, 0.2, 0), V(0.34 * s, 0.05, 0.02), 0.03); // forearm
    limb('muscles', 'muscles', musM, V(0.095 * s, -0.1, 0.035), V(0.1 * s, -0.4, 0.04), 0.06); // quadriceps
    limb('muscles', 'muscles', musM, V(0.1 * s, -0.52, -0.03), V(0.1 * s, -0.72, -0.025), 0.045); // calf
    ell('muscles', 'muscles', musM, V(0.08 * s, -0.04, -0.09), [0.075, 0.07, 0.05]); // gluteal
  }
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) ell('muscles', 'muscles', musM, V(0.035 * s, 0.25 - i * 0.07, 0.1), [0.032, 0.03, 0.015]); // abdominals

  // ---------- organs ----------
  const brainGeo = sphere(1, 96, 64); const p = brainGeo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + 0.035 * Math.sin(14 * x + 3) * Math.sin(16 * y) * Math.sin(12 * z + 1) + (Math.abs(x) < 0.06 && y > 0 ? -0.06 : 0); p.setXYZ(i, x * n, y * n, z * n); }
  brainGeo.computeVertexNormals();
  const brain = new THREE.Mesh(brainGeo, mat('brain', 0xf2a6b8, { roughness: 0.45 })); brain.position.set(0, 0.752, -0.008); brain.scale.set(0.074, 0.062, 0.088); add('organs', 'brain', brain);
  for (const s of [1, -1]) {
    ell('organs', 'eyes', mat('eyes', 0xf8fafc, { roughness: 0.2 }), V(0.034 * s, 0.712, 0.082), [0.015, 0.015, 0.015]);
    const ie = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 8, 20), mat('inner_ear', 0xfacc15)); ie.position.set(0.062 * s, 0.712, -0.005); ie.rotation.y = Math.PI / 2; add('organs', 'inner_ear', ie);
    ell('organs', 'ears', mat('ears', 0xe0b48f, { roughness: 0.6 }), V(0.098 * s, 0.712, -0.005), [0.012, 0.03, 0.02]);
    ell('organs', 'lungs', mat('lungs', 0xf4a3a8, { transparent: true, opacity: 0.85, roughness: 0.7 }), V(0.072 * s, 0.37, -0.005), [0.062, 0.118, 0.07]);
    ell('organs', 'kidneys', mat('kidneys', 0x9a3b3b), V(0.065 * s, 0.17, -0.06), [0.024, 0.044, 0.02], [0, 0, 0.25 * s]);
  }
  const heart = ell('organs', 'heart', mat('heart', 0xdc2626, { roughness: 0.4 }), V(0.022, 0.355, 0.045), [0.048, 0.06, 0.045], [0, 0, -0.5]);
  ell('organs', 'digestive', mat('digestive', 0x8b4a2b), V(-0.065, 0.235, 0.035), [0.1, 0.048, 0.075], [0, 0, 0.15]); // liver
  ell('organs', 'digestive', mats.digestive, V(0.065, 0.215, 0.05), [0.05, 0.042, 0.038], [0, 0, -0.5]); // stomach (shares material)
  const intPts = []; for (let i = 0; i <= 120; i++) { const t = i / 120; const ang = t * Math.PI * 9; intPts.push(V(Math.cos(ang) * 0.085 * (1 - t * 0.5), 0.15 - t * 0.12, 0.055 + Math.sin(ang) * 0.025)); }
  tube('organs', 'digestive', mat('digestive2', 0xe7a17a), intPts, 0.013); organMeshes.digestive.at(-1).material = mat('digestive2', 0xe7a17a);
  ell('organs', 'blood', mat('blood', 0x7c3aed), V(0.105, 0.24, -0.035), [0.022, 0.04, 0.02]); // spleen as immune/blood proxy

  // ---------- vessels ----------
  const art = mat('vessels', 0xef4444, { roughness: 0.4 }); const vein = mat('vessels_v', 0x3b82f6, { roughness: 0.4 });
  const aorta = [V(0.02, 0.38, 0.04), V(0.02, 0.45, 0.03), V(0.0, 0.475, -0.01), V(-0.005, 0.44, -0.045), V(0, 0.3, -0.045), V(0, 0.1, -0.04), V(0, -0.02, -0.02)];
  tube('vessels', 'vessels', art, aorta, 0.009);
  for (const s of [1, -1]) {
    tube('vessels', 'vessels', art, [V(0, -0.02, -0.02), V(0.06 * s, -0.08, 0.0), V(0.09 * s, -0.3, 0.02), V(0.1 * s, -0.6, 0.0), V(0.1 * s, -0.84, 0)], 0.006);
    tube('vessels', 'vessels', art, [V(0.008 * s, 0.47, 0.0), V(0.025 * s, 0.56, 0.02), V(0.03 * s, 0.66, 0.02)], 0.005);
    tube('vessels', 'vessels', art, [V(0.01 * s, 0.47, -0.01), V(0.12 * s, 0.5, -0.01), V(0.22 * s, 0.42, 0.0), V(0.3 * s, 0.2, 0.0), V(0.36 * s, 0.02, 0.02)], 0.005);
    tube('vessels', 'vessels', vein, [V(-0.025, -0.02, -0.01), V(0.06 * s - 0.01, -0.08, 0.01), V(0.085 * s, -0.3, 0.03), V(0.095 * s, -0.6, 0.01), V(0.095 * s, -0.84, 0.01)], 0.006);
    tube('vessels', 'vessels', vein, [V(-0.02, 0.45, 0.01), V(0.035 * s - 0.005, 0.56, 0.025), V(0.045 * s, 0.66, 0.015)], 0.005);
  }
  tube('vessels', 'vessels', vein, [V(-0.025, -0.02, -0.01), V(-0.03, 0.15, -0.02), V(-0.025, 0.33, 0.02), V(-0.02, 0.45, 0.01)], 0.009);
  organMeshes.vessels.forEach(m => { if (m.material === vein) m.userData.organ = 'vessels'; });

  // ---------- interaction ----------
  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
  let hovered = null, selected = null, highlights = {}, focusTarget = null;
  const pickables = () => Object.values(layers).filter(g => g.visible).flatMap(g => g.children);
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hits = ray.intersectObjects(pickables(), false);
    const inner = hits.find(h => h.object.userData.organ !== 'skin');
    return (inner || hits[0])?.object.userData.organ || null;
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; controls.autoRotate = false; });
  renderer.domElement.addEventListener('pointerup', e => { if (onSelect && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) { const id = pick(e); if (id) select(id, true); } downAt = null; });
  renderer.domElement.addEventListener('pointermove', e => { if (!onHover) return; const id = pick(e); if (id !== hovered) { hovered = id; renderer.domElement.style.cursor = id ? 'pointer' : 'grab'; } onHover?.(id, e); });
  renderer.domElement.addEventListener('pointerleave', () => { hovered = null; onHover?.(null); });

  function centerOf(id) { const box = new THREE.Box3(); (organMeshes[id] || []).forEach(m => box.expandByObject(m)); return box.getCenter(new THREE.Vector3()); }
  function select(id, fromClick = false) {
    selected = id; if (id && organMeshes[id]) { focusTarget = centerOf(id); controls.autoRotate = false; }
    if (fromClick) onSelect?.(id);
  }

  const COLORS = { caution: new THREE.Color(0xf5b942), warning: new THREE.Color(0xf97316), emergency: new THREE.Color(0xef4444) };
  const clock = new THREE.Clock(); let raf = 0;
  function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  function animate() {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const beat = 1 + 0.06 * Math.max(0, Math.sin(t * 7.5)) ** 8; heart.scale.set(0.048 * beat, 0.06 * beat, 0.045 * beat);
    const br = 1 + 0.035 * Math.sin(t * 1.4); (organMeshes.lungs || []).forEach(m => { m.scale.x = 0.062 * br; m.scale.z = 0.07 * br; });
    scan.position.y = -0.9 + ((t * 0.35) % 1) * 1.75; scan.material.opacity = 0.15 + 0.35 * Math.sin(((t * 0.35) % 1) * Math.PI);
    ring1.rotation.z = t * 0.2;
    for (const [id, m] of Object.entries(mats)) {
      const organ = id.replace(/(_v|_skull|2)$/, '');
      const lv = highlights[organ]; const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      if (organ === selected) m.emissive.setRGB(0.05, 0.35 + 0.15 * pulse, 0.45 + 0.15 * pulse);
      else if (lv && COLORS[lv]) m.emissive.copy(COLORS[lv]).multiplyScalar(0.25 + 0.45 * pulse);
      else if (organ === hovered) m.emissive.setRGB(0.08, 0.2, 0.28);
      else m.emissive.setRGB(0, 0, 0);
    }
    if (focusTarget) { controls.target.lerp(focusTarget, 0.08); if (controls.target.distanceTo(focusTarget) < 0.002) focusTarget = null; }
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    setLayer(name, on) { layers[name].visible = on; },
    setHighlights(map) { highlights = map || {}; },
    select: id => select(id, false),
    resetView() { focusTarget = V(0, 0.05, 0); camera.position.set(0.9, 0.35, 2.6); controls.autoRotate = true; selected = null; },
    zoomTo(id) { if (!organMeshes[id]) return; const c = centerOf(id); focusTarget = c; const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(c.clone().add(dir.multiplyScalar(0.9))); },
    organs: () => Object.keys(organMeshes),
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); scene.traverse(o => { o.geometry?.dispose(); }); Object.values(mats).forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove(); },
  };
}
