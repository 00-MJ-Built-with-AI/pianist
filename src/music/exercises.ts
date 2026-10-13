import { songToMusicXml } from './musicxml';
import { isCompound, rhythmTimes, RHYTHM_LABEL, type ExerciseRhythm } from './rhythm';
import { finalizeSong, measureLength } from './song';
import type { Hand, Note, Song } from './types';

/*
 * Generated practice material: scales, arpeggios and chord progressions in every key, and endless
 * sight-reading pieces. Everything is built as ordinary songs, so all practice modes and reports work.
 */

type Raw = Omit<Note, 'id' | 'measure'>;

export interface Tonic {
  pc: number;
  major: string;
  minor: string;
}

/** The twelve keys around the circle of fifths. */
export const TONICS: Tonic[] = [
  { pc: 0, major: 'C', minor: 'C' },
  { pc: 7, major: 'G', minor: 'G' },
  { pc: 2, major: 'D', minor: 'D' },
  { pc: 9, major: 'A', minor: 'A' },
  { pc: 4, major: 'E', minor: 'E' },
  { pc: 11, major: 'B', minor: 'B' },
  { pc: 6, major: 'F#', minor: 'F#' },
  { pc: 1, major: 'Db', minor: 'C#' },
  { pc: 8, major: 'Ab', minor: 'G#' },
  { pc: 3, major: 'Eb', minor: 'Eb' },
  { pc: 10, major: 'Bb', minor: 'Bb' },
  { pc: 5, major: 'F', minor: 'F' },
];

const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]; // by tonic pitch class

export function majorFifths(pc: number): number {
  return MAJOR_FIFTHS[((pc % 12) + 12) % 12];
}

export function minorFifths(pc: number): number {
  const f = majorFifths(pc + 3); // relative major
  return f === 6 && pc === 3 ? -6 : f; // Eb minor rather than D# minor
}

export function tonicName(pc: number, minor: boolean): string {
  const t = TONICS.find((x) => x.pc === ((pc % 12) + 12) % 12)!;
  return minor ? t.minor : t.major;
}

export type ScaleKind = 'major' | 'natural-minor' | 'harmonic-minor';
const STEPS: Record<ScaleKind, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
};
const KIND_LABEL: Record<ScaleKind, string> = {
  major: 'Major',
  'natural-minor': 'Natural Minor',
  'harmonic-minor': 'Harmonic Minor',
};

export type HandsOption = 'R' | 'L' | 'both';
const HANDS_LABEL: Record<HandsOption, string> = { R: 'right hand', L: 'left hand', both: 'hands together' };

/** Pitch of a scale degree (0 = tonic, 7 = tonic an octave up, negatives go down). */
function degreePitch(tonicPitch: number, steps: number[], deg: number): number {
  const oct = Math.floor(deg / 7);
  return tonicPitch + 12 * oct + steps[((deg % 7) + 7) % 7];
}

function build(
  id: string,
  title: string,
  composer: string,
  level: number,
  bpm: number,
  timeSig: [number, number],
  keyFifths: number,
  notes: Raw[],
): Song {
  const song = finalizeSong({ id, title, composer, level, bpm, timeSig, keyFifths, notes, source: 'builtin' });
  song.scoreXml = songToMusicXml(song);
  return song;
}

/** Places a run of pitches one after another (in a rhythm), holding the last note to the end of its bar. */
function run(
  pitches: number[],
  beats: number,
  hand: Hand,
  barLen: number,
  spellOf?: (p: number, i: number) => Raw['spell'],
  rhythm: ExerciseRhythm = 'straight',
  offset = 0,
): Raw[] {
  const times = rhythmTimes(pitches.length, beats, rhythm);
  const notes: Raw[] = pitches.map((pitch, i) => ({
    pitch,
    start: offset + times[i].start,
    dur: times[i].dur,
    hand,
    velocity: times[i].velocity,
    spell: spellOf?.(pitch, i),
  }));
  const last = notes[notes.length - 1];
  const end = last.start + last.dur;
  const barEnd = Math.ceil(end / barLen - 1e-9) * barLen;
  last.dur = Math.max(beats, barEnd - last.start);
  return notes;
}

function withHands(
  rh: number[],
  beats: number,
  hands: HandsOption,
  barLen: number,
  spellOf?: (p: number, i: number) => Raw['spell'],
  rhythm: ExerciseRhythm = 'straight',
  offset = 0,
): Raw[] {
  const notes: Raw[] = [];
  if (hands !== 'L') notes.push(...run(rh, beats, 'R', barLen, spellOf, rhythm, offset));
  if (hands !== 'R') notes.push(...run(rh.map((p) => p - 12), beats, 'L', barLen, spellOf, rhythm, offset));
  return notes;
}

/** Time signature, bar length and written tempo for a rhythm (swing and triplets are written in 12/8). */
function meterFor(rhythm: ExerciseRhythm, bpm: number): { timeSig: [number, number]; barLen: number; bpm: number } {
  return isCompound(rhythm) ? { timeSig: [12, 8], barLen: 6, bpm: Math.round(bpm * 1.5) } : { timeSig: [4, 4], barLen: 4, bpm };
}

const rhythmSuffix = (r: ExerciseRhythm | undefined) => (r && r !== 'straight' ? ` · ${RHYTHM_LABEL[r].toLowerCase()}` : '');
const rhythmId = (r: ExerciseRhythm | undefined) => (r && r !== 'straight' ? `-${r}` : '');

export interface ScaleOptions {
  pc: number;
  kind: ScaleKind;
  octaves: 1 | 2;
  hands: HandsOption;
  beats: 1 | 0.5; // per note
  bpm: number;
  rhythm?: ExerciseRhythm;
}

export function scaleExercise(o: ScaleOptions): Song {
  const minor = o.kind !== 'major';
  const steps = STEPS[o.kind];
  const tonic = 60 + o.pc;
  const top = 7 * o.octaves;
  const degrees = [...Array(top + 1).keys(), ...Array.from({ length: top }, (_, i) => top - 1 - i)];
  const pitches = degrees.map((d) => degreePitch(tonic, steps, d));
  // The raised seventh of harmonic minor is written with a sharp (or natural), never as a flat.
  const spellOf = (_p: number, i: number) => (o.kind === 'harmonic-minor' && degrees[i] % 7 === 6 ? ('sharp' as const) : undefined);
  const name = `${tonicName(o.pc, minor)} ${KIND_LABEL[o.kind]} Scale`;
  const m = meterFor(o.rhythm ?? 'straight', o.bpm);
  return build(
    `ex-scale-${o.pc}-${o.kind}-${o.octaves}-${o.hands}-${o.beats}${rhythmId(o.rhythm)}`,
    name,
    `Exercise · ${o.octaves} octave${o.octaves > 1 ? 's' : ''} · ${HANDS_LABEL[o.hands]}${rhythmSuffix(o.rhythm)}`,
    o.octaves === 1 ? 1 : 2,
    m.bpm,
    m.timeSig,
    minor ? minorFifths(o.pc) : majorFifths(o.pc),
    withHands(pitches, o.beats, o.hands, m.barLen, spellOf, o.rhythm),
  );
}

export interface ArpeggioOptions {
  pc: number;
  quality: 'major' | 'minor';
  octaves: 1 | 2;
  hands: HandsOption;
  beats: 1 | 0.5;
  bpm: number;
  rhythm?: ExerciseRhythm;
}

export function arpeggioExercise(o: ArpeggioOptions): Song {
  const minor = o.quality === 'minor';
  const tones = minor ? [0, 3, 7] : [0, 4, 7];
  const up: number[] = [];
  for (let oct = 0; oct < o.octaves; oct++) for (const t of tones) up.push(60 + o.pc + 12 * oct + t);
  up.push(60 + o.pc + 12 * o.octaves);
  const pitches = [...up, ...up.slice(0, -1).reverse()];
  const m = meterFor(o.rhythm ?? 'straight', o.bpm);
  return build(
    `ex-arp-${o.pc}-${o.quality}-${o.octaves}-${o.hands}-${o.beats}${rhythmId(o.rhythm)}`,
    `${tonicName(o.pc, minor)} ${minor ? 'Minor' : 'Major'} Arpeggio`,
    `Exercise · ${o.octaves} octave${o.octaves > 1 ? 's' : ''} · ${HANDS_LABEL[o.hands]}${rhythmSuffix(o.rhythm)}`,
    2,
    m.bpm,
    m.timeSig,
    minor ? minorFifths(o.pc) : majorFifths(o.pc),
    withHands(pitches, o.beats, o.hands, m.barLen, undefined, o.rhythm),
  );
}

export const PROGRESSIONS: Record<'major' | 'minor', Array<{ id: string; label: string; degrees: number[] }>> = {
  major: [
    { id: 'I-IV-V-I', label: 'I – IV – V – I', degrees: [1, 4, 5, 1] },
    { id: 'I-V-vi-IV', label: 'I – V – vi – IV (pop)', degrees: [1, 5, 6, 4] },
    { id: 'I-vi-IV-V', label: 'I – vi – IV – V (50s)', degrees: [1, 6, 4, 5] },
    { id: 'ii-V-I', label: 'ii – V – I (jazz)', degrees: [2, 5, 1, 1] },
  ],
  minor: [
    { id: 'i-iv-V-i', label: 'i – iv – V – i', degrees: [1, 4, 5, 1] },
    { id: 'i-VI-III-VII', label: 'i – VI – III – VII', degrees: [1, 6, 3, 7] },
    { id: 'i-iv-VII-III', label: 'i – iv – VII – III', degrees: [1, 4, 7, 3] },
  ],
};

export interface ProgressionOptions {
  pc: number;
  minor: boolean;
  progression: string;
  beatsPerChord: 4 | 2;
  bpm: number;
}

/** Block chords in the right hand with smooth voice leading, roots in the left hand. */
export function progressionExercise(o: ProgressionOptions): Song {
  const list = PROGRESSIONS[o.minor ? 'minor' : 'major'];
  const prog = list.find((p) => p.id === o.progression) ?? list[0];
  const natural = STEPS[o.minor ? 'natural-minor' : 'major'];
  const tonic = 48 + o.pc;
  const notes: Raw[] = [];
  let prev: number[] | null = null;
  const degrees = [...prog.degrees, ...prog.degrees, 1];
  degrees.forEach((deg, i) => {
    const d = deg - 1;
    // In minor, V (and its leading tone) comes from the harmonic minor scale.
    const steps = o.minor && deg === 5 ? STEPS['harmonic-minor'] : natural;
    const chordPcs = [0, 2, 4].map((k) => degreePitch(tonic, steps, d + k) % 12);
    const leading = o.minor && deg === 5 ? degreePitch(tonic, steps, 6) % 12 : -1;
    // All voicings of the triad between G3 and G5; pick the closest to the previous chord.
    const voicings: number[][] = [];
    for (let inv = 0; inv < 3; inv++) {
      for (let base = 52; base <= 72; base++) {
        if (base % 12 !== chordPcs[inv]) continue;
        const v = [base];
        for (let k = 1; k < 3; k++) {
          let p = v[k - 1] + 1;
          while (p % 12 !== chordPcs[(inv + k) % 3]) p++;
          v.push(p);
        }
        if (v[2] <= 79) voicings.push(v);
      }
    }
    const score = (v: number[]) =>
      prev ? v.reduce((a, p, k) => a + Math.abs(p - prev![k]), 0) : Math.abs(v[0] - (60 + o.pc)) + (v[0] % 12 === chordPcs[0] ? 0 : 6);
    const voicing = voicings.sort((a, b) => score(a) - score(b))[0];
    prev = voicing;
    const start = i * o.beatsPerChord;
    const dur = i === degrees.length - 1 ? 4 - (start % 4) : o.beatsPerChord;
    for (const p of voicing) notes.push({ pitch: p, start, dur, hand: 'R', velocity: 70, spell: p % 12 === leading ? 'sharp' : undefined });
    let root = 36 + chordPcs[0];
    if (root < 40) root += 12;
    notes.push({ pitch: root, start, dur, hand: 'L', velocity: 64 });
  });
  return build(
    `ex-prog-${o.pc}-${o.minor ? 'min' : 'maj'}-${prog.id}-${o.beatsPerChord}`,
    `${tonicName(o.pc, o.minor)} ${o.minor ? 'minor' : 'major'}: ${prog.label.replace(/ \(.*\)/, '')}`,
    'Exercise · chord progression',
    2,
    o.bpm,
    [4, 4],
    o.minor ? minorFifths(o.pc) : majorFifths(o.pc),
    notes,
  );
}

/* ---------------------------------------------------------------- sight-reading */

/** Small deterministic random generator, so a seed always gives the same piece. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LevelSpec {
  keys: number[]; // tonic pitch classes
  times: Array<[number, number]>;
  rhythms: Record<number, number[][]>; // by beats per bar
  range: [number, number]; // scale degrees for the melody
  maxLeap: number; // in scale degrees
  lh: 'none' | 'whole' | 'root-fifth' | 'broken';
  description: string;
}

export const SIGHT_LEVELS: Record<number, LevelSpec> = {
  1: {
    keys: [0],
    times: [[4, 4]],
    rhythms: { 4: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [2, 2]] },
    range: [0, 4],
    maxLeap: 1,
    lh: 'none',
    description: 'C position, right hand, steps only, quarter and half notes',
  },
  2: {
    keys: [0, 7, 5],
    times: [[4, 4]],
    rhythms: { 4: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 2]] },
    range: [0, 5],
    maxLeap: 2,
    lh: 'whole',
    description: 'C, G and F major, both hands, small skips, eighth notes',
  },
  3: {
    keys: [0, 7, 2, 5, 10],
    times: [[4, 4], [3, 4]],
    rhythms: {
      4: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1], [2, 1, 1], [0.5, 0.5, 0.5, 0.5, 2]],
      3: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [1, 0.5, 0.5, 1]],
    },
    range: [-1, 7],
    maxLeap: 4,
    lh: 'root-fifth',
    description: 'Keys up to two sharps or flats, 3/4 and 4/4, dotted rhythms, moving bass',
  },
  4: {
    keys: [0, 7, 2, 9, 5, 10, 3],
    times: [[4, 4], [3, 4]],
    rhythms: {
      4: [[1, 0.5, 0.5, 1, 1], [1.5, 0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 1, 2], [0.75, 0.25, 1, 2]],
      3: [[1, 0.5, 0.5, 1], [1.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 1], [2, 1]],
    },
    range: [-2, 9],
    maxLeap: 5,
    lh: 'broken',
    description: 'Keys up to three sharps or flats, wider range, broken-chord accompaniment',
  },
};

// Harmony per bar (scale degrees 0 = I), ending V → I.
const PLANS = [
  [0, 3, 4, 0],
  [0, 4, 0, 4],
  [0, 5, 3, 4],
  [0, 3, 0, 4],
];

export function sightReading(level: number, bars: 4 | 8, seed: number): Song {
  const spec = SIGHT_LEVELS[Math.max(1, Math.min(4, level))];
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const pc = pick(spec.keys);
  const time = pick(spec.times);
  const barLen = measureLength(time);
  const steps = STEPS.major;
  const tonic = pc <= 7 ? 60 + pc : 48 + pc; // keep the melody around middle C
  const plan = pick(PLANS);
  const harmony = Array.from({ length: bars }, (_, b) => (b === bars - 1 ? 0 : b === bars - 2 ? 4 : plan[b % plan.length]));

  const notes: Raw[] = [];
  let deg = pick([0, 2, 4].filter((d) => d >= spec.range[0] && d <= spec.range[1]));
  let dir = rnd() < 0.5 ? -1 : 1;
  for (let b = 0; b < bars; b++) {
    const barStart = b * barLen;
    const chord = harmony[b];
    const chordDegs = [chord, chord + 2, chord + 4];
    if (b === bars - 1) {
      // Final bar: the tonic nearest the current note, held.
      const target = [0, 7, -7].filter((t) => t >= spec.range[0] - 1 && t <= spec.range[1] + 1).sort((x, y) => Math.abs(x - deg) - Math.abs(y - deg))[0] ?? 0;
      notes.push({ pitch: degreePitch(tonic, steps, target), start: barStart, dur: barLen, hand: 'R', velocity: 72 });
    } else {
      const rhythm = pick(spec.rhythms[Math.round(barLen)] ?? spec.rhythms[4]);
      let t = 0;
      rhythm.forEach((d, i) => {
        if (i === 0) {
          // Strong beat: the chord tone closest to where the melody is.
          const options: number[] = [];
          for (const c of chordDegs) for (const o of [-7, 0, 7]) {
            const x = c + o;
            if (x >= spec.range[0] && x <= spec.range[1] && Math.abs(x - deg) <= Math.max(2, spec.maxLeap)) options.push(x);
          }
          if (options.length) deg = options.sort((x, y) => Math.abs(x - deg) - Math.abs(y - deg))[Math.floor(rnd() * Math.min(2, options.length))];
        } else {
          if (rnd() < 0.25) dir = -dir;
          const leap = rnd() < 0.75 ? 1 : 1 + Math.floor(rnd() * spec.maxLeap);
          let next = deg + dir * Math.min(leap, spec.maxLeap);
          if (next < spec.range[0] || next > spec.range[1]) {
            dir = -dir;
            next = deg + dir;
          }
          deg = Math.max(spec.range[0], Math.min(spec.range[1], next));
        }
        notes.push({ pitch: degreePitch(tonic, steps, deg), start: barStart + t, dur: d, hand: 'R', velocity: 72 });
        t += d;
      });
    }

    // Left hand: chord root kept between E2 and E3 so it reads comfortably in the bass clef.
    if (spec.lh !== 'none') {
      let root = 36 + (degreePitch(pc, steps, chord) % 12);
      if (root < 40) root += 12;
      const fifth = root + (degreePitch(0, steps, chord + 4) - degreePitch(0, steps, chord));
      const lh = (pitch: number, start: number, dur: number) => notes.push({ pitch, start: barStart + start, dur, hand: 'L', velocity: 60 });
      if (spec.lh === 'whole' || b === bars - 1) lh(root, 0, barLen);
      else if (spec.lh === 'root-fifth') {
        for (let beat = 0; beat < barLen; beat++) lh(beat % 2 === 0 ? root : fifth, beat, 1);
      } else {
        const pattern = [root, fifth, root + 12, fifth];
        for (let k = 0; k < barLen * 2; k++) lh(pattern[k % 4], k * 0.5, 0.5);
      }
    }
  }
  return build(
    `ex-sight-${level}-${bars}-${seed}`,
    `Sight-reading · Level ${level}`,
    `Generated · ${tonicName(pc, false)} major`,
    level,
    [0, 72, 80, 88, 96][level] ?? 80,
    time,
    majorFifths(pc),
    notes,
  );
}

/* ------------------------------------------------------------------ your own exercises */

/** A pattern of scale degrees moved up the scale (and back down, mirrored, Hanon-style) in one or more keys. */
export interface PatternSpec {
  type: 'pattern';
  pattern: number[]; // scale degrees, 1 = the tonic, 8 = an octave up
  keys: number[]; // tonic pitch classes, one after another
  minor: boolean;
  climb: number; // scale steps the pattern moves up (7 = an octave)
  mirror: boolean; // come back down
  hands: HandsOption;
  beats: 1 | 0.5 | 0.25;
  rhythm: ExerciseRhythm;
  bpm: number;
}

export type ChordType = 'maj' | 'min' | 'dim' | 'aug' | 'dom7' | 'maj7' | 'min7';

export const CHORD_TYPES: Record<ChordType, { label: string; tones: number[] }> = {
  maj: { label: 'major', tones: [0, 4, 7] },
  min: { label: 'minor', tones: [0, 3, 7] },
  dim: { label: 'diminished', tones: [0, 3, 6] },
  aug: { label: 'augmented', tones: [0, 4, 8] },
  dom7: { label: 'dominant 7th', tones: [0, 4, 7, 10] },
  maj7: { label: 'major 7th', tones: [0, 4, 7, 11] },
  min7: { label: 'minor 7th', tones: [0, 3, 7, 10] },
};

/** Chord types and inversions, block or broken, through a set of keys. */
export interface ChordSpec {
  type: 'chords';
  chords: ChordType[];
  inversions: number[]; // 0 = root position, 1, 2, 3 (7ths only)
  style: 'block' | 'broken';
  keys: number[];
  hands: HandsOption; // the right hand plays the chords, the left the roots (or the left plays the chords alone)
  rhythm: ExerciseRhythm; // broken chords only
  bpm: number;
}

export interface ScaleSpec {
  type: 'scale';
  pc: number;
  kind: ScaleKind;
  octaves: 1 | 2;
  hands: HandsOption;
  beats: 1 | 0.5;
  rhythm: ExerciseRhythm;
  bpm: number;
}

export type ExerciseSpec = PatternSpec | ChordSpec | ScaleSpec;

export interface SavedExercise {
  id: string;
  name: string;
  spec: ExerciseSpec;
  /** Today's plan may pick it for the warm-up. */
  warmup: boolean;
}

/** "1 2 3 4 5 4 3 2", "1-2-3-4-5" or "12345432" → scale degrees (1–15). */
export function parsePattern(text: string): number[] | null {
  const t = text.trim();
  if (!t) return null;
  const parts = /[\s,\-]/.test(t) ? t.split(/[\s,\-]+/).filter(Boolean) : [...t];
  const degs = parts.map(Number);
  if (degs.length < 2 || degs.length > 24 || degs.some((d) => !Number.isInteger(d) || d < 1 || d > 15)) return null;
  return degs;
}

const KEY_NAMES = (keys: number[], minor: boolean) => keys.map((k) => tonicName(k, minor)).join(', ');

/** Bars of `barLen` needed to hold `beats`. */
const barsFor = (beats: number, barLen: number) => Math.max(1, Math.ceil(beats / barLen - 1e-9));

export function patternExercise(o: PatternSpec, id = 'ex-pattern'): Song {
  const steps = STEPS[o.minor ? 'natural-minor' : 'major'];
  const pmin = Math.min(...o.pattern);
  const pmax = Math.max(...o.pattern);
  const m = meterFor(o.rhythm, o.bpm);
  const notes: Raw[] = [];
  let offset = 0;
  for (const pc of o.keys) {
    // Keep it in a comfortable range: keys above F# start an octave lower.
    const tonic = 60 + pc - (pc > 5 ? 12 : 0);
    const degrees: number[] = [];
    for (let r = 0; r <= o.climb; r++) for (const d of o.pattern) degrees.push(d - 1 + r);
    if (o.mirror) for (let r = o.climb; r >= 0; r--) for (const d of o.pattern) degrees.push(pmax + pmin - d - 1 + r);
    degrees.push(0); // home on the tonic
    const pitches = degrees.map((d) => degreePitch(tonic, steps, d));
    const segment = withHands(pitches, o.beats, o.hands, m.barLen, undefined, o.rhythm, offset);
    notes.push(...segment);
    const end = Math.max(...segment.map((n) => n.start + n.dur));
    offset += barsFor(end - offset, m.barLen) * m.barLen;
  }
  const single = o.keys.length === 1;
  return build(
    id,
    `Pattern ${o.pattern.join('-')} in ${KEY_NAMES(o.keys, o.minor)}${o.minor ? ' minor' : ''}`,
    `Your exercise · ${HANDS_LABEL[o.hands]}${o.mirror ? ' · up and down' : ''}${rhythmSuffix(o.rhythm)}`,
    2,
    m.bpm,
    m.timeSig,
    single ? (o.minor ? minorFifths(o.keys[0]) : majorFifths(o.keys[0])) : 0,
    notes,
  );
}

export function chordDrill(o: ChordSpec, id = 'ex-chords'): Song {
  const m = meterFor(o.style === 'broken' ? o.rhythm : 'straight', o.bpm);
  const notes: Raw[] = [];
  let offset = 0;
  const half = m.barLen / 2;
  for (const pc of o.keys) {
    const root = 60 + pc - (pc > 6 ? 12 : 0);
    for (const type of o.chords) {
      const base = CHORD_TYPES[type].tones;
      for (const inv of o.inversions) {
        if (inv >= base.length) continue;
        let tones = base.map((t) => root + t);
        for (let i = 0; i < inv; i++) tones = [...tones.slice(1), tones[0] + 12];
        const chordHand: Hand = o.hands === 'L' ? 'L' : 'R';
        const shift = o.hands === 'L' ? -12 : 0;
        let length: number;
        if (o.style === 'block') {
          for (const p of tones) notes.push({ pitch: p + shift, start: offset, dur: half, hand: chordHand, velocity: 72 });
          length = half;
        } else {
          const times = rhythmTimes(tones.length + 1, 0.5, o.rhythm);
          const seq = [...tones, tones[0] + 12];
          seq.forEach((p, i) => notes.push({ pitch: p + shift, start: offset + times[i].start, dur: times[i].dur, hand: chordHand, velocity: times[i].velocity }));
          length = Math.max(half, Math.ceil((times[times.length - 1].start + times[times.length - 1].dur) / half - 1e-9) * half);
        }
        if (o.hands === 'both') notes.push({ pitch: root - 12 - (root >= 60 ? 12 : 0), start: offset, dur: length, hand: 'L', velocity: 64 });
        offset += length;
      }
    }
  }
  // End on a full bar.
  const types = o.chords.map((c) => CHORD_TYPES[c].label).join(', ');
  const invs = o.inversions.map((i) => (i === 0 ? 'root' : `${i}${i === 1 ? 'st' : i === 2 ? 'nd' : 'rd'}`)).join(', ');
  const song = build(
    id,
    `Chords: ${types}`,
    `Your exercise · ${invs} · ${KEY_NAMES(o.keys, false)} · ${o.style}${o.style === 'broken' ? rhythmSuffix(o.rhythm) : ''}`,
    2,
    m.bpm,
    m.timeSig,
    o.keys.length === 1 ? majorFifths(o.keys[0]) : 0,
    notes,
  );
  return song;
}

/** Builds a saved exercise (its id ties practice results to it). */
export function buildExercise(spec: ExerciseSpec, id: string): Song {
  if (spec.type === 'pattern') return patternExercise(spec, `ex-custom-${id}`);
  if (spec.type === 'chords') return chordDrill(spec, `ex-custom-${id}`);
  const song = scaleExercise(spec);
  return { ...song, id: `ex-custom-${id}` };
}

export function describeSpec(spec: ExerciseSpec): string {
  if (spec.type === 'pattern') return `${spec.pattern.join('-')} · ${KEY_NAMES(spec.keys, spec.minor)} · ${HANDS_LABEL[spec.hands]}${rhythmSuffix(spec.rhythm)}`;
  if (spec.type === 'chords')
    return `${spec.chords.map((c) => CHORD_TYPES[c].label).join(', ')} · ${KEY_NAMES(spec.keys, false)} · ${spec.style}${spec.style === 'broken' ? rhythmSuffix(spec.rhythm) : ''}`;
  return `${tonicName(spec.pc, spec.kind !== 'major')} ${KIND_LABEL[spec.kind].toLowerCase()} scale · ${HANDS_LABEL[spec.hands]}${rhythmSuffix(spec.rhythm)}`;
}
