import type { Hand, Note } from './types';

type Raw = Omit<Note, 'id' | 'measure'>;

/**
 * Makes played (or performance-MIDI) note lengths read like notation: a note released a little
 * before the next note in the same hand is held until it, a slight legato overlap is trimmed, and
 * the last notes are rounded to whole beats.
 */
export function tidyDurations<T extends Raw>(
  notes: T[],
  grid: number,
  /** Gaps up to max(minGap, ratio × note length) before the next note in the hand are filled. */
  legato: { minGap: number; ratio: number } = { minGap: 0.25, ratio: 0.35 },
): T[] {
  const out = notes.map((n) => ({ ...n }));
  for (const hand of ['R', 'L'] as Hand[]) {
    const mine = out.filter((n) => n.hand === hand).sort((a, b) => a.start - b.start);
    const onsets = [...new Set(mine.map((n) => n.start))].sort((a, b) => a - b);
    for (const n of mine) {
      const next = onsets.find((o) => o > n.start + 1e-9);
      const end = n.start + n.dur;
      if (next === undefined) {
        if (n.dur >= 0.75) n.dur = Math.max(1, Math.round(n.dur));
        continue;
      }
      const gap = next - end;
      if (gap > 0 && gap <= Math.max(legato.minGap, n.dur * legato.ratio)) n.dur = next - n.start;
      else if (gap < 0 && -gap <= 0.25) n.dur = next - n.start;
      n.dur = Math.max(1 / grid, Math.round(n.dur * grid) / grid);
    }
  }
  return out;
}
