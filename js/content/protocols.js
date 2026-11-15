// ORBITAL — preloaded emergency reference cards.
// SCOPE: summaries of widely published GENERAL first-aid / basic-life-support guidance (AHA, ERC, American Red Cross,
// AHA/ASA stroke guidance). They are NOT official NASA or mission medical protocols. In a real mission they must be
// replaced by the vehicle's approved medical checklists and directed by the Crew Medical Officer / flight surgeon.
// No medication doses are given.
export const PROTOCOL_SCOPE = 'Reference summary of general first-aid principles (AHA 2020 BLS, ERC 2021, American Red Cross, AHA/ASA BE-FAST). Not an official NASA protocol. Always follow your vehicle\'s approved medical checklists and the direction of the Crew Medical Officer (CMO) / flight surgeon.';

export const PROTOCOLS = [
  { id: 'arrest', title: 'Unresponsive / not breathing normally', organs: ['heart', 'lungs', 'brain'], when: 'No response to voice or touch AND no normal breathing (gasping is not normal).',
    steps: ['Make the scene safe; alarm the crew loudly and call the CMO.', 'Check for normal breathing for no more than 10 seconds.', 'If not breathing normally: start chest compressions immediately — centre of chest, 100–120 per minute, about 5–6 cm deep, allowing full recoil.', 'Use the vehicle\'s microgravity CPR restraint/positioning method exactly as trained.', 'Attach the AED as soon as it is available and follow its voice prompts.', 'Continue until the person breathes normally, the CMO takes over, or you are directed to stop.', 'Notify mission control / flight surgeon as soon as communication allows.'],
    dont: ['Do not delay compressions to look for a pulse if you are not trained to do so.'], src: 'AHA 2020 Guidelines for CPR & ECC; ERC Guidelines 2021 (BLS).' },
  { id: 'chest', title: 'Chest pain or pressure (possible heart problem)', organs: ['heart', 'vessels'], when: 'Pressure, squeezing or pain in the chest, possibly spreading to arm, jaw, back; with breathlessness, sweating, nausea or light-headedness.',
    steps: ['Stop all activity and rest in a stable, restrained position.', 'Alert the CMO and crew immediately.', 'Record time of onset and symptoms; measure HR, BP and SpO₂ with onboard devices.', 'Obtain an ECG if the vehicle kit has one and you are trained.', 'Follow the vehicle cardiac checklist; give medication only as specified by that checklist / flight surgeon.', 'Be ready to start CPR if the person becomes unresponsive.'],
    dont: ['Do not continue exercise or EVA preparation.', 'Do not ignore symptoms that come and go.'], src: 'AHA heart-attack warning signs; American Red Cross First Aid.' },
  { id: 'stroke', title: 'Stroke warning signs (BE-FAST)', organs: ['brain', 'eyes', 'vessels'], when: 'Sudden: Balance loss · Eyes (vision loss/double vision) · Face drooping · Arm/leg weakness · Speech difficulty · Time — note it. Also sudden severe headache or confusion.',
    steps: ['Note the exact time symptoms started (or last known well).', 'Alert the CMO and mission control immediately — this is time-critical.', 'Keep the person safe and restrained; monitor breathing and responsiveness.', 'Record vital signs and repeat BE-FAST checks every few minutes.', 'Follow the vehicle neurological emergency checklist.'],
    dont: ['Do not give food, drink or medication by mouth unless directed.', 'Do not wait to see if symptoms improve.'], src: 'AHA/ASA BE-FAST stroke recognition.' },
  { id: 'breathing', title: 'Severe breathing difficulty / possible toxic atmosphere', organs: ['lungs', 'blood'], when: 'Struggling to breathe, unable to speak full sentences, blue lips, SpO₂ < 90%, or smoke / odour / ammonia / chemical alarm.',
    steps: ['If an atmosphere hazard is suspected, follow the vehicle\'s fire/toxic-atmosphere emergency procedure first (masks/respirators, isolate, relocate).', 'Alert the CMO and crew.', 'Help the person into the most comfortable upright position; loosen tight clothing.', 'Measure SpO₂ and breathing rate; use oxygen from the medical kit only as directed by the vehicle checklist.', 'Monitor continuously; be ready to start CPR.'],
    dont: ['Do not remove respiratory protection in a contaminated atmosphere.'], src: 'General first aid (American Red Cross); vehicle emergency procedures take precedence.' },
  { id: 'anaphylaxis', title: 'Severe allergic reaction', organs: ['lungs', 'skin', 'vessels'], when: 'Swelling of face/lips/tongue/throat, hives, wheeze, breathing difficulty, faintness — often minutes after a trigger.',
    steps: ['Alert the CMO immediately.', 'If the person has a prescribed adrenaline (epinephrine) auto-injector or the medical kit checklist directs it, assist with its use exactly as instructed.', 'Position: sitting up if breathing is difficult; lying with legs raised if faint (as feasible in microgravity).', 'Monitor breathing, HR, BP and SpO₂; be ready for CPR.', 'Note the suspected trigger.'],
    dont: ['Do not leave the person alone.'], src: 'ERC First Aid 2021; American Red Cross First Aid.' },
  { id: 'bleeding', title: 'Severe bleeding', organs: ['vessels', 'blood', 'skin'], when: 'Blood spurting or flowing continuously, or soaking through dressings.',
    steps: ['Wear gloves from the medical kit; alert the CMO.', 'Apply firm, direct pressure with a dressing.', 'If blood soaks through, add more dressing on top and keep pressing.', 'For life-threatening limb bleeding not controlled by pressure, apply a tourniquet if trained and available.', 'Contain free-floating blood with absorbent material to protect crew and equipment.', 'Monitor for shock: pale, cold, fast pulse, confusion.'],
    dont: ['Do not remove soaked dressings.'], src: 'ACS Stop the Bleed; ERC First Aid 2021.' },
  { id: 'head', title: 'Head injury', organs: ['brain', 'bones'], when: 'Impact to the head, especially with loss of consciousness, confusion, vomiting or worsening headache.',
    steps: ['Alert the CMO; keep the person still and restrained.', 'Check responsiveness, breathing, pupils and orientation; note times.', 'Re-check regularly; record any change.', 'Escalate immediately for: worsening headache, repeated vomiting, seizures, increasing drowsiness, unequal pupils, weakness or clear fluid from nose/ears.'],
    dont: ['Do not leave the person unobserved for the next several hours.'], src: 'General first aid (American Red Cross); NICE head-injury red flags.' },
  { id: 'eye', title: 'Chemical or particle in the eye', organs: ['eyes'], when: 'Chemical splash, dust or debris in the eye; pain, redness, tearing.',
    steps: ['Use the vehicle eyewash kit: flush the eye with clean water continuously for at least 15 minutes.', 'Remove contact lenses if easily possible.', 'Alert the CMO; record the substance involved.', 'Cover the eye loosely if advised and arrange examination.'],
    dont: ['Do not rub the eye.'], src: 'American Red Cross First Aid; OSHA eyewash guidance.' },
  { id: 'burn', title: 'Burns', organs: ['skin'], when: 'Thermal, electrical or chemical burn.',
    steps: ['Ensure the source is isolated (electrical power off, fire procedure if needed).', 'Cool the burn with cool clean water for 20 minutes (as feasible with vehicle water system).', 'Remove jewellery/tight items near the area.', 'Cover loosely with a clean non-adhesive dressing.', 'Alert the CMO for large, deep, facial, hand or electrical burns.'],
    dont: ['Do not apply ice, creams or burst blisters.'], src: 'ERC First Aid 2021; American Red Cross.' },
  { id: 'radiation', title: 'Radiation alert (solar particle event)', organs: ['blood', 'skin', 'eyes'], when: 'Dosimeter / space-weather alert of elevated radiation, or high dose-rate reading.',
    steps: ['Follow the mission radiation shelter procedure immediately (move to the designated shielded area).', 'Keep personal dosimeter on; record time in and out of shelter.', 'Report symptoms such as nausea, vomiting, fatigue or skin redness to the CMO.', 'Record exposure in ORBITAL (Mission Environment) for long-term tracking.'],
    dont: ['Do not leave shelter until the all-clear is given.'], src: 'NASA space-weather operations concept (general description); mission flight rules apply.' },
  { id: 'abdominal', title: 'Severe abdominal or flank pain', organs: ['digestive', 'kidneys'], when: 'Severe or worsening belly pain, pain radiating from back to groin, fever, vomiting, blood in urine.',
    steps: ['Stop activity and rest.', 'Alert the CMO; record location, onset, severity, fever and urine changes.', 'Measure temperature, HR and BP.', 'Follow the vehicle abdominal-pain checklist; nothing by mouth unless directed.'],
    dont: ['Do not take pain medication unless directed — it can mask important signs.'], src: 'General first aid principles.' },
  { id: 'crisis', title: 'Mental-health crisis', organs: ['brain'], when: 'Thoughts of self-harm or suicide, severe agitation, disorientation, or behaviour that could endanger self or crew.',
    steps: ['Stay with the person; speak calmly and listen without judgement.', 'Alert the CMO and commander.', 'Make the environment safe (secure hazardous items).', 'Request an urgent private conference with the flight surgeon / psychological support team.', 'Keep observing until support is in place.'],
    dont: ['Do not leave the person alone if they may be at risk.'], src: 'Mental Health First Aid principles.' },
];

export const RED_FLAGS = [
  { id: 'unresponsive', label: 'Unresponsive / not breathing normally', group: 'Critical' },
  { id: 'chest_pain', label: 'Chest pain or pressure', group: 'Heart & breathing' },
  { id: 'arm_jaw', label: 'Pain spreading to arm, jaw or back', group: 'Heart & breathing' },
  { id: 'sweating', label: 'Cold sweat / clammy', group: 'Heart & breathing' },
  { id: 'sob_severe', label: 'Severe shortness of breath', group: 'Heart & breathing' },
  { id: 'palpitations', label: 'Racing / irregular heartbeat', group: 'Heart & breathing' },
  { id: 'fainting', label: 'Fainting / near-fainting', group: 'Heart & breathing' },
  { id: 'face_droop', label: 'Face drooping on one side', group: 'Brain' },
  { id: 'arm_weak', label: 'Sudden arm/leg weakness or numbness', group: 'Brain' },
  { id: 'speech', label: 'Slurred or confused speech', group: 'Brain' },
  { id: 'vision_loss', label: 'Sudden vision loss / double vision', group: 'Brain' },
  { id: 'worst_headache', label: 'Sudden, severe "worst ever" headache', group: 'Brain' },
  { id: 'confusion', label: 'New confusion / disorientation', group: 'Brain' },
  { id: 'balance', label: 'Sudden loss of balance', group: 'Brain' },
  { id: 'head_injury', label: 'Head injury', group: 'Injury' },
  { id: 'vomiting', label: 'Repeated vomiting', group: 'Injury' },
  { id: 'bleeding', label: 'Bleeding that will not stop', group: 'Injury' },
  { id: 'burn', label: 'Burn', group: 'Injury' },
  { id: 'eye_chem', label: 'Chemical/particle in eye', group: 'Injury' },
  { id: 'throat_swell', label: 'Swelling of lips/tongue/throat', group: 'Allergy & environment' },
  { id: 'hives', label: 'Widespread hives / itching', group: 'Allergy & environment' },
  { id: 'smoke', label: 'Smoke, odour or atmosphere alarm', group: 'Allergy & environment' },
  { id: 'rad_alarm', label: 'Radiation alarm / SPE warning', group: 'Allergy & environment' },
  { id: 'abd_severe', label: 'Severe abdominal or flank pain', group: 'Other' },
  { id: 'fever_high', label: 'High fever with stiff neck, rash or confusion', group: 'Other' },
  { id: 'self_harm', label: 'Thoughts of self-harm', group: 'Other' },
];

/** Deterministic, instant triage-support rules. Returns {level, findings:[{level,text,protocol}]} */
export function triage(sel, vit = {}) {
  const has = id => sel.includes(id); const F = [];
  const add = (level, text, protocol) => F.push({ level, text, protocol });
  if (has('unresponsive')) add('emergency', 'Unresponsive or not breathing normally — start basic life support now.', 'arrest');
  if (has('chest_pain') && (has('arm_jaw') || has('sweating') || has('sob_severe') || has('fainting') || has('palpitations'))) add('emergency', 'Chest pain with associated warning signs — possible heart emergency.', 'chest');
  else if (has('chest_pain')) add('warning', 'Chest pain — treat as potentially serious until assessed.', 'chest');
  const strokeSigns = ['face_droop', 'arm_weak', 'speech', 'vision_loss', 'balance', 'worst_headache', 'confusion'].filter(has);
  if (strokeSigns.length) add('emergency', `Possible stroke warning sign(s) (BE-FAST): ${strokeSigns.length} present — note the time of onset.`, 'stroke');
  if (has('throat_swell') || (has('hives') && (has('sob_severe') || has('fainting')))) add('emergency', 'Signs of a severe allergic reaction.', 'anaphylaxis');
  if (has('sob_severe') || (vit.spo2 && vit.spo2 < 90)) add('emergency', `Severe breathing difficulty${vit.spo2 ? ` (SpO₂ ${vit.spo2}%)` : ''}.`, 'breathing');
  if (has('smoke')) add('emergency', 'Possible atmosphere hazard — follow vehicle emergency procedure first.', 'breathing');
  if (has('bleeding')) add('emergency', 'Uncontrolled bleeding.', 'bleeding');
  if (has('head_injury') && (has('vomiting') || has('confusion') || has('fainting'))) add('emergency', 'Head injury with red-flag signs.', 'head');
  else if (has('head_injury')) add('warning', 'Head injury — observe closely for red flags.', 'head');
  if (has('eye_chem')) add('warning', 'Eye exposure — flush immediately.', 'eye');
  if (has('burn')) add('warning', 'Burn — cool and cover.', 'burn');
  if (has('rad_alarm')) add(has('vomiting') ? 'emergency' : 'warning', 'Radiation alert — follow shelter procedure.', 'radiation');
  if (has('abd_severe')) add('warning', 'Severe abdominal/flank pain needs medical assessment.', 'abdominal');
  if (has('fever_high') || (vit.temp && vit.temp >= 39.5)) add('warning', 'High fever with warning signs.', 'abdominal');
  if (has('self_harm')) add('emergency', 'Risk to personal safety — do not stay alone; get support now.', 'crisis');
  if (vit.hr && (vit.hr > 150 || vit.hr < 40)) add('warning', `Heart rate ${vit.hr} bpm is far outside typical resting range.`, 'chest');
  if (vit.sys && (vit.sys < 90 || vit.sys >= 180)) add('warning', `Blood pressure ${vit.sys} mmHg systolic is outside safe range.`, 'chest');
  if (has('palpitations') && !has('chest_pain')) add('warning', 'Palpitations — measure HR/ECG and inform CMO.', 'chest');
  if (has('vomiting') && !F.length) add('warning', 'Repeated vomiting — hydration and assessment needed.', 'abdominal');
  if (has('hives') && !has('throat_swell')) add('warning', 'Hives — watch for breathing or swelling.', 'anaphylaxis');
  if (has('fainting') && !F.some(f => f.protocol === 'chest')) add('warning', 'Fainting — lie/restrain safely, check vitals.', 'chest');
  const order = { emergency: 0, warning: 1 };
  F.sort((a, b) => order[a.level] - order[b.level]);
  return { level: F[0]?.level || (sel.length ? 'warning' : 'ok'), findings: F };
}
