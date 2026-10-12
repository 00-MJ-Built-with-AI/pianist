import { describe, expect, it } from 'vitest';
import { arpeggioExercise, majorFifths, minorFifths, progressionExercise, scaleExercise, sightReading, TONICS, PROGRESSIONS } from './exercises';
import { DIVISIONS } from './musicxml';
import type { Song } from './types';

/** Every bar of both staves must add up to the bar length. */
function expectWellFormed(s: Song) {
  const measures = s.scoreXml!.split('<measure ').slice(1);
  expect(measures.length, s.id).toBe(s.measures.length);
  measures.forEach((mx, i) => {
    const expected = Math.round(s.measures[i].length * DIVISIONS);
    const [staff1, staff2] = mx.split('<backup>');
    for (const part of [staff1, staff2.slice(staff2.indexOf('</backup>'))]) {
      let total = 0;
      for (const note of part.split('<note>').slice(1)) {
        if (note.startsWith('<chord/>')) continue;
        total += Number(/<duration>(\d+)<\/duration>/.exec(note)![1]);
      }
      expect(total, `${s.id} bar ${i}`).toBe(expected);
    }
  });
}

const pcs = (s: Song, hand = 'R') => s.notes.filter((n) => n.hand === hand).map((n) => n.pitch % 12);

describe('key signatures', () => {
  it('knows major and minor keys', () => {
    expect(majorFifths(2)).toBe(2); // D
    expect(majorFifths(10)).toBe(-2); // Bb
    expect(minorFifths(9)).toBe(0); // A minor
    expect(minorFifths(4)).toBe(1); // E minor
    expect(minorFifths(2)).toBe(-1); // D minor
    expect(minorFifths(3)).toBe(-6); // Eb minor
  });
});

describe('scales and arpeggios', () => {
  it('builds D major up and down', () => {
    const s = scaleExercise({ pc: 2, kind: 'major', octaves: 1, hands: 'R', beats: 1, bpm: 80 });
    expect(pcs(s)).toEqual([2, 4, 6, 7, 9, 11, 1, 2, 1, 11, 9, 7, 6, 4, 2]);
    expect(s.keyFifths).toBe(2);
    expectWellFormed(s);
  });

  it('spells the raised seventh of D harmonic minor as C sharp', () => {
    const s = scaleExercise({ pc: 2, kind: 'harmonic-minor', octaves: 1, hands: 'both', beats: 0.5, bpm: 80 });
    expect(s.keyFifths).toBe(-1);
    expect(s.scoreXml).toContain('<step>C</step><alter>1</alter>');
    expect(s.scoreXml).not.toContain('<step>D</step><alter>-1</alter>');
    expect(s.notes.filter((n) => n.hand === 'L').length).toBe(s.notes.filter((n) => n.hand === 'R').length);
    expectWellFormed(s);
  });

  it('is well formed in every key and setting', () => {
    for (const t of TONICS) {
      for (const kind of ['major', 'natural-minor', 'harmonic-minor'] as const) {
        for (const octaves of [1, 2] as const) {
          for (const beats of [1, 0.5] as const) {
            const s = scaleExercise({ pc: t.pc, kind, octaves, hands: 'both', beats, bpm: 80 });
            expectWellFormed(s);
            expect(s.notes.length).toBe(2 * (14 * octaves + 1));
          }
        }
      }
      expectWellFormed(arpeggioExercise({ pc: t.pc, quality: 'minor', octaves: 2, hands: 'both', beats: 0.5, bpm: 80 }));
    }
  });

  it('builds arpeggios from chord tones', () => {
    const s = arpeggioExercise({ pc: 0, quality: 'major', octaves: 1, hands: 'R', beats: 1, bpm: 80 });
    expect(s.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 72, 67, 64, 60]);
  });
});

describe('chord progressions', () => {
  it('voices I–IV–V–I in C with smooth movement', () => {
    const s = progressionExercise({ pc: 0, minor: false, progression: 'I-IV-V-I', beatsPerChord: 4, bpm: 70 });
    const chordAt = (beat: number) =>
      s.notes
        .filter((n) => n.hand === 'R' && n.start === beat)
        .map((n) => n.pitch % 12)
        .sort((a, b) => a - b);
    expect(chordAt(0)).toEqual([0, 4, 7]);
    expect(chordAt(4)).toEqual([0, 5, 9]);
    expect(chordAt(8)).toEqual([2, 7, 11]);
    // voice leading: no voice jumps more than a fourth between chords
    const rh = (beat: number) => s.notes.filter((n) => n.hand === 'R' && n.start === beat).map((n) => n.pitch).sort((a, b) => a - b);
    for (let b = 4; b < 32; b += 4) rh(b).forEach((p, k) => expect(Math.abs(p - rh(b - 4)[k])).toBeLessThanOrEqual(5));
    expectWellFormed(s);
  });

  it('uses a major V with a sharpened leading tone in minor', () => {
    const s = progressionExercise({ pc: 9, minor: true, progression: 'i-iv-V-i', beatsPerChord: 2, bpm: 70 });
    const v = s.notes.filter((n) => n.hand === 'R' && n.start === 4).map((n) => n.pitch % 12).sort((a, b) => a - b);
    expect(v).toEqual([4, 8, 11]); // E G# B
    expect(s.scoreXml).toContain('<step>G</step><alter>1</alter>');
    for (const p of PROGRESSIONS.minor) expectWellFormed(progressionExercise({ pc: 3, minor: true, progression: p.id, beatsPerChord: 4, bpm: 70 }));
  });
});

describe('sight-reading', () => {
  it('generates valid, repeatable pieces at every level', () => {
    for (const level of [1, 2, 3, 4]) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = sightReading(level, seed % 2 ? 4 : 8, seed);
        expectWellFormed(s);
        const rh = s.notes.filter((n) => n.hand === 'R');
        const tonicPc = rh[rh.length - 1].pitch % 12;
        expect([0, 7, 5, 2, 10, 9, 3]).toContain(tonicPc);
        for (const n of s.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(38);
          expect(n.pitch).toBeLessThanOrEqual(86);
        }
        if (level === 1) expect(s.notes.every((n) => n.hand === 'R')).toBe(true);
      }
    }
    expect(sightReading(3, 8, 99).notes).toEqual(sightReading(3, 8, 99).notes);
  });
});
