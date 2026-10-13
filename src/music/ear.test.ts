import { describe, expect, it } from 'vitest';
import { checkAnswer, groupPresses, intervalName, makeQuestion, nextLevel, seededRng, type EarKind } from './ear';

describe('ear training', () => {
  it('makes questions of every kind and level in range', () => {
    for (const kind of ['notes', 'intervals', 'chords', 'melodies'] as EarKind[]) {
      for (let level = 1; level <= 4; level++) {
        const rnd = seededRng(level * 31 + kind.length);
        for (let i = 0; i < 50; i++) {
          const q = makeQuestion(kind, level, rnd);
          expect(q.answer.length).toBeGreaterThan(0);
          for (const g of q.answer) for (const p of g) expect(p >= 40 && p <= 90, `${kind} L${level} ${p}`).toBe(true);
          if (kind === 'melodies') expect(q.answer).toHaveLength([3, 4, 5, 6][level - 1]);
          if (kind === 'chords' && level <= 2) expect(q.answer[0]).toHaveLength(3);
        }
      }
    }
  });

  it('checks played answers, with or without octave freedom', () => {
    const q = { kind: 'intervals' as const, level: 1, answer: [[60], [64]], label: '' };
    expect(checkAnswer(q, [[60], [64]], false).correct).toBe(true);
    expect(checkAnswer(q, [[60], [65]], false)).toEqual({ correct: false, groups: [true, false] });
    expect(checkAnswer(q, [[72], [76]], false).correct).toBe(false);
    expect(checkAnswer(q, [[72], [76]], true).correct).toBe(true);
    const chord = { kind: 'chords' as const, level: 2, answer: [[57, 60, 64]], label: '' };
    expect(checkAnswer(chord, [[64, 57, 60]], false).correct).toBe(true);
    expect(checkAnswer(chord, [[64, 69, 72]], true).correct).toBe(true); // A minor, another voicing
    expect(checkAnswer(chord, [[57, 61, 64]], true).correct).toBe(false);
  });

  it('groups chord notes played together', () => {
    expect(groupPresses([{ pitch: 60, time: 0 }, { pitch: 64, time: 40 }, { pitch: 67, time: 90 }, { pitch: 72, time: 600 }])).toEqual([
      [60, 64, 67],
      [72],
    ]);
  });

  it('adapts the level', () => {
    expect(nextLevel(1, 3, 0)).toBe(2);
    expect(nextLevel(4, 3, 0)).toBe(4);
    expect(nextLevel(2, 0, 2)).toBe(1);
    expect(nextLevel(2, 1, 1)).toBe(2);
    expect(intervalName(7)).toBe('perfect 5th');
  });
});

describe('your own ear drills', () => {
  it('asks only what was chosen, inside the range', async () => {
    const { makeCustomQuestion, customItems, DEFAULT_CUSTOM_EAR, seededRng } = await import('./ear');
    const c = { ...DEFAULT_CUSTOM_EAR, what: 'intervals' as const, intervals: [7], directions: ['down' as const, 'together' as const], low: 55, high: 72 };
    expect(customItems(c)).toEqual(['int:7:down', 'int:7:together']);
    const rnd = seededRng(3);
    for (let i = 0; i < 20; i++) {
      const q = makeCustomQuestion(c, rnd);
      const ps = q.answer.flat();
      expect(Math.abs(ps[0] - ps[1])).toBe(7);
      expect(Math.min(...ps)).toBeGreaterThanOrEqual(55);
      expect(Math.max(...ps)).toBeLessThanOrEqual(72);
      expect(q.choices).toEqual(['perfect 5th down', 'perfect 5th together']);
      if (q.item.endsWith('together')) expect(q.answer).toHaveLength(1);
    }
  });

  it('builds chords with inversions and notes in the key', async () => {
    const { makeCustomQuestion, DEFAULT_CUSTOM_EAR, seededRng } = await import('./ear');
    const chord = makeCustomQuestion({ ...DEFAULT_CUSTOM_EAR, what: 'chords', chords: ['min'], inversions: [1] }, seededRng(1));
    const [a, b, c] = chord.answer[0];
    expect([b - a, c - a]).toEqual([4, 9]); // minor, 1st inversion
    const note = makeCustomQuestion({ ...DEFAULT_CUSTOM_EAR, what: 'notes', keyPc: 7 }, seededRng(2));
    expect([7, 9, 11, 0, 2, 4, 6]).toContain(note.answer[0][0] % 12);
    expect(note.reference! % 12).toBe(7);
  });

  it('asks the weakest items more often and lists them', async () => {
    const { pickItem, weakSpots, seededRng } = await import('./ear');
    const stats = { a: { asked: 10, right: 2 }, b: { asked: 10, right: 10 } };
    const rnd = seededRng(5);
    let a = 0;
    for (let i = 0; i < 400; i++) if (pickItem(['a', 'b'], stats, rnd) === 'a') a++;
    expect(a).toBeGreaterThan(240); // weights 3.4 vs 1
    expect(weakSpots(stats, ['a', 'b']).map((x) => x.item)).toEqual(['a']);
  });
});
