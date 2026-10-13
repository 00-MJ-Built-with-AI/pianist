import { inputHub, type PlayedNote } from '../input/hub';
import { buildSteps, type Region, type Step } from '../music/steps';
import type { Hand, Note } from '../music/types';
import type { Clock } from './clock';
import type { ModeOptions, Tuning } from '../store/settings';
import { NoteMark, type ExtraNote, type Judging, type StepResult } from './types';

export type KeyKind = 'good' | 'wrong' | 'neutral';

export interface Flash {
  pitch: number;
  kind: 'good' | 'perfect' | 'wrong' | 'miss';
  label?: string;
  time: number;
}

/** What controllers need from the running session. */
export interface SessionContext {
  clock: Clock;
  region: Region;
  hands: Hand[];
  userNotes: Note[]; // the notes the player plays, inside the region
  allNotes: Note[];
  marks: Uint8Array;
  targetBps: number;
  leadIn: number;
  tuning: Tuning;
  flash(f: Flash): void;
  /** How late key presses arrive (the microphone detector reports notes ~0.25 s after they sound). */
  inputLag(): number;
  judging: Judging;
  learn: ModeOptions['learn'];
  roll: { lives: number; perfectOnly: boolean; multiplier: boolean };
  /** Start of the phrase a beat is in (for "back to the start of the phrase"). */
  phraseStart(beat: number): number;
}

export interface Judgments {
  perfect: number;
  good: number;
  miss: number;
  wrong: number;
  combo: number;
  maxCombo: number;
  /** Game rules (Piano Roll): points, lives left (null = no lives), and the combo multiplier. */
  points: number;
  lives: number | null;
  multiplier: number;
  gameOver: boolean;
}

export interface Controller {
  start(now: number): void;
  onNote(n: PlayedNote): KeyKind;
  update(now: number): void;
  /** Accompaniment and clicks may not run past this beat (the cursor is waiting there). */
  clampBeat(): number;
  playhead(now: number): number;
  targets(now: number): number[];
  isComplete(now: number): boolean;
  accuracy(): number | null;
  stepResults(): StepResult[];
  extras(): ExtraNote[];
  judgments(): Judgments | null;
  waiting(now: number): boolean;
  /** Jump to a beat (the start of a bar); everything from there on is played again. */
  seek(beat: number, now: number): void;
  /** Give up on the notes the cursor is waiting for (they count as missed) and move on. */
  skip?(now: number): void;
  /** Pitches of the next steps after the current one (nearest first). */
  upcoming?(count: number): number[][];
}

const firstAtOrAfter = <T extends { beat?: number; start?: number }>(xs: T[], beat: number) => {
  const i = xs.findIndex((x) => (x.beat ?? x.start ?? 0) >= beat - 1e-6);
  return i < 0 ? xs.length : i;
};

function emptyResult(step: Step): StepResult {
  return {
    beat: step.beat,
    measure: step.measure,
    hands: [...new Set(step.notes.map((n) => n.hand))],
    expected: step.notes.map((n) => ({ pitch: n.pitch, hand: n.hand, velocity: n.velocity, dur: n.dur })),
    played: [],
    missed: [],
    wrongBefore: 0,
    waitedMs: 0,
  };
}

function markStep(ctx: SessionContext, step: Step, pitch: number | null, mark: number) {
  for (const n of step.notes) if (pitch === null || n.pitch === pitch) ctx.marks[n.id] = mark;
}

/* ---------------------------------------------------------------- Learn (wait) */

/** Waits on every step until all of its notes are pressed (any order, within about a second). */
export class LearnController implements Controller {
  private steps: Step[];
  private idx = 0;
  private hits = new Map<number, number>();
  private results: StepResult[] = [];
  private extraNotes: ExtraNote[] = [];
  private correct = 0;
  private wrong = 0;
  /** Hold-full-length: the step's keys are down; it counts once they've been held until `until`. */
  private holding: { until: number; mic: boolean } | null = null;

  constructor(private ctx: SessionContext) {
    this.steps = buildSteps(ctx.userNotes, new Set(ctx.hands));
  }

  start(now: number): void {
    this.idx = 0;
    this.holding = null;
    this.hits.clear();
    this.results = this.steps.map(emptyResult);
    this.extraNotes = [];
    this.correct = 0;
    this.wrong = 0;
    this.ctx.clock.start(this.ctx.region.startBeat - this.ctx.leadIn, now);
  }

  clampBeat(): number {
    // While a note is held to its full length the cursor moves on through it.
    if (this.holding) return this.steps[this.idx + 1]?.beat ?? this.ctx.region.endBeat;
    return this.steps[this.idx]?.beat ?? Infinity;
  }

  playhead(now: number): number {
    return Math.min(this.ctx.clock.beatAt(now), this.clampBeat());
  }

  waiting(now: number): boolean {
    return this.idx < this.steps.length && !this.holding && this.ctx.clock.beatAt(now) >= this.clampBeat();
  }

  targets(): number[] {
    const step = this.steps[this.idx];
    return step && !this.holding ? step.pitches.filter((p) => !this.hits.has(p)) : [];
  }

  upcoming(count: number): number[][] {
    return this.steps.slice(this.idx + 1, this.idx + 1 + count).map((s) => s.pitches);
  }

  onNote(n: PlayedNote): KeyKind {
    // Legato into the next note while holding: fine once the hold is nearly done.
    if (this.holding && n.time >= this.holding.until - 150) this.completeHold(n.time);
    const step = this.steps[this.idx];
    if (!step) return 'neutral';
    if (this.holding) return step.pitches.includes(n.pitch) ? 'good' : 'neutral';
    // Rhythm only: any key plays the whole step.
    if (this.ctx.judging === 'rhythm') {
      const res = this.results[this.idx];
      for (const p of step.pitches) {
        this.hits.set(p, n.time);
        res.played.push({ pitch: p, time: n.time, velocity: n.velocity });
      }
      this.correct += step.pitches.length;
      this.stepDone(n.time, n.source === 'mic');
      return 'good';
    }
    if (step.pitches.includes(n.pitch)) {
      // A chord counts when its notes arrive within a second of each other (or are still held).
      const win = this.ctx.tuning.chordWindowMs;
      for (const [p, t] of this.hits) if (n.time - t > win && !inputHub.held.has(p)) this.hits.delete(p);
      this.hits.set(n.pitch, n.time);
      const res = this.results[this.idx];
      res.played = res.played.filter((x) => x.pitch !== n.pitch);
      res.played.push({ pitch: n.pitch, time: n.time, velocity: n.velocity });
      this.correct++;
      if (step.pitches.every((p) => this.hits.has(p))) this.stepDone(n.time, n.source === 'mic');
      return 'good';
    }
    const rule = this.ctx.learn.wrongNote;
    if (rule === 'ignore') return 'neutral';
    if (rule !== 'flash') {
      this.wrong++;
      this.results[this.idx].wrongBefore++;
      this.extraNotes.push({ pitch: n.pitch, time: n.time, measure: step.measure, beat: step.beat });
    }
    if (rule === 'restart') {
      // Back to the start of the phrase.
      this.ctx.flash({ pitch: n.pitch, kind: 'wrong', label: 'Again', time: n.time });
      this.seek(this.ctx.phraseStart(step.beat), n.time);
      return 'wrong';
    }
    this.ctx.flash({ pitch: n.pitch, kind: 'wrong', time: n.time });
    return 'wrong';
  }

  /** All of the step's notes are down: move on, or first hold them for their written length. */
  private stepDone(t: number, mic: boolean) {
    const step = this.steps[this.idx];
    if (this.ctx.learn.holdFull) {
      const beats = Math.min(...step.notes.map((x) => x.dur));
      const ms = Math.min(6000, ((beats / this.ctx.targetBps) * 1000) * 0.8);
      if (ms >= 250) {
        this.holding = { until: t + ms, mic };
        // The cursor runs on through the held note.
        this.ctx.clock.anchor(step.beat, t);
        return;
      }
    }
    this.advance(t);
  }

  private completeHold(t: number) {
    const step = this.steps[this.idx];
    this.holding = null;
    this.results[this.idx].waitedMs = 0;
    markStep(this.ctx, step, null, NoteMark.Hit);
    this.hits.clear();
    this.idx++;
    this.lastAdvance = t;
  }

  private advance(t: number) {
    const step = this.steps[this.idx];
    const arrival = this.ctx.clock.timeAt(step.beat);
    this.results[this.idx].waitedMs = Math.max(0, t - Math.max(arrival, this.lastAdvance));
    markStep(this.ctx, step, null, NoteMark.Hit);
    for (const p of step.pitches) this.ctx.flash({ pitch: p, kind: 'good', time: t });
    this.hits.clear();
    this.idx++;
    this.lastAdvance = t;
    // Continue from this step at the normal speed, whether the player was early or the cursor waited.
    this.ctx.clock.anchor(step.beat, t);
  }

  private lastAdvance = 0;

  seek(beat: number, now: number): void {
    this.idx = firstAtOrAfter(this.steps, beat);
    this.holding = null;
    this.hits.clear();
    for (let k = this.idx; k < this.steps.length; k++) {
      this.results[k] = emptyResult(this.steps[k]);
      markStep(this.ctx, this.steps[k], null, NoteMark.Pending);
    }
    this.lastAdvance = now;
    this.ctx.clock.start(beat - Math.min(this.ctx.leadIn, 1), now);
  }

  skip(now: number): void {
    const step = this.steps[this.idx];
    if (!step) return;
    const res = this.results[this.idx];
    res.missed = step.pitches.filter((p) => !this.hits.has(p));
    for (const p of res.missed) markStep(this.ctx, step, p, NoteMark.Missed);
    this.hits.clear();
    this.idx++;
    this.lastAdvance = now;
    this.ctx.clock.anchor(step.beat, now);
  }

  update(now: number): void {
    const h = this.holding;
    if (!h) return;
    const step = this.steps[this.idx];
    // The microphone can't tell reliably when a key is let go, so only the time counts there.
    const held = h.mic || inputHub.pedal || step.pitches.every((p) => inputHub.held.has(p));
    if (!held) {
      // Let go too soon: play it again and hold it.
      this.holding = null;
      this.hits.clear();
      this.wrong++;
      this.results[this.idx].wrongBefore++;
      for (const p of step.pitches) this.ctx.flash({ pitch: p, kind: 'miss', label: 'Hold it', time: now });
      this.ctx.clock.anchor(step.beat, now);
    } else if (now >= h.until) {
      this.completeHold(now);
    }
  }

  isComplete(now: number): boolean {
    return this.idx >= this.steps.length && this.ctx.clock.beatAt(now) >= this.ctx.region.endBeat;
  }

  accuracy(): number | null {
    const total = this.correct + this.wrong;
    return total ? this.correct / total : null;
  }

  stepResults(): StepResult[] {
    return this.results;
  }

  extras(): ExtraNote[] {
    return this.extraNotes;
  }

  judgments(): Judgments | null {
    return null;
  }
}

/* ---------------------------------------------------------------- Practice / Audition (score following) */

const LATE_CHORD_MS = 300;
const LAST_STEP_TIMEOUT_MS = 1500;

/**
 * Follows the player through the score at their own pace. The cursor moves at the player's
 * estimated tempo and waits at the next note; skipped notes count as missed, others as extra.
 */
export class FollowController implements Controller {
  private steps: Step[];
  private pos = 0;
  private matched: Array<Map<number, PlayedNote>> = [];
  private firstTime: number[] = [];
  private results: StepResult[] = [];
  private extraNotes: ExtraNote[] = [];
  private anchorIdx = -1;
  private anchorTime = 0;
  private bps = 1;
  private lastInput = 0;

  constructor(
    private ctx: SessionContext,
    private hideCues: boolean,
  ) {
    this.steps = buildSteps(ctx.userNotes, new Set(ctx.hands));
  }

  start(now: number): void {
    this.pos = 0;
    this.matched = this.steps.map(() => new Map());
    this.firstTime = this.steps.map(() => NaN);
    this.results = this.steps.map(emptyResult);
    this.extraNotes = [];
    this.anchorIdx = -1;
    this.bps = this.ctx.targetBps;
    this.ctx.clock.bps = this.bps;
    this.ctx.clock.start(this.ctx.region.startBeat - this.ctx.leadIn, now);
  }

  private clampIdx(): number {
    let k = this.pos;
    while (k < this.steps.length && this.matched[k].size > 0) k++;
    return k;
  }

  clampBeat(): number {
    return this.steps[this.clampIdx()]?.beat ?? Infinity;
  }

  playhead(now: number): number {
    return Math.min(this.ctx.clock.beatAt(now), this.clampBeat());
  }

  waiting(now: number): boolean {
    return this.clampIdx() < this.steps.length && this.ctx.clock.beatAt(now) >= this.clampBeat();
  }

  targets(): number[] {
    if (this.hideCues) return [];
    const step = this.steps[this.pos];
    return step ? step.pitches.filter((p) => !this.matched[this.pos].has(p)) : [];
  }

  onNote(n: PlayedNote): KeyKind {
    this.lastInput = n.time;
    // Rhythm only: any key plays the next step.
    if (this.ctx.judging === 'rhythm' && this.pos < this.steps.length) {
      const j = this.pos;
      for (const p of this.steps[j].pitches) if (!this.matched[j].has(p)) this.match(j, { ...n, pitch: p });
      return 'good';
    }
    const p = n.pitch;
    // A chord note that arrives just after its neighbours moved the cursor on.
    if (this.pos > 0) {
      const prev = this.pos - 1;
      const res = this.results[prev];
      if (
        this.steps[prev].pitches.includes(p) &&
        !this.matched[prev].has(p) &&
        n.time - this.firstTime[prev] < LATE_CHORD_MS
      ) {
        res.missed = res.missed.filter((m) => m !== p);
        this.match(prev, n);
        return 'good';
      }
    }
    const predicted = this.ctx.clock.beatAt(n.time);
    for (let j = this.pos; j < this.steps.length && j <= this.pos + 3; j++) {
      // Jumping more than one step ahead needs the timing to agree, so stray notes don't skip music.
      if (j > this.pos + 1 && predicted < this.steps[j].beat - 1) break;
      if (this.steps[j].pitches.includes(p) && !this.matched[j].has(p)) {
        for (let k = this.pos; k < j; k++) this.missRemaining(k);
        this.match(j, n);
        return 'good';
      }
    }
    const near = this.steps[Math.min(this.pos, this.steps.length - 1)];
    this.extraNotes.push({ pitch: p, time: n.time, measure: near?.measure ?? 0, beat: near?.beat ?? predicted });
    if (this.pos < this.steps.length) this.results[this.pos].wrongBefore++;
    if (!this.hideCues) this.ctx.flash({ pitch: p, kind: 'wrong', time: n.time });
    return this.hideCues ? 'neutral' : 'wrong';
  }

  private match(j: number, n: PlayedNote) {
    const step = this.steps[j];
    if (this.matched[j].size === 0) {
      this.firstTime[j] = n.time;
      this.updateTempo(j, n.time);
    }
    this.matched[j].set(n.pitch, n);
    this.results[j].played.push({ pitch: n.pitch, time: n.time, velocity: n.velocity });
    markStep(this.ctx, step, n.pitch, NoteMark.Hit);
    if (!this.hideCues) this.ctx.flash({ pitch: n.pitch, kind: 'good', time: n.time });
    if (j >= this.pos) {
      this.pos = this.matched[j].size >= step.pitches.length ? j + 1 : j;
    }
  }

  private missRemaining(k: number) {
    const step = this.steps[k];
    for (const p of step.pitches) {
      if (this.matched[k].has(p) || this.results[k].missed.includes(p)) continue;
      this.results[k].missed.push(p);
      markStep(this.ctx, step, p, NoteMark.Missed);
    }
  }

  private updateTempo(j: number, t: number) {
    const target = this.ctx.targetBps;
    if (this.anchorIdx >= 0) {
      const dBeat = this.steps[j].beat - this.steps[this.anchorIdx].beat;
      const dt = (t - this.anchorTime) / 1000;
      if (dBeat > 0 && dt > 0.03) {
        const inst = dBeat / dt;
        const ratio = inst / target;
        // Pauses and stumbles don't change the tempo estimate.
        if (ratio > 0.5 && ratio < 2) {
          this.bps = Math.min(target * 1.6, Math.max(target * 0.5, this.bps * 0.7 + inst * 0.3));
        }
      }
    }
    this.anchorIdx = j;
    this.anchorTime = t;
    this.ctx.clock.setBps(this.bps, t);
    this.ctx.clock.anchor(this.steps[j].beat, t);
  }

  seek(beat: number, now: number): void {
    this.pos = firstAtOrAfter(this.steps, beat);
    for (let k = this.pos; k < this.steps.length; k++) {
      this.matched[k] = new Map();
      this.firstTime[k] = NaN;
      this.results[k] = emptyResult(this.steps[k]);
      markStep(this.ctx, this.steps[k], null, NoteMark.Pending);
    }
    this.anchorIdx = -1;
    this.bps = this.ctx.targetBps;
    this.ctx.clock.bps = this.bps;
    this.ctx.clock.start(beat - Math.min(this.ctx.leadIn, 1), now);
  }

  skip(now: number): void {
    if (this.pos >= this.steps.length) return;
    this.missRemaining(this.pos);
    const step = this.steps[this.pos];
    this.pos++;
    this.anchorIdx = -1;
    this.ctx.clock.anchor(step.beat, now);
  }

  update(now: number): void {
    // The final chord resolves once the player has clearly stopped.
    const last = this.steps.length - 1;
    if (this.pos === last && this.matched[last].size > 0 && now - this.lastInput > LAST_STEP_TIMEOUT_MS + this.ctx.inputLag()) {
      this.missRemaining(last);
      this.pos = this.steps.length;
    }
  }

  isComplete(now: number): boolean {
    if (this.pos < this.steps.length) return false;
    const last = this.steps[this.steps.length - 1];
    const lastEnd = last ? Math.max(...last.notes.map((n) => n.start + n.dur)) : this.ctx.region.startBeat;
    return this.ctx.clock.beatAt(now) >= Math.min(this.ctx.region.endBeat, lastEnd + 0.5);
  }

  accuracy(): number | null {
    let expected = 0;
    let hit = 0;
    for (let i = 0; i < this.pos && i < this.steps.length; i++) {
      expected += this.steps[i].pitches.length;
      hit += this.matched[i].size;
    }
    if (!expected) return null;
    return Math.max(0, (hit - this.extraNotes.length * 0.5) / expected);
  }

  stepResults(): StepResult[] {
    return this.results;
  }

  extras(): ExtraNote[] {
    return this.extraNotes;
  }

  judgments(): Judgments | null {
    return null;
  }

  /** Steps the player got to (for partial runs). */
  reached(): number {
    return this.pos;
  }

  upcoming(count: number): number[][] {
    if (this.hideCues) return [];
    return this.steps.slice(this.pos + 1, this.pos + 1 + count).map((s) => s.pitches);
  }
}

/* ---------------------------------------------------------------- Piano Roll (flowing, judged) */


export class RollController implements Controller {
  private notes: Note[];
  private steps: Step[];
  private stepOf = new Map<number, number>();
  private results: StepResult[] = [];
  private extraNotes: ExtraNote[] = [];
  private matched = new Set<number>();
  private missPtr = 0;
  private j: Judgments = this.freshJudgments();

  private freshJudgments(): Judgments {
    const lives = this.ctx?.roll?.lives || 0;
    return { perfect: 0, good: 0, miss: 0, wrong: 0, combo: 0, maxCombo: 0, points: 0, lives: lives > 0 ? lives : null, multiplier: 1, gameOver: false };
  }

  /** A miss or wrong note: the combo breaks and a life is lost. */
  private slip() {
    this.j.combo = 0;
    this.j.multiplier = 1;
    if (this.j.lives !== null) {
      this.j.lives = Math.max(0, this.j.lives - 1);
      if (this.j.lives === 0) this.j.gameOver = true;
    }
  }

  private score(points: number) {
    this.j.combo++;
    this.j.maxCombo = Math.max(this.j.maxCombo, this.j.combo);
    this.j.multiplier = this.ctx.roll.multiplier ? Math.min(4, 1 + Math.floor(this.j.combo / 10)) : 1;
    this.j.points += points * this.j.multiplier;
  }

  constructor(private ctx: SessionContext) {
    this.notes = ctx.userNotes.filter((n) => ctx.hands.includes(n.hand));
    this.steps = buildSteps(this.notes, new Set(ctx.hands));
    this.steps.forEach((s, i) => s.notes.forEach((n) => this.stepOf.set(n.id, i)));
  }

  start(now: number): void {
    this.matched.clear();
    this.missPtr = 0;
    this.results = this.steps.map(emptyResult);
    this.extraNotes = [];
    this.j = this.freshJudgments();
    this.ctx.clock.bps = this.ctx.targetBps;
    this.ctx.clock.start(this.ctx.region.startBeat - this.ctx.leadIn, now);
  }

  clampBeat(): number {
    return Infinity;
  }

  playhead(now: number): number {
    return this.ctx.clock.beatAt(now);
  }

  waiting(): boolean {
    return false;
  }

  targets(now: number): number[] {
    const beat = this.ctx.clock.beatAt(now);
    const out: number[] = [];
    for (const n of this.notes) {
      if (n.start > beat + 0.08) break;
      if (n.start + n.dur > beat && !this.matched.has(n.id)) out.push(n.pitch);
    }
    return out;
  }

  onNote(n: PlayedNote): KeyKind {
    const clock = this.ctx.clock;
    const judging = this.ctx.judging;
    // Notes only: any timing within about half a second counts.
    const goodMs = judging === 'notes' ? Math.max(this.ctx.tuning.goodMs, 600) : this.ctx.tuning.goodMs;
    let best: Note | null = null;
    let bestDev = Infinity;
    for (const note of this.notes) {
      // Rhythm only: any key counts for the note that's due.
      if ((judging !== 'rhythm' && note.pitch !== n.pitch) || this.matched.has(note.id)) continue;
      const dev = n.time - clock.timeAt(note.start);
      if (dev < -goodMs) break;
      if (Math.abs(dev) <= goodMs && Math.abs(dev) < Math.abs(bestDev)) {
        best = note;
        bestDev = dev;
      }
    }
    if (best && judging === 'rhythm') {
      // A chord is one tap: every note starting with it counts.
      for (const other of this.notes) {
        if (other.id !== best.id && Math.abs(other.start - best.start) < 1e-6 && !this.matched.has(other.id)) {
          this.matched.add(other.id);
          this.ctx.marks[other.id] = NoteMark.Hit;
          this.results[this.stepOf.get(other.id)!].played.push({ pitch: other.pitch, time: n.time, velocity: n.velocity });
        }
      }
    }
    if (!best) {
      this.j.wrong++;
      this.slip();
      const beat = clock.beatAt(n.time);
      const measure = this.notes.find((x) => x.start + x.dur > beat)?.measure ?? 0;
      this.extraNotes.push({ pitch: n.pitch, time: n.time, measure, beat });
      this.ctx.flash({ pitch: n.pitch, kind: 'wrong', time: n.time });
      return 'wrong';
    }
    this.matched.add(best.id);
    const si = this.stepOf.get(best.id)!;
    this.results[si].played.push({ pitch: best.pitch, time: n.time, velocity: n.velocity });
    const perfect = judging === 'notes' || Math.abs(bestDev) <= this.ctx.tuning.perfectMs;
    if (!perfect && this.ctx.roll.perfectOnly) {
      // Perfect-only challenge: anything less is a miss.
      this.j.miss++;
      this.slip();
      this.ctx.marks[best.id] = NoteMark.Missed;
      this.results[si].missed.push(best.pitch);
      this.ctx.flash({ pitch: n.pitch, kind: 'miss', label: bestDev < 0 ? 'Early' : 'Late', time: n.time });
      return 'wrong';
    }
    if (perfect) this.j.perfect++;
    else this.j.good++;
    this.score(perfect ? 100 : 50);
    this.ctx.marks[best.id] = perfect ? NoteMark.Hit : bestDev < 0 ? NoteMark.Early : NoteMark.Late;
    this.ctx.flash({
      pitch: n.pitch,
      kind: perfect ? 'perfect' : 'good',
      label: perfect ? 'Perfect' : bestDev < 0 ? 'Early' : 'Late',
      time: n.time,
    });
    return 'good';
  }

  update(now: number): void {
    const clock = this.ctx.clock;
    const judgedUpTo = now - this.ctx.inputLag();
    while (this.missPtr < this.notes.length) {
      const note = this.notes[this.missPtr];
      if (clock.timeAt(note.start) + this.ctx.tuning.goodMs > judgedUpTo) break;
      this.missPtr++;
      if (this.matched.has(note.id)) continue;
      this.j.miss++;
      this.slip();
      this.ctx.marks[note.id] = NoteMark.Missed;
      this.results[this.stepOf.get(note.id)!].missed.push(note.pitch);
      this.ctx.flash({ pitch: note.pitch, kind: 'miss', label: 'Miss', time: now });
    }
  }

  isComplete(now: number): boolean {
    return this.ctx.clock.beatAt(now) >= this.ctx.region.endBeat;
  }

  seek(beat: number, now: number): void {
    for (const n of this.notes) {
      if (n.start < beat - 1e-6) continue;
      this.matched.delete(n.id);
      this.ctx.marks[n.id] = NoteMark.Pending;
    }
    this.steps.forEach((s, i) => {
      if (s.beat >= beat - 1e-6) this.results[i] = emptyResult(s);
    });
    this.missPtr = firstAtOrAfter(this.notes, beat);
    this.j.combo = 0;
    // A full count-in bar before the music continues.
    this.ctx.clock.bps = this.ctx.targetBps;
    this.ctx.clock.start(beat - this.ctx.leadIn, now);
  }

  accuracy(): number | null {
    const judged = this.j.perfect + this.j.good + this.j.miss;
    if (!judged) return null;
    return (this.j.perfect + this.j.good * 0.7) / (judged + this.j.wrong * 0.5);
  }

  stepResults(): StepResult[] {
    return this.results;
  }

  extras(): ExtraNote[] {
    return this.extraNotes;
  }

  judgments(): Judgments {
    return this.j;
  }
}

/* ---------------------------------------------------------------- Listen */

export class ListenController implements Controller {
  constructor(private ctx: SessionContext) {}

  start(now: number): void {
    this.ctx.clock.bps = this.ctx.targetBps;
    this.ctx.clock.start(this.ctx.region.startBeat - this.ctx.leadIn, now);
  }

  clampBeat(): number {
    return Infinity;
  }

  playhead(now: number): number {
    return this.ctx.clock.beatAt(now);
  }

  waiting(): boolean {
    return false;
  }

  /** The keys of the hands being heard light up as they sound. */
  targets(now: number): number[] {
    const beat = this.ctx.clock.beatAt(now);
    const out: number[] = [];
    for (const n of this.ctx.allNotes) {
      if (n.start > beat) break;
      if (n.start + n.dur > beat && this.ctx.hands.includes(n.hand)) out.push(n.pitch);
    }
    return out;
  }

  onNote(): KeyKind {
    return 'neutral';
  }

  seek(beat: number, now: number): void {
    for (const n of this.ctx.allNotes) if (n.start >= beat - 1e-6) this.ctx.marks[n.id] = NoteMark.Pending;
    this.ctx.clock.start(beat, now);
  }

  /** Notes of the heard hands turn lighter once they've sounded; a silent hand stays grey. */
  update(now: number): void {
    const beat = this.ctx.clock.beatAt(now);
    for (const n of this.ctx.allNotes) {
      if (n.start > beat) break;
      if (this.ctx.hands.includes(n.hand)) this.ctx.marks[n.id] = NoteMark.Hit;
    }
  }

  isComplete(now: number): boolean {
    return this.ctx.clock.beatAt(now) >= this.ctx.region.endBeat;
  }

  accuracy(): null {
    return null;
  }

  stepResults(): StepResult[] {
    return [];
  }

  extras(): ExtraNote[] {
    return [];
  }

  judgments(): null {
    return null;
  }
}
