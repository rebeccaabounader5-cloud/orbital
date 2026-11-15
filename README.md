# ORBITAL — AI-Powered Astronaut Health Monitoring (NASA Space Apps Challenge prototype)

ORBITAL is an offline-first, browser-based health-monitoring and decision-support companion for astronauts on
long-duration missions. It uses only the computer's ordinary **webcam** plus information that already exists
(self-reports, onboard device readings typed in, imported spacecraft/medical files).

> **Student prototype — not a medical device.** ORBITAL does not diagnose. Thresholds are literature-based
> prototype defaults, not NASA flight rules. Emergency cards summarise general first-aid guidance and must be
> replaced by a mission's approved checklists.

---

## 1. Quick start (≈1 minute)

Requirements: **Python 3** (any recent version) and a Chromium-based browser (**Chrome or Edge**, recommended),
or Firefox. No `npm install`, no build step, no internet — every library and model is already in `vendor/` and `models/`.

```bash
cd orbital
```

```bash
python3 serve.py
```

Open **http://localhost:8080** in Chrome/Edge.

*Why a server?* Browsers only allow webcam access in a **secure context**; `http://localhost` qualifies, a
`file://` double-click does not (ES modules and the service worker also need HTTP). Any static server works,
e.g. `npx serve` or `python3 -m http.server 8080`.

On first launch ORBITAL loads a **demo mission with 30 days of clearly labelled _simulated_ data** so every
chart and alert can be demonstrated immediately. Remove it any time in **Profile & Data → Remove simulated data**.

### Granting webcam permission
1. Go to **AI Camera** → **▶ Start camera**.
2. The browser asks for permission → **Allow**.
3. If you blocked it earlier: click the camera/lock icon in the address bar → *Camera: Allow* → reload.
4. Use even, frontal lighting; keep your face centred, about an arm's length from the camera.

---

## 2. Offline use

1. Open ORBITAL once at `http://localhost:8080` while the server is running. The **service worker** precaches
   all 54 app files (~36 MB, including the three computer-vision models and WebAssembly runtime).
2. Reload once. **Profile & Data → Offline status** should show *Service worker: active*.
3. Optional: install as an app (Chrome/Edge menu → *Install ORBITAL*, or the button in Profile & Data).
4. Now disconnect the network — everything keeps working. (The local server must still be running unless you
   installed the app; the installed PWA serves itself from cache.)

| Works fully offline | Notes |
|---|---|
| All 9 pages + Profile & Data, navigation, charts | Chart.js, Three.js, fonts bundled locally |
| Webcam face / hand / pose tracking | MediaPipe Tasks Vision models run on-device (WASM + WebGL/CPU) |
| Experimental rPPG heart rate & breathing estimates | Local signal processing |
| Rule-based health analysis, alerts, projections, correlations | `js/analysis.js`, no AI service |
| Emergency triage rules, reference cards, reports | Shown instantly, no processing delay |
| Data storage, export, import, backup/restore | IndexedDB in the browser |

After you change any file, run `python3 tools/build-sw.py` to refresh the precache list and version.

---

## 3. Tour of the application (how to demo each requirement)

| Page | What to try |
|---|---|
| **Dashboard** | Wellness index, 5-hazard status, top recommendations, daily health missions (XP/badges), key indicators vs baseline, alerts with reasoning, recent observations, 14-day trends. |
| **AI Camera** | Start camera → live observations (face detection, blink rate, PERCLOS-style eye closure, head pose, gaze, lighting, facial movements). **No manual tests:** while the camera runs, ORBITAL automatically saves blink rate, eye closure, gaze stability and posture every minute. Experimental rPPG heart-rate and breathing estimates. |
| **Virtual Body** | **Voice only.** Say what hurts ("why does my head hurt?", "my lower back aches", "I have chest pain"). ORBITAL zooms to and highlights that part of the 3D body while it **speaks** likely causes in spaceflight and what to do. It asks a yes/no red-flag question; red flags (or words like "crushing", "worst headache", "can't breathe", "collapsed") start a **spoken step-by-step emergency protocol** ("next" / "repeat" / "back" / "stop"), log an emergency event and show progress dots. Captions are optional (CC). |
| **Physical Health** | No manual tests and no manual entry. Camera-observed indicators (HR, breathing, reaction time, coordination, posture, gaze, blinking, eye closure) vs baseline; **daily cabin workout** (rotating plans; extra balance/gaze drills before landing) with a **voice-guided session**; 7-day adherence; **skipped-exercise detection** — ORBITAL checks in and looks for reasons in sleep, stress and mood observations. Demo buttons simulate what the camera sees. Lab records import, trends. |
| **Mental Health** | **No questionnaires.** The AI floating camera (RGB + thermal) observes sleep (duration, time to fall asleep, awakenings, restlessness → insomnia / sleep-discomfort signs), stress & muscle tension, low-mood signs, silence and conversation with crew — **simulated** via demo scenarios. **Well-being companion** (voice + text): varied, non-repeating, remembers what you told it; speaks only when you call it ("ORBITAL…") or when it sees very bad signs (persistent low-mood signs → plays a happy song; long silence with crew present → shares a happy memory; skipped exercise → asks why). Relaxation exercises appear only when tension/stress is detected. Daily **news from Earth** (simulated, light-time delayed). |
| **Emergency Center** | Conversational emergency assistant: describe what is happening by voice or text; ORBI gives the immediate action, asks one relevant question at a time, starts the validated spoken protocol on red flags (rule-based check always first, live AI or offline engine for the conversation), shows status, symptoms, labelled vital signs, Earth-link status (with loss-of-signal simulation; reports queued and sent when the link returns), current actions and event history. Responsiveness check: if a person who may faint stops answering, ORBI asks "Are you okay?" and starts the unresponsive protocol after 15 s. The old checklist and reference cards remain as optional shortcuts. |
| **Mission Environment** | Simplified: overall cabin status, temperature, pressure, oxygen, CO₂ and humidity with limits and source labels, environmental alerts, one CO₂ chart, and collapsed data entry / import / demo telemetry. |
| **Spaceflight Hazards** | Simplified: space radiation (mission dose vs the 600 mSv limit), microgravity, cabin environment, isolation & distance — each with its effect on the body, what ORBITAL watches, status and current values — plus the active health & safety alerts. |
| **Profile & Data** | Profile and mission stages, baseline window, PIN lock, offline status, install, full JSON backup/restore, CSV export, sync package, simulated-data controls, reference-value table. |

Suggested 5-minute demo: Dashboard → Mental Health (demo scenarios: Persistent low-mood signs, Stress, Insomnia; talk to ORBITAL) → Physical (Session skipped) → Virtual Body (say "why does my head hurt?", then "I have chest pain" → "yes") →
Mental (news) → Environment (+ CO₂ excursion) → Emergency (tick *Chest pain* + *Cold sweat*) → Profile & Data (event history) → turn
Wi-Fi off and reload to show offline mode.

---


### Voice, music and the companion (v1.1)
* **Voice output** uses the computer's installed voices (works offline on Windows/macOS).
* **Voice input** uses the browser's Web Speech API (Chrome or Edge). By default Chrome sends audio to its speech
  service, which needs a network connection. *Profile & Data → Pre-mission library → Use on-device voice recognition*
  asks Chrome (139+) for offline recognition instead; if unavailable, ORBITAL falls back automatically. If voice input
  cannot work, the Virtual Body shows a small text box as a fallback and the companion accepts typing.
* **Music:** the library lists real recent upbeat songs (e.g. "APT.", "Golden", "Espresso"). Audio is not bundled
  (copyright): load your licensed files in Profile & Data. Unloaded songs play a short synthesised placeholder tune.
* **Happy memories:** example memories are included; add your family's own in Profile & Data.
* **Optional on-device AI:** if the browser exposes Chrome's built-in on-device language model, the companion uses it for
  free conversation; otherwise it uses its offline, non-repeating reply engine.
* The companion is not a therapist and ORBITAL never diagnoses depression or any condition: it reacts to observed patterns.
* Emergency guidance is general first aid (see protocols); in a mission the vehicle's approved checklists and the crew
  medical officer take precedence.


## ORBI — the floating AI companion camera (v1.2)
ORBI is a spherical free-flyer (inspired by JAXA's Int-Ball2) with **two eyes**. Open **AI Camera · ORBI**:
* **Eye 1 — RGB (real):** your webcam, analysed on-device: face & landmarks, blinks / eye closure, facial-fatigue index,
  pose, posture & movement briskness, facial puffiness vs a reference image, rolling **rPPG heart-rate estimate**
  (POS method — not skin redness). Each capability shows *Active / Analyzing / Insufficient image quality /
  Unavailable*. No webcam → **Demo footage (simulated)**, clearly labelled. Saves observations automatically every minute.
  If the room goes dark the RGB eye hands over to the thermal eye.
* **Eye 2 — Thermal (simulated unless hardware is connected):** a webcam cannot see infrared, so ORBI simulates a
  radiometric thermal camera and *analyses* that data: breathing rate from nostril temperature, forehead / inner-eye
  temperature (skin ≠ core temperature), stress pattern (forehead warmer, nose cooler), and a **night mode** that tracks
  sleep in darkness (sleep/wake/restless, awakenings, sleep onset) and saves the night to Mental Health. A UVC thermal
  camera can be connected (relative false-colour; calibrated °C needs the vendor SDK).
* **ORBI analysis:** today vs yesterday vs previous 7 days vs the sample **pre-flight Earth baseline**, 7-day trend,
  "Check" (one day) / "Investigate" (2 of 3 days); critical single readings trigger an immediate spoken safety check.
* **Emergency demo — astronaut cannot speak:** ORBI asks "Are you okay?"; with no answer in 15 s it starts the
  unresponsive-person protocol by itself, speaks each step, logs the event and sends a report to Earth.

Voice: say **"ORBI, …"** anywhere ("ORBI, how did I sleep last night?", "ORBI, show me my heart rate",
"ORBI, play some music", "ORBI, tell me what happened on Earth today", "ORBI, I don't feel like exercising",
"ORBI, I need someone to talk to", "ORBI, start my exercise"). The **⏸ Mission ops** button makes ORBI hold
non-urgent support until a critical operation is finished (safety checks are never held).

Earth news: real articles from public news feeds (NASA, ESA, Space.com, ScienceDaily, BBC, Positive News, Good News Network) are fetched by `serve.py` when the internet is available and stored in the browser, so the latest news stays readable offline. Each calendar day shows articles never shown before (identified by URL), with headline, summary, publication date, source and the time ORBITAL received them. If the feeds cannot be reached the page says the feed was not updated; old stories are never recycled. Files prepared on Earth can still be uplinked (Profile & Data).

## ORBI AI conversations, continuous voice & real music (v1.3)

**Live AI (Claude).** The Virtual Body and the Well-being Assistant can be driven by Claude through ORBITAL's own
server — the key never reaches the web page.
1. Once, in PowerShell: `python -m pip install anthropic`
2. Start ORBITAL as usual: `python serve.py` (it prints whether the live AI is ready).
3. Profile & Data → *ORBI live AI* → paste an Anthropic API key → *Save on this computer* (stored in `orbi_ai_key.txt`
   next to `serve.py`, never served to the browser). Setting `ANTHROPIC_API_KEY` works too.
While the live AI is on, conversation text and ORBI's observation summary are sent to Anthropic's API (internet needed).
Without it, a badge says **"Offline rules — not a live AI"** and ORBI uses its built-in conversation engines
(`js/ai/medical.js`, `js/companion/chat.js`): they understand free speech and keep context, but they are not a language model.
The rule-based emergency check always runs first, even with the live AI.

**Free live AI with Google Gemini (new).** Get a free key at **aistudio.google.com** → *Get API key* (it starts with
`AIza`). Paste it in **Profile & Data → ORBI live AI → Save on this computer** — nothing to install. The badge then shows
**"Live AI · Gemini"** on the Virtual Body, Well-being and Emergency pages. The key is stored only in `orbi_ai_key.txt`
next to `serve.py` (never in the web page, never served). The free tier has request limits; when they are reached ORBI says
so and falls back to its offline rules. On the free tier Google may use the conversation text to improve its products.
A Claude key (`sk-ant-…`) still works too; ORBITAL detects which one you pasted.

**Two separate conversations.** Virtual Body (medical) and Well-being (companion) keep their own conversation history;
a one-line summary is shared between them only if *Share a short health summary* is ticked.

**Continuous voice.** Press the microphone once. ORBI listens → thinks → speaks → listens again on its own; the microphone
is paused while ORBI speaks so it never answers itself. Natural pauses mid-sentence are allowed (about 1 second).
Chrome's standard speech recognition needs internet; on-device recognition can be enabled in Profile & Data.

**Music:** see v1.5 below (five MP3s only).

## v1.4 changes
* **AI Camera — RGB eye fixed:** models load as soon as the page opens; detection errors are no longer swallowed (after repeated GPU failures the face model switches to the CPU, and persistent failures are explained); time-based heart-rate and puffiness windows (they never completed at 15 fps webcams); clear HUD states (scanning / face locked / face lost / too far / no video / low light) with plain-language reasons; head-movement and gaze readouts; the thermal eye only takes over in darkness when no face is visible; a thermal "hardware" device can no longer grab the RGB webcam; the webcam is released if the page is left during start-up.
* **Selected songs (replaced in v1.5 by local MP3s):** the five YouTube Music tracks chosen by the crew (sad/lonely, motivation, hope & connection ×2, rest) play through YouTube's official embedded player (IFrame API), shown on screen while playing. ORBI reports "playing" only after YouTube confirms it; restricted or offline tracks are explained and the exact YouTube Music link is offered — never a substitute.
* **Removed:** Health Timeline. **Moved:** Health event history → Profile & Data (same records).

## v1.5 changes — AI, camera, music & emergency upgrade
**Music — exactly five songs, played from MP3 files on this computer (works offline).**
| Mood | Song | Exact file name |
|---|---|---|
| Sad / lonely | Count on Me — Bruno Mars | `Bruno Mars - Count on Me (Official Lyric Video).mp3` |
| Stressed | A Sky Full of Stars — Coldplay | `@coldplay - A Sky Full Of Stars (Lyrics).mp3` |
| Needs motivation | Hall of Fame — The Script | `The Script - Hall Of Fame (Lyrics).mp3` |
| Wants to feel happy | Firework — Katy Perry | `Katy Perry - Firework (Lyrics).mp3` |
| Wants to relax | Piano Man — Billy Joel | `Billy Joel - Piano Man (Lyrics).mp3` |

Add them either by copying the files into the `music/` folder with exactly these names, or in **Profile & Data → Music
library → ⇪ Load MP3** (stored in the browser, plays offline). The MP3s are **not** included in this package — they are
copyrighted, so do not upload them to GitHub or any public site. If a file is missing ORBI says so honestly.
Voice: "I need motivation", "I'm stressed", "make me happy", "I want to relax", "play Piano Man", "pause", "resume",
"skip", "stop the music". A feeling on its own ("I feel lonely") gets a conversation first; ORBI may *offer* a song and
respects "no". All other songs, YouTube playback and downloaders were removed.

**Virtual Body.** Short answers (one or two sentences, more on "tell me more"); understands "explain that again", "keep it
short", "why?", "what should I do?", "I don't understand", "let's move on", "I have another problem". Severity levels
(minor / moderate / severe / life-threatening): severe complaints get urgent questions only, never a 5-step routine.
Medication is only suggested from the CMO-approved list in Profile & Data and checked against allergies.
**Guidance steps** run on a state machine: no answer for 30 s → the step is repeated once, then the next step; after the
last step ORBI waits 30 s and asks "Are you still there?"; if there is still no answer ORBI looks through the camera —
silence alone is never treated as unconsciousness. Collapse / eyes closed and no movement → emergency escalation (SOS to
Earth, queued if the link is down; crew alarm if crew are on board; event recorded; protocol started; monitoring
continues). Camera can't tell → escalation marked *uncertain* (crew alerted, no CPR prompt). Say "next", "repeat",
"stop", or describe a new emergency at any time. A **Safety test** panel simulates camera evidence — all simulated
events are tagged `[SIMULATION]`, and no real message ever leaves the computer.

**AI Camera.** Thermal: named facial regions (forehead, inner eye corners, nose, cheeks, breath zone) with a personal
baseline and Δ values, gradients, data quality, a face-temperature trend through the night, and every value labelled
SIMULATED (no thermal hardware in a webcam). **Sleep watch (RGB):** eyes open → awake; eyes closed and still for a set
time → *possibly asleep*; face not visible or too dark → *UNKNOWN*. Sleep is saved only after ≥ 60 min observed asleep
with ≥ 70 % coverage — no invented sleep records.

**Workout form coach (Physical).** Uses MediaPipe Pose 3-D landmarks: recognises squat, lunge, deadlift, heel raise,
shoulder press, row, plank and balance hold; counts reps; exercise-specific checks (knee collapse, forward lean, depth,
speed, left/right asymmetry, hip sag…) with spoken corrections; asks naturally when a movement looks unusual or painful;
says "I can't see your knees/ankles" instead of guessing. Sessions are stored and feed **Unusual trends explained**
(slower reps, smaller range, recurring asymmetry, form drop).

**Well-being Assistant** is a separate AI with its own conversation, personality and voice. Tiers: Claude (key on the
server) → **free on-device Chrome AI (Gemini Nano, where Chrome offers it — enable in Profile & Data)** → offline rules.
The badge on each page says which one is answering, and the status bar shows which assistant owns the microphone.

## Public website (GitHub Pages) — open ORBITAL from any network
GitHub Pages hosts ORBITAL for free at `https://<your-username>.github.io/<repository>/` (HTTPS, so camera and
microphone work). There is no `serve.py` there, so the app switches to **public website mode** automatically:
* **AI:** each visitor pastes their own free Gemini key in Profile & Data. It is kept only in that visitor's browser
  (localStorage) and sent only to Google; it is never in the code or the repository. Without a key, the offline rules work.
* **Music:** the MP3s are not on the website (copyright). Each visitor uses Profile & Data → Load MP3.
* **News:** Earth news feeds need the local server; the website shows the built-in news.
* Everything else (camera, voice, Virtual Body, emergency, exercise coach, data) works the same, stored per browser.

Publish:
1. github.com → **New repository** → name `orbital` → **Public** → Create.
2. **uploading an existing file** → drag *all the contents* of the `orbital` folder (not the folder itself, and no MP3s
   or `orbi_ai_key.txt`) → **Commit changes**.
3. Repository **Settings → Pages** → Source **Deploy from a branch** → Branch **main**, folder **/ (root)** → Save.
4. After 1–2 minutes the address appears at the top of the Pages screen.
After changing a prompt in `serve.py`, run `python tools/export-prompts.py` so the website uses the same prompts.

## 4. Data sources and honesty labels

Every value carries one of six badges, everywhere in the UI and in exports:

| Badge | Meaning |
|---|---|
| **Observed** | Measured directly by ORBITAL: computer vision on the webcam image or a timed interactive task. Observation, not diagnosis. |
| **Experimental** | Experimental camera estimate (rPPG heart rate, breathing). Shows signal quality; not a medical measurement. |
| **Self-report** | Answers from the astronaut. |
| **Manual entry** | A reading from an onboard device typed in by the crew. |
| **Imported** | Loaded from a spacecraft system file or medical record (JSON/CSV). |
| **Simulated** | Synthetic demo data generated by ORBITAL (dashed badge). Never a real measurement. |

---

## 5. How the analysis works (`js/analysis.js`)

A transparent, local **rule-based engine** (no cloud AI, nothing pretending to be one):

* **Personal baseline** — median and robust spread (MAD) of each indicator over a configurable baseline window
  (default mission days 5–11, after initial adaptation).
* **R1 baseline deviation** — recent 3-day mean ≥2× normal variation and ≥8% from baseline in the unfavourable direction.
* **R2 reference ranges** — device readings (SpO₂ < 90/95 %, temperature ≥ 38 °C, BP ≥ 140/90, resting HR > 100).
* **R3/R4 environment & radiation** — configurable limits, cumulative dose vs career limit.
* **X1–X6 cross-hazard patterns** — radiation × lab changes, multi-indicator fatigue, persistent mood/stress,
  CO₂ × headaches, exercise × movement scores, repeated symptoms. Individual deviations are folded into the pattern
  alert that lists them as evidence. Labelled *association, not proven cause*.
* **P1 projections** — 14-day linear trend extrapolated 7 days with ~95 % band; labelled *estimate*.
* Every alert lists **what changed, why it may matter, supporting data with sources, next steps and the rule**.
* **Emergency triage** (`js/content/protocols.js`) is a separate, deterministic, instant rule set — it never waits for analysis.

---

## 6. Limitations (please read)

* **3D anatomy:** the body is a **procedurally generated schematic** built from Three.js primitives — organ
  shapes/positions are approximate. No licensed anatomical mesh is bundled. To upgrade, export organ meshes from
  **Z-Anatomy** (CC BY-SA 4.0) or **BodyParts3D** (CC BY-SA 2.1 JP) as glTF, load them with `GLTFLoader` in
  `js/body3d.js`, and keep the `userData.organ` ids (`brain`, `heart`, `lungs`, …).
* **Webcam cannot measure** blood pressure, SpO₂, glucose, body temperature, radiation, blood counts, bone density,
  muscle mass, internal organs, DNA damage, or air quality; it cannot diagnose disease, detect pain, or infer emotions.
* **rPPG / breathing** are experimental: accuracy depends on light, motion, camera quality and skin tone. ORBITAL
  shows signal quality and refuses to give a number when quality is low.
* **Gaze tracking** with a webcam is coarse (iris position relative to eye corners); scores are for within-person comparison.
* **PERCLOS** is approximated from the MediaPipe eye-blink blendshape. The reaction task is 60 s (standard PVT: 3–10 min).
* **Facial "symmetry"** is affected by lighting/head angle and is not a stroke test — sudden facial weakness → Emergency Center.
* **Thresholds** are literature-based defaults (cited in-app); they are not official NASA limits or clinical cut-offs.
* **Emergency cards** summarise general first-aid guidance (AHA, ERC, Red Cross, AHA/ASA); they are not NASA
  protocols and give no drug doses.
* **Security:** the PIN is a local access screen (SHA-256 hashed); IndexedDB data is **not encrypted at rest**.
* **Sync:** no ground link exists in the prototype; reports are exported as files and tracked in a queue you mark as sent.
* **Python/ML backend:** not needed — all CV runs in-browser via WebAssembly, which keeps the demo to one command.
* GPU acceleration falls back to CPU automatically; on older laptops hand/pose tracking may run at reduced frame rate.

---

## 7. Project structure

```
index.html            app shell, navigation
css/styles.css        space-medical UI theme
js/app.js             boot, hash router, PIN lock, service-worker registration
js/db.js, store.js    IndexedDB storage + in-memory state/event bus
js/metrics.js         indicator registry, data-source taxonomy, reference values (with citations)
js/analysis.js        rule-based analysis, baselines, correlations, projections
js/seed.js            simulated demo mission (all records source:"simulated")
js/game.js            daily missions, XP, badges (rewards actions, never results)
js/cv/vision.js       MediaPipe face/hand/pose, blink & eye-closure tracking, drawing
js/cv/signal.js       rPPG (POS) & breathing estimation, spectral SNR quality
js/body3d.js          Three.js schematic anatomy
js/content/           organ knowledge base, hazard content, emergency reference cards
js/pages/*.js         the nine pages + settings
vendor/, models/      bundled libraries, fonts and CV models (offline)
samples/              example import files
sw.js, manifest       offline support / installable PWA
tools/build-sw.py     regenerates sw.js precache list
```

## 8. Licences & credits

* Three.js r160 — MIT · Chart.js 4.4.1 — MIT · MediaPipe Tasks Vision 0.10.14 and face/hand/pose landmarker
  models — Apache-2.0 (Google) · Inter & Orbitron fonts — SIL Open Font License (`vendor/fonts/`).
* Scientific basis: NASA Human Research Program evidence reports, NASA-STD-3001, peer-reviewed sources cited in the
  app (e.g. Barger 2014, Basner 2014, Zeitlin 2013, Law 2014, Lee 2020, Marshall-Goebel 2019, Trudel 2022, Hughes 2004,
  Åkerstedt & Gillberg 1990, Wang 2017 POS rPPG).
