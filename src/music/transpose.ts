import { songToMusicXml } from './musicxml';
import type { Song } from './types';

const MAJOR_KEYS = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

/** Name of the major key with this many sharps (positive) or flats (negative). */
export function keyName(fifths: number): string {
  return MAJOR_KEYS[fifths + 7] ?? 'C';
}

/** Key signature after moving `semitones`: up a half step adds 7 fifths; keep it within 6 flats … 5 sharps. */
export function transposeKey(fifths: number, semitones: number): number {
  let f = (((fifths + 7 * semitones) % 12) + 12) % 12; // 0 … 11
  if (f > 5) f -= 12; // prefer flats over 6+ sharps
  return f;
}

/** How far a song can move and stay on the 88 keys. */
export function transposeRange(song: Song): [number, number] {
  if (!song.notes.length) return [-12, 12];
  const lo = Math.min(...song.notes.map((n) => n.pitch));
  const hi = Math.max(...song.notes.map((n) => n.pitch));
  return [Math.max(-12, 21 - lo), Math.min(12, 108 - hi)];
}

/** The same piece in another key. Keeps the id, so progress and history stay with the song. */
export function transposeSong(song: Song, semitones: number): Song {
  if (!semitones) return song;
  const out: Song = {
    ...song,
    keyFifths: transposeKey(song.keyFifths, semitones),
    notes: song.notes.map((n) => ({ ...n, pitch: Math.max(21, Math.min(108, n.pitch + semitones)) })),
  };
  out.scoreXml = songToMusicXml(out);
  return out;
}
