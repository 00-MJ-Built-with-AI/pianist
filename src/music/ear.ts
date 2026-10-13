import { isBlackKey, noteLabel, pitchName } from './pitch';

/*
 * Ear training: the app plays something, the player plays it back on the piano.
 * Four kinds, four levels each; questions come from a seeded generator.
 */

export type EarKind = 'notes' | 'intervals' | 'chords' | 'melodies';

export interface EarQuestion {
  kind: EarKind;
  level: number;
  /** What to play back, in order; notes in one group sound together. */
  answer: number[][];
  /** A note to play first as a reference (heard, not part of the answer). */
  reference?: number;
  /** Shown on the keyboard to help (the first note of intervals and melodies). */
  hint?: number;
  label: string;
}

export const EAR_LEVELS: Record<EarKind, string[]> = {
  notes: ['C D E F G after a C', 'One octave of white keys', 'All twelve notes', 'Two octaves, all notes'],
  intervals: ['Seconds and thirds, upwards', 'Up to a fifth, upwards', 'Up to an octave, upwards', 'Up to an octave, up or down'],
  chords: ['C, F and G major', 'Major and minor, any root', 'Major and minor with inversions', 'Plus diminished, augmented and 7ths'],
  melodies: ['3 notes, stepwise, from C', '4 notes in C major', '5 notes with skips', '6 notes in C, G or F major'],
};

const INTERVAL_NAMES = [
  'unison',
  'minor 2nd',
  'major 2nd',
  'minor 3rd',
  'major 3rd',
  'perfect 4th',
  'tritone',
  'perfect 5th',
  'minor 6th',
  'major 6th',
  'minor 7th',
  'major 7th',
  'octave',
];

export function intervalName(semitones: number): string {
  const s = Math.abs(semitones);
  return INTERVAL_NAMES[s] ?? `${s} semitones`;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

const CHORDS: Record<string, { name: string; tones: number[] }> = {
  maj: { name: 'major', tones: [0, 4, 7] },
  min: { name: 'minor', tones: [0, 3, 7] },
  dim: { name: 'diminished', tones: [0, 3, 6] },
  aug: { name: 'augmented', tones: [0, 4, 8] },
  dom7: { name: 'dominant 7th', tones: [0, 4, 7, 10] },
  maj7: { name: 'major 7th', tones: [0, 4, 7, 11] },
};

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rnd: Rng, xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const name = (p: number, flats = false) => noteLabel(p, 'letter', flats);
const MAJOR_ROOTS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_ROOTS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

export function makeQuestion(kind: EarKind, level: number, rnd: Rng): EarQuestion {
  const lv = Math.max(1, Math.min(4, level));
  switch (kind) {
    case 'notes': {
      const pool =
        lv === 1
          ? [60, 62, 64, 65, 67]
          : lv === 2
            ? [60, 62, 64, 65, 67, 69, 71, 72]
            : lv === 3
              ? Array.from({ length: 12 }, (_, i) => 60 + i)
              : Array.from({ length: 24 }, (_, i) => 48 + i);
      const p = pick(rnd, pool.filter((x) => x !== 60 || lv > 1));
      return { kind, level: lv, answer: [[p]], reference: 60, label: `${pitchName(p)}` };
    }
    case 'intervals': {
      const sizes = lv === 1 ? [1, 2, 3, 4] : lv === 2 ? [2, 3, 4, 5, 7] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const size = pick(rnd, sizes);
      const down = lv === 4 && rnd() < 0.5;
      const first = down ? 60 + Math.floor(rnd() * 12) + 2 : 55 + Math.floor(rnd() * 10);
      const second = first + (down ? -size : size);
      // Minor intervals read naturally with flats (C → E♭), major ones from a black key too (B♭ → D).
      const flats = [3, 8, 10].includes(size) || (isBlackKey(first) && [4, 9, 11].includes(size));
      return {
        kind,
        level: lv,
        answer: [[first], [second]],
        hint: first,
        label: `${intervalName(size)} ${down ? 'down' : 'up'} (${name(first, flats)} → ${name(second, flats)})`,
      };
    }
    case 'chords': {
      const types = lv === 4 ? Object.keys(CHORDS) : lv === 1 ? ['maj'] : ['maj', 'min'];
      const type = pick(rnd, types);
      const root = lv === 1 ? pick(rnd, [60, 65, 55]) : 53 + Math.floor(rnd() * 12);
      let tones = CHORDS[type].tones.map((t) => root + t);
      let inv = 0;
      if (lv >= 3) {
        inv = Math.floor(rnd() * tones.length);
        for (let i = 0; i < inv; i++) tones = [...tones.slice(1), tones[0] + 12];
      }
      const invName = inv === 0 ? '' : inv === 1 ? ', 1st inversion' : inv === 2 ? ', 2nd inversion' : ', 3rd inversion';
      const rootName = (type === 'min' || type === 'dim' ? MINOR_ROOTS : MAJOR_ROOTS)[root % 12];
      return { kind, level: lv, answer: [tones], label: `${rootName} ${CHORDS[type].name}${invName}` };
    }
    case 'melodies': {
      const length = [3, 4, 5, 6][lv - 1];
      const tonic = lv === 4 ? pick(rnd, [60, 67, 65]) : 60;
      const maxLeap = lv >= 3 ? 3 : 1;
      let deg = 0;
      const degs = [0];
      for (let i = 1; i < length; i++) {
        let step = 1 + (rnd() < 0.35 ? Math.floor(rnd() * maxLeap) : 0);
        if (rnd() < 0.5) step = -step;
        const lo = lv === 1 ? 0 : -2;
        const hi = lv <= 2 ? 4 + (lv - 1) * 3 : 9;
        if (deg + step < lo || deg + step > hi) step = -step;
        deg = Math.max(lo, Math.min(hi, deg + step));
        degs.push(deg);
      }
      const pitches = degs.map((d) => tonic + 12 * Math.floor(d / 7) + MAJOR[((d % 7) + 7) % 7]);
      return { kind, level: lv, answer: pitches.map((p) => [p]), hint: pitches[0], label: pitches.map((p) => name(p, tonic === 65)).join(' ') };
    }
  }
}

export interface EarResult {
  correct: boolean;
  /** For each answer group: whether it was played right. */
  groups: boolean[];
}

/** Compares what was played with the answer; `anyOctave` accepts the right note names in any octave. */
export function checkAnswer(q: EarQuestion, played: number[][], anyOctave: boolean): EarResult {
  const norm = (p: number) => (anyOctave ? ((p % 12) + 12) % 12 : p);
  const sameSet = (a: number[], b: number[]) => {
    const x = [...new Set(a.map(norm))].sort((m, n) => m - n);
    const y = [...new Set(b.map(norm))].sort((m, n) => m - n);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  // Single-note answers are compared as a flat sequence, so slightly overlapping notes still count.
  if (q.answer.every((g) => g.length === 1)) {
    const flat = played.flat();
    const groups = q.answer.map((g, i) => flat[i] !== undefined && norm(flat[i]) === norm(g[0]));
    return { correct: groups.every(Boolean) && flat.length === q.answer.length, groups };
  }
  const groups = q.answer.map((g, i) => !!played[i] && sameSet(g, played[i]));
  return { correct: groups.every(Boolean) && played.length === q.answer.length, groups };
}

/** Groups key presses that start within `windowMs` of each other. */
export function groupPresses(presses: Array<{ pitch: number; time: number }>, windowMs = 140): number[][] {
  const groups: Array<{ t: number; pitches: number[] }> = [];
  for (const p of [...presses].sort((a, b) => a.time - b.time)) {
    const last = groups[groups.length - 1];
    if (last && p.time - last.t <= windowMs) last.pitches.push(p.pitch);
    else groups.push({ t: p.time, pitches: [p.pitch] });
  }
  return groups.map((g) => g.pitches);
}

/** Adaptive difficulty: three right in a row moves up, two wrong in a row moves down. */
export function nextLevel(level: number, streak: number, misses: number): number {
  if (streak >= 3) return Math.min(4, level + 1);
  if (misses >= 2) return Math.max(1, level - 1);
  return level;
}

/* ------------------------------------------------------------------ your own drills */

export type CustomWhat = 'intervals' | 'chords' | 'notes' | 'melodies';
export type IntervalDir = 'up' | 'down' | 'together';

export const CUSTOM_CHORDS: Record<string, { name: string; tones: number[] }> = {
  ...CHORDS,
  min7: { name: 'minor 7th', tones: [0, 3, 7, 10] },
  sus2: { name: 'sus2', tones: [0, 2, 7] },
  sus4: { name: 'sus4', tones: [0, 5, 7] },
};

/** A drill the player puts together: exactly what to hear, where, how to answer, and how long a round is. */
export interface CustomEar {
  what: CustomWhat;
  intervals: number[]; // semitones, 1–12
  directions: IntervalDir[];
  chords: string[]; // keys of CUSTOM_CHORDS
  inversions: number[]; // 0 = root position
  low: number; // pitch range
  high: number;
  keyPc: number; // notes and melodies are in this key
  minor: boolean;
  melodyLength: number;
  answer: 'play' | 'name';
  round: number; // questions per round (0 = endless)
}

export const DEFAULT_CUSTOM_EAR: CustomEar = {
  what: 'intervals',
  intervals: [3, 4, 7],
  directions: ['up'],
  chords: ['maj', 'min'],
  inversions: [0],
  low: 48,
  high: 79,
  keyPc: 0,
  minor: false,
  melodyLength: 4,
  answer: 'play',
  round: 10,
};

/** How often each item was asked and answered right (for weak spots). */
export type EarStats = Record<string, { asked: number; right: number }>;

export interface CustomQuestion extends EarQuestion {
  /** What was asked, for the weak-spot stats ("int:7:up", "chord:min:1", "note:4", "melody"). */
  item: string;
  /** Answer by name: the correct choice and all the choices. */
  choice: string;
  choices: string[];
}

const DIR_LABEL: Record<IntervalDir, string> = { up: 'up', down: 'down', together: 'together' };
const INV_LABEL = ['', ', 1st inversion', ', 2nd inversion', ', 3rd inversion'];
const PC_NAMES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Everything a drill can ask, as item keys. */
export function customItems(c: CustomEar): string[] {
  if (c.what === 'intervals') return c.intervals.flatMap((s) => c.directions.map((d) => `int:${s}:${d}`));
  if (c.what === 'chords') {
    return c.chords.flatMap((t) => c.inversions.filter((i) => i < (CUSTOM_CHORDS[t]?.tones.length ?? 3)).map((i) => `chord:${t}:${i}`));
  }
  if (c.what === 'notes') return (c.minor ? NAT_MINOR : MAJOR).map((st) => `note:${(c.keyPc + st) % 12}`);
  return ['melody'];
}

/** The name an item is answered with. */
export function itemName(item: string): string {
  const [kind, a, b] = item.split(':');
  if (kind === 'int') return `${intervalName(Number(a))} ${DIR_LABEL[b as IntervalDir]}`;
  if (kind === 'chord') return `${CUSTOM_CHORDS[a]?.name ?? a}${INV_LABEL[Number(b)] ?? ''}`;
  if (kind === 'note') return PC_NAMES[Number(a)];
  return 'melody';
}

/** Picks an item, favouring the ones missed most. */
export function pickItem(items: string[], stats: EarStats, rnd: Rng): string {
  const weight = (it: string) => {
    const s = stats[it];
    return s && s.asked ? 1 + 3 * (1 - s.right / s.asked) : 1.5;
  };
  const total = items.reduce((a, it) => a + weight(it), 0);
  let r = rnd() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

const within = (lo: number, hi: number, rnd: Rng) => lo + Math.floor(rnd() * Math.max(1, hi - lo + 1));

export function makeCustomQuestion(c: CustomEar, rnd: Rng, stats: EarStats = {}): CustomQuestion {
  const items = customItems(c);
  const item = items.length ? pickItem(items, stats, rnd) : 'melody';
  const choices = c.what === 'melodies' ? [] : items.map(itemName);
  const [kind, a, b] = item.split(':');
  const lo = Math.min(c.low, c.high - 12);
  const hi = Math.max(c.high, c.low + 12);
  if (kind === 'int') {
    const size = Number(a);
    const dir = b as IntervalDir;
    const first = dir === 'down' ? within(lo + size, hi, rnd) : within(lo, hi - size, rnd);
    const second = dir === 'down' ? first - size : first + size;
    // Spelled the way the normal drills do: minor intervals with flats, major ones from a black key too.
    const low = Math.min(first, second);
    const flats = [3, 8, 10].includes(size) || (isBlackKey(low) && [4, 9, 11].includes(size));
    const answer = dir === 'together' ? [[first, second]] : [[first], [second]];
    return {
      kind: 'intervals',
      level: 0,
      answer,
      hint: dir === 'together' ? undefined : first,
      label: `${itemName(item)} (${name(first, flats)} → ${name(second, flats)})`,
      item,
      choice: itemName(item),
      choices,
    };
  }
  if (kind === 'chord') {
    const base = CUSTOM_CHORDS[a].tones;
    const inv = Number(b);
    const span = base[base.length - 1] + (inv ? 12 : 0);
    const root = within(lo, hi - span, rnd);
    let tones = base.map((t) => root + t);
    for (let i = 0; i < inv; i++) tones = [...tones.slice(1), tones[0] + 12];
    const rootName = (a === 'min' || a === 'dim' || a === 'min7' ? MINOR_ROOTS : MAJOR_ROOTS)[root % 12];
    return { kind: 'chords', level: 0, answer: [tones], label: `${rootName} ${itemName(item)}`, item, choice: itemName(item), choices };
  }
  const scale = c.minor ? NAT_MINOR : MAJOR;
  // The key's tonic inside the range, as a reference.
  let tonic = c.keyPc + 12 * Math.floor(lo / 12);
  while (tonic < lo) tonic += 12;
  if (kind === 'note') {
    const pc = Number(a);
    const options: number[] = [];
    for (let p = lo; p <= hi; p++) if (((p % 12) + 12) % 12 === pc) options.push(p);
    const p = options.length ? options[Math.floor(rnd() * options.length)] : tonic;
    return { kind: 'notes', level: 0, answer: [[p]], reference: tonic, label: pitchName(p), item, choice: itemName(item), choices };
  }
  // A melody in the key, from the tonic, moving mostly by step.
  const degs = [0];
  let deg = 0;
  for (let i = 1; i < Math.max(2, c.melodyLength); i++) {
    let step = rnd() < 0.7 ? 1 : 2;
    if (rnd() < 0.5) step = -step;
    const next = deg + step;
    const pitch = tonic + 12 * Math.floor(next / 7) + scale[((next % 7) + 7) % 7];
    deg = pitch < lo || pitch > hi ? deg - step : next;
    degs.push(deg);
  }
  const pitches = degs.map((d) => tonic + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]);
  return { kind: 'melodies', level: 0, answer: pitches.map((p) => [p]), hint: pitches[0], label: pitches.map((p) => name(p)).join(' '), item, choice: '', choices: [] };
}

/** The items missed most (at least two tries), worst first. */
export function weakSpots(stats: EarStats, items: string[], count = 3): Array<{ item: string; rate: number; asked: number }> {
  return items
    .map((item) => ({ item, asked: stats[item]?.asked ?? 0, rate: stats[item]?.asked ? stats[item].right / stats[item].asked : 1 }))
    .filter((x) => x.asked >= 2 && x.rate < 1)
    .sort((a, b) => a.rate - b.rate || b.asked - a.asked)
    .slice(0, count);
}
