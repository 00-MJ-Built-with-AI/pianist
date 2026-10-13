import { perfToAudio } from '../audio/audio';
import { metronomeClick, piano, type ClickLevel } from '../audio/piano';
import type { Bus } from '../audio/audio';
import type { ClickSound, MetronomeFade } from './types';
import type { Note, Song } from '../music/types';
import { clickUnit } from '../music/song';
import type { Clock } from './clock';

const LOOKAHEAD_MS = 120;
const TOO_LATE_MS = 60;

/** Plays notes (the hand the app accompanies with, or everything in Listen mode) as the playhead reaches them. */
export class NoteScheduler {
  private idx = 0;
  constructor(
    private notes: Note[],
    private bus: Bus = 'accomp',
    /** Also play notes exactly at the limit (a guide plays the note the cursor waits on). */
    private inclusive = false,
  ) {}

  reset(beat: number): void {
    this.idx = this.notes.findIndex((n) => n.start >= beat - 1e-6);
    if (this.idx < 0) this.idx = this.notes.length;
  }

  /** Schedules everything strictly before `limitBeat` that falls inside the look-ahead window. */
  run(clock: Clock, now: number, limitBeat: number, endBeat: number): void {
    if (!clock.running) return;
    const horizon = Math.min(clock.beatAt(now + LOOKAHEAD_MS), limitBeat + (this.inclusive ? 1e-3 : -1e-6));
    while (this.idx < this.notes.length && this.notes[this.idx].start < horizon) {
      const n = this.notes[this.idx++];
      if (n.start >= endBeat - 1e-6) continue;
      const t = clock.timeAt(n.start);
      if (t < now - TOO_LATE_MS) continue;
      piano.noteOn(n.pitch, n.velocity, {
        when: perfToAudio(t),
        duration: (n.dur / clock.bps) * 0.98,
        bus: this.bus,
      });
    }
  }
}

export interface Click {
  beat: number;
  level: ClickLevel;
}

export interface ClickOptions {
  subdivision: 'beat' | 'eighth';
  accent: boolean;
  sound: ClickSound;
  fade?: MetronomeFade;
  /** Fading: bars of clicks before it goes quiet. */
  fadeAfter?: number;
}

const DEFAULT_CLICKS: ClickOptions = { subdivision: 'beat', accent: true, sound: 'beep' };

/** Metronome clicks for the whole piece, plus a count-in before `from`. */
export function buildClicks(song: Song, from: number, countIn: number, o: ClickOptions = DEFAULT_CLICKS): Click[] {
  const unit = clickUnit(song.timeSig);
  const sub = o.subdivision === 'eighth' ? unit / 2 : unit;
  const clicks: Click[] = [];
  const levelAt = (offsetInBar: number, isBarStart: boolean): ClickLevel => {
    const onBeat = Math.abs(offsetInBar / unit - Math.round(offsetInBar / unit)) < 1e-6;
    if (!onBeat) return 'sub';
    return isBarStart && o.accent ? 'accent' : 'beat';
  };
  for (let b = from - countIn; b < from - 1e-6; b += sub) {
    const off = b - (from - countIn);
    clicks.push({ beat: b, level: levelAt(off, Math.abs(off) < 1e-6) });
  }
  // Bars counted from where playing starts, for the fading metronome (the count-in always sounds).
  let bar = -1;
  for (const m of song.measures) {
    if (m.start + m.length > from + 1e-6) bar++;
    if (o.fade === 'fade' && bar >= (o.fadeAfter ?? 2)) continue;
    if (o.fade === 'alternate' && bar % 2 === 1) continue;
    for (let b = 0; b < m.length - 1e-6; b += sub) {
      if (o.fade === 'beat1' && b > 1e-6) break;
      if (m.start + b >= from - 1e-6) clicks.push({ beat: m.start + b, level: levelAt(b, b === 0 && m.number !== 0) });
    }
  }
  return clicks;
}

export class ClickScheduler {
  private idx = 0;
  constructor(
    private clicks: Click[],
    private sound: ClickSound = 'beep',
  ) {}

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
      metronomeClick(perfToAudio(t), c.level, this.sound);
    }
  }
}
