# Pianist: status and roadmap

**Live app:** https://pianist-six.vercel.app · **Code:** https://github.com/00-MJ-Built-with-AI/pianist
**Last updated:** 13 October 2026

At a glance:

| | |
| --- | --- |
| ✅ Built and live | 100+ features (below) |
| ⏳ Agreed and still to build | 37 features, in the order agreed |
| 🙋 Needs you | 6 things only you can do (2 more already done), and 7 decisions to make before those features are built |

The top right of the app shows when the version you're running was published. If a newer one is online, it turns into an **Update available** button.

---

## ✅ What Pianist has today

### Hearing your piano
- **MIDI**: USB or Bluetooth digital pianos in Chrome or Edge. It reads exact notes, loudness, and the sustain, soft and middle pedals.
- **Microphone**: Spotify's Basic Pitch model, running in your browser. It hears chords and is timed to within a few milliseconds.
  - While you practise, it listens harder for the notes the music expects, but still catches wrong notes.
  - It fills in the faint middle notes of chords.
  - It ignores strings ringing under the sustain pedal, and harmonics (overtones).
  - A noise gate stops it hearing "notes" in microphone hiss.
  - An "I use headphones" setting.
- **Computer keyboard and on-screen keys** for practising without a piano. Touch screens can play chords with several fingers.
- **Piano check-up**: a guided 3-minute test on your own piano. It explains what it found, recommends latency and sensitivity settings, and saves a file (optionally with a recording) for fine-tuning.
- **Timing calibration** (play along with clicks) and a microphone self-test.

### The five practice modes
- **Learn**: the music waits for you; chord notes can come in any order.
- **Practice**: the score follows your pace. Wrong and missed notes are marked, and you get a full report.
- **Audition**: a performance with no hints, and a detailed report afterwards.
- **Piano Roll**: falling notes at tempo, judged Perfect, Good or Miss, with a combo.
- **Listen**: Pianist plays the piece while the score scrolls.

### Tools in every mode
- Choose which hand you play: Left, Both or Right. The other hand is played by Pianist, silent, or hidden, with its own volume.
- Tempo from 25% to 150%.
- Metronome with a count-in, and a choice of beat, accent and sound.
- Loops of any bars, with automatic speed-up.
- **Wait for me / Keep going.**
- Transpose by half steps.
- Move around while playing: previous or next bar, skip a note, start from any bar, click a bar.
- Guide notes (Pianist softly plays your part).
- The practice coach (a step-by-step routine for a hard passage) and "Fix my mistakes" from any report.
- **Your own coach routines**:
  - a step builder with ready-made templates (hands separately, slow to fast, 2-bar chunks then join, rhythm variations, listen then from memory);
  - special steps: Listen first, From memory, and Eyes on the sheet;
  - a routine attached to a piece, so its Coach button starts it straight away.
- Hands-free control: spare piano keys or pedals act as Start/Stop, Restart, Next bar, Previous bar and Skip.

### Options for each mode (⚙ button)
- **Learn**:
  - Hear it first (Pianist plays each phrase, then it's your turn).
  - Hold notes for their full length.
  - What a wrong note does: nothing, a red flash, counts as a mistake, or back to the start of the phrase.
  - Look-ahead hints, and finger numbers on the keys.
- **Practice**:
  - Clean passes needed before speeding up, and slowing down after bad passes.
  - Hands rotation (right, then left, then both).
  - Fading metronome.
  - Stop and fix: a mistake loops its bar until it's clean, then the run carries on.
- **Audition**:
  - What you see while performing: everything, sheet music only, or nothing (from memory).
  - A 3-2-1 countdown, and how many restarts are allowed.
  - Compare with your best take.
- **Piano Roll**:
  - Game rules: lives, perfect-only, combo multiplier, points and high scores.
  - Read-ahead challenge (notes fade out or appear late).
- **All modes**:
  - Judge notes and rhythm, rhythm only, or notes only.
  - Each mode remembers its own setup for every piece.

### Seeing the music
- Real sheet music (OpenSheetMusicDisplay), as one scrolling line or as pages that turn by themselves, with zoom.
- Mistakes marked on the sheet, suggested fingering, and note names next to the notes.
- Falling notes, with:
  - speed;
  - colours by hand, by note or by finger;
  - glow;
  - names on the notes.
- On-screen piano:
  - key names (C only, white keys or all keys, as C4 or Do Re Mi);
  - computer-key letters;
  - key lights;
  - three sizes;
  - all 88 keys, or just the range of the piece.
- A **Show** row of one-tap switches for the piano, falling notes, key lights and every kind of label.
- Themes (dark, light, high contrast) and hand colours, including a colour-blind setting.

### Songs and library
- 11 built-in public-domain or original pieces, including the original "Lantern River Lullaby".
- Import MIDI and MusicXML (.mid, .musicxml, .xml, .mxl) by dragging files in.
- **Record a song** by playing it, and **transcribe audio** (MP3, WAV, M4A, OGG, FLAC) into sheet music with AI.
- **Transcriber presets**: ready-made and your own, the last settings remembered, and several files at once into a collection.
- **Note editor** (add, move, resize and delete notes, switch hands, undo) and **export** to MusicXML, MIDI or PDF.
- **Collections**: ordered lists of songs, practised in order.
- Search, sort, filter by level or tag, favourites, and each song's own name, emoji, colour, level, tags and notes.

### Exercises and training
- Scales and arpeggios in all 12 keys, chord progressions, and endless sight-reading at four levels.
- **Ear training**: notes, intervals, chords and melodies, with levels that adapt to you.
- **Your own ear drills**: pick exact intervals (up, down, together), chord types and inversions, notes in a key or melodies, and the note range. Answer by playing or by choosing the name. Rounds of 10–20, and the things you miss most come up more often.
- **Your own exercises**:
  - a pattern builder (Hanon-style patterns moved up the scale and back down, through any keys);
  - chord drills (types, inversions, block or broken);
  - scales in rhythms (dotted, swing, triplets, accents).
  - Save them, and let them take turns as the daily warm-up.
- **Mock exam**: scales, pieces and sight-reading combined into one mark, graded Pass, Merit or Distinction, with a history.

### Reports and progress
- **Report** after each run:
  - a bar-by-bar heat map;
  - a timing chart and a tempo curve;
  - dynamics and evenness;
  - coach's notes;
  - a replay of your performance.
- You choose how the score is weighted and which sections the report shows.
- **Progress**:
  - stars per mode;
  - your practice streak, minutes practised and session history;
  - a daily practice plan with a goal and a reminder.

### Personal settings and the app
- **Players**: separate profiles, each with their own progress and settings.
- **Backup and restore** to a file.
- Piano sounds (grand, bright, mellow, electric), reverb, volumes, sound effects, confetti, and a spoken coach.
- **Installable app** that works offline after the first visit, made for tablets.
- **Light on tablets**: the piano sound uses about 45 MB instead of 162 MB, and nothing is redrawn when idle.
- **Always up to date**: when you open the app, it switches to the newest version on its own. While it's open, it checks every 5 minutes and whenever you come back to it. The top right shows the publish date, or an **Update available** button.

---

## ⏳ What's left (agreed, in build order)

🙋 marks features that need a decision from you first (see the next section).

**Step 2: the 15 features chosen earlier** (1–4 done 13 Oct 2026)
1. ✅ **Your own coach routines**
2. ✅ **Custom ear training**
3. ✅ **Custom exercises**
4. ✅ **Transcriber presets**
5. **Remember settings per song**: tempo, key, hands and loop for each piece. Partly done: each mode already remembers its setup per piece.
6. **Custom keyboard shortcuts**: choose your own computer keys for Start, Next bar and so on.
7. **Report targets and PDF**: set goals (score, accuracy, tempo), and print or save reports as PDF.
8. **Weekly progress report** 🙋: a summary of the week.
9. **Achievements and challenges** 🙋: badges and weekly challenges.
10. **Pedal training**: exercises for clean sustain-pedal changes (MIDI).
11. **Audio recording** 🙋: record your real piano sound, alongside the note replay.
12. **Chord symbols and lead sheets**: chord names above the music, and playing from chord symbols.
13. **Backing tracks** 🙋: drums, bass and band styles to play along with.
14. **Teacher and student lessons** 🙋: lessons, assignments and feedback between a teacher and a student.
15. **Public-domain catalog** 🙋: many more free classical pieces, sorted by level.

**Step 3: learning and playing**

16. **Note-reading games**: timed games for naming notes, finding keys and reading key signatures.
17. **Rhythm trainer**: tap rhythms on any key, and clap back rhythms you hear.
18. **Theory lessons** (beginner to intermediate): intervals, scales, chords, keys, the circle of fifths, 7th chords and cadences.
19. **Memorize mode**: the sheet music fades away bar by bar as you play correctly.
20. **Free play and jam**: shows the chord names and key as you play, and keeps your ideas.
21. **Duet mode**: Pianist plays the other hand, or a real duet partner part, and follows your tempo.
22. **Touch and evenness trainer**: loud and soft on cue, and even scales (MIDI).
23. **Sight-reading test**: a graded test with a new piece each time, and a reading level.
24. **Practice journal**: a daily diary, filled in automatically, plus your own notes, goals and mood.

**Step 4: across devices**

25. **Sync between devices** through your own Google Drive 🙋 (needs a Google sign-in key; see below).

**Step 5: chosen 13 Oct 2026**

*Learn smarter*

26. **Simplify any piece**: easier versions with one click (melody only, a simpler left hand, thinner chords, simpler rhythms).
27. **Add a left hand**: Pianist writes a left-hand part for melody-only songs (block chords, broken chords, Alberti bass).
28. **What to learn next**: suggests your next piece and exercise from your level and what you've mastered.
29. **Recital planner**: a performance date for a piece, daily goals to get it ready, and a countdown.

*Practice tools*

30. **Play along with YouTube**: paste a link, slow it down, loop a section and practise next to it (YouTube's official player).
31. **Pencil on the sheet music**: draw and write on the sheet, saved with each piece and printed with it.
32. **Voice commands**: say "start", "slower", "again" or "next bar" (Chrome).
33. **Metronome page**: tap tempo, gradual speed-up, rhythm patterns and sounds, for practising from paper books.

*App*

34. **What's new panel**: after each update, a short list of what changed, shown once.
35. **App shortcuts**: long-press the installed app's icon for "Continue last piece", "Today's plan" or "Piano check-up".
36. **Follow system theme**: light or dark switches with your computer's setting.
37. **Bigger text and accessibility**: a larger-text option, full keyboard navigation and screen-reader labels.

*Family and sharing*

38. **Family dashboard**: every player's streak, minutes and recent stars on this device, on one screen.
39. **Certificates**: printable certificates for a passed mock exam, 3 stars on a piece, or a long streak.
40. **Share a performance**: save a performance and its report as a file; the person you send it to opens it in Pianist.
41. **Play with a friend online** 🙋: live duets or challenges between devices (needs a server; see below).

---

## 🙋 What needs you

### Things only you can do

1. **Test on your real piano.** Open Settings → Timing & microphone → **Piano check-up**. Do it with MIDI (USB cable) and with the microphone, press **Save check-up file**, and send me the file (put it in the `piano-app` folder or attach it in the chat). So far everything has been tested with simulated pianos, so this is how I tune it to your piano and room.
2. **Try it on your own devices**: your computer in Chrome or Edge, and any tablet. Android Chrome supports MIDI; iPad Safari does not, so an iPad can only use the microphone.
3. ✅ **Automatic deploys** (done 13 Oct 2026). The repository is connected to Vercel, so every push to `main` publishes the site by itself.
4. **Update the local git address** (optional; I'm not allowed to change it). Pushing still works through GitHub's redirect.
   `git remote set-url origin https://github.com/00-MJ-Built-with-AI/pianist.git`
5. ✅ **Google sign-in key** (received 13 Oct 2026; stored in `src/config.ts`). It's ready for sync in step 4. Sync only uses Pianist's own hidden folder in your Drive (`drive.appdata`). While the Google app is in "Testing", only the test users you added can sign in.
6. **Copyrighted songs** (for example "Leaves from the Vine" or "Let It Go"): get a legal MIDI or MusicXML file (buy it or download a licensed one) and drag it into the library. You can also transcribe a recording you own. They can't be bundled in the public app.
7. **Approve actions when Claude Code asks**, such as publishing the site.
8. **Set up a small server account** for *Play with a friend online* when we get there. Real-time play between two devices needs a relay service. Options include Supabase Realtime, Ably and PartyKit; each has a free tier with limits and may cost money as it grows. You'd create the account, and I'd write the code.

### Decisions before I build these

| Feature | Question for you |
| --- | --- |
| Teacher and student lessons | Who is the teacher (you, a real teacher, a family member)? How should lessons travel: as files you send (free, no server), through Google Drive after sync, or with accounts on a server (costs money)? |
| Public-domain catalog | How many pieces, and which levels or composers? Is it OK to include free pieces that require a credit line (for example from the Mutopia Project, CC BY-SA)? |
| Backing tracks | Which styles (pop, ballad, waltz, jazz, Latin, rock)? Drums and bass only, or a fuller band? |
| Weekly progress report | Shown in the app only, or also by email? Email needs an email service and an account. |
| Achievements and challenges | Playful (kid-friendly badges) or grown-up (milestones and stats)? Weekly challenges picked by Pianist, or chosen by you? |
| Audio recording | Keep recordings in the browser (there's a storage limit), or save each one as a file? |
| Play with a friend online | Which service (free tier first)? Only people you invite with a code, or open matchmaking? Duets only, or challenges too? |

All other features can be built without further input.

---

## Change log

| Date | What changed |
| --- | --- |
| 12 Oct 2026 | First version: five practice modes, MIDI and microphone, sheet music, falling notes, reports and progress |
| 12 Oct 2026 | Microphone tuning, collections, the "Lantern River Lullaby" piece, audio-to-sheet-music transcription |
| 12 Oct 2026 | Keep going and transpose, timing calibration, exercises, daily plan, note editor and export |
| 12 Oct 2026 | Display options and moving around, mistakes and fingering on the sheet, practice coach, ear training, installable and offline |
| 12 Oct 2026 | Customisation: Settings page, players, backup, hands-free control, themes, sounds, library tools, feedback |
| 13 Oct 2026 | Piano check-up, smarter microphone hearing (noise gate, chords, pedal ring), lighter and smoother on tablets |
| 13 Oct 2026 | Options for each mode, hand controls, the Show row, game rules, comparing takes, mock exam |
| 13 Oct 2026 | Always loads the latest version, with the publish date and an Update button at the top right; this status page; 16 more features planned (step 5) |
| 13 Oct 2026 | Automatic publishing from GitHub turned on; Google sign-in key for sync added |
| 13 Oct 2026 | Your own coach routines, custom ear drills, custom exercises (patterns, chord drills, rhythms, warm-ups), transcriber presets and batch transcription |
