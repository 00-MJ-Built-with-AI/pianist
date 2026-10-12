import { describe, expect, it } from 'vitest';
import { builtinSongs } from './library';
import { songFromText } from './notation';
import { parsePitch, spell } from './pitch';
import { buildSteps } from './steps';
import { DIVISIONS } from './musicxml';
import { tidyDurations } from './tidy';

describe('pitch', () => {
  it('parses names', () => {
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('A0')).toBe(21);
    expect(parsePitch('F#5')).toBe(78);
    expect(parsePitch('Bb3')).toBe(58);
  });
  it('spells by key', () => {
    expect(spell(66, 1)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(70, -1)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(70, 0)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(60, 7)).toEqual({ step: 'B', alter: 1, octave: 3 });
  });
});

describe('library', () => {
  const songs = builtinSongs();

  it('parses every song with valid bar lines', () => {
    expect(songs.length).toBeGreaterThanOrEqual(10);
    for (const s of songs) {
      expect(s.notes.length, s.id).toBeGreaterThan(0);
      for (const n of s.notes) {
        expect(n.pitch).toBeGreaterThanOrEqual(21);
        expect(n.pitch).toBeLessThanOrEqual(108);
        const m = s.measures[n.measure];
        expect(n.start).toBeGreaterThanOrEqual(m.start - 1e-9);
        expect(n.start).toBeLessThan(m.start + m.length);
      }
    }
  });

  it('keeps the written spelling of accidentals', () => {
    const fe = songs.find((s) => s.id === 'fur-elise')!;
    expect(fe.scoreXml).toContain('<step>D</step><alter>1</alter>');
    expect(fe.scoreXml).not.toContain('<step>E</step><alter>-1</alter>');
  });

  it('handles the Für Elise pickup', () => {
    const fe = songs.find((s) => s.id === 'fur-elise')!;
    expect(fe.measures[0]).toMatchObject({ number: 0, length: 0.5 });
    expect(fe.measures[1]).toMatchObject({ number: 1, start: 0.5, length: 1.5 });
    expect(fe.notes[0]).toMatchObject({ pitch: 76, start: 0, dur: 0.25, measure: 0 });
  });

  it('groups chords into steps', () => {
    const chords = songs.find((s) => s.id === 'chord-basics')!;
    const both = buildSteps(chords.notes, new Set(['L', 'R']));
    expect(both[0].pitches.sort()).toEqual([48, 60, 64, 67]);
    const right = buildSteps(chords.notes, new Set(['R']));
    expect(right[0].pitches.sort()).toEqual([60, 64, 67]);
  });

  it('ties merge into one note', () => {
    const s = songFromText({ id: 't', title: 't', composer: '', level: 1, bpm: 60, time: '4/4', key: 0, rh: 'C4/h~ C4/h | D4/w |' });
    expect(s.notes.map((n) => [n.pitch, n.start, n.dur])).toEqual([[60, 0, 4], [62, 4, 4]]);
  });

  it('rejects wrong bar lengths', () => {
    expect(() =>
      songFromText({ id: 't', title: 't', composer: '', level: 1, bpm: 60, time: '3/4', key: 0, rh: 'C4/q D4/q | E4/h. |' }),
    ).toThrow(/bar 1/);
  });
});

describe('musicxml', () => {
  it('fills every bar of every staff exactly', () => {
    for (const s of builtinSongs()) {
      const xml = s.scoreXml!;
      const measures = xml.split('<measure ').slice(1);
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
      expect(xml.match(/<note>/g)!.length).toBeGreaterThan(0);
    }
  });

  it('ties notes across bar lines', () => {
    const s = songFromText({ id: 't', title: 't', composer: '', level: 1, bpm: 60, time: '4/4', key: 0, rh: 'r/h C4/w~ C4/h |'.replace(' |', '') });
    const xml = s.scoreXml!;
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
  });
});

describe('tidyDurations', () => {
  it('closes small gaps, trims overlaps and rounds the last note', () => {
    const n = (pitch: number, start: number, dur: number, hand: 'R' | 'L' = 'R') => ({ pitch, start, dur, hand, velocity: 80 });
    const out = tidyDurations([n(64, 0, 0.9), n(62, 1, 1.2), n(60, 2, 0.4), n(62, 3, 1.84), n(48, 0, 3.7, 'L')], 4);
    expect(out.map((x) => x.dur)).toEqual([1, 1, 0.5, 2, 4]);
  });
});

describe('recording to song', () => {
  it('quantizes played notes, splits hands and tidies lengths', async () => {
    const { buildRecordedSong } = await import('./recording');
    const beat = 600; // 100 bpm
    const t0 = 1000;
    const ev = (type: 'on' | 'off', pitch: number, b: number, jitter = 0) => ({ type, pitch, velocity: 70, t: t0 + b * beat + jitter });
    const song = buildRecordedSong(
      [
        ev('on', 64, 0, 12), ev('off', 64, 0.9),
        ev('on', 62, 1, -15), ev('off', 62, 1.85),
        ev('on', 48, 0, 5), ev('on', 60, 2, 8), ev('off', 48, 3.9), ev('off', 60, 3.9),
        ev('on', 30, -3), // played during the count-in: dropped
      ],
      { t0, stopAt: t0 + 5 * beat, bpm: 100, timeSig: [4, 4], split: 60, grid: 4, title: 'T' },
    )!;
    expect(song.notes.map((n) => [n.pitch, n.start, n.dur, n.hand])).toEqual([
      [48, 0, 4, 'L'],
      [64, 0, 1, 'R'],
      [62, 1, 1, 'R'],
      [60, 2, 2, 'R'],
    ]);
    expect(song.scoreXml).toContain('<work-title>T</work-title>');
  });
});
