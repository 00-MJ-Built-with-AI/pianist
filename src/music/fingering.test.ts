import { describe, expect, it } from 'vitest';
import { scaleExercise } from './exercises';
import { suggestFingering } from './fingering';
import { builtinSongs } from './library';

const fingersOf = (song: ReturnType<typeof scaleExercise>, hand: 'R' | 'L') => {
  const f = suggestFingering(song);
  return song.notes.filter((n) => n.hand === hand).map((n) => f.get(n.id));
};

describe('suggested fingering', () => {
  it('fingers the C major scale the standard way', () => {
    const s = scaleExercise({ pc: 0, kind: 'major', octaves: 1, hands: 'both', beats: 1, bpm: 80 });
    expect(fingersOf(s, 'R')).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]);
    expect(fingersOf(s, 'L')).toEqual([5, 4, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('keeps the thumb off black keys in D major', () => {
    const s = scaleExercise({ pc: 2, kind: 'major', octaves: 1, hands: 'R', beats: 1, bpm: 80 });
    const f = suggestFingering(s);
    for (const n of s.notes) if ([1, 6].includes(n.pitch % 12)) expect(f.get(n.id)).not.toBe(1);
  });

  it('gives every note of every library piece a finger', () => {
    for (const song of builtinSongs()) {
      const f = suggestFingering(song);
      for (const n of song.notes) {
        expect(f.get(n.id), `${song.id} note ${n.id}`).toBeGreaterThanOrEqual(1);
        expect(f.get(n.id)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('uses chord shapes', () => {
    const chords = builtinSongs().find((s) => s.id === 'chord-basics')!;
    const f = suggestFingering(chords);
    const first = chords.notes.filter((n) => n.start === 0 && n.hand === 'R').map((n) => f.get(n.id));
    expect(first).toEqual([1, 3, 5]);
  });
});

describe('fingering in the score', () => {
  it('writes finger numbers into the MusicXML', async () => {
    const { songToMusicXml } = await import('./musicxml');
    const s = scaleExercise({ pc: 0, kind: 'major', octaves: 1, hands: 'R', beats: 1, bpm: 80 });
    const xml = songToMusicXml(s, { fingering: suggestFingering(s) });
    expect((xml.match(/<fingering placement="above">/g) ?? []).length).toBe(15);
    expect(xml).toContain('<fingering placement="above">1</fingering>');
  });
});
