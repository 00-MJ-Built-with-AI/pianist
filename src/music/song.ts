import type { DynamicMark, Measure, Note, Song, SongSource } from './types';

export const EPS = 1e-6;

/** Length of one bar in quarter-note beats. */
export function measureLength(timeSig: [number, number]): number {
  return (timeSig[0] * 4) / timeSig[1];
}

/** Metronome click spacing in beats: compound meters (6/8, 9/8, 12/8, 3/8) click on dotted quarters. */
export function clickUnit(timeSig: [number, number]): number {
  const [num, den] = timeSig;
  if (den === 8 && num % 3 === 0) return 1.5;
  return 4 / den;
}

export function buildMeasures(totalBeats: number, timeSig: [number, number], pickup: number): Measure[] {
  const len = measureLength(timeSig);
  const measures: Measure[] = [];
  let start = 0;
  let number = 1;
  if (pickup > EPS) {
    measures.push({ index: 0, number: 0, start: 0, length: pickup });
    start = pickup;
  }
  // Always at least one full bar, even for an empty recording.
  do {
    measures.push({ index: measures.length, number: number++, start, length: len });
    start += len;
  } while (start < totalBeats - EPS);
  return measures;
}

export function measureIndexAt(measures: Measure[], beat: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measures[mid].start <= beat + EPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface SongInput {
  id: string;
  title: string;
  composer: string;
  level: number;
  bpm: number;
  timeSig: [number, number];
  keyFifths: number;
  pickup?: number;
  notes: Array<Omit<Note, 'id' | 'measure'>>;
  dynamics?: DynamicMark[];
  source: SongSource;
  scoreXml?: string;
  createdAt?: number;
  totalBeats?: number;
  /** Bars taken from a score file (time signatures may change); otherwise built from timeSig. */
  measures?: Measure[];
}

/** Sorts notes, assigns ids and bar indexes, and builds the bar grid. */
export function finalizeSong(input: SongInput): Song {
  const pickup = input.pickup ?? 0;
  const sorted = [...input.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const lastEnd = sorted.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const len = measureLength(input.timeSig);
  let measures: Measure[];
  let totalBeats: number;
  if (input.measures?.length) {
    measures = input.measures;
    const last = measures[measures.length - 1];
    totalBeats = last.start + last.length;
  } else {
    // Round the end of the piece up to a whole bar.
    const afterPickup = Math.max(0, (input.totalBeats ?? lastEnd) - pickup);
    totalBeats = pickup + Math.max(len, Math.ceil(afterPickup / len - EPS) * len);
    measures = buildMeasures(totalBeats, input.timeSig, pickup);
  }
  const notes: Note[] = sorted.map((n, i) => ({ ...n, id: i, measure: measureIndexAt(measures, n.start) }));
  return {
    id: input.id,
    title: input.title,
    composer: input.composer,
    level: input.level,
    bpm: input.bpm,
    timeSig: input.timeSig,
    keyFifths: input.keyFifths,
    pickup,
    notes,
    measures,
    totalBeats,
    dynamics: input.dynamics ?? [],
    source: input.source,
    scoreXml: input.scoreXml,
    createdAt: input.createdAt,
  };
}
