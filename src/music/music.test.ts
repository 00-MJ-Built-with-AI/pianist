import { describe, expect, it } from 'vitest';
import { builtinSongs } from './library';
import { songFromText } from './notation';
import { parsePitch, spell } from './pitch';
import { buildSteps } from './steps';
import { DIVISIONS } from './musicxml';

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
