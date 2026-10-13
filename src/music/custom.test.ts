import { describe, expect, it } from 'vitest';
import { chordDrill, parsePattern, patternExercise } from './exercises';
import { applyVariant, rhythmTimes } from './rhythm';
import { finalizeSong } from './song';

const eighths = finalizeSong({
  id: 't',
  title: 't',
  composer: '',
  level: 1,
  bpm: 100,
  timeSig: [4, 4],
  keyFifths: 0,
  source: 'builtin',
  notes: [60, 62, 64, 65, 67, 65, 64, 62].map((pitch, i) => ({ pitch, start: i * 0.5, dur: 0.5, hand: 'R' as const, velocity: 70 })),
});

describe('rhythm variations', () => {
  it('plays pairs of eighths long-short or short-long, keeping note ids', () => {
    const d = applyVariant(eighths, 'dotted');
    expect(d.notes.map((n) => [n.start, n.dur])).toEqual([
      [0, 0.75], [0.75, 0.25], [1, 0.75], [1.75, 0.25], [2, 0.75], [2.75, 0.25], [3, 0.75], [3.75, 0.25],
    ]);
    expect(d.notes.map((n) => n.id)).toEqual(eighths.notes.map((n) => n.id));
    const r = applyVariant(eighths, 'reverse');
    expect(r.notes.slice(0, 2).map((n) => [n.start, n.dur])).toEqual([[0, 0.25], [0.25, 0.75]]);
    expect(d.scoreXml).toContain('<divisions>');
    expect(applyVariant(eighths, null)).toBe(eighths);
  });

  it('times runs in each rhythm', () => {
    expect(rhythmTimes(4, 0.5, 'dotted').map((t) => t.dur)).toEqual([0.75, 0.25, 0.75, 0.25]);
    expect(rhythmTimes(3, 0.5, 'reverse').map((t) => t.dur)).toEqual([0.25, 0.75, 0.5]);
    expect(rhythmTimes(4, 0.5, 'swing').map((t) => t.dur)).toEqual([1, 0.5, 1, 0.5]);
    expect(rhythmTimes(3, 1, 'triplets').map((t) => t.start)).toEqual([0, 0.5, 1]);
    expect(rhythmTimes(6, 0.5, 'accent3').map((t) => t.velocity > 90)).toEqual([true, false, false, true, false, false]);
  });
});

describe('your own exercises', () => {
  it('reads patterns', () => {
    expect(parsePattern('1 2 3 4 5 4 3 2')).toEqual([1, 2, 3, 4, 5, 4, 3, 2]);
    expect(parsePattern('12345')).toEqual([1, 2, 3, 4, 5]);
    expect(parsePattern('1-3-5-8')).toEqual([1, 3, 5, 8]);
    expect(parsePattern('1 x')).toBeNull();
  });

  it('moves a pattern up the scale and back down, mirrored', () => {
    const s = patternExercise({ type: 'pattern', pattern: [1, 2, 3], keys: [0], minor: false, climb: 2, mirror: true, hands: 'R', beats: 0.5, rhythm: 'straight', bpm: 90 });
    const pitches = s.notes.map((n) => n.pitch);
    // Up: C D E, D E F, E F G. Down (mirrored): G F E, F E D, E D C. Then home on C.
    expect(pitches).toEqual([60, 62, 64, 62, 64, 65, 64, 65, 67, 67, 65, 64, 65, 64, 62, 64, 62, 60, 60]);
    expect(s.timeSig).toEqual([4, 4]);
  });

  it('writes swing and triplets in 12/8 at the same pulse', () => {
    const s = patternExercise({ type: 'pattern', pattern: [1, 2], keys: [0, 7], minor: false, climb: 1, mirror: false, hands: 'both', beats: 0.5, rhythm: 'triplets', bpm: 80 });
    expect(s.timeSig).toEqual([12, 8]);
    expect(s.bpm).toBe(120);
    expect(s.keyFifths).toBe(0); // two keys: accidentals instead of a key signature
    expect(s.notes.some((n) => n.hand === 'L')).toBe(true);
  });

  it('drills chords and inversions', () => {
    const s = chordDrill({ type: 'chords', chords: ['maj', 'min'], inversions: [0, 1], style: 'block', keys: [0], hands: 'both', rhythm: 'straight', bpm: 80 });
    const right = s.notes.filter((n) => n.hand === 'R');
    const starts = [...new Set(right.map((n) => n.start))];
    expect(starts).toHaveLength(4); // C, C/E, Cm, Cm/Eb
    expect(right.filter((n) => n.start === starts[1]).map((n) => n.pitch).sort((a, b) => a - b)).toEqual([64, 67, 72]);
    expect(s.notes.filter((n) => n.hand === 'L').every((n) => n.pitch % 12 === 0)).toBe(true);
  });
});
