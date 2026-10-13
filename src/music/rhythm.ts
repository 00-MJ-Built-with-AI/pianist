import { songToMusicXml } from './musicxml';
import type { Note, Song } from './types';

/*
 * Rhythm variations, a classic way to practise a passage: play pairs of even notes long-short
 * (dotted) or short-long (reverse dotted). Both fit the sixteenth-note grid the score is written on.
 */

export type Variant = 'dotted' | 'reverse';

export const VARIANT_LABEL: Record<Variant, string> = { dotted: 'dotted (long-short)', reverse: 'reverse dotted (short-long)' };

const EPS = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

/**
 * The piece with pairs of even eighths (or quarters) played long-short or short-long, in each hand.
 * Notes keep their ids, so practice results line up with the original.
 */
export function applyVariant(song: Song, variant: Variant | null): Song {
  if (!variant) return song;
  const notes: Note[] = song.notes.map((n) => ({ ...n }));
  for (const hand of ['R', 'L'] as const) {
    const mine = notes.filter((n) => n.hand === hand);
    const onsets = [...new Set(mine.map((n) => Math.round(n.start * 1e4) / 1e4))].sort((a, b) => a - b);
    const at = (t: number) => mine.filter((n) => near(n.start, t));
    for (let i = 0; i + 1 < onsets.length; ) {
      const a = onsets[i];
      const b = onsets[i + 1];
      const d = b - a;
      const after = onsets[i + 2] ?? Infinity;
      const m = song.measures.find((x) => a >= x.start - EPS && a < x.start + x.length - EPS);
      const aligned = !!m && near(((a - m.start) / (2 * d)) % 1, 0) && a + 2 * d <= m.start + m.length + EPS;
      const even = (near(d, 0.5) || near(d, 1)) && after >= a + 2 * d - EPS;
      const first = at(a);
      const second = at(b);
      if (aligned && even && first.every((n) => near(n.dur, d)) && second.every((n) => near(n.dur, d))) {
        const split = variant === 'dotted' ? a + 1.5 * d : a + 0.5 * d;
        for (const n of first) n.dur = split - a;
        for (const n of second) {
          n.start = split;
          n.dur = a + 2 * d - split;
        }
        i += 2;
      } else i += 1;
    }
  }
  const out: Song = { ...song, notes };
  out.scoreXml = songToMusicXml(out);
  return out;
}

/* ------------------------------------------------------------------ exercises */

export type ExerciseRhythm = 'straight' | 'dotted' | 'reverse' | 'swing' | 'triplets' | 'accent3' | 'accent4';

export const RHYTHM_LABEL: Record<ExerciseRhythm, string> = {
  straight: 'Even',
  dotted: 'Dotted (long-short)',
  reverse: 'Reverse dotted (short-long)',
  swing: 'Swing',
  triplets: 'Triplets',
  accent3: 'Accents in 3s',
  accent4: 'Accents in 4s',
};

/** Swing and triplets are written in 12/8, where they fit the score exactly. */
export const isCompound = (r: ExerciseRhythm) => r === 'swing' || r === 'triplets';

/**
 * Start, length and loudness of `count` notes in a run of `beats`-long notes played in a rhythm
 * (in quarter-note beats).
 */
export function rhythmTimes(count: number, beats: number, rhythm: ExerciseRhythm): Array<{ start: number; dur: number; velocity: number }> {
  const out: Array<{ start: number; dur: number; velocity: number }> = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    // Pairs of notes: the first of a pair is i even (a last note on its own stays even).
    const paired = i % 2 === 1 || i < count - 1;
    const firstOfPair = i % 2 === 0;
    let dur = beats;
    if (rhythm === 'triplets') dur = 0.5;
    else if (paired && rhythm === 'dotted') dur = firstOfPair ? beats * 1.5 : beats * 0.5;
    else if (paired && rhythm === 'reverse') dur = firstOfPair ? beats * 0.5 : beats * 1.5;
    else if (paired && rhythm === 'swing') dur = firstOfPair ? beats * 2 : beats;
    const accent = (rhythm === 'accent3' && i % 3 === 0) || (rhythm === 'accent4' && i % 4 === 0);
    const soft = rhythm === 'accent3' || rhythm === 'accent4';
    out.push({ start: t, dur, velocity: accent ? 100 : soft ? 60 : 72 });
    t += dur;
  }
  return out;
}
