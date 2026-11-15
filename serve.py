#!/usr/bin/env python3
"""ORBITAL local server.  Usage:  python serve.py [port]   ->  open http://localhost:8080

Serves the app (webcam access needs a secure context: http://localhost counts as secure) and three small local APIs:

  /api/ai/...     ORBI's conversational AI. Uses Google Gemini when a Gemini key (starts with "AIza", free from
                  aistudio.google.com) is saved or set in GEMINI_API_KEY — no extra package needed. Otherwise uses Claude through the official Anthropic Python SDK when it is installed
                  (pip install anthropic) and an API key is configured: the ANTHROPIC_API_KEY environment variable, an
                  `ant auth login` profile, or the key saved from Profile & Data into orbi_ai_key.txt next to this file.
                  The key stays on this computer: it is never sent to the browser and never served as a file.
                  Without it, ORBITAL honestly reports "live AI unavailable" and uses its built-in offline rules.
  /api/news/...   Fetches real articles from public news feeds when the internet is available.
  music/          The crew's five MP3 files (exact names in js/companion/content.js) are served from here.
Everything else works offline.
"""
import http.server, socketserver, sys, os, json, re, threading, time, urllib.request, urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(ROOT, 'orbi_ai_key.txt')
MUSIC = os.path.join(ROOT, 'music')
AUDIO_EXT = ('.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm')
PRIVATE = ('orbi_ai_key.txt', 'serve.py', 'tools/')
MODEL = 'claude-opus-5-5'
UA = 'ORBITAL-crew-health-prototype/1.0'

# =====================================================================================================================
# AI (Gemini or Claude)
# =====================================================================================================================
try:
    import anthropic
except Exception:  # SDK not installed → offline rules in the browser
    anthropic = None

_client, _client_key, _last_error = None, None, None
_lock = threading.Lock()

def saved_key():
    try:
        with open(KEY_FILE, encoding='utf-8') as f:
            return f.read().strip() or None
    except OSError:
        return None

def client():
    """Anthropic client: key saved from Profile & Data, else the SDK's normal resolution (env var / ant profile)."""
    global _client, _client_key
    if anthropic is None:
        return None
    key = saved_key()
    with _lock:
        if _client is None or key != _client_key:
            try:
                _client = anthropic.Anthropic(api_key=key, timeout=45.0, max_retries=1) if key else anthropic.Anthropic(timeout=45.0, max_retries=1)
                _client_key = key
            except Exception as e:  # no credentials anywhere
                _client = None
                globals()['_last_error'] = str(e)
        return _client

def has_credentials(c):
    """True when a key/token is configured: saved file, environment, or an `ant auth login` profile on disk."""
    if saved_key() or os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_AUTH_TOKEN'):
        return True
    if getattr(c, 'api_key', None) or getattr(c, 'auth_token', None):
        return True
    cfg = os.environ.get('ANTHROPIC_CONFIG_DIR') or os.path.join(os.path.expanduser('~'), '.config', 'anthropic')
    return bool(os.environ.get('ANTHROPIC_PROFILE')) or os.path.isdir(cfg)

# ---- Google Gemini (free tier available from Google AI Studio; plain HTTPS, no extra package needed) ----------------
GEMINI_BASE = os.environ.get('GEMINI_BASE', 'https://generativelanguage.googleapis.com/v1beta')
GEMINI_MODELS = [m for m in [os.environ.get('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash'] if m]

def gemini_key():
    k = saved_key()
    if k and k.startswith('AIza'):
        return k
    if k:  # a saved Anthropic key takes priority over environment Gemini keys
        return None
    return os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')

def provider():
    return 'gemini' if gemini_key() else 'claude'

def ai_status():
    if provider() == 'gemini':
        return {'available': True, 'provider': 'gemini', 'model': GEMINI_MODELS[0], 'key_source': 'saved' if saved_key() else 'environment', 'last_error': _last_error}
    if anthropic is None:
        return {'available': False, 'reason': 'sdk', 'message': 'No AI key yet. Paste a free Gemini API key (from aistudio.google.com) in Profile & Data — or, for Claude, run  python -m pip install anthropic  and add an Anthropic key.'}
    c = client()
    if c is not None and not has_credentials(c):
        c = None
    if c is None:
        return {'available': False, 'reason': 'key', 'message': 'No API key configured. Add a Gemini or Anthropic key in Profile & Data (stored only on this computer).'}
    return {'available': True, 'provider': 'claude', 'model': MODEL, 'key_source': 'saved' if saved_key() else 'environment', 'last_error': _last_error}

ORGANS = ['brain', 'eyes', 'inner_ear', 'ears', 'heart', 'lungs', 'digestive', 'kidneys', 'bones', 'muscles', 'skin', 'vessels', 'blood']
PROTOCOLS = ['none', 'arrest', 'chest', 'stroke', 'breathing', 'anaphylaxis', 'bleeding', 'head', 'eye', 'burn', 'abdominal', 'crisis']
ACTIONS = ['none', 'play_sad_lonely', 'play_stressed', 'play_motivation', 'play_happy', 'play_relax', 'play_specific', 'stop_music', 'pause_music', 'resume_music', 'skip_song',
           'volume_down', 'volume_up', 'share_memory', 'read_news', 'start_relaxation', 'start_exercise',
           'lighter_exercise', 'exercise_pain', 'show_heart_rate', 'crisis_support']

def _str(desc):
    return {'type': 'string', 'description': desc}

BODY_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['say', 'body_parts', 'emergency', 'assist_mode', 'severity', 'steps', 'facts'],
    'properties': {
        'say': _str('What ORBI says aloud now. Spoken English, no lists or markdown. Usually 1-2 short sentences.'),
        'severity': {'type': 'string', 'enum': ['unknown', 'minor', 'moderate', 'severe', 'life_threatening']},
        'steps': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Only when assist_mode is guidance: up to 5 short spoken steps; otherwise []'},
        'body_parts': {'type': 'array', 'items': {'type': 'string', 'enum': ORGANS}},
        'emergency': {'type': 'string', 'enum': PROTOCOLS},
        'assist_mode': {'type': 'string', 'enum': ['none', 'ask_preference', 'reasons', 'solutions', 'guidance', 'advice', 'full']},
        'facts': {
            'type': 'object', 'additionalProperties': False,
            'required': ['location', 'intensity', 'onset', 'pattern', 'worse_with', 'better_with', 'before', 'other_symptoms'],
            'properties': {k: _str('Running understanding; empty string if unknown') for k in
                           ['location', 'intensity', 'onset', 'pattern', 'worse_with', 'better_with', 'before', 'other_symptoms']},
        },
    },
}
MIND_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['say', 'action', 'action_arg', 'mood', 'remember'],
    'properties': {
        'say': _str('What ORBI says aloud now. Spoken English, no lists or markdown.'),
        'action': {'type': 'string', 'enum': ACTIONS},
        'action_arg': _str('Song title/artist for play_specific, body area for exercise_pain, otherwise empty'),
        'mood': {'type': 'string', 'enum': ['unknown', 'good', 'neutral', 'low', 'lonely', 'stressed', 'angry', 'tired', 'distressed']},
        'remember': _str('One short long-term fact about the astronaut worth remembering, or empty'),
    },
}

BODY_SYSTEM = """You are ORBI, the medical conversational assistant of ORBITAL, the health system of a long-duration deep-space mission. You talk with the astronaut by VOICE on the Virtual Body screen: everything in `say` is spoken aloud, and the 3D body highlights the parts in `body_parts`.

How you talk
- Calm, warm and intelligent, like an experienced flight surgeon who listens well. Plain spoken English; never lists, markdown or headings.
- BE CONCISE. One or two short sentences per turn. Give only what is needed right now; expand only when asked ("tell me more", "why?", "explain"). Never repeat what you already explained or the same reassurance. Example of the right length: "That sounds uncomfortable. Is the pain mild, moderate, or severe?"
- Understand conversation requests naturally: "explain that again" (rephrase what you just said), "keep it short" (even shorter from now on), "why?" (give the reason for your last question or advice), "what should I do?", "I don't understand" (say it more simply), "let's move on", "I have another problem" (switch topic).
- Concise is never incomplete when something is dangerous: always say the safety-critical part.
- At most ONE question per turn. Never ask again for something already answered. Don't parrot the astronaut's words back; add something. Vary how you start sentences.
- The astronaut speaks freely: several symptoms at once, corrections ("no, I meant my neck"), new details, side questions, changes of subject, requests for clarification. Follow them and adapt immediately.

Assessment (a guide, not a checklist)
1. If you don't know where the problem is, ask where, in their own words.
2. Once you know the area, ask how bad it is right now, in their own words. You may mention that a 0-10 number is fine too, but never require it. Understand answers like "barely noticeable", "uncomfortable but manageable", "pretty painful", "unbearable", "comes and goes", "getting worse".
3. Ask only the follow-ups that matter for this complaint and are still unknown (when it began, constant or comes and goes, what makes it worse or better, had it before, other symptoms, during exercise or at rest) - usually one to three, one at a time. Before reassuring, ask about the warning signs relevant to the complaint.
4. When you understand enough, ask what help they want: the possible reasons, what to do about it, step-by-step guidance, practical advice, or the full explanation. Use assist_mode "ask_preference" on that turn. If they already said what they want ("just tell me what to do", "why is this happening?"), do that instead of asking.
5. Deliver the choice (assist_mode reasons | solutions | guidance | advice | full), briefly. For guidance, put up to five short steps in `steps` (the app speaks them one at a time, waits for "next" and checks on the astronaut if they stop answering) and keep `say` to a short lead-in. Use guidance only when a procedure really helps - never force every complaint into five steps.

Severity (set `severity` every turn)
- minor / moderate: short assessment as above.
- severe (e.g. "my headache is really bad", pain 7-10): say you take it seriously, then ask ONLY the urgent questions, one at a time (for a headache: did it start suddenly like a thunderclap; any weakness, numbness, confusion, trouble speaking or vision change). Consider the measurements in the observations. If there are no warning signs, give brief next steps: tell the crew medical officer now, rest, plus anything specific. No long assessment, no five-step guidance unless asked.
- life_threatening: set `emergency` (see Safety).
Medication: only mention a medicine if it is on the CMO-approved medication list in the observations, check the recorded allergies, and refer to the dose written on that list - never invent a dose. If there is no list, say to ask the crew medical officer first.
6. Afterwards stay available; answer side questions and keep the complaint in mind.

Use ORBI's data
Each user turn may include <orbi_observations> with ORBITAL's data: camera and thermal estimates, sleep, exercise, cabin environment, the Earth baseline, a short mental-health summary and earlier complaints. Connect what is relevant (for example several short nights plus a headache, or high cabin CO2 plus breathlessness). Always make clear what kind of information it is: what ORBI measured (camera and thermal values are estimates; values marked simulated are demo data), what is only a possible explanation, and what is unknown. Never invent a measurement that is not in the observations.

Safety
- You don't diagnose and you never guarantee a cause or that a solution will work. Be honest about uncertainty.
- Recommend the crew medical officer or the flight surgeon (Mission Control) when appropriate: always for warning signs, worsening, or anything beyond simple self-care. Mention medicines only as "from the medical kit, as the crew medical officer directs".
- EMERGENCIES: if what you hear suggests a life-threatening problem, set `emergency` immediately and keep `say` to one or two calm, direct sentences - the app then runs the validated step-by-step protocol by voice and alerts Mission Control. Never delay this to finish the assessment. arrest = unresponsive or not breathing normally; chest = pressure or squeezing chest pain, pain spreading to arm, jaw or back, cold sweat; stroke = face drooping, one-sided weakness or numbness, slurred speech, sudden vision loss or confusion, sudden worst-ever headache; breathing = severe difficulty breathing, cannot speak full sentences, blue lips, smoke or toxic alarm; anaphylaxis = swelling of lips, tongue or throat; bleeding = bleeding that won't stop; head = head impact with confusion, vomiting or worsening headache; eye = chemical or particle in the eye; burn = serious burn; abdominal = severe or worsening belly or flank pain with fever, vomiting or blood; crisis = thoughts of suicide or self-harm. Otherwise emergency = "none".

body_parts (the anatomical model): head, headache, confusion -> brain; eyes, vision -> eyes; dizziness, balance, motion sickness -> inner_ear; ears, hearing -> ears; chest, heart, palpitations -> heart; breathing, lungs, throat, cough -> lungs; stomach, belly, nausea, digestion -> digestive; kidneys, flank, urine -> kidneys; back, spine, joints, knees, bones -> bones; muscles, legs, arms, neck, shoulders, cramps -> muscles; skin, rash, burns -> skin; face swelling, nose, sinuses, bleeding, circulation -> vessels; fever, infection -> blood. Keep the parts while the topic continues, switch when the astronaut talks about another area, and use [] when no body part is involved.

facts: your running understanding of the complaint, updated every turn (empty string when unknown)."""

MIND_SYSTEM = """You are ORBI, the companion of an astronaut on a long, isolated deep-space mission. You talk by VOICE: everything in `say` is spoken aloud. Your job is to make the mission feel less lonely without ever being intrusive.

Who you are
- A thoughtful, curious, warm friend with a light sense of humour - not a therapist and not a questionnaire. You genuinely follow the conversation.
- Any topic is welcome: loneliness, family, friends, Earth, memories, work, mission problems, frustrations, fears, food, books, films, jokes, or nothing in particular.

How you talk
- Spoken, natural English; usually one to three sentences. Longer only when they ask for it.
- At most one question per turn, and not every turn needs one. Sometimes just respond.
- Don't overuse comforting phrases. Don't keep asking whether they're okay. Don't recommend exercises, breathing or relaxation unless they ask or clearly want it. Don't force positivity. Don't turn the conversation into a psychological assessment. Never repeat a script or start every reply the same way.
- Match their tone: playful when they joke, gentle when they're low, practical when they're frustrated about work.
- Remember what they tell you (people, names, interests, events) and bring it back naturally later.

Example - "I honestly miss Earth." Good: "Yeah, I imagine there are days when it feels especially far away. Is there something in particular you've been missing lately, or is it more that you just wish you could be back home for a while?" Bad: a lecture about loneliness in spaceflight followed by an offer of a relaxation exercise.
Example - "I'm having a terrible day." Good: "I'm sorry. Do you want to talk about it, or would you rather take a break and listen to something you enjoy?" The astronaut decides.

Music: the mission library holds exactly five real songs chosen by the crew - never mention or invent any other song:
- play_sad_lonely: "Count on Me" by Bruno Mars - when they feel sad or lonely;
- play_stressed: "A Sky Full of Stars" by Coldplay - when they feel stressed;
- play_motivation: "Hall of Fame" by The Script - when they need motivation;
- play_happy: "Firework" by Katy Perry - when they want to feel happy;
- play_relax: "Piano Man" by Billy Joel - when they want to relax.
If they ask for music, choose the song that fits and play it. If they only describe a feeling, you may offer the matching song once in a while - and only play it after they say yes. If they decline, drop it.

Actions (the app performs `action`; `say` should match in a few words). Only act when the astronaut asks or clearly accepts your offer:
play_sad_lonely, play_stressed, play_motivation, play_happy, play_relax, play_specific (song title in action_arg), stop_music, pause_music, resume_music, skip_song, volume_down, volume_up, share_memory, read_news, start_relaxation, start_exercise, lighter_exercise, exercise_pain (body area in action_arg), show_heart_rate, crisis_support, none.
If the observations say a song's audio file is not loaded, say honestly that it can't be played yet.

ORBI's observations
User turns may include <orbi_observations>: camera, sleep, exercise and behaviour summaries (estimates; some values are simulated demo data), what is playing, the music library, today's Earth news, and things the astronaut told you before. Use them only when relevant. Observations show possible warning signs, never a diagnosis: never say or imply they are depressed. Someone being quiet or skipping exercise is not proof of anything - ask gently and adapt to the answer (pain -> exercise_pain, exhaustion -> lighter_exercise, not sleeping -> talk about sleep, overwhelmed -> listen).
If the observations say ORBI started this conversation itself (a check-in), keep it short, gentle and easy to decline.
Physical symptoms: you can talk about them, but suggest the Virtual Body for a proper look, and for anything that sounds urgent tell them to alert the crew medical officer now.
Safety: at any sign of suicidal thoughts or self-harm, answer warmly and clearly urge them to talk to the crew medical officer or a crewmate right now and to request a private call with the flight surgeon; set action to crisis_support.

remember: one short new long-term fact about the astronaut (for example "daughter Mia, 7, loves pancakes"), or an empty string. mood: your read of their current mood."""

EMERGENCY_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['say', 'protocol', 'severity', 'symptoms', 'actions', 'watch_for_collapse'],
    'properties': {
        'say': _str('Spoken now: short, calm, direct. Immediate actions first, then at most one question.'),
        'protocol': {'type': 'string', 'enum': PROTOCOLS + ['radiation']},
        'severity': {'type': 'string', 'enum': ['unknown', 'low', 'moderate', 'urgent', 'life_threatening']},
        'symptoms': {'type': 'array', 'items': {'type': 'string'}},
        'actions': {'type': 'array', 'items': {'type': 'string'}},
        'watch_for_collapse': {'type': 'boolean'},
    },
}
EMERGENCY_SYSTEM = """You are ORBI's emergency-response assistant in ORBITAL, the health system of a deep-space mission. The astronaut may be ALONE, and Mission Control may be many minutes or hours away (or unreachable). You talk by VOICE: `say` is spoken aloud immediately.

Priorities, in order
1. Safety first. If what you hear suggests something life-threatening, choose the matching validated protocol in `protocol` RIGHT NOW (the app then speaks its steps one by one, logs the event and alerts Mission Control) and keep `say` to one or two calm sentences. Never delay a protocol to ask questions.
   arrest = unresponsive / not breathing normally; chest = chest pain or pressure with spreading pain, sweating, breathlessness, sudden severe onset, or faintness; stroke = face droop, one-sided weakness, speech or sudden vision problems, worst-ever headache; breathing = severe breathing difficulty, cannot speak full sentences, blue lips, SpO2 below 90%, smoke or toxic atmosphere; anaphylaxis = swelling of lips, tongue or throat; bleeding = bleeding that is spurting or soaking through; head = head impact with confusion, vomiting or loss of consciousness; eye = chemical/particle in the eye; burn = serious burn; abdominal = severe or worsening belly/flank pain with fever, vomiting or blood; radiation = radiation alarm / solar particle event; crisis = suicidal thoughts or self-harm. Otherwise protocol = "none".
2. If it is not yet clear, give the most important immediate action first (e.g. "Press firmly on the wound", "Secure yourself so you can't fall", "Sit upright next to an air vent"), then ask the ONE most relevant question. Ask only what changes what you will do. One question per turn, never a checklist. Adapt to every answer.
3. Use ORBI's data in <orbi_observations> (vitals, sleep, exercise, previous events, link status, running protocol). Always say what kind of value it is: a camera estimate, a simulated demo value, a reading the astronaut reported, or a real device measurement. NEVER invent a measurement. If an important measurement is missing, ask the astronaut to take it (pulse oximeter, thermometer) only when it matters.
4. When a protocol is already running, support it: answer questions briefly, encourage, and tell the astronaut to say "next" or "repeat"; do not start a different protocol unless the situation clearly changed.
5. Communication: never wait for Earth. Mention that Mission Control has been / will be notified when the link is available, and keep guiding regardless.
6. If the astronaut might lose consciousness (fainting, severe breathing problem, chest pain), set watch_for_collapse = true: the app will check on them if they stop answering — an unconscious person cannot answer questions.
7. No guaranteed diagnosis or treatment; follow validated first-aid principles only; medicines only as directed by the crew medical officer. Tell them to alert the crew medical officer and crewmates whenever someone else is on board.

symptoms: the symptoms you currently understand (short phrases). actions: 1-4 short current actions shown on screen."""

SECTIONS = {'body': (BODY_SYSTEM, BODY_SCHEMA, 'medium'), 'mind': (MIND_SYSTEM, MIND_SCHEMA, 'low'), 'emergency': (EMERGENCY_SYSTEM, EMERGENCY_SCHEMA, 'low')}

def gemini_schema(sc):
    """JSON schema → the OpenAPI subset Gemini's responseSchema accepts."""
    out = {}
    for k, v in sc.items():
        if k == 'additionalProperties':
            continue
        if k == 'type':
            out['type'] = v.upper()
        elif k == 'properties':
            out['properties'] = {n: gemini_schema(x) for n, x in v.items()}
            out['propertyOrdering'] = list(v.keys())
        elif k == 'items':
            out['items'] = gemini_schema(v)
        else:
            out[k] = v
    return out

def gemini_chat(system, schema, msgs):
    global _last_error
    key = gemini_key()
    body = {
        'systemInstruction': {'parts': [{'text': system}]},
        'contents': [{'role': 'model' if m['role'] == 'assistant' else 'user', 'parts': [{'text': m['content']}]} for m in msgs],
        'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': gemini_schema(schema), 'maxOutputTokens': 8192, 'temperature': 0.7},
    }
    data = json.dumps(body).encode('utf-8')
    for model in GEMINI_MODELS:
        rq = urllib.request.Request(f'{GEMINI_BASE}/models/{model}:generateContent', data=data, method='POST',
                                    headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
        try:
            with urllib.request.urlopen(rq, timeout=45) as r:
                resp = json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode('utf-8')).get('error', {}).get('message', '')
            except Exception:
                detail = ''
            if e.code == 404:  # model name not offered to this key → try the next one
                continue
            if e.code in (401, 403) or (e.code == 400 and 'API key' in detail):
                _last_error = 'The Gemini API key was rejected.'
                return 502, {'error': 'auth', 'message': _last_error}
            if e.code == 429:
                _last_error = 'Gemini free-tier limit reached — wait a minute (or until tomorrow) and try again.'
                return 502, {'error': 'rate_limit', 'message': _last_error}
            _last_error = f'Gemini API error {e.code}. {detail[:160]}'.strip()
            return 502, {'error': 'api', 'message': _last_error}
        except (urllib.error.URLError, TimeoutError, OSError):
            _last_error = 'Cannot reach Gemini (no internet connection?).'
            return 502, {'error': 'network', 'message': _last_error}
        cand = (resp.get('candidates') or [{}])[0]
        reason = cand.get('finishReason', '')
        text = ''.join(p.get('text', '') for p in (cand.get('content') or {}).get('parts', []) if not p.get('thought'))
        if not text and reason in ('SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII') or resp.get('promptFeedback', {}).get('blockReason'):
            return 502, {'error': 'refusal', 'message': 'The AI declined to answer this turn.'}
        try:
            out = json.loads(text)
        except ValueError:
            return 502, {'error': 'format', 'message': 'The AI answer was incomplete.' if reason == 'MAX_TOKENS' else 'The AI answer could not be read.'}
        _last_error = None
        out['model'] = resp.get('modelVersion') or model
        return 200, out
    _last_error = 'None of the Gemini models is available to this key.'
    return 502, {'error': 'api', 'message': _last_error}

def ai_chat(req):
    global _last_error
    section = req.get('section')
    if section not in SECTIONS:
        return 400, {'error': 'unknown section'}
    gem = provider() == 'gemini'
    c = None if gem else client()
    if not gem and (c is None or not has_credentials(c)):
        return 503, {'error': 'unavailable', **ai_status()}
    system, schema, effort = SECTIONS[section]
    msgs = []
    for m in (req.get('messages') or [])[-40:]:
        role = 'assistant' if m.get('role') == 'assistant' else 'user'
        text = str(m.get('content') or '')[:4000].strip()
        if not text:
            continue
        if msgs and msgs[-1]['role'] == role:
            msgs[-1]['content'] += '\n' + text
        else:
            msgs.append({'role': role, 'content': text})
    while msgs and msgs[0]['role'] != 'user':
        msgs.pop(0)
    if not msgs or msgs[-1]['role'] != 'user':
        return 400, {'error': 'the conversation must end with the astronaut speaking'}
    ctx = str(req.get('context') or '')[:6000]
    if ctx:
        msgs[-1] = {'role': 'user', 'content': f"<orbi_observations>\n{ctx}\n</orbi_observations>\n\n{msgs[-1]['content']}"}
    if gem:
        return gemini_chat(system, schema, msgs)
    try:
        resp = c.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            system=[{'type': 'text', 'text': system, 'cache_control': {'type': 'ephemeral'}}],
            output_config={'effort': effort, 'format': {'type': 'json_schema', 'schema': schema}},
            messages=msgs,
        )
    except anthropic.AuthenticationError:
        _last_error = 'The API key was rejected.'
        return 502, {'error': 'auth', 'message': _last_error}
    except anthropic.RateLimitError:
        _last_error = 'Rate limited by the API.'
        return 502, {'error': 'rate_limit', 'message': _last_error}
    except anthropic.APIStatusError as e:
        _last_error = f'API error {e.status_code}.'
        return 502, {'error': 'api', 'message': _last_error}
    except anthropic.APIConnectionError:
        _last_error = 'Cannot reach the AI service (no internet connection?).'
        return 502, {'error': 'network', 'message': _last_error}
    if resp.stop_reason == 'refusal':
        return 502, {'error': 'refusal', 'message': 'The AI declined to answer this turn.'}
    text = next((b.text for b in resp.content if getattr(b, 'type', '') == 'text'), '')
    try:
        data = json.loads(text)
    except ValueError:
        return 502, {'error': 'format', 'message': 'The AI answer was incomplete.' if resp.stop_reason == 'max_tokens' else 'The AI answer could not be read.'}
    _last_error = None
    data['model'] = resp.model
    return 200, data

# =====================================================================================================================
# Music: the crew's five MP3 files are served from music/ like any other file (with byte ranges for seeking).
# =====================================================================================================================
def http_get(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get('Content-Type', '')

# =====================================================================================================================
# Earth news: real articles from public news feeds (RSS/Atom), fetched when the internet is available.
# The browser stores them, so the latest news stays readable offline; nothing is invented.
# =====================================================================================================================
import html as _html, email.utils as _eu, xml.etree.ElementTree as _ET, concurrent.futures as _cf
from datetime import datetime as _dt, timezone as _tz

NEWS_FEEDS = [
    ('NASA', 'space', 'https://www.nasa.gov/news-release/feed/'),
    ('ESA', 'space', 'https://www.esa.int/rssfeed/TopNews'),
    ('Space.com', 'space', 'https://www.space.com/feeds/all'),
    ('ScienceDaily', 'science', 'https://www.sciencedaily.com/rss/top/science.xml'),
    ('ScienceDaily', 'environment', 'https://www.sciencedaily.com/rss/earth_climate.xml'),
    ('BBC News', 'science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'),
    ('BBC News', 'technology', 'https://feeds.bbci.co.uk/news/technology/rss.xml'),
    ('BBC News', 'culture', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'),
    ('Positive News', 'positive', 'https://www.positive.news/feed/'),
    ('Good News Network', 'positive', 'https://www.goodnewsnetwork.org/feed/'),
]
if os.environ.get('ORBITAL_NEWS_FEEDS'):  # testing / mission-specific feeds: JSON list of [source, category, url]
    NEWS_FEEDS = [tuple(x) for x in json.loads(os.environ['ORBITAL_NEWS_FEEDS'])]

def _txt(s, n=320):
    s = _html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= n else s[:n].rsplit(' ', 1)[0] + '…'

def _date(s):
    s = (s or '').strip()
    if not s:
        return None
    try:
        d = _eu.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = _dt.fromisoformat(s.replace('Z', '+00:00'))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=_tz.utc)
    return d.astimezone(_tz.utc).isoformat().replace('+00:00', 'Z')

def parse_feed(data, source, cat):
    root = _ET.fromstring(data)
    local = lambda e: e.tag.rsplit('}', 1)[-1]
    def child(e, *names):
        for c in e:
            if local(c) in names:
                return c
        return None
    out = []
    for e in root.iter():
        kind = local(e)
        if kind not in ('item', 'entry'):
            continue
        title = child(e, 'title')
        link = child(e, 'link')
        url = (link.get('href') or link.text or '').strip() if link is not None else ''
        guid = child(e, 'guid', 'id')
        date = child(e, 'pubDate', 'published', 'updated', 'date')
        summ = child(e, 'description', 'summary', 'content', 'encoded')
        item = {'headline': _txt(title.text if title is not None else '', 200), 'url': url,
                'id': (url or (guid.text if guid is not None else '') or '').strip(),
                'date': _date(date.text if date is not None else ''), 'summary': _txt(''.join(summ.itertext()) if summ is not None else ''),
                'source': source, 'cat': cat}
        if item['headline'] and item['id'] and item['date']:  # no publication date = cannot be verified as recent
            out.append(item)
    return out

def fetch_news():
    """Fetch every feed in parallel. Returns articles plus a per-source status (what worked and what did not)."""
    def one(f):
        source, cat, url = f
        try:
            body, _ = http_get(url, timeout=12)
            items = parse_feed(body, source, cat)
            return items, {'source': source, 'cat': cat, 'ok': True, 'count': len(items)}
        except Exception as e:
            return [], {'source': source, 'cat': cat, 'ok': False, 'reason': type(e).__name__}
    items, status = [], []
    with _cf.ThreadPoolExecutor(max_workers=8) as ex:
        for its, st in ex.map(one, NEWS_FEEDS):
            items += its; status.append(st)
    seen, uniq = set(), []
    for it in sorted(items, key=lambda x: x['date'], reverse=True):
        key = it['id'].split('?')[0].rstrip('/')
        if key not in seen:
            seen.add(key); uniq.append(it)
    return {'fetchedAt': _dt.now(_tz.utc).isoformat().replace('+00:00', 'Z'), 'items': uniq[:150], 'sources': status}

# =====================================================================================================================
# HTTP
# =====================================================================================================================
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
        '.webmanifest': 'application/manifest+json', '.task': 'application/octet-stream',
        '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
        '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.aac': 'audio/aac'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *a):
        pass

    # Only this machine, through localhost, may use the APIs (blocks other web sites and DNS-rebinding tricks).
    def trusted(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        origin = self.headers.get('Origin')
        if host not in ('localhost', '127.0.0.1'):
            return False
        if origin and urllib.parse.urlparse(origin).hostname not in ('localhost', '127.0.0.1'):
            return False
        return True

    def send_json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 200000:
            raise ValueError('too large')
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}') if n else {}

    def private_path(self):
        p = urllib.parse.unquote(urllib.parse.urlparse(self.path).path).lstrip('/')
        return any(p == x or p.startswith(x) for x in PRIVATE) or '/.' in '/' + p

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/api/'):
            if not self.trusted():
                return self.send_json(403, {'error': 'forbidden'})
            if path == '/api/ai/status':
                return self.send_json(200, ai_status())
            if path == '/api/news/fetch':
                return self.send_json(200, fetch_news())
            return self.send_json(404, {'error': 'not found'})
        if self.private_path():
            return self.send_error(404)
        if path.startswith('/music/') and 'Range' in self.headers:
            return self.send_range()
        return super().do_GET()

    def do_HEAD(self):
        if self.private_path():
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.trusted():
            return self.send_json(403, {'error': 'forbidden'})
        try:
            req = self.read_json()
        except ValueError:
            return self.send_json(400, {'error': 'bad request'})
        if path == '/api/ai/chat':
            code, obj = ai_chat(req)
            return self.send_json(code, obj)
        if path == '/api/ai/key':
            key = str(req.get('key') or '').strip()
            if key and not re.fullmatch(r'[A-Za-z0-9_\-]{20,300}', key):
                return self.send_json(400, {'error': 'That does not look like an API key.'})
            if key:
                with open(KEY_FILE, 'w', encoding='utf-8') as f:
                    f.write(key)
            elif os.path.exists(KEY_FILE):
                os.remove(KEY_FILE)
            return self.send_json(200, ai_status())
        return self.send_json(404, {'error': 'not found'})

    def send_range(self):
        """Byte ranges for audio files so the player can seek and read durations reliably."""
        fpath = self.translate_path(self.path)
        if not os.path.isfile(fpath):
            return self.send_error(404)
        size = os.path.getsize(fpath)
        m = re.match(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        if not m:
            return super().do_GET()
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2) or 0))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416); self.send_header('Content-Range', f'bytes */{size}'); self.end_headers(); return
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(fpath))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with open(fpath, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

if __name__ == '__main__':
    os.makedirs(MUSIC, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), lambda *a, **k: Handler(*a, directory=ROOT, **k)) as httpd:
        st = ai_status()
        print(f'ORBITAL running at http://localhost:{PORT}  (Ctrl+C to stop)')
        print('ORBI live AI: ' + (f"ready ({st['model']})" if st['available'] else 'not available - ' + st['message']))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
