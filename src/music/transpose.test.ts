import { describe, expect, it } from 'vitest';
import { builtinSongs } from './library';
import { keyName, transposeKey, transposeRange, transposeSong } from './transpose';

describe('transpose', () => {
  it('moves the key signature around the circle of fifths', () => {
    expect(keyName(transposeKey(0, 2))).toBe('D'); // C → D
    expect(keyName(transposeKey(0, 1))).toBe('Db'); // C → Db rather than C#
    expect(keyName(transposeKey(0, -2))).toBe('Bb');
    expect(keyName(transposeKey(1, 5))).toBe('C'); // G → C
    expect(keyName(transposeKey(2, -12))).toBe('D'); // an octave keeps the key
  });

  it('shifts every note and keeps the song identity', () => {
    const ode = builtinSongs().find((s) => s.id === 'ode-to-joy')!;
    const up = transposeSong(ode, 2);
    expect(up.id).toBe(ode.id);
    expect(up.notes.map((n) => n.pitch)).toEqual(ode.notes.map((n) => n.pitch + 2));
    expect(up.keyFifths).toBe(2);
    expect(up.scoreXml).toContain('<fifths>2</fifths>');
    expect(up.scoreXml).toContain('<step>F</step><alter>1</alter>'); // E → F#
    expect(transposeSong(ode, 0)).toBe(ode);
  });

  it('limits the range to the 88 keys', () => {
    const fe = builtinSongs().find((s) => s.id === 'fur-elise')!;
    const [lo, hi] = transposeRange(fe);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
    expect(lo).toBeGreaterThanOrEqual(-12);
  });
});
