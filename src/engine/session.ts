import { piano } from '../audio/piano';
import { inputHub, type InputSource, type PlayedNote } from '../input/hub';
import { micLag } from '../input/mic/mic';
import { measureLength } from '../music/song';
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
  status: Session['status'];
}

const AUTO_SPEED_STEP = 0.05;
const CLEAN_PASS = 0.9;

export class Session implements SessionContext {
  readonly clock = new Clock();
  readonly region: Region;
  readonly hands: Hand[];
  readonly userNotes: Note[];
  readonly allNotes: Note[];
  readonly marks: Uint8Array;
  readonly leadIn: number;
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
    this.region = opts.loop ? regionFor(song, opts.loop.from, opts.loop.to) : wholeSong(song);
    this.hands = opts.mode === 'listen' ? ['R', 'L'] : opts.hands;
    this.rate = opts.rate;
    this.metronome = opts.metronome;
    this.targetBps = (song.bpm * this.rate) / 60;
    const inRegion = (n: Note) => n.start >= this.region.startBeat - 1e-6 && n.start < this.region.endBeat - 1e-6;
    this.allNotes = song.notes.filter(inRegion);
    this.userNotes = opts.mode === 'listen' ? [] : this.allNotes.filter((n) => this.hands.includes(n.hand));
    const appNotes =
      opts.mode === 'listen'
        ? this.allNotes
        : opts.otherHand === 'app'
          ? this.allNotes.filter((n) => !this.hands.includes(n.hand))
          : [];
    this.marks = new Uint8Array(song.notes.length);
    for (const n of appNotes) this.marks[n.id] = NoteMark.Auto;

    const bar = measureLength(song.timeSig);
    const timed = opts.mode === 'roll' || opts.mode === 'listen';
    // Timed modes get a full count-in bar; waiting modes just need the first notes to fall into view.
    this.leadIn = timed ? bar : Math.min(bar, 1.5 * this.targetBps);

    this.controller = this.makeController();
    this.appSched = new NoteScheduler(appNotes);
    this.clickSched = new ClickScheduler(buildClicks(song, this.region.startBeat, this.leadIn));

    this.unsubs.push(
      inputHub.onNote((n) => this.onNote(n)),
      inputHub.onNoteOff((pitch, time) => {
        this.keyKinds.delete(pitch);
        this.record(time, 'off', pitch, 0);
      }),
      inputHub.onPedal((down, time) => this.record(time, 'pedal', down ? 1 : 0, 0)),
    );
    this.startedAt = now;
    this.passStart = now;
    this.restart(now);
  }

  private makeController(): Controller {
    switch (this.opts.mode) {
      case 'learn':
        return new LearnController(this);
      case 'practice':
        return new FollowController(this, false);
      case 'audition':
        return new FollowController(this, true);
      case 'roll':
        return this.opts.rollWait ? new LearnController(this) : new RollController(this);
      case 'listen':
        return new ListenController(this);
    }
  }

  private restart(now: number) {
    piano.stopAll('accomp');
    for (const n of this.userNotes) this.marks[n.id] = NoteMark.Pending;
    this.clock.bps = this.targetBps;
    this.controller.start(now);
    const from = this.region.startBeat - this.leadIn;
    this.appSched.reset(this.region.startBeat);
    this.clickSched.reset(from);
    this.passStart = now;
  }

  flash(f: Flash): void {
    this.flashes.push(f);
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

  private onNote(n: PlayedNote) {
    if (this.status !== 'running') return;
    this.lastSource = n.source;
    this.record(n.time, 'on', n.pitch, n.velocity);
    const kind = this.controller.onNote(n);
    this.keyKinds.set(n.pitch, kind);
  }

  frame(now: number): void {
    if (this.status !== 'running') return;
    this.controller.update(now);
    const clamp = this.controller.clampBeat();
    this.appSched.run(this.clock, now, clamp, this.region.endBeat);
    this.clickSched.run(this.clock, now, clamp, this.metronome);
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
    const clean = acc >= CLEAN_PASS;
    this.passes.push({ accuracy: acc, rate: this.rate, durationSec: (now - this.passStart) / 1000, clean });
    this.lastPass = { steps: this.controller.stepResults(), extras: this.controller.extras(), judgments: this.controller.judgments() };
    let msg = `Pass ${this.passes.length}: ${Math.round(acc * 100)}%`;
    if (this.opts.autoSpeedUp && clean && this.rate < 1 - 1e-6) {
      this.setRate(Math.min(1, this.rate + AUTO_SPEED_STEP));
      msg += ` — tempo up to ${Math.round(this.rate * 100)}%`;
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
    return this.status === 'running' ? this.controller.playhead(now) : this.clock.beatAt(now);
  }

  targets(now: number): number[] {
    return this.status === 'running' ? this.controller.targets(now) : [];
  }

  waiting(now: number): boolean {
    return this.status === 'running' && this.controller.waiting(now);
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
      status: this.status,
    };
  }

  /** Ends the run. Returns the report when anything was played. */
  stop(now: number): Report | null {
    if (this.status === 'running') this.finish(now, false);
    return this.report;
  }

  private finish(now: number, completed: boolean) {
    this.status = 'finished';
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
        mode: this.opts.mode === 'roll' && this.opts.rollWait ? 'learn' : this.opts.mode,
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
      });
      if (this.opts.mode === 'roll' && this.opts.rollWait) this.report.mode = 'roll';
    }
    this.emit();
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
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    piano.stopAll('accomp');
    this.listeners.clear();
  }
}
