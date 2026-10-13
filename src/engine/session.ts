import { perfToAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import { inputHub, type InputSource, type PlayedNote } from '../input/hub';
import { micLag } from '../input/mic/mic';
import { measureIndexAt, measureLength } from '../music/song';
import { regionFor, wholeSong, type Region } from '../music/steps';
import type { Hand, Note, Song } from '../music/types';
import { analyze } from './analysis';
import { Clock } from './clock';
import {
  FollowController,
  LearnController,
  ListenController,
  RollController,
  type Controller,
  type Flash,
  type KeyKind,
  type SessionContext,
} from './controllers';
import { ClickScheduler, NoteScheduler, buildClicks } from './scheduler';
import { NoteMark, type PassSummary, type RecordedEvent, type Report, type SessionOptions } from './types';
import { DEFAULT_MODE_OPTIONS, TUNING_PRESETS, type ModeOptions, type Tuning } from '../store/settings';
import type { Judging } from './types';

export interface Hud {
  accuracy: number | null;
  combo: number;
  perfect: number;
  good: number;
  miss: number;
  wrong: number;
  pass: number;
  rate: number;
  message: string | null;
  waiting: boolean;
  timed: boolean;
  status: Session['status'];
  /** Piano Roll game rules. */
  points: number;
  lives: number | null;
  multiplier: number;
  /** Hear it first: Pianist is playing the phrase. */
  demo: boolean;
}


const NO_NOTES: ReadonlySet<number> = new Set();

export class Session implements SessionContext {
  readonly clock = new Clock();
  readonly region: Region;
  readonly hands: Hand[];
  readonly userNotes: Note[];
  readonly allNotes: Note[];
  readonly marks: Uint8Array;
  readonly leadIn: number;
  readonly tuning: Tuning;
  readonly judging: Judging;
  readonly learn: ModeOptions['learn'];
  readonly roll: { lives: number; perfectOnly: boolean; multiplier: boolean };
  targetBps: number;
  rate: number;
  metronome: boolean;
  status: 'running' | 'finished' = 'running';
  report: Report | null = null;
  message: string | null = null;
  flashes: Flash[] = [];
  readonly keyKinds = new Map<number, KeyKind>();
  private recording: RecordedEvent[] = [];
  private passes: PassSummary[] = [];
  private passStart: number;
  private controller: Controller;
  private appSched: NoteScheduler;
  private guideSched: NoteScheduler | null;
  private countInClicks = true;
  private clickSched: ClickScheduler;
  private unsubs: Array<() => void> = [];
  private listeners = new Set<() => void>();
  private startedAt: number;
  private lastSource: InputSource | 'none' = 'none';

  constructor(
    readonly song: Song,
    readonly opts: SessionOptions,
    now: number,
  ) {
    this.region = opts.loop
      ? regionFor(song, opts.loop.from, opts.loop.to)
      : opts.startMeasure
        ? regionFor(song, opts.startMeasure, song.measures.length - 1)
        : wholeSong(song);
    this.hands = opts.hands;
    this.rate = opts.rate;
    this.metronome = opts.metronome;
    this.targetBps = (song.bpm * this.rate) / 60;
    const inRegion = (n: Note) => n.start >= this.region.startBeat - 1e-6 && n.start < this.region.endBeat - 1e-6;
    this.allNotes = song.notes.filter(inRegion);
    this.userNotes = opts.mode === 'listen' ? [] : this.allNotes.filter((n) => this.hands.includes(n.hand));
    // Listen plays the chosen hands; otherwise Pianist may play the hand the player leaves out.
    const appNotes =
      opts.mode === 'listen'
        ? this.allNotes.filter((n) => this.hands.includes(n.hand))
        : opts.otherHand === 'app'
          ? this.allNotes.filter((n) => !this.hands.includes(n.hand))
          : [];
    this.tuning = opts.tuning ?? TUNING_PRESETS.normal;
    this.judging = opts.judging ?? 'both';
    this.learn = opts.learn ?? DEFAULT_MODE_OPTIONS.learn;
    this.roll = opts.roll ?? { lives: 0, perfectOnly: false, multiplier: false };
    this.hearFirstBars = opts.mode === 'learn' && opts.wait ? this.learn.hearFirst : 0;
    this.marks = new Uint8Array(song.notes.length);
    for (const n of appNotes) this.marks[n.id] = NoteMark.Auto;

    const bar = measureLength(song.timeSig);
    const timed = opts.mode === 'listen' || (!opts.wait && opts.mode !== 'audition');
    // Timed modes get a full count-in bar; waiting modes just need the first notes to fall into view.
    const countIn = opts.countInBars ?? 1;
    this.leadIn = timed && countIn > 0 ? bar * countIn : Math.min(bar, 1.5 * this.targetBps);
    this.countInClicks = timed && countIn > 0;

    this.controller = this.makeController();
    this.appSched = new NoteScheduler(appNotes);
    this.clickSched = new ClickScheduler(buildClicks(song, this.region.startBeat, this.leadIn, opts.clicks), opts.clicks?.sound);

    this.guideSched = opts.guide && opts.mode !== 'listen' ? new NoteScheduler(this.userNotes, 'guide', true) : null;

    this.unsubs.push(
      inputHub.onNote((n) => this.onNote(n)),
      inputHub.onNoteOff((pitch, time) => {
        this.keyKinds.delete(pitch);
        this.record(time, 'off', pitch, 0);
      }),
      inputHub.onPedal((down, time) => this.record(time, 'pedal', down ? 1 : 0, 0)),
    );
    // The microphone listens harder for the notes the music expects at each moment.
    if (opts.mode !== 'listen') inputHub.expectation = this.expect;
    this.startedAt = now;
    this.passStart = now;
    this.restart(now);
  }

  private makeController(): Controller {
    const { mode, wait } = this.opts;
    switch (mode) {
      case 'learn':
      case 'roll':
        return wait ? new LearnController(this) : new RollController(this);
      case 'practice':
        // Waiting = the score follows the player's pace; otherwise a fixed tempo that keeps going.
        return wait ? new FollowController(this, false) : new RollController(this);
      case 'audition':
        return new FollowController(this, true);
      case 'listen':
        return new ListenController(this);
    }
  }

  /** True when the music runs at a fixed tempo and keeps going whatever is played. */
  get timed(): boolean {
    return this.controller instanceof RollController;
  }

  /** Clicks before this beat are a count-in and sound even with the metronome off. */
  private countInUntil = 0;

  /* ---- Hear it first: Pianist plays each phrase, then waits for the player to play it. */
  private hearFirstBars = 0;
  private demo: { from: number; to: number; start: number; end: number } | null = null;
  private demoDone = -1;

  private phraseIndex(beat: number): number {
    const m = measureIndexAt(this.song.measures, Math.max(this.region.startBeat, beat));
    return Math.floor((m - this.region.fromMeasure) / Math.max(1, this.hearFirstBars || 1));
  }

  phraseStart(beat: number): number {
    const bars = Math.max(1, this.hearFirstBars || 1);
    const m = measureIndexAt(this.song.measures, Math.max(this.region.startBeat, beat));
    const first = this.region.fromMeasure + Math.floor((m - this.region.fromMeasure) / bars) * bars;
    return Math.max(this.region.startBeat, this.song.measures[first].start);
  }

  private startDemo(phrase: number, now: number) {
    const bars = this.hearFirstBars;
    const fromM = this.region.fromMeasure + phrase * bars;
    const toM = Math.min(this.region.toMeasure, fromM + bars - 1);
    const from = Math.max(this.region.startBeat, this.song.measures[fromM].start);
    const to = Math.min(this.region.endBeat, this.song.measures[toM].start + this.song.measures[toM].length);
    this.demoDone = phrase;
    piano.stopAll('accomp');
    piano.stopAll('guide');
    const start = now + 500;
    const bps = this.targetBps;
    // The player's part, and the other hand too when Pianist plays it.
    const notes = this.opts.otherHand === 'app' ? this.allNotes : this.userNotes;
    for (const n of notes) {
      if (n.start < from - 1e-6 || n.start >= to - 1e-6) continue;
      piano.noteOn(n.pitch, n.velocity, { when: perfToAudio(start + ((n.start - from) / bps) * 1000), duration: (n.dur / bps) * 0.98, bus: 'accomp' });
    }
    this.demo = { from, to, start, end: start + ((to - from) / bps) * 1000 };
    const a = this.song.measures[fromM].number;
    const b = this.song.measures[toM].number;
    this.message = `Listen: ${a === b ? `bar ${a}` : `bars ${a}–${b}`}`;
    this.emit();
  }

  private endDemo(now: number) {
    const from = this.demo!.from;
    this.demo = null;
    this.controller.seek(from, now);
    this.appSched.reset(from);
    this.guideSched?.reset(from);
    this.clickSched.reset(this.clock.beatAt(now));
    this.message = 'Your turn';
    this.emit();
  }

  /** Bar the cursor is in. */
  currentMeasure(now: number): number {
    return measureIndexAt(this.song.measures, Math.max(this.region.startBeat, this.playhead(now)));
  }

  /** Jumps to a bar inside the practised region. */
  seekMeasure(index: number, now: number): void {
    if (this.status !== 'running') return;
    const m = Math.max(this.region.fromMeasure, Math.min(this.region.toMeasure, index));
    const beat = this.song.measures[m].start;
    piano.stopAll('accomp');
    piano.stopAll('guide');
    this.controller.seek(beat, now);
    this.appSched.reset(beat);
    this.guideSched?.reset(beat);
    this.clickSched.reset(this.clock.beatAt(now));
    this.countInUntil = beat;
    this.message = `Bar ${this.song.measures[m].number}`;
    this.emit();
  }

  /** Back to the start of this bar, or to the previous bar when already at its start. */
  previousBar(now: number): void {
    const cur = this.currentMeasure(now);
    const into = this.playhead(now) - this.song.measures[cur].start;
    this.seekMeasure(into > 0.75 ? cur : cur - 1, now);
  }

  nextBar(now: number): void {
    this.seekMeasure(this.currentMeasure(now) + 1, now);
  }

  get canSkip(): boolean {
    return !!this.controller.skip && !this.timed && this.opts.mode !== 'audition';
  }

  skip(now: number): void {
    if (this.status === 'running') this.controller.skip?.(now);
  }

  private restart(now: number) {
    piano.stopAll('accomp');
    for (const n of this.userNotes) this.marks[n.id] = NoteMark.Pending;
    this.clock.bps = this.targetBps;
    this.controller.start(now);
    const from = this.region.startBeat - this.leadIn;
    this.appSched.reset(this.region.startBeat);
    this.guideSched?.reset(this.region.startBeat);
    this.clickSched.reset(from);
    this.countInUntil = this.region.startBeat;
    this.passStart = now;
  }

  flash(f: Flash): void {
    this.flashes.push(f);
    if ((f.kind === 'miss' || f.kind === 'wrong') && this.status === 'running') this.mistakeListeners.forEach((l) => l(f));
  }

  private mistakeListeners = new Set<(f: Flash) => void>();

  /** Called for every missed or wrong note while running. */
  onMistake(l: (f: Flash) => void): () => void {
    this.mistakeListeners.add(l);
    return () => this.mistakeListeners.delete(l);
  }

  inputLag(): number {
    return micLag();
  }

  private record(time: number, type: RecordedEvent['type'], pitch: number, velocity: number) {
    if (this.status !== 'running') return;
    this.recording.push({
      t: Math.round(time - this.startedAt),
      type,
      pitch,
      velocity,
      beat: Math.round(this.controller.playhead(time) * 1000) / 1000,
    });
  }

  private recentMic: Array<{ pitch: number; time: number }> = [];

  /** The microphone sometimes reports a strong overtone of a note as a second note. */
  private isLikelyOvertone(n: PlayedNote): boolean {
    this.recentMic = this.recentMic.filter((r) => Math.abs(n.time - r.time) < 150);
    const overtone = this.recentMic.some((r) => [12, 19, 24].includes(n.pitch - r.pitch));
    this.recentMic.push({ pitch: n.pitch, time: n.time });
    return overtone && !this.controller.targets(performance.now()).includes(n.pitch);
  }

  private onNote(n: PlayedNote) {
    if (this.status !== 'running' || this.demo) return;
    this.lastSource = n.source;
    if (n.source === 'mic' && this.isLikelyOvertone(n)) {
      this.keyKinds.set(n.pitch, 'neutral');
      return;
    }
    this.record(n.time, 'on', n.pitch, n.velocity);
    const kind = this.controller.onNote(n);
    this.keyKinds.set(n.pitch, kind);
  }

  frame(now: number): void {
    if (this.status !== 'running') return;
    if (this.demo) {
      if (now >= this.demo.end + 350) this.endDemo(now);
      return;
    }
    if (this.hearFirstBars) {
      const beat = this.controller.clampBeat();
      if (Number.isFinite(beat) && beat < this.region.endBeat - 1e-6) {
        const phrase = this.phraseIndex(beat);
        if (phrase > this.demoDone) {
          this.startDemo(phrase, now);
          return;
        }
      }
    }
    this.controller.update(now);
    // Piano Roll with lives: the game ends when they run out.
    if (this.controller.judgments()?.gameOver) {
      this.message = 'Game over';
      this.finish(now, false);
      return;
    }
    const clamp = this.controller.clampBeat();
    this.appSched.run(this.clock, now, clamp, this.region.endBeat);
    this.guideSched?.run(this.clock, now, clamp, this.region.endBeat);
    const countIn = this.timed && this.countInClicks ? this.countInUntil : -Infinity;
    this.clickSched.run(this.clock, now, clamp, this.metronome, countIn);
    if (this.controller.isComplete(now)) {
      if (this.opts.loop && this.opts.mode !== 'listen') this.completePass(now);
      else this.finish(now, true);
    }
    if (this.flashes.length && now - this.flashes[0].time > 1200) {
      this.flashes = this.flashes.filter((f) => now - f.time < 1200);
    }
  }

  private completePass(now: number) {
    const acc = this.controller.accuracy() ?? 0;
    const clean = acc >= this.tuning.cleanPass;
    this.passes.push({ accuracy: acc, rate: this.rate, durationSec: (now - this.passStart) / 1000, clean });
    this.lastPass = { steps: this.controller.stepResults(), extras: this.controller.extras(), judgments: this.controller.judgments() };
    let msg = `Pass ${this.passes.length}: ${Math.round(acc * 100)}%`;
    // Speed-up rules: clean passes in a row before going faster; two bad ones in a row slow it down.
    const need = Math.max(1, this.opts.practice?.cleanPasses ?? 1);
    const recent = this.passes.slice(-need);
    const streak = recent.length === need && recent.every((p) => p.clean && Math.abs(p.rate - this.rate) < 1e-6);
    const lastTwo = this.passes.slice(-2);
    if (this.opts.autoSpeedUp && clean && streak && this.rate < this.tuning.maxRate - 1e-6) {
      this.setRate(Math.round(Math.min(this.tuning.maxRate, this.rate + this.tuning.speedStep) * 100) / 100);
      msg += ` — tempo up to ${Math.round(this.rate * 100)}%`;
    } else if (this.opts.autoSpeedUp && clean && !streak) {
      const done = this.passes.length - this.passes.map((p) => p.clean && Math.abs(p.rate - this.rate) < 1e-6).lastIndexOf(false) - 1;
      msg += ` — clean ${Math.min(done, need)} of ${need}`;
    } else if (
      this.opts.autoSpeedUp &&
      this.opts.practice?.slowDown &&
      lastTwo.length === 2 &&
      lastTwo.every((p) => !p.clean && Math.abs(p.rate - this.rate) < 1e-6) &&
      this.rate > 0.3 + 1e-6
    ) {
      this.setRate(Math.round(Math.max(0.3, this.rate - this.tuning.speedStep) * 100) / 100);
      msg += ` — slowing to ${Math.round(this.rate * 100)}%`;
    } else if (!clean) {
      msg += ' — again, slowly and cleanly';
    }
    this.message = msg;
    this.restart(now);
    this.emit();
  }

  private lastPass: { steps: ReturnType<Controller['stepResults']>; extras: ReturnType<Controller['extras']>; judgments: ReturnType<Controller['judgments']> } | null =
    null;

  setRate(rate: number): void {
    this.rate = rate;
    this.targetBps = (this.song.bpm * rate) / 60;
    this.clock.setBps(this.targetBps, performance.now());
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
  }

  playhead(now: number): number {
    const d = this.demo;
    if (d && this.status === 'running') return Math.min(d.to, d.from + ((now - d.start) / 1000) * this.targetBps);
    return this.status === 'running' ? this.controller.playhead(now) : this.clock.beatAt(now);
  }

  targets(now: number): number[] {
    if (this.status !== 'running') return [];
    if (this.demo) {
      // The keys Pianist is playing light up.
      const beat = this.playhead(now);
      return this.allNotes.filter((n) => n.start <= beat && n.start + n.dur > beat && (this.opts.otherHand === 'app' || this.hands.includes(n.hand))).map((n) => n.pitch);
    }
    return this.controller.targets(now);
  }

  /** Pitches of the next steps (look-ahead hints). */
  upcoming(count: number): number[][] {
    if (this.status !== 'running' || this.demo || !count) return [];
    return this.controller.upcoming?.(count) ?? [];
  }

  waiting(now: number): boolean {
    return this.status === 'running' && !this.demo && this.controller.waiting(now);
  }

  hud(now: number): Hud {
    const j = this.controller.judgments();
    return {
      accuracy: this.controller.accuracy(),
      combo: j?.combo ?? 0,
      perfect: j?.perfect ?? 0,
      good: j?.good ?? 0,
      miss: j?.miss ?? 0,
      wrong: j?.wrong ?? this.controller.extras().length,
      pass: this.passes.length + 1,
      rate: this.rate,
      message: this.message,
      waiting: this.waiting(now),
      timed: this.timed,
      status: this.status,
      points: j?.points ?? 0,
      lives: j?.lives ?? null,
      multiplier: j?.multiplier ?? 1,
      demo: !!this.demo,
    };
  }

  /** Ends the run. Returns the report when anything was played. */
  stop(now: number): Report | null {
    if (this.status === 'running') this.finish(now, false);
    return this.report;
  }

  private readonly expect = (time: number): ReadonlySet<number> => {
    if (this.status !== 'running') return NO_NOTES;
    const beat = this.playhead(time);
    // Timed: notes due within a third of a second. Waiting: the current notes and the next couple of beats.
    const before = this.timed ? 0.35 * this.targetBps : 0.5;
    const after = this.timed ? 0.35 * this.targetBps : 2;
    const set = new Set(this.controller.targets(time));
    for (const n of this.userNotes) {
      if (n.start > beat + after) break;
      if (n.start >= beat - before) set.add(n.pitch);
    }
    return set;
  };

  private releaseExpectation() {
    if (inputHub.expectation === this.expect) inputHub.expectation = null;
  }

  private finish(now: number, completed: boolean) {
    this.status = 'finished';
    this.releaseExpectation();
    this.clock.pause(now);
    piano.stopAll('accomp');
    const useLast = !completed && this.lastPass && this.controller.stepResults().every((s) => !s.played.length);
    const steps = useLast ? this.lastPass!.steps : this.controller.stepResults();
    const extras = useLast ? this.lastPass!.extras : this.controller.extras();
    const judgments = useLast ? this.lastPass!.judgments : this.controller.judgments();
    const played = steps.some((s) => s.played.length > 0);
    if (this.opts.mode !== 'listen' && played) {
      this.report = analyze({
        song: this.song,
        // Analysed by how it was played (waiting, following or timed), reported under the chosen mode.
        mode: this.controller instanceof LearnController ? 'learn' : this.timed ? 'roll' : this.opts.mode,
        hands: [...this.hands],
        rate: this.rate,
        steps,
        extras,
        judgments,
        passes: this.passes,
        recording: this.recording,
        durationSec: Math.round((now - this.startedAt) / 1000),
        completed: completed || !!useLast,
        source: this.lastSource,
        regionMeasures: [this.region.fromMeasure, this.region.toMeasure],
        // Notes only: timing and tempo don't count.
        weights: this.opts.weights && this.judging === 'notes' ? { ...this.opts.weights, timing: 0, tempo: 0 } : this.opts.weights,
      });
      this.report.mode = this.opts.mode;
    }
    this.emit();
  }

  /** Loop passes completed so far. */
  get passList(): readonly PassSummary[] {
    return this.passes;
  }

  /** Wrong notes so far in this pass. */
  extrasList() {
    return this.controller.extras();
  }

  /** Practice time in seconds. */
  elapsedSec(now: number): number {
    return (now - this.startedAt) / 1000;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  dispose(): void {
    this.releaseExpectation();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    piano.stopAll('accomp');
    this.listeners.clear();
    this.mistakeListeners.clear();
  }
}
