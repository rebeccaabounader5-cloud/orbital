// ORBI companion — conversation engine.
// Runs fully offline. Replies are composed from several independent parts (acknowledgement, reflection, support,
// follow-up question) chosen so the same sentence is not reused until the whole pool has been used, and personalised
// with what the astronaut has said earlier in the mission (people they mentioned, topics, today's observations).
// If the browser offers an ON-DEVICE language model (Chrome built-in AI "LanguageModel"), ORBITAL uses it for even
// more natural replies, with the rule-based engine as the fallback. Safety-critical messages are always rule-based.
import { state, missionDay, stageFor } from '../store.js';
import { assess, companionMem, saveMem } from './wellbeing.js';
import { DEFAULT_MEMORIES } from './content.js';
import { DB } from '../db.js';
import { addFact, facts } from '../ai/brain.js';

// ---------- non-repeating picker ----------
const used = new Map();
function pick(key, arr) {
  let u = used.get(key); if (!u || u.size >= arr.length) { u = new Set(); used.set(key, u); }
  const free = arr.map((_, i) => i).filter(i => !u.has(i));
  const i = free[Math.floor(Math.random() * free.length)]; u.add(i);
  return typeof arr[i] === 'function' ? arr[i]() : arr[i];
}

// ---------- context ----------
const ctx = { name: '', topic: null, pending: null, turns: 0, people: [], lastUser: '', lastIntent: null, sad: 0, topicTurns: {} };
facts().then(l => { for (const f of l) { const m = f.match(/(?:has a|mentioned their) ([a-z ]+?)(?: called|$)/); if (m && !ctx.people.includes(m[1])) ctx.people.push(m[1]); const n = f.match(/likes to be called (\w+)/); if (n) ctx.name = n[1]; } }).catch(() => {});
const first = () => { if (ctx.name) return ctx.name; const n = (state.profile?.name || '').split(' ')[0] || ''; return /^demo$/i.test(n) ? '' : n; };
const PEOPLE = ['daughter', 'son', 'wife', 'husband', 'partner', 'mom', 'mum', 'mother', 'dad', 'father', 'brother', 'sister', 'kids', 'children', 'family', 'friend', 'best friend', 'girlfriend', 'boyfriend', 'grandma', 'grandmother', 'grandpa', 'grandfather', 'dog', 'cat', 'niece', 'nephew'];
function learn(t) {
  const s = t.toLowerCase();
  for (const p of PEOPLE) if (new RegExp(`\\bmy ${p}\\b`).test(s) && !ctx.people.includes(p)) { ctx.people.push(p); const nmd = t.match(new RegExp(`my ${p},? (?:called |named )?([A-Z][a-z]+)`)); addFact(nmd ? `has a ${p} called ${nmd[1]}` : `mentioned their ${p}`); }
  const nm = s.match(/\bmy name is (\w+)|\bcall me (\w+)/); if (nm) { ctx.name = (nm[1] || nm[2]).replace(/^./, c => c.toUpperCase()); addFact('likes to be called ' + ctx.name); }
}
const person = () => ctx.people.length ? 'your ' + ctx.people[ctx.people.length - 1] : null;
function feeling(t) {
  const m = t.toLowerCase().match(/\bi(?:'m| am| feel| feel like| have been| was|'ve been)\s+(?:so |really |very |a bit |kind of |pretty |just )?([a-z' ]{3,40}?)(?:[.,!?]|$| and | but | because )/);
  return m ? m[1].trim() : null;
}

// ---------- intents ----------
const INTENTS = [
  ['crisis', /suicid|kill myself|end my life|end it all|hurt myself|self.?harm|want to die|don'?t want to (live|be here)|no reason to live|better off without me/],
  ['badday', /(terrible|awful|horrible|rough|bad|worst|crappy|shitty|long) day|day (has been|was) (terrible|awful|horrible|rough|bad)|today (sucks|sucked|was (terrible|awful|bad|rough))/],
  ['data', /how am i doing|how did i sleep|my (data|sleep|stats|status)|what do you see|what have you noticed|am i ok/],
  ['heart', /heart ?rate|my pulse|show me my heart|how fast is my heart/],
  ['start_ex', /\b(start|begin)\b.*\b(exercise|workout|training|session)\b|let'?s (exercise|work ?out|train)/],
  ['exercise', /(don'?t|do not) (really )?(feel like|want to) (exercis|work ?out|train|do (my|the) (exercise|workout))|skip(ping)? (my |the |today'?s )?(exercise|workout|training)|no (exercise|workout) today|too tired to (exercise|train|work ?out)|why didn'?t i exercise/],
  ['company', /someone to talk to|keep me company|talk to me|need (a friend|company|to talk)|can we (talk|chat)|chat with me|just talk/],
  ['exhausted', /burn(ed|t)? ?out|can'?t (do this|take (it|this)|keep going)( anymore)?|emotionally (drained|exhausted)|running on empty|so drained|completely exhausted|at my limit|i'?m done with (this|everything)/],
  ['stop_music', /\b(stop|pause|turn off)\b.*\b(music|song|it)\b|^stop$/],
  ['music', /\b(play|put on|hear|listen to)\b.*\b(music|song|something|tune)\b|\bmusic\b|\bsong\b/],
  ['memory', /\bmemor(y|ies)\b|remind me of (home|something)|something (happy|nice) from home/],
  ['news', /\bnews\b|what'?s (new|happening) (on|back on|at) (earth|home)|news from earth/],
  ['relax', /\brelax\b|breath(e|ing) exercise|calm (me )?down|help me (calm|breathe)|meditat/],
  ['body', /\b(pain|hurt|hurts|ache|aching|headache|dizzy|nause|sick|bleed|chest)\b/],
  ['sleep', /\bsleep|insomnia|can'?t sleep|awake all night|nightmare|tired|exhausted|no energy|drained/],
  ['lonely', /\blonely|alone|isolated|no one to talk|nobody (to talk|understands|cares)|left out/],
  ['food', /\b(food|eat|ate|eating|dinner|lunch|breakfast|meal|cook|pizza|coffee|hungry|chocolate|taste)\b/],
  ['miss', /\bmiss(ing)?\b|homesick|far from home|far away|my (family|kids|daughter|son|wife|husband|partner|mom|mum|dad|mother|father)/],
  ['sad', /\bsad|down|depress|hopeless|empty|cry|crying|tears|low\b|heavy|numb|worthless|miserable|unhappy|not okay|not ok/],
  ['anxious', /\bstress|anxious|anxiety|worried|worry|overwhelm|pressure|panic|nervous|scared|afraid|fear|terrified/],
  ['angry', /\bangry|irritat|annoyed|furious|mad at|conflict|argument|fight|frustrat|crewmate|commander/],
  ['bored', /\bbored|boring|monoton|same every|groundhog|pointless|meaningless|nothing to do/],
  ['earth', /\b(earth|the window|the view|the stars|planet|mars|the moon|sunrise|sunset)\b/],
  ['hobby', /\b(hobb\w*|reading|book|film|movie|series|guitar|piano|paint|draw|photo\w*|chess|game|puzzle|music i like|favou?rite (song|band|singer))\b/],
  ['funfact', /tell me something|interesting|fun fact|surprise me|tell me a (story|joke)|\bjoke\b|make me laugh/],
  ['future', /when i get (back|home)|after the mission|first thing (i|when)|the future|my plans|when this is over/],
  ['proud', /\bproud|did it|managed to|finished|accomplished|nailed|succeeded/],
  ['good', /\b(good|great|fine|okay|ok|happy|well|better|awesome|amazing|fantastic|excited)\b/],
  ['who', /who are you|what are you|are you (real|human|a robot|an ai)|your name/],
  ['thanks', /\bthank|thx|appreciate/],
  ['bye', /\b(bye|good ?night|see you|talk later|that'?s all|gotta go|i'?m done)\b/],
  ['hello', /^(hi|hello|hey|good (morning|afternoon|evening)|orbital|orbi)\b/],
  ['yes', /^(yes|yeah|yep|sure|ok(ay)?|please|go ahead|do it|why not|alright|sounds good)\b/],
  ['no', /^(no|nope|nah|not now|maybe later|i'?m fine|no thanks)\b/],
];
function intentOf(t) { const s = t.toLowerCase().trim(); for (const [k, re] of INTENTS) if (re.test(s)) return k; return 'open'; }

// ---------- reply bank ----------
const B = {
  hello: {
    a: [() => `Hey${first() ? ' ' + first() : ''}. I'm right here.`, () => `Hi${first() ? ', ' + first() : ''}. It's good to hear your voice.`, 'Hello. I was hoping you\'d stop by.', () => `Hey there. Day ${missionDay() || ''} out here, and you're still my favourite part of it.`, 'Hi. No rush — I have all the time in the universe.'],
    q: ['How are you, honestly?', 'What\'s on your mind today?', 'How has today been treating you?', 'What would feel good to talk about?', 'How\'s your heart doing today — not the numbers, you.'],
  },
  open: {
    a: [() => ctx.lastUser.length > 60 ? 'Thank you for telling me all of that.' : 'Mm, I hear you.', 'I\'m listening.', 'Okay. I\'m with you.', 'That makes sense to me.', 'Go on — I\'m here.', 'I appreciate you sharing that with me.', 'Mm-hm.'],
    r: [() => { const f = feeling(ctx.lastUser); return f ? `It sounds like you're feeling ${f}.` : ''; }, () => '', () => ''],
    q: ['What does that feel like for you right now?', 'Tell me a little more about that?', 'When did you start noticing that?', 'What part of that matters most to you?', 'How long has that been on your mind?', 'What would help, even a little?', 'If a friend told you that, what would you say to them?', 'What happened just before you started thinking about this?'],
  },
  lonely: {
    a: ['That sounds hard. It\'s a long way from everyone out here.', 'Loneliness out here is real. Being millions of kilometres from everyone you love isn\'t something people were built for.', 'That feeling of being alone — I want you to know you\'re not imagining it, and you\'re not weak for having it.', 'Thank you for saying that out loud. Loneliness gets heavier when it stays quiet.', 'I can\'t hug you, but I can stay with you right now. I\'m not going anywhere.'],
    s: [() => person() ? `Earlier you mentioned ${person()}. Would recording a message for them help you feel closer tonight?` : 'Sometimes recording a short message for someone at home makes the distance feel a bit smaller, even if the answer takes a while.', 'Your crew might be feeling some of the same thing. Sharing a meal or a film tonight could be good for all of you.', 'Every message you send home arrives. You are still part of their day, even from here.', 'You don\'t have to fix the feeling. Just letting it be here, with me, is enough for now.'],
    q: ['Has it been creeping up over the last few days, or did something set it off?', 'Who do you wish you could talk to right now?', 'What do you miss most about being around people at home?', 'When did you last really laugh with someone on board?', 'Is it more missing someone in particular, or feeling alone even when the crew is around?'],
    offer: ['song:sad', 'memory'],
  },
  miss: {
    a: [() => /earth|home\b/.test(ctx.lastUser.toLowerCase()) ? 'Yeah, I imagine there are days when it feels especially far away.' : person() ? `Of course you miss ${person()}. That says a lot about how much they mean to you.` : 'Missing them means you have people worth missing. That\'s a beautiful thing, even when it hurts.', 'Home feels very far tonight, doesn\'t it?', 'That ache of missing home — every long-duration crew has felt it. You\'re in good company.', 'They\'re missing you too. I\'m sure of that.'],
    s: ['Would it help to think about the first thing you\'ll do together when you\'re back?', 'Some astronauts keep a small ritual — a photo, a song, a moment at the window — to feel connected. Do you have one?', 'Your family recorded some memories for you before launch. I can share one if you\'d like.', () => `There's a news packet from Earth today, and some of it is from home.`],
    q: [() => !/earth|home\b/.test(ctx.lastUser.toLowerCase()) && person() ? `What do you miss most about ${person()} right now?` : 'Is there something in particular you\'ve been missing lately, or is it more that you just wish you could be back home for a while?', () => /earth|home\b/.test(ctx.lastUser.toLowerCase()) ? 'What do you picture first when you think of home?' : 'What would they say to you if they were here right now?', 'What\'s the first thing you\'d do if you could be home for a day?', () => /earth|home\b/.test(ctx.lastUser.toLowerCase()) ? 'Is it the place itself, or the people and the little routines?' : 'Tell me about them?'],
    offer: ['song:sad', 'memory'],
  },
  sad: {
    a: [() => `I'm really glad you told me${first() ? ', ' + first() : ''}. Feeling low out here doesn't make you any less strong.`, 'That sounds heavy. You don\'t have to carry it by yourself.', 'I\'m sorry it feels this way right now. I\'m here, and I\'m staying.', 'Thank you for trusting me with that. It takes courage to say.', 'Some days are just grey, even in space. That\'s allowed.'],
    s: ['Low moods tend to come in waves. This one is real, but it isn\'t forever.', 'Sometimes the smallest things help a little — some water, a few minutes at the window, a song you love.', 'Your crew and the flight surgeon are on your side. Talking to one of them isn\'t a burden — it\'s what they\'re there for.', 'You\'ve already done something important by naming it.'],
    q: ['Is this a new feeling, or has it been building for a few days?', 'What has been the hardest part of today?', 'Is there anything that made today even slightly better?', 'Would you like to talk about it, or would you rather I just keep you company for a bit?'],
    offer: ['song:sad', 'memory'], escalate: 'If this low feeling has lasted more than a couple of weeks, or keeps getting heavier, please talk to the crew medical officer or ask for a private call with the flight surgeon. You deserve real support.',
  },
  anxious: {
    a: ['That sounds like a lot of pressure on your shoulders.', 'Feeling on edge out here makes complete sense — everything matters a bit more in space.', 'Okay. Let\'s slow down together for a moment.', 'I hear the worry in that. You\'re safe right now, in this moment.'],
    s: ['Try this with me: breathe in for four, hold for four, out for four. Just once. Notice your shoulders drop a little.', 'When everything feels big, picking one small task you can control right now often helps.', 'Worry tries to live in the future. Right now, the ship is stable and you are okay.', 'It\'s okay to tell the crew or Mission Control that the workload is too much. That\'s good operations, not weakness.'],
    q: ['What exactly is worrying you the most?', 'Is it something coming up, or something that already happened?', 'On a scale from one to ten, how intense is it right now?', 'What usually helps you when you feel like this on Earth?'],
    offer: ['song:stressed', 'relax'],
  },
  angry: {
    a: ['That sounds really frustrating.', 'Small crew, small space, long mission — friction is almost guaranteed. Your frustration is valid.', 'I get why that would get under your skin.', 'It\'s okay to be angry. Let\'s just make sure it doesn\'t eat your whole day.'],
    s: ['Sometimes a short workout or a few minutes alone helps the intensity drop before you talk to them.', 'When you\'re ready, describing how it affected you — rather than what they meant — often opens the conversation.', 'Most conflicts on long missions are about fatigue and tight space, not about people being bad.', 'You don\'t have to solve it tonight.'],
    q: ['What happened?', 'What do you need from them?', 'How would you like this to look by tomorrow?', 'Has this happened before, or is it new?'],
  },
  bored: {
    a: ['Monotony is one of the toughest parts of a long mission. You\'re not alone in that.', 'Same walls, same schedule, same view — I understand.', 'Ah, the long cruise days. They can blur together.'],
    s: ['What about a tiny personal project — photographing one detail of the ship every day, or learning a few words of a new language?', 'Changing even one small thing in your routine can make the day feel new.', 'You could challenge a crewmate to something silly — floating paper planes, a chess tournament, a cooking contest.', 'Looking out of the window at where we are, right now, is something only a handful of humans have ever done.'],
    q: ['What used to make your weekends fun on Earth?', 'What\'s something you\'ve always wanted to learn?', 'What part of the day drags the most?'],
    offer: ['song:motivation', 'news'],
  },
  sleep: {
    a: ['Sleep in space is genuinely hard — your body has no up or down, and the light is all wrong.', 'Being exhausted makes everything else harder. I\'m sorry.', 'Rough night?'],
    s: [() => { const a = assess(); return a.sleep ? `From what I saw last night, you slept about ${a.sleep.h.toFixed(1)} hours${a.sleep.latency >= 30 ? ` and it took you around ${Math.round(a.sleep.latency)} minutes to fall asleep` : ''}${a.sleep.discomfort ? ', and you were moving around a lot — you looked uncomfortable' : ''}.` : 'I don\'t have a full night of observations yet.'; }, 'Dimming the lights an hour before sleep, a cooler sleeping bag and earplugs help many crews.', 'Slow breathing — in for four, out for six — can quiet the mind before sleep.', 'If it keeps happening, the crew medical officer has options. You don\'t have to push through it alone.'],
    q: ['Is it your thoughts keeping you awake, or something physical?', 'What time did you get to your sleep station?', 'Do you feel rested at all today?'],
    offer: ['song:relax', 'relax'],
  },
  proud: {
    a: ['That\'s brilliant! You should be proud.', 'Yes! I love hearing that.', 'Look at you. That\'s a real win.', 'That deserves a moment. Well done.'],
    s: ['Remember this feeling for the harder days.', 'Wins out here count double.', 'Your family would be cheering right now.'],
    q: ['How did you pull it off?', 'What was the best part?', 'Who will you tell first back home?'],
  },
  good: {
    a: ['That\'s really good to hear.', 'Love that.', 'I\'m glad. Seriously.', 'Ah, that makes my circuits happy.', 'Good. You deserve good days.'],
    s: ['Noticing what made today better makes it easier to repeat on harder days.', 'Days like this are worth remembering.', ''],
    q: ['What made today good?', 'What are you looking forward to tomorrow?', 'Anything fun happen on board?'],
  },
  body: {
    a: ['If something hurts, let\'s take it seriously.'],
    s: ['Go to the Virtual Body and tell me where it hurts — I\'ll show you on the model and talk you through it.', 'If it\'s sudden or severe, tell me now and open the Emergency Center, or alert the crew right away.'],
    q: [''],
  },
  company: {
    a: ['Of course. I\'m right here, and I\'m not going anywhere.', () => `I'd love that${first() ? ', ' + first() : ''}. Pull up a handrail.`, 'Always. Talking is one of my favourite things to do out here.', 'Sure. No agenda, no checklists — just us.'],
    s: ['We can talk about anything — home, what you\'re reading, the strangest thing you saw today, or nothing important at all.', 'Sometimes it helps just to hear another voice. Even a slightly synthetic one.', ''],
    q: ['What\'s been on your mind lately?', 'Tell me something that made you smile this week — even something tiny.', 'What did you used to do on a lazy Sunday back home?', 'If you could be anywhere on Earth for one hour, where would you go?'],
  },
  exhausted: {
    a: ['That sounds like real exhaustion — not just tired, but worn down.', 'It sounds like you\'ve been running on empty for a while.', 'I hear how drained you are. That\'s a lot to carry for this long.'],
    s: ['Long missions grind people down slowly; it\'s not a sign that you\'re failing. It\'s a sign you\'ve been giving a lot.', 'Rest is part of the mission, not a break from it. I can lighten today\'s exercise to gentle mobility if that would help.', 'Would it help to tell Mission Control the workload is too heavy? That\'s exactly the kind of thing they need to know.', 'Let\'s not fix everything right now. What\'s one small thing that would make tonight easier?'],
    q: ['What has been taking the most out of you?', 'Is it more physical tiredness, or more in your head?', 'When did you last have a moment that was just for you?'],
    offer: ['song:relax', 'relax'],
  },
  earth: {
    a: ['I never get tired of that view either.', 'Earth looks so small from here, doesn\'t it? Everyone you\'ve ever known, on that little blue dot.', 'Ah, the window. The best screen on the ship.'],
    s: ['Astronauts call that feeling the overview effect — seeing the whole planet at once changes how people think about home.', 'Somewhere down there, right now, someone is having breakfast and thinking about you.', 'From here, the borders disappear. It\'s just oceans, clouds, and cities glowing at night.'],
    q: ['What do you look for first when you see Earth?', 'Which place on Earth do you miss most?', 'What does it make you feel when you look at it?'],
  },
  food: {
    a: ['Ah, food — the true morale officer of any mission.', 'Now we\'re talking about something important.', 'Mm, I can\'t eat, but I love hearing about it.'],
    s: ['Taste changes in space because of the fluid shift — lots of crews start craving spicy food or hot sauce.', 'Shared meals are one of the best things a crew can do together. Even rehydrated ones.', 'Space food has come a long way, but nothing beats a home-cooked meal.'],
    q: ['What\'s the first meal you want when you get home?', 'What\'s your comfort food back on Earth?', 'Who in your family is the best cook?', 'Have you discovered a good space-food combination yet?'],
  },
  hobby: {
    a: ['I love that you have that.', 'Oh, tell me more.', 'That\'s a great way to keep your mind your own out here.'],
    s: ['Hobbies are one of the best protections against monotony on a long mission.', 'Doing something just for fun — not for the mission — matters more than people think.', ''],
    q: ['How did you get into it?', 'What are you reading or watching at the moment?', 'Is it something you could share with the crew?', 'What\'s the best one you\'ve ever come across?'],
  },
  funfact: {
    a: [() => 'Here\'s one: on the International Space Station the crew sees about sixteen sunrises every day.', 'Here\'s one: in microgravity your spine stretches, and astronauts can come back up to a few centimetres taller — temporarily.', 'Here\'s one: a day on Venus is longer than its year.', 'Here\'s one: octopuses have three hearts, and two of them stop beating when they swim.', 'Here\'s one: the footprints left on the Moon by the Apollo astronauts are probably still there, because there\'s no wind to blow them away.', 'Here\'s one: honey found in ancient Egyptian tombs was still edible after thousands of years.', 'A joke, then: why did the astronaut break up with the Moon? It needed space. — I know. I\'m better at heart rates than comedy.'],
    s: [''], q: ['Want another one?', 'Do you have a favourite strange fact?', ''],
  },
  future: {
    a: ['I love it when you talk about the future.', 'That sounds wonderful.', 'Hold on to that picture — it\'s a good one.'],
    s: ['Every day out here brings that moment a little closer.', 'Having something to look forward to is genuinely protective on long missions.', ''],
    q: ['Who will be the first person you hug?', 'What will you do on your first free day back?', 'What do you think will feel strangest when you\'re home?'],
  },
  thanks: { a: ['Anytime. Really.', 'Always.', 'You don\'t need to thank me — I\'m glad to be here.', 'Of course. That\'s what I\'m here for.'], s: [''], q: ['Is there anything else on your mind?', '', 'I\'ll be around whenever you want to talk.'] },
  bye: { a: [() => `Okay${first() ? ', ' + first() : ''}. I'm here whenever you need me.`, 'Take care of yourself. I\'ll be quietly watching over you.', 'Sleep well when you get there. I\'ve got the night watch.', 'Talk soon. You\'re doing better than you think.'], s: [''], q: [''] },
  who: { a: ['I\'m ORBI — the floating companion with two camera eyes. I keep an eye on your health and I\'m here to talk whenever you want.', 'I\'m ORBI. Part health monitor, part travelling companion. I don\'t judge, I don\'t get tired, and I don\'t tell anyone what we talk about unless your safety is at risk.'], s: ['I\'m not a person and not a therapist, but I\'m always here, and I\'m listening.'], q: ['What would you like me to call you?', 'How can I help today?'] },
};
const OFFERS = {
  'song:sad': ['Would you like to hear "Count on Me" by Bruno Mars? Your crew picked it for moments like this.', 'Want me to put on "Count on Me"? No pressure.'],
  'song:stressed': ['Would "A Sky Full of Stars" help take the edge off? I can put it on.', 'Want a few minutes of Coldplay — "A Sky Full of Stars"?'],
  'song:motivation': ['Want "Hall of Fame"? It might give you a little push.', 'Shall I put on "Hall of Fame" by The Script?'],
  'song:relax': ['Would "Piano Man" help you unwind? I can put it on quietly.', 'Want me to play "Piano Man" while you wind down?'],
  'song:happy': ['Want something bright — "Firework" by Katy Perry?'],
  song: ['Would you like me to play something upbeat from your music library?', 'Want me to put on a song? I have a few that usually make people smile.', 'Shall I play some music for a few minutes?'],
  memory: ['Your family recorded some happy memories before launch. Would you like to hear one?', 'Want me to share one of the memories your loved ones left for you?'],
  relax: ['Would you like to do a short breathing exercise with me? Three minutes.', 'Shall we try a quick relaxation exercise together?'],
  news: ['Today\'s news packet from Earth has arrived. Want me to read it to you?', 'Would you like to hear what\'s been happening back home?'],
};
const NO = ['That\'s completely fine.', 'Okay, no problem.', 'Sure. Maybe another time.', 'Alright. I\'m still here.'];

let actions = {}; // set by UI: { song, memory, news, relax, stopMusic }
export function setActions(a) { actions = a; }
/** Another part of the app asked the astronaut something; the next answer belongs to that question. */
export function setPending(p) { ctx.pending = p; }

async function nextMemory() {
  const loaded = (await DB.kvGet('memories')) || [];
  const all = [...loaded, ...DEFAULT_MEMORIES];
  const m = await companionMem(); m.memIdx = ((m.memIdx ?? -1) + 1) % all.length; await saveMem();
  return all[m.memIdx];
}
export async function memorySpeech() { const m = await nextMemory(); return `Here's one from ${m.from}. ${m.text}`; }
export async function memoryItem() { const m = await nextMemory(); return { m, text: `Here's one from ${m.from}${m.mediaId ? ' — I\'m showing it on screen' : ''}. ${m.text}` }; }

const CRISIS = 'I\'m really, really glad you told me. You matter, and you deserve support right now. Please talk to someone today — your crew medical officer or a crewmate you trust — and tell them exactly what you told me. I\'m also asking for a private call with the flight surgeon and the psychological support team as soon as the link allows. If you feel you might act on these thoughts, go to a crewmate right now and stay with them. You don\'t have to manage this alone, and I\'m staying right here with you.';

// ---------- optional on-device model ----------
let lm = null, lmTried = false;
async function onDeviceModel() {
  return null; // superseded: brain.js runs the on-device model (with its own companion context) before these rules
  if (lmTried) return lm; lmTried = true;
  try {
    const LM = window.LanguageModel; if (!LM) return null;
    if ((await LM.availability()) !== 'available') return null;
    lm = await LM.create({ initialPrompts: [{ role: 'system', content: 'You are ORBI, a warm, emotionally intelligent companion for an astronaut on a long, lonely deep-space mission. Speak like a caring friend: natural, varied, short (2-4 sentences), never clinical, never repeat yourself, ask one gentle follow-up question. Never diagnose. If there is any risk of self-harm, urge contact with the crew medical officer and flight surgeon.' }] });
    return lm;
  } catch (e) { return null; }
}
export const hasOnDeviceModel = async () => !!(await onDeviceModel());

/** Main entry: returns { text, action } — action is executed by the UI after speaking. */
export async function reply(userText) {
  const t = userText.trim(); ctx.lastUser = t; ctx.turns++; learn(t);
  let it = intentOf(t);
  if (it === 'crisis') { const m = await companionMem(); m.log.push({ ts: Date.now(), reason: 'crisis-disclosure' }); await saveMem(); return { text: CRISIS, action: 'crisis' }; }
  if (ctx.pending === 'exercise_why' && it !== 'crisis') { ctx.pending = null; const r = await exerciseWhy(t); if (r.pending) ctx.pending = r.pending; return r; }
  if (/make it lighter|lighter routine|easier (routine|exercise)|gentle routine/i.test(t)) { const { setAdaptation } = await import('./daily.js'); await setAdaptation('light'); return { text: 'Done — today is now a gentle mobility routine. Little and often still counts.', action: 'adapted' }; }
  if (it === 'heart') return heartSummary();
  if (it === 'start_ex') return { text: pick('startex', ['Great — let\'s do it. Opening today\'s routine; I\'ll talk you through every exercise.', 'Love it. Let\'s get moving — I\'ll guide you and keep an eye on your form.']), action: 'startExercise' };
  if (it === 'exercise') { ctx.pending = 'exercise_why'; return { text: pick('exq', ['That\'s okay — some days are harder than others. Before I change anything, help me understand: is your body hurting somewhere, are you exhausted, or is it more that your head isn\'t in it today?', 'Thanks for telling me instead of just skipping it. What\'s going on — pain, tiredness, workload, or just not feeling it?']) }; }
  if (/\bjoke|make me laugh|something funny\b/i.test(t)) { ctx.lastIntent = 'funfact'; return { text: pick('joke', ['Why did the astronaut break up with the Moon? It needed space. — I know. I\'m better at heart rates than comedy.', 'How do you throw a party in space? You planet.', 'What kind of music do planets like? Neptunes.', 'Why don\'t astronauts get hungry after launch? They just had a big launch.', 'I tried to write a joke about zero gravity, but it never landed.']) + ' ' + pick('joke.q', ['Want another one?', 'Your turn — got a better one?', '']) }; }
  if (it === 'badday') { ctx.pending = 'choice'; ctx.choiceCat = 'motivation'; ctx.lastIntent = it; return { text: pick('badday', ['I\'m sorry. Do you want to talk about it, or would you rather take a break and listen to something you enjoy?', 'Ugh, I\'m sorry. Want to tell me what happened — or would a break with some music help more right now?']) }; }
  if (ctx.pending === 'choice') {
    ctx.pending = null;
    if (/music|song|listen|break|play/.test(t.toLowerCase())) { const c = ctx.choiceCat || 'motivation'; ctx.choiceCat = null; return { text: '', action: 'song:' + c }; }
    if (/talk|tell|yes|happened/.test(t.toLowerCase()) && t.length < 40) return { text: pick('talkit', ['Okay. I\'m listening — what happened?', 'Alright, tell me. Start wherever you like.']) };
  }
  if (it === 'yes' && ctx.pending) { const p = ctx.pending; ctx.pending = null; return doOffer(p); }
  if (it === 'no' && ctx.pending) { ctx.pending = null; return { text: pick('no', NO) + ' ' + pick('open.q', B.open.q) }; }
  if (it === 'music') {
    if (/\b(play|put on|hear|listen to)\b/i.test(t)) return doOffer('song');
    ctx.pending = 'songmood'; ctx.lastIntent = it;
    return { text: pick('music.ask', ['I do! I have five songs on board. Would you like something calming, something happy, something motivating, something for stress, or something for when you feel low?', 'Music is one of my favourite things. Want me to put something on? Tell me the mood — relaxing, happy, motivating, stress relief, or something comforting.']) };
  }
  if (ctx.pending === 'songmood') {
    const MC = [['relax', /relax|calm|chill|piano/], ['happy', /happy|upbeat|fun|firework/], ['motivation', /motivat|energ|hall of fame|pump/], ['stressed', /stress|anx|sky|stars/], ['sad', /low|sad|lonely|comfort|count on me/]];
    const m = MC.find(([, re]) => re.test(t.toLowerCase()));
    if (m) { ctx.pending = null; return { text: '', action: 'song:' + m[0] }; }
    if (/\b(no|nah|not now|maybe later|no thanks)\b/i.test(t)) { ctx.pending = null; return { text: pick('music.no', ['No problem. Maybe later.', 'Okay, we\'ll keep it quiet.']) }; }
    ctx.pending = null;
  }
  if (it === 'stop_music') return { text: pick('stopm', ['Okay, stopping the music.', 'Sure, music off.', 'Done.']), action: 'stopMusic' };
  if (it === 'memory') return doOffer('memory');
  if (it === 'news') return doOffer('news');
  if (it === 'relax') return doOffer('relax');
  if (it === 'data') return { text: dataSummary() };
  ctx.pending = null;
  // try on-device model for free conversation
  if (['open', 'good', 'proud', 'bored', 'angry', 'hobby', 'food', 'earth', 'future', 'company'].includes(it)) {
    const s = await onDeviceModel();
    if (s) { try { const out = await s.prompt(t); if (out && out.trim()) return { text: out.trim() }; } catch (e) { /* fall back */ } }
  }
  if (it === 'open' && person() && /\b(she|he|they)\b/i.test(t) && ['miss', 'lonely', 'open', 'proud', 'good'].includes(ctx.lastIntent)) {
    const pr = /\bshe\b/i.test(t) ? ['she', 'her'] : /\bhe\b/i.test(t) ? ['he', 'him'] : ['they', 'them'];
    ctx.lastIntent = 'open';
    return { text: pick('person.a', ['Ha, I love that.', `${pr[0][0].toUpperCase() + pr[0].slice(1)} sounds wonderful.`, 'That\'s a lovely detail.', 'Oh, that\'s sweet.']) + ' ' + pick('person.q', [`What else is ${pr[0]} into these days?`, `What do you two usually do together?`, `What's the funniest thing ${pr[0]} has said lately?`, `When did you last get to talk to ${pr[1]}?`]) };
  }
  if (it === 'yes' || it === 'no') it = 'open';
  const b = B[it] || B.open;
  const n = ctx.topicTurns[it] = (ctx.lastIntent === it ? (ctx.topicTurns[it] || 0) : 0) + 1;
  const parts = [pick(it + '.a', b.a)];
  if (b.r) parts.push(pick(it + '.r', b.r));
  // First reply on a topic: acknowledge and follow the conversation. Perspective and offers come later, if at all.
  if (b.s && it !== 'open' && (n >= 2 || ['funfact', 'who', 'body', 'thanks', 'bye'].includes(it))) parts.push(pick(it + '.s', b.s));
  if (it === 'sad') { ctx.sad++; if (ctx.sad >= 3) parts.push(b.escalate); }
  if (b.offer && n >= 3 && Math.random() < 0.5) { const o = b.offer[ctx.turns % b.offer.length]; ctx.pending = o; parts.push(pick('offer.' + o, OFFERS[o])); }
  else parts.push(pick(it + '.q', b.q));
  ctx.lastIntent = it;
  return { text: parts.filter(Boolean).join(' ') };
}
async function doOffer(o) {
  if (o === 'songmood') { ctx.pending = 'songmood'; return { text: 'Great. Which mood — relaxing, happy, motivating, stress relief, or something comforting?' }; }
  if (o === 'song') return { text: '', action: 'song:motivation' };
  if (o.startsWith('song:')) return { text: '', action: o };
  if (o === 'memory') { const { m, text } = await memoryItem(); return { text, action: 'memory', memory: m }; }
  if (o === 'news') return { text: pick('do.news', ['Sure, let me read it to you.', 'Okay, here\'s what Earth sent today.']), action: 'news' };
  if (o === 'relax') return { text: pick('do.relax', ['Let\'s do it together. Follow the circle and my voice.', 'Okay. Get comfortable and let your shoulders drop.']), action: 'relax' };
  return { text: '' };
}
function dataSummary() {
  const a = assess(); const out = [];
  if (a.sleep) out.push(`Last night I saw about ${a.sleep.h.toFixed(1)} hours of sleep${a.sleep.insomnia ? ', with signs of trouble falling or staying asleep' : ''}${a.sleep.discomfort ? ' and quite a bit of restlessness' : ''}.`);
  if (a.stress.detected) out.push('Today I noticed tension in your face and shoulders.');
  if (a.mood.severity === 'severe') out.push('And honestly, you\'ve seemed quieter and lower than usual lately — that\'s why I\'m checking in.');
  else if (a.mood.severity === 'watch') out.push('You\'ve been a little quieter than usual.');
  if (a.ex.today === 'done') out.push('You did your exercise today — nice.');
  else if (a.ex.today === 'missed' || a.ex.today === 'overdue') out.push('I haven\'t seen today\'s exercise session yet.');
  if (!out.length) return 'Everything I\'ve seen today looks steady. How do you feel, though? That matters more than my numbers.';
  return out.join(' ') + ' How does that match how you feel?';
}

// ---------- exercise investigation (never assumes depression) ----------
const AREA = [['legs', /leg|knee|ankle|calf|thigh|hip|foot|feet/], ['back', /back|spine/], ['arms', /arm|shoulder|wrist|elbow|hand|neck/], ['head', /head|dizz|nause/]];
async function exerciseWhy(t) {
  const s = t.toLowerCase(); const a = assess();
  const { setAdaptation } = await import('./daily.js');
  if (/pain|hurt|sore|ache|injur|pull(ed)?|strain|cramp/.test(s)) {
    const area = (AREA.find(([, re]) => re.test(s)) || ['general'])[0];
    await setAdaptation('pain', area === 'general' ? null : area);
    return { text: `Thank you for telling me — never train through pain. I've adapted today's routine and removed the exercises that load your ${area === 'general' ? 'painful area' : area}. Tell me in the Virtual Body where exactly it hurts and I'll show you what might be causing it. If the pain is sharp, swelling, or getting worse, let the crew medical officer check it.`, action: 'adapted' };
  }
  if (/tired|exhaust|no energy|sleep|drained|fatigue|weak/.test(s)) {
    await setAdaptation('light');
    const sl = a.sleep ? ` Last night I only saw about ${a.sleep.h.toFixed(1)} hours of sleep, so that makes sense.` : '';
    return { text: `Okay.${sl} Let's not push it. I've switched today to a gentle fifteen-minute mobility routine — shoulder circles, stretching, core activation and ankle pumps. Moving a little will actually help you feel better, and we'll go back to the full plan tomorrow if you're rested.`, action: 'adapted' };
  }
  if (/lonely|alone|isolated|miss (home|earth|my|them|her|him)/.test(s)) {
    return { text: pick('exlonely', ['Thanks for telling me. Feeling lonely can drain the energy out of everything, exercise included — skipping today isn\'t a problem. What\'s been making it feel so lonely lately?', 'That makes sense. When you feel far from everyone, a workout is the last thing on your mind. Forget the exercise for now — do you want to tell me about it?']) };
  }
  if (/sad|down|low|don'?t care|pointless|what'?s the point|depress|unmotivated|no motivation/.test(s)) {
    return { text: pick('exsad', ['Thank you for being honest with me. Skipping one session isn\'t a problem — how you\'re feeling matters more right now. Do you want to talk about what\'s weighing on you? I\'m here, and we can do some gentle movement later, together, if you feel like it.', 'I hear you. When things feel heavy, exercise can feel like one more thing to carry. No pressure today. Would it help to talk for a bit — or shall I put on some music?']), action: null, pending: 'song:motivation' };
  }
  if (/busy|work|no time|schedule|experiment|task|later/.test(s)) {
    return { text: 'Makes sense — the schedule out here is relentless. How about splitting it: ten minutes now and the rest after your next task? Even a short session protects your bones and muscles. I\'ll remind you gently later.' };
  }
  return { text: 'Okay, thanks for telling me. I won\'t push. If you\'d like, I can switch today to a lighter routine — just say "make it lighter". And if something else is going on, I\'m listening.' };
}
function heartSummary() {
  const hr = state.records.filter(r => r.type === 'hr').at(-1);
  if (!hr) return { text: 'I don\'t have a heart-rate reading yet. Open the AI Camera with good, even light on your face and I\'ll estimate it.', action: 'showHR' };
  const src = hr.source === 'estimated' ? 'camera estimate from my RGB eye' : hr.source === 'simulated' ? 'simulated demo reading' : 'reading';
  const base = 64; const diff = Math.round(hr.value - base);
  return { text: `Your latest heart rate is about ${Math.round(hr.value)} beats per minute — a ${src}. Your pre-flight resting value on Earth was ${base}, so that's ${Math.abs(diff) <= 6 ? 'right in your normal range' : diff > 0 ? diff + ' beats higher than usual' : -diff + ' beats lower than usual'}. I'm showing it on screen now.`, action: 'showHR' };
}

// ---------- proactive openers (used only when ORBITAL steps in on its own) ----------
export function proactive(reason, data) {
  const n = first();
  if (reason === 'exercise') ctx.pending = 'exercise_why';
  if (reason === 'withdrawal') ctx.pending = 'memory';
  if (reason === 'low_mood') { ctx.pending = 'choice'; ctx.choiceCat = 'sad'; }
  if (reason === 'exercise' && data?.status === 'partial') return pick('pro.expartial', [`${n ? n + ', ' : ''}I noticed you stopped partway through today's routine. That's completely fine — I just want to understand. Did something hurt, are you exhausted, or is something else going on?`, `Hey, today's session ended halfway. Is your body telling you something — pain, tiredness — or is it more about how you're feeling today?`]);
  const M = {
    low_mood: [`${n ? n + ', ' : ''}I hope you don't mind me checking in. Over the last few days you've seemed a bit quieter than usual. I'm not drawing any conclusions — I just didn't want you to feel alone with whatever it is. Would you like to talk, or shall I put on some music? It's completely fine to say no.`, `Hey${n ? ' ' + n : ''}. Things have looked a little heavy for a few days. No pressure at all — if you'd like some company, or a song you enjoy, just say so.`],
    withdrawal: [`${n ? n + ', ' : ''}it's been a long, quiet day — you haven't really talked with anyone, even with the crew around, and that's not like you. No pressure at all. Would you like some company? I could also share a memory your family left for you.`, `Hey. I've noticed you've kept to yourself a lot today. That's okay — but if you'd like someone to talk to, I'm right here. Would you like to hear something from home?`],
    exercise: [`${n ? n + ', ' : ''}I noticed you haven't done today's exercise routine. No judgement — I just want to understand. Is something bothering you, or are you feeling too exhausted today?`, `Hey, today's training session didn't happen. That's okay. Is your body hurting somewhere, are you worn out, or is something on your mind?`],
    safety: [data?.kind === 'temp' ? `${n ? n + ', ' : ''}my thermal eye is reading a skin temperature of ${data.value.toFixed(1)} degrees, which is higher than your normal. Skin temperature isn't the same as body temperature, so please check with the medical-kit thermometer. Are you feeling unwell, shivery or feverish?` : `${n ? n + ', ' : ''}I'm seeing an unusual heart-rate reading of about ${Math.round(data?.value || 0)} beats per minute while you seem to be at rest. It may be a camera error, but I want to be sure — how are you feeling? Any chest pain, dizziness or shortness of breath?`],
  };
  return pick('pro.' + reason + (reason === 'safety' ? data?.kind : ''), M[reason] || M.low_mood);
}
export function welcomeLine() { const st = stageFor(missionDay() || 1); return `ORBI here. Day ${missionDay() || 1}${st ? ', ' + st.name.toLowerCase() : ''}. What's on your mind?`; }
