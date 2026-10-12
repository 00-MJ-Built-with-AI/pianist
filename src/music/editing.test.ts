import { describe, expect, it } from 'vitest';
import { docFromSong, deleteNotes, moveNotes, notesInBox, resizeNotes, snap, songFromDoc, toggleHands } from './editing';
import { songToMidi } from './export';
import { importMidi } from './importers';
import { builtinSongs } from './library';

const ode = () => builtinSongs().find((s) => s.id === 'ode-to-joy')!;

describe('editing', () => {
  it('round-trips a song through the editor document', () => {
    const s = ode();
    const back = songFromDoc(docFromSong(s), { id: s.id, source: s.source, level: s.level, createdAt: 1 });
    expect(back.notes.map((n) => [n.pitch, n.start, n.dur, n.hand])).toEqual(s.notes.map((n) => [n.pitch, n.start, n.dur, n.hand]));
    expect(back.scoreXml).toContain('<work-title>Ode to Joy</work-title>');
  });

  it('moves a selection together and keeps it in bounds', () => {
    const doc = docFromSong(ode());
    const first = new Set([doc.notes[0].uid, doc.notes[1].uid]);
    const moved = moveNotes(doc.notes, first, -3, 2);
    const a = moved.find((n) => n.uid === doc.notes[0].uid)!;
    expect(a.start).toBe(0); // can't go before the start
    expect(a.pitch).toBe(doc.notes[0].pitch + 2);
    const high = moveNotes(doc.notes, first, 0, 200);
    expect(Math.max(...high.filter((n) => first.has(n.uid)).map((n) => n.pitch))).toBe(108);
  });

  it('resizes, deletes, changes hands and box-selects', () => {
    const doc = docFromSong(ode());
    const one = new Set([doc.notes[0].uid]);
    expect(resizeNotes(doc.notes, one, -5, 0.25).find((n) => n.uid === doc.notes[0].uid)!.dur).toBe(0.25);
    expect(deleteNotes(doc.notes, one)).toHaveLength(doc.notes.length - 1);
    expect(toggleHands(doc.notes, one).find((n) => n.uid === doc.notes[0].uid)!.hand).not.toBe(doc.notes[0].hand);
    // first bar, right hand only (E4–G4)
    const box = notesInBox(doc.notes, 0, 3.9, 60, 70);
    expect(box).toHaveLength(4);
    expect(snap(1.13, 0.25)).toBe(1.25);
  });
});

describe('export', () => {
  it('writes a MIDI file that imports back to the same notes', () => {
    const s = builtinSongs().find((x) => x.id === 'minuet-in-g')!;
    const back = importMidi(songToMidi(s).buffer as ArrayBuffer, 'x');
    expect(back.bpm).toBe(s.bpm);
    expect(back.timeSig).toEqual(s.timeSig);
    const key = (n: { pitch: number; start: number; hand: string }) => `${n.pitch}@${n.start}${n.hand}`;
    expect(back.notes.map(key).sort()).toEqual(s.notes.map(key).sort());
  });
});
