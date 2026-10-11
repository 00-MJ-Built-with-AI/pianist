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
metronome with count-in, and A–B bar loops (click bars in the score) with automatic speed-up after clean passes.

## The report

Bar-by-bar heat map (click a bar to loop it), coach's notes (weakest stretch, rushing / dragging, pauses, tempo vs.
target, hands not together, dynamics vs. markings, melody balance, run evenness, pedal blur), a timing chart against
your own pulse, a tempo curve, a dynamics chart (MIDI only), and a replay of your performance.

## Songs

* 10 built-in public-domain pieces (scales, chords, Ode to Joy, Minuet in G, Für Elise, Canon in D …), written in a
  compact text notation in `src/music/library.ts` and engraved to MusicXML automatically.
* Import `.mid`, `.musicxml`, `.xml` or `.mxl` (drag onto the library). MuseScore exports all of these.
* **Record a song**: play with a metronome; your playing is quantized into sheet music you can practise.

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
src/music     song model, text notation, library, MusicXML generator, MIDI/MusicXML import, recording → song
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
