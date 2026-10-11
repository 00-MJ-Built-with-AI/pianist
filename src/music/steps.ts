import type { Hand, Note, Song } from './types';

/** All notes that begin together in the hands being practised. */
export interface Step {
  index: number;
  beat: number;
  notes: Note[];
  pitches: number[];
  measure: number;
}

const SAME_ONSET = 1e-3;

export function buildSteps(notes: Note[], hands: ReadonlySet<Hand>, from = 0, to = Infinity): Step[] {
  const steps: Step[] = [];
  for (const n of notes) {
    if (!hands.has(n.hand) || n.start < from - SAME_ONSET || n.start >= to - SAME_ONSET) continue;
    const last = steps[steps.length - 1];
    if (last && Math.abs(last.beat - n.start) < SAME_ONSET) {
      last.notes.push(n);
      if (!last.pitches.includes(n.pitch)) last.pitches.push(n.pitch);
    } else {
      steps.push({ index: steps.length, beat: n.start, notes: [n], pitches: [n.pitch], measure: n.measure });
    }
  }
  return steps;
}

export interface Region {
  fromMeasure: number;
  toMeasure: number; // inclusive
  startBeat: number;
  endBeat: number;
}

export function regionFor(song: Song, fromMeasure: number, toMeasure: number): Region {
  const a = Math.max(0, Math.min(fromMeasure, song.measures.length - 1));
  const b = Math.max(a, Math.min(toMeasure, song.measures.length - 1));
  const last = song.measures[b];
  return { fromMeasure: a, toMeasure: b, startBeat: song.measures[a].start, endBeat: last.start + last.length };
}

export function wholeSong(song: Song): Region {
  return regionFor(song, 0, song.measures.length - 1);
}
