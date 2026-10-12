import { describe, expect, it } from 'vitest';
import { builtinSongs } from './library';
import { arrangeSong, dropOvertones, estimateBeat, guessKeyFifths, type HeardNote } from './transcribe';

/** Renders a song's notes as if heard in a recording: seconds, an offset, and a little timing jitter. */
function hear(beats: Array<{ pitch: number; start: number; dur: number }>, bpm: number, offset: number, jitterMs = 15): HeardNote[] {
  const lastStart = Math.max(...beats.map((b) => b.start));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const spb = 60 / bpm;
  return beats.map((n) => ({
    pitch: n.pitch,
    start: offset + n.start * spb + (rand() * jitterMs) / 1000,
    // bass notes fade before they end; the final chord rings on
    dur: n.start === lastStart ? n.dur * spb * 2.5 : n.dur * spb * (n.pitch < 55 ? 0.55 : 0.9),
    amplitude: n.pitch < 55 ? 0.6 : 0.8,
  }));
}

describe('beat tracking', () => {
  it('finds the tempo and phase of a steady performance', () => {
    const ode = builtinSongs().find((s) => s.id === 'ode-to-joy')!;
    const g = estimateBeat(hear(ode.notes, 100, 1.37));
    expect(Math.abs(g.bpm - 100)).toBeLessThan(1.5);
    const period = 60 / g.bpm;
    const off = (((1.37 - g.phase) % period) + period) % period;
    expect(Math.min(off, period - off)).toBeLessThan(0.03);
  });

  it('works at a quicker tempo with eighth notes', () => {
    const minuet = builtinSongs().find((s) => s.id === 'minuet-in-g')!;
    const g = estimateBeat(hear(minuet.notes, 132, 0.5));
    expect(Math.abs(g.bpm - 132)).toBeLessThan(2);
  });
});

describe('arranging heard notes', () => {
  it('rebuilds the score of a clean performance', () => {
    const ode = builtinSongs().find((s) => s.id === 'ode-to-joy')!;
    const heard = hear(ode.notes, 100, 2.1);
    const g = estimateBeat(heard);
    const song = arrangeSong(heard, {
      title: 'Ode',
      bpm: g.bpm,
      phase: g.phase,
      timeSig: [4, 4],
      split: 60,
      grid: 4,
      simplify: 'all',
      maxPerHand: 4,
    })!;
    const key = (n: { pitch: number; start: number; hand: string }) => `${n.pitch}@${n.start}${n.hand}`;
    expect(song.notes.map(key).sort()).toEqual(ode.notes.map(key).sort());
    // Faded bass notes are held to the next bass note (whole notes stay whole).
    const c3 = song.notes.find((n) => n.pitch === 48 && n.start === 0)!;
    expect(c3.dur).toBe(4);
    expect(song.pickup).toBe(0);
    expect(song.keyFifths).toBe(0);
    expect(song.measures.length).toBe(ode.measures.length);
  });

  it('detects a pickup beat from where the bass lands', () => {
    // 3/4 waltz: one pickup quarter, then bass on every downbeat.
    const beats: Array<{ pitch: number; start: number; dur: number }> = [{ pitch: 67, start: 0, dur: 1 }];
    for (let bar = 0; bar < 6; bar++) {
      const t = 1 + bar * 3;
      beats.push({ pitch: 43, start: t, dur: 1 }, { pitch: 59, start: t + 1, dur: 1 }, { pitch: 59, start: t + 2, dur: 1 });
      beats.push({ pitch: [72, 71, 69, 67, 69, 67][bar], start: t, dur: 3 });
    }
    const heard = hear(beats, 120, 0.8);
    const g = estimateBeat(heard);
    const song = arrangeSong(heard, {
      title: 'Waltz',
      bpm: g.bpm,
      phase: g.phase,
      timeSig: [3, 4],
      split: 60,
      grid: 4,
      simplify: 'all',
      maxPerHand: 4,
    })!;
    expect(song.pickup).toBe(1);
    expect(song.notes.find((n) => n.pitch === 43)!.start).toBe(1);
  });

  it('keeps just the melody and bass when simplifying', () => {
    const chords = builtinSongs().find((s) => s.id === 'chord-basics')!;
    const heard = hear(chords.notes, 70, 0.4);
    const song = arrangeSong(heard, {
      title: 'C',
      bpm: 70,
      phase: 0.4,
      timeSig: [4, 4],
      split: 60,
      grid: 4,
      simplify: 'melody-bass',
      maxPerHand: 4,
    })!;
    const first = song.notes.filter((n) => n.start === 0);
    expect(first.map((n) => [n.pitch, n.hand])).toEqual([
      [48, 'L'],
      [67, 'R'],
    ]);
  });
});

describe('key guess', () => {
  it('recognises sharp and flat keys', () => {
    expect(guessKeyFifths([62, 64, 66, 67, 69, 71, 73, 74, 66, 69])).toBe(2); // D major
    expect(guessKeyFifths([65, 67, 69, 70, 72, 74, 76, 77, 70, 65])).toBe(-1); // F major
  });
});

describe('overtone filter', () => {
  it('drops quiet ghosts above a note but keeps real octaves', () => {
    const n = (pitch: number, start: number, amplitude: number) => ({ pitch, start, dur: 0.5, amplitude });
    const out = dropOvertones([n(60, 1, 0.8), n(72, 1.01, 0.3), n(79, 1.02, 0.25), n(48, 2, 0.7), n(60, 2, 0.65), n(76, 3, 0.2)]);
    expect(out.map((x) => x.pitch)).toEqual([60, 48, 60, 76]);
  });
});
