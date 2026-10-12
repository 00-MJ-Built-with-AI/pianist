# Pianist

A piano practice web app in the spirit of Harmono: it listens to your real piano (USB/Bluetooth MIDI or the
microphone), shows real sheet music with falling notes, and coaches you bar by bar.

## Run it

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests (song engine, practice modes, analysis)
npm run build      # production build in dist/
```

Use **Chrome or Edge** (Web MIDI). Plug the piano in by USB, open the app, click the input chip at the top
right → **Connect**. Without a piano you can play with the computer keyboard (`A`–`'` = C4–F5, `W E T Y U O P`
black keys, `Z`/`X` octave, `Shift` = pedal) or click the on-screen keys.

## Practice modes

| Mode | What it does |
| --- | --- |
| **Learn** | The music waits for you. Play the highlighted keys (chord notes in any order, within ~1 s) to move on. |
| **Practice** | Play at your own pace; the cursor follows your tempo. Wrong notes flash red, skipped notes count as missed, and you get a full report. |
| **Audition** | A performance with no hints. Afterwards: accuracy, tempo stability, timing, dynamics, balance, evenness, pedalling. |
| **Piano Roll** | Notes fall at a fixed tempo; hit them on the line for Perfect / Good, keep the combo. "Wait for me" turns it into Learn without the score. |
| **Listen** | The app plays the piece (sampled grand piano) while the score and notes scroll. |

Shared tools: choose left / right / both hands (the app plays or mutes the other hand), tempo 25–150 %,
metronome with count-in, A–B bar loops (click bars in the score) with automatic speed-up after clean passes,
**Wait for me / Keep going** (wait for the right notes, or keep playing at tempo and mark misses), and
**transpose** by half steps (C→D is two steps; the key signature follows).

## More

* **Today's practice**: a daily plan on the library page built from your history: a rotating scale warm-up, the
  weakest bars from recent reports as slowed-down loops, a rusty piece to review (or one ready for Audition),
  something new, and a sight-reading piece of the day, with a 15-minute goal.
* **Exercises**: scales (major, natural / harmonic minor) and arpeggios in all 12 keys, chord progressions with smooth
  voice leading, and an endless sight-reading generator in four levels.
* **Note editor**: fix any song on a piano-roll grid (add, move, resize, delete, switch hands, undo/redo) with the sheet
  music updating live; change tempo, time and key signature.
* **Export**: MusicXML, MIDI, or print / save as PDF.
* **Timing calibration**: play along with 12 clicks and Pianist measures and corrects your piano's delay.
* **Practice coach**: pick a passage; it walks you through right hand → left hand → together slowly → up to tempo →
  a keep-going run, moving on after each clean pass.
* **Ear training**: notes, intervals, chords and melodies; the app plays, you play it back; adaptive levels.
* **On the sheet music**: missed / early / late notes and wrong notes are marked on the score, and suggested
  fingering can be shown (a small optimiser using thumb-under, span and black-key rules).
* **Moving around**: jump a bar back or forward while playing (or click a bar), skip a note you're stuck on, start
  from any bar.
* **Display**: note names on all / white / C / no keys as letters, letters with octave or Do Re Mi; names on falling
  notes, key highlights, falling notes and keyboard size can be switched.
* **Install & offline**: installable app (manifest + service worker that caches the whole app, the note-detector model
  and the piano sound after first use); touch-friendly, multi-touch on-screen keyboard for tablets.
* **Fix my mistakes**: from any report, loop each stretch of weak bars slowly and speed back up to tempo.

## Make it yours (Settings)

* **Players**: separate profiles with their own progress, history, lists and settings (songs are shared).
* **Practice**: Relaxed / Normal / Strict presets or custom timing windows, clean-pass level, speed-up step and
  maximum; guide notes that softly play your part.
* **Metronome**: 0–2 bar count-in, beats or eighths, accented downbeat, beep / wood block / cowbell.
* **Sound**: concert grand, bright, mellow or electric piano; room reverb.
* **Look**: dark, light or high-contrast theme; hand colours (incl. a colour-blind preset); falling-note speed and
  colouring by hand, by note or by finger; glow.
* **Sheet music**: size, and a scrolling line or whole pages that turn by themselves.
* **Hands-free**: assign spare piano keys or the soft / middle pedal to start/stop, restart, next/previous bar, skip.
* **Score & feedback**: how much notes, timing, steady tempo and dynamics count; which report sections show; sound
  effects, confetti, and a spoken coach.
* **Daily plan**: goal minutes, which items appear, and a practice reminder.
* **Library**: search, sort, filter by level or tag, favourites, and per-song name, emoji, colour, level, tags and notes.
* **Backup & restore**: everything for every player in one file.

## The report

Bar-by-bar heat map (click a bar to loop it), coach's notes (weakest stretch, rushing / dragging, pauses, tempo vs.
target, hands not together, dynamics vs. markings, melody balance, run evenness, pedal blur), a timing chart against
your own pulse, a tempo curve, a dynamics chart (MIDI only), and a replay of your performance.

## Songs

* 10 built-in public-domain pieces (scales, chords, Ode to Joy, Minuet in G, Für Elise, Canon in D …), written in a
  compact text notation in `src/music/library.ts` and engraved to MusicXML automatically.
* Import `.mid`, `.musicxml`, `.xml` or `.mxl` (drag onto the library). MuseScore exports all of these.
* **Record a song**: play with a metronome; your playing is quantized into sheet music you can practise.
* **Transcribe audio**: drop an MP3 / WAV / M4A / OGG / FLAC (up to 10 minutes). Basic Pitch finds the notes in the
  browser, then the app detects tempo and beat, places bar lines (including a pickup bar), splits the hands, guesses
  the key signature and quantizes the rhythm. Tempo (×2 / ÷2), time signature, detail, hand split and simplification
  ("Everything", "Melody + bass", "Melody only") can be changed instantly without re-running the model. Solo piano
  recordings work best (on rendered piano audio: ~98 % of notes found, tempo exact); full band mixes come out rough.
* **Collections**: group songs into ordered lists, import files straight into a list, and practise a list in order.

Progress (best stars per mode, daily streak, minutes, session history with reports and replays) is stored in the
browser's IndexedDB. Nothing leaves your computer.

## How it hears the piano

* **MIDI**: exact notes, velocity and sustain pedal via the Web MIDI API (`src/input/midi.ts`).
* **Microphone**: Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) model running in the browser with
  TensorFlow.js (`src/input/mic/mic.ts`). Every 128 ms the last two seconds of audio (resampled to 22 050 Hz) go
  through the model; new onsets become key presses stamped with the time they actually sounded, so timing judgments
  stay accurate despite ~0.25 s of detection delay. Overtones are filtered, and notes the app itself plays
  (accompaniment, metronome) are ignored. Settings → *Check the microphone detector* runs a self-test.

## Code map

```
src/music     song model, text notation, library, MusicXML generator, MIDI/MusicXML import, recording → song,
              beat tracking and arrangement of transcribed audio
src/ai        Basic Pitch model loader, audio-file decoding and note extraction
src/engine    clock, accompaniment/metronome scheduling, mode controllers, session, analysis → report
src/input     input hub, MIDI, computer keyboard, microphone detector
src/audio     Web Audio context, sampled piano, app-sound log
src/ui        player (score strip + canvas stage), report, library, progress, recorder, settings
```

## Deploying (Vercel)

Web MIDI and the microphone need HTTPS, which Vercel provides. Vercel detects Vite automatically:

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

## Credits

Salamander Grand Piano samples by Alexander Holm (CC BY 3.0), served by the Tone.js project · Basic Pitch by Spotify
(Apache 2.0) · OpenSheetMusicDisplay (BSD-3) · @tonejs/midi (MIT).
