// ORBITAL companion — pre-mission content library.
// THE MUSIC LIBRARY — exactly the five recordings the crew provided (MP3 files). Nothing else is ever played:
// no generated music, no substitutes. Each song is matched to the moment it is meant for.
// A song plays from (1) the copy loaded in Profile & Data (stored in the browser → works offline anywhere), or
// (2) the MP3 file with exactly this name in ORBITAL's music/ folder (served by serve.py).
export const LIBRARY = [
  { id: 'count-on-me', title: 'Count on Me', artist: 'Bruno Mars', cat: 'sad', mood: 'Sad or lonely', file: 'Bruno Mars - Count on Me (Official Lyric Video).mp3' },
  { id: 'sky-full-of-stars', title: 'A Sky Full of Stars', artist: 'Coldplay', cat: 'stressed', mood: 'Stressed', file: '@coldplay - A Sky Full Of Stars (Lyrics).mp3' },
  { id: 'hall-of-fame', title: 'Hall of Fame', artist: 'The Script', cat: 'motivation', mood: 'Needs motivation', file: 'The Script - Hall Of Fame (Lyrics).mp3' },
  { id: 'firework', title: 'Firework', artist: 'Katy Perry', cat: 'happy', mood: 'Wants to feel happy', file: 'Katy Perry - Firework (Lyrics).mp3' },
  { id: 'piano-man', title: 'Piano Man', artist: 'Billy Joel', cat: 'relax', mood: 'Wants to relax', file: 'Billy Joel - Piano Man (Lyrics).mp3' },
];

// Example happy memories, as a family would record them before launch (demo content — replace in Profile & Data).
export const DEFAULT_MEMORIES = [
  { id: 'm1', from: 'Your family', text: 'Remember the morning before launch, when everyone squeezed into the kitchen and your youngest insisted on making pancakes shaped like rockets? Half of them were burnt, and you said they were the best thing you had ever eaten.' },
  { id: 'm2', from: 'Your best friend', text: 'Remember the summer road trip when the car broke down in the middle of nowhere, and instead of panicking we sat on the roof, ate cold pizza and counted shooting stars until the tow truck came? You said one day you would see those stars up close. Look at you now.' },
  { id: 'm3', from: 'Your mother', text: 'When you were seven you built a cardboard spaceship in the living room and refused to come out for dinner, because, as you said, astronauts eat in orbit. I am so proud of you. Dinner is still waiting when you get back.' },
  { id: 'm4', from: 'Your crewmates from training', text: 'Remember the survival training, when the tent collapsed in the rain at three in the morning, and you laughed so hard that the whole team started laughing too? That is the sound we will remember from this mission.' },
  { id: 'm5', from: 'Your partner', text: 'Remember our first dance in the kitchen, with no music, just the fridge humming? I still dance there sometimes, and I keep one step for you.' },
  { id: 'm6', from: 'Your old teacher', text: 'You once wrote in your school notebook: I will go further than anyone in my family has ever gone. I kept that page. You were right.' },
];

// ---------- Earth news ----------
// Daily news comes from real, dated articles fetched from public news feeds (see daily.js and serve.py).
// (The former built-in news archive was removed: daily news now comes only from real, dated feed articles.)
// Example personal messages (the family would record their own before / during the mission). Labelled "Example".
export const FAMILY_MESSAGES = [
  'Your family sends a photo update: the garden you planted before launch has its first tomatoes, and the neighbours keep asking how you are.',
  'Your hometown school painted your mission patch on the gym wall. The kids voted to name the school robot after your call sign.',
  'Your dog learned to open the back door by himself and is very proud of it. He still waits by your chair every evening.',
  'Your brother finished the city half-marathon in a personal best time and dedicated it to you.',
  'The local library opened a space corner with your mission timeline on the wall. Children leave paper stars with messages for you.',
  'Your niece lost her first tooth and asked if the tooth fairy can reach spacecraft. The family voted yes.',
];

// Sample PRE-MISSION MEDICAL BASELINE (recorded on Earth before launch) — demonstration values, not a real person.
export const EARTH_BASELINE = {
  recorded: 'Pre-flight medical examination, launch minus 30 days (sample data)',
  values: { hr: 64, rr: 14, skin_temp: 34.8, sleep_h: 7.4, sleep_latency: 12, sleep_wakes: 1, blink_rate: 15, perclos: 4, posture: 86, gaze_stability: 85, coordination: 87, reaction_ms: 280, move_speed: 82, puffiness: 0, social_min: 90, tension: 25, affect_low: 15, body_mass: 74.8 },
};

// Daily training programme for a small spacecraft cabin (resistance device / bungees, cycle ergometer, foot restraints).
// Aims: preserve muscle and bone, cardiovascular fitness and prepare the vestibular system for gravity changes.
export const EXERCISES = {
  shoulders: { name: 'Shoulder mobility circles', dose: '2 sets of 10 each direction', min: 4, part: 'shoulders & upper back', why: 'Keeps the shoulders mobile after hours of floating in a hunched position.', cue: 'Hold a handrail lightly. Draw slow, big circles with your shoulders — up, back and down. Then reverse.', mod: 'Smaller circles if anything pinches.' },
  stretch: { name: 'Gentle full-body stretch', dose: '6 stretches, 30 seconds each', min: 5, part: 'whole body', why: 'Restores mobility and eases stiffness without heavy load.', cue: 'Reach both arms overhead and lengthen your body, then gently pull each knee to your chest, then hug your shoulders and round your upper back. Breathe slowly in every position.', mod: 'Skip any stretch that causes pain.' },
  core: { name: 'Core activation (restrained)', dose: '3 rounds of 10 slow breaths', min: 4, part: 'deep core', why: 'Activates the deep stomach and back muscles that support the spine in weightlessness.', cue: 'With your feet in the restraints, breathe out slowly and gently draw your belly button toward your spine. Hold the tension while breathing normally for ten breaths.', mod: 'Lighter tension if your back hurts.' },
  ankles: { name: 'Gentle leg movements & ankle pumps', dose: '2 sets of 20', min: 3, part: 'legs & circulation', why: 'Keeps blood moving in the legs and keeps the joints mobile on low-energy days.', cue: 'Point and flex your feet slowly, then draw circles with your ankles, then bend and straighten each knee.', mod: 'Can be done in the sleeping bag or seat.' },
  squat: { name: 'Resistance-device squats', dose: '3 sets of 10', min: 8, part: 'legs & hips', why: 'Loads the leg bones and thigh muscles that lose mass fastest in weightlessness.', cue: 'Clip into the resistance harness, feet hip-width apart in the foot restraints. Lower slowly for three seconds, then push up through your heels. Keep your back straight.' , mod: 'Modification: if your knees or back hurt, do half-depth squats with lighter bungee load.' },
  deadlift: { name: 'Resistance-device deadlift', dose: '3 sets of 8', min: 8, part: 'spine & hips', why: 'Loads the spine and hips to slow bone loss and back stiffness.', cue: 'Hinge at the hips with a straight back, hold the bar close to your legs, then stand tall and squeeze your glutes at the top.' , mod: 'Modification: with any back pain, replace with hip bridges against the wall, no load.' },
  heel: { name: 'Heel raises with bungees', dose: '3 sets of 20', min: 5, part: 'calves & ankles', why: 'Calf muscles help push blood back to the heart — important when gravity returns.', cue: 'Rise onto your toes against the bungee tension, pause for one second at the top, and lower slowly.' , mod: 'Modification: single-leg version for more challenge; seated ankle pumps if calves are sore.' },
  row: { name: 'Band rows', dose: '3 sets of 12', min: 6, part: 'upper back & posture', why: 'Strengthens the upper back and counters the forward-curled posture of weightlessness.', cue: 'Anchor the band at chest height. Pull your elbows back, squeeze your shoulder blades together, and return slowly.' , mod: 'Modification: lighter band and slower tempo if your shoulders are stiff.' },
  press: { name: 'Handrail push-ups (isometric press)', dose: '4 holds of 20 seconds', min: 5, part: 'chest & arms', why: 'Keeps pushing strength for hatch operations and for walking with a load after landing.', cue: 'Brace your feet in the restraints, place your hands on the handrail, and push as hard as you can without moving for twenty seconds.' , mod: 'Modification: shorter 10-second holds if your wrists or shoulders hurt.' },
  plank: { name: 'Restrained plank', dose: '3 holds of 40 seconds', min: 4, part: 'core', why: 'A strong core protects the lower back, which often aches in space as the spine lengthens.', cue: 'Feet in the restraints, forearms on the handrail. Tighten your belly and keep your body in one straight line. Breathe steadily.' , mod: 'Modification: knees braced instead of feet, or 20-second holds.' },
  bike: { name: 'Cycle ergometer intervals', dose: '20 minutes: 2 min easy, 1 min hard, repeated', min: 20, part: 'heart & lungs', why: 'Keeps your heart and blood vessels conditioned for gravity and for the effort of a surface walk.', cue: 'Strap in, start at an easy pace for two minutes, then push hard for one minute. Repeat. You should be breathing hard but able to say a few words.' , mod: 'Modification: replace the hard minutes with steady easy pedalling if you feel exhausted or dizzy.' },
  gaze: { name: 'Gaze-stabilisation drill', dose: '3 rounds of 30 seconds', min: 4, part: 'balance system (inner ear)', why: 'Trains the inner ear and eyes to work together so you are less dizzy when gravity changes.', cue: 'Fix your eyes on a target at arm\'s length and turn your head side to side, while keeping the target sharp. Then repeat nodding up and down.' , mod: 'Modification: slow the head movement, or stop, if it makes you nauseous.' },
  balance: { name: 'Tandem-stance balance (with bungee load)', dose: '3 rounds of 30 seconds each side', min: 5, part: 'balance & legs', why: 'Prepares your balance for walking again on Mars or Earth.', cue: 'With bungees pulling you down to the floor, put one foot directly in front of the other and hold steady. Then try with your eyes closed, next to a handrail.' , mod: 'Modification: keep one hand on the handrail and eyes open.' },
  lunge: { name: 'Bungee-loaded lunges', dose: '3 sets of 8 each leg', min: 7, part: 'legs & balance', why: 'Builds single-leg strength and control needed for walking on uneven ground.', cue: 'Step forward, lower your back knee toward the floor, then push back up. Keep your front knee over your ankle.' , mod: 'Modification: shorter steps and no bungee load if your knees hurt.' },
};
export const GENTLE = ['shoulders', 'stretch', 'core', 'ankles'];
// Rotating daily plans (index by mission day). Pre-landing plans add more balance and gaze work.
export const PLANS = [
  { title: 'Lower body & bone loading', keys: ['shoulders', 'squat', 'heel', 'plank', 'bike'] },
  { title: 'Back, posture & heart', keys: ['stretch', 'deadlift', 'row', 'press', 'bike'] },
  { title: 'Balance & gravity readiness', keys: ['lunge', 'balance', 'gaze', 'heel', 'bike'] },
  { title: 'Strength circuit', keys: ['shoulders', 'squat', 'row', 'press', 'core'] },
  { title: 'Cardio & core', keys: ['bike', 'plank', 'gaze', 'heel'] },
];
