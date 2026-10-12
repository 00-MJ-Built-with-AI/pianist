import { songToMusicXml } from './musicxml';
import { finalizeSong } from './song';
import type { Hand, Song } from './types';

/** A note while it is being edited (uid stays stable through moves, unlike Note.id). */
export interface EditNote {
  uid: number;
  pitch: number;
  start: number;
  dur: number;
  hand: Hand;
  velocity: number;
  spell?: 'sharp' | 'flat';
}

export interface EditDoc {
  title: string;
  composer: string;
  bpm: number;
  timeSig: [number, number];
  keyFifths: number;
  pickup: number;
  notes: EditNote[];
}

export function docFromSong(song: Song): EditDoc {
  return {
    title: song.title,
    composer: song.composer,
    bpm: song.bpm,
    timeSig: song.timeSig,
    keyFifths: song.keyFifths,
    pickup: song.pickup,
    notes: song.notes.map((n, i) => ({ uid: i + 1, pitch: n.pitch, start: n.start, dur: n.dur, hand: n.hand, velocity: n.velocity, spell: n.spell })),
  };
}

export function songFromDoc(doc: EditDoc, base: Pick<Song, 'id' | 'source' | 'level' | 'createdAt'>): Song {
  const song = finalizeSong({
    id: base.id,
    title: doc.title.trim() || 'Untitled',
    composer: doc.composer,
    level: base.level,
    bpm: Math.max(20, Math.min(300, Math.round(doc.bpm))),
    timeSig: doc.timeSig,
    keyFifths: doc.keyFifths,
    pickup: doc.pickup,
    notes: doc.notes.map(({ pitch, start, dur, hand, velocity, spell }) => ({ pitch, start, dur, hand, velocity, spell })),
    source: base.source,
    createdAt: base.createdAt ?? Date.now(),
  });
  song.scoreXml = songToMusicXml(song);
  return song;
}

export const snap = (beat: number, grid: number) => Math.round(beat / grid) * grid;

const clampPitch = (p: number) => Math.max(21, Math.min(108, p));

export function nextUid(notes: EditNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.uid), 0) + 1;
}

export function moveNotes(notes: EditNote[], uids: ReadonlySet<number>, dBeat: number, dPitch: number): EditNote[] {
  // Keep the whole selection together: don't let any note go before the start or off the keyboard.
  const sel = notes.filter((n) => uids.has(n.uid));
  if (!sel.length) return notes;
  const minStart = Math.min(...sel.map((n) => n.start));
  const db = Math.max(dBeat, -minStart);
  const lo = Math.min(...sel.map((n) => n.pitch));
  const hi = Math.max(...sel.map((n) => n.pitch));
  const dp = Math.max(21 - lo, Math.min(108 - hi, dPitch));
  // A note moved to another pitch loses its written spelling.
  return notes.map((n) =>
    uids.has(n.uid) ? { ...n, start: n.start + db, pitch: clampPitch(n.pitch + dp), spell: dp ? undefined : n.spell } : n,
  );
}

export function resizeNotes(notes: EditNote[], uids: ReadonlySet<number>, dDur: number, minDur: number): EditNote[] {
  return notes.map((n) => (uids.has(n.uid) ? { ...n, dur: Math.max(minDur, n.dur + dDur) } : n));
}

export function deleteNotes(notes: EditNote[], uids: ReadonlySet<number>): EditNote[] {
  return notes.filter((n) => !uids.has(n.uid));
}

export function toggleHands(notes: EditNote[], uids: ReadonlySet<number>): EditNote[] {
  return notes.map((n) => (uids.has(n.uid) ? { ...n, hand: n.hand === 'R' ? 'L' : 'R' } : n));
}

/** Notes whose rectangle overlaps a box in (beats, pitches). */
export function notesInBox(notes: EditNote[], b0: number, b1: number, p0: number, p1: number): number[] {
  const [bl, bh] = [Math.min(b0, b1), Math.max(b0, b1)];
  const [pl, ph] = [Math.min(p0, p1), Math.max(p0, p1)];
  return notes.filter((n) => n.pitch >= pl && n.pitch <= ph && n.start < bh && n.start + n.dur > bl).map((n) => n.uid);
}
