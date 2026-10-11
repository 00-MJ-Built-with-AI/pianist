import { perfToAudio } from '../audio/audio';
import { metronomeClick, piano } from '../audio/piano';
import type { Note, Song } from '../music/types';
import { clickUnit } from '../music/song';
import type { Clock } from './clock';

const LOOKAHEAD_MS = 120;
const TOO_LATE_MS = 60;

/** Plays notes (the hand the app accompanies with, or everything in Listen mode) as the playhead reaches them. */
export class NoteScheduler {
  private idx = 0;
  constructor(private notes: Note[]) {}

  reset(beat: number): void {
    this.idx = this.notes.findIndex((n) => n.start >= beat - 1e-6);
    if (this.idx < 0) this.idx = this.notes.length;
  }

  /** Schedules everything strictly before `limitBeat` that falls inside the look-ahead window. */
  run(clock: Clock, now: number, limitBeat: number, endBeat: number): void {
    if (!clock.running) return;
    const horizon = Math.min(clock.beatAt(now + LOOKAHEAD_MS), limitBeat - 1e-6);
    while (this.idx < this.notes.length && this.notes[this.idx].start < horizon) {
      const n = this.notes[this.idx++];
      if (n.start >= endBeat - 1e-6) continue;
      const t = clock.timeAt(n.start);
      if (t < now - TOO_LATE_MS) continue;
      piano.noteOn(n.pitch, n.velocity, {
        when: perfToAudio(t),
        duration: (n.dur / clock.bps) * 0.98,
        bus: 'accomp',
      });
    }
  }
}

export interface Click {
  beat: number;
  accent: boolean;
}

/** Metronome clicks for the whole piece, plus a count-in bar before `from`. */
export function buildClicks(song: Song, from: number, countIn: number): Click[] {
  const unit = clickUnit(song.timeSig);
  const clicks: Click[] = [];
  for (let b = from - countIn; b < from - 1e-6; b += unit) clicks.push({ beat: b, accent: Math.abs(b - (from - countIn)) < 1e-6 });
  for (const m of song.measures) {
    for (let b = 0; b < m.length - 1e-6; b += unit) {
      if (m.start + b >= from - 1e-6) clicks.push({ beat: m.start + b, accent: b === 0 && m.number !== 0 });
    }
  }
  return clicks;
}

export class ClickScheduler {
  private idx = 0;
  constructor(private clicks: Click[]) {}

  reset(beat: number): void {
    this.idx = this.clicks.findIndex((c) => c.beat >= beat - 1e-6);
    if (this.idx < 0) this.idx = this.clicks.length;
  }

  /** Clicks before `alwaysBefore` (the count-in) sound even when the metronome is off. */
  run(clock: Clock, now: number, limitBeat: number, enabled: boolean, alwaysBefore = -Infinity): void {
    if (!clock.running) return;
    const horizon = Math.min(clock.beatAt(now + LOOKAHEAD_MS), limitBeat + 1e-6);
    while (this.idx < this.clicks.length && this.clicks[this.idx].beat < horizon) {
      const c = this.clicks[this.idx++];
      const t = clock.timeAt(c.beat);
      if ((!enabled && c.beat >= alwaysBefore - 1e-6) || t < now - TOO_LATE_MS) continue;
      metronomeClick(perfToAudio(t), c.accent);
    }
  }
}
