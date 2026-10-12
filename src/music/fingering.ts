import { isBlackKey } from './pitch';
import type { Hand, Note, Song } from './types';

/*
 * Suggested fingering. For each hand the melodic line (top notes for the right hand, bottom notes for
 * the left) gets the finger sequence with the lowest total "effort" (Viterbi over fingers 1–5), using
 * the usual rules of thumb: neighbouring fingers for steps, wider spans for skips, the thumb passing
 * under (or a finger crossing over the thumb) to continue a run, and no thumb on black keys.
 * Chord notes get standard shapes (1-3-5 and so on).
 */

const FINGERS = [1, 2, 3, 4, 5];

// Comfortable intervals (semitones) between two fingers |d| apart: [min, ideal, max].
const SPANS: Record<number, [number, number, number]> = {
  1: [1, 2, 4],
  2: [2, 4, 7],
  3: [4, 6, 9],
  4: [5, 8, 12],
};

/** Effort of going from finger a on one note to finger b on the next, `interval` semitones up (right hand). */
function transition(a: number, b: number, interval: number): number {
  if (interval === 0) return a === b ? 0 : 1.5;
  const d = b - a;
  if (d === 0) return 8; // same finger on a different key
  const span = Math.abs(interval);
  if (Math.sign(d) === Math.sign(interval)) {
    const [min, ideal, max] = SPANS[Math.abs(d)];
    const thumb = a === 1 || b === 1 ? 2 : 0; // the thumb stretches further
    return Math.max(0, min - span) * 1.2 + Math.max(0, span - max - thumb) * 1.6 + Math.abs(span - ideal) * 0.15;
  }
  // Crossings: thumb under while going up, or a finger over the thumb while going down.
  if (interval > 0 && b === 1 && a >= 2 && a <= 4) return 2 + Math.max(0, span - 4) * 0.8 + (a === 4 ? 0.5 : 0);
  if (interval < 0 && a === 1 && b >= 2 && b <= 4) return 2 + Math.max(0, span - 4) * 0.8 + (b === 4 ? 0.5 : 0);
  return 14;
}

function keyCost(finger: number, pitch: number): number {
  if (!isBlackKey(pitch)) return 0;
  return finger === 1 ? 2.5 : finger === 5 ? 1 : 0;
}

/** Standard shapes for chords, lowest note first (right hand; the left hand mirrors). */
function chordShape(pitches: number[]): number[] {
  const n = pitches.length;
  const span = pitches[n - 1] - pitches[0];
  if (n === 1) return [0];
  if (n === 2) return [1, span <= 4 ? 3 : span <= 7 ? 4 : 5];
  if (n === 3) return span <= 5 ? [1, 2, 4] : [1, 3, 5];
  if (n === 4) return [1, 2, 3, 5];
  return [1, 2, 3, 4, 5].slice(0, n);
}

function fingerHand(notes: Note[], hand: Hand, out: Map<number, number>) {
  // Onsets in time order, each with its notes low → high.
  const groups = new Map<number, Note[]>();
  for (const n of notes) {
    if (n.hand !== hand) continue;
    const g = groups.get(n.start) ?? [];
    g.push(n);
    groups.set(n.start, g);
  }
  const onsets = [...groups.keys()].sort((a, b) => a - b).map((t) => groups.get(t)!.sort((a, b) => a.pitch - b.pitch));
  if (!onsets.length) return;

  // The line the hand "travels" along, and fixed fingers where a chord shape decides them.
  const sign = hand === 'R' ? 1 : -1; // the left hand is the mirror image
  const line = onsets.map((g) => (hand === 'R' ? g[g.length - 1] : g[0]));
  const forced = onsets.map((g) => {
    if (g.length < 2) return 0;
    // The line note is the top of a right-hand chord or the bottom of a left-hand one: both get the outer finger.
    const shape = chordShape(g.map((n) => n.pitch));
    return shape[shape.length - 1];
  });

  // Viterbi over the five fingers.
  const n = line.length;
  const cost: number[][] = [];
  const back: number[][] = [];
  cost[0] = FINGERS.map((f) => keyCost(f, line[0].pitch) + (forced[0] && f !== forced[0] ? 20 : 0));
  back[0] = FINGERS.map(() => -1);
  for (let i = 1; i < n; i++) {
    const interval = (line[i].pitch - line[i - 1].pitch) * sign;
    // A long rest or a big jump frees the hand to reposition.
    const gap = line[i].start - (line[i - 1].start + line[i - 1].dur);
    const free = gap >= 1 || Math.abs(interval) > 12;
    cost[i] = [];
    back[i] = [];
    for (const f of FINGERS) {
      let best = Infinity;
      let arg = 0;
      for (const p of FINGERS) {
        const c = cost[i - 1][p - 1] + (free ? 0 : transition(p, f, interval));
        if (c < best) {
          best = c;
          arg = p;
        }
      }
      cost[i][f - 1] = best + keyCost(f, line[i].pitch) + (forced[i] && f !== forced[i] ? 20 : 0);
      back[i][f - 1] = arg;
    }
  }
  let f = cost[n - 1].indexOf(Math.min(...cost[n - 1])) + 1;
  const lineFingers: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    lineFingers[i] = f;
    f = back[i][f - 1];
  }

  onsets.forEach((g, i) => {
    if (g.length === 1) {
      out.set(g[0].id, lineFingers[i]);
      return;
    }
    const shape = chordShape(g.map((x) => x.pitch));
    // Right hand: thumb on the lowest note. Left hand: thumb on the highest.
    g.forEach((note, k) => out.set(note.id, hand === 'R' ? shape[k] : shape[g.length - 1 - k]));
  });
}

/** Suggested finger (1 = thumb … 5 = little finger) for every note id. */
export function suggestFingering(song: Song): Map<number, number> {
  const out = new Map<number, number>();
  fingerHand(song.notes, 'R', out);
  fingerHand(song.notes, 'L', out);
  return out;
}
