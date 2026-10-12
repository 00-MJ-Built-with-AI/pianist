const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parses names like "C4", "F#5", "Bb3", "C##4" into MIDI numbers. */
export function parsePitch(name: string): number {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Bad pitch "${name}"`);
  const letter = m[1].toUpperCase();
  const acc = m[2] ?? '';
  const alter = acc.startsWith('#') ? acc.length : -acc.length;
  const octave = Number(m[3]);
  return (octave + 1) * 12 + LETTER_SEMITONE[letter] + alter;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function pitchName(pitch: number, preferFlats = false): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12);
}

export interface Spelling {
  step: string;
  alter: number;
  octave: number;
}

// Neutral-key spelling: the accidentals most common in C major / A minor pieces.
const NEUTRAL: Array<[string, number]> = [
  ['C', 0], ['C', 1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['B', -1], ['B', 0],
];

/** Spells a MIDI pitch for notation, choosing sharps or flats from the key signature (or a per-note hint). */
export function spell(pitch: number, keyFifths: number, hint?: 'sharp' | 'flat'): Spelling {
  const pc = ((pitch % 12) + 12) % 12;
  let step: string;
  let alter: number;
  if (hint) {
    const n = (hint === 'sharp' ? SHARP_NAMES : FLAT_NAMES)[pc];
    step = n[0];
    alter = n.length > 1 ? (hint === 'sharp' ? 1 : -1) : 0;
  } else if (keyFifths > 0) {
    const n = SHARP_NAMES[pc];
    step = n[0];
    alter = n.length > 1 ? 1 : 0;
    // E# and B# appear only in keys with many sharps.
    if (keyFifths >= 6 && pc === 5) [step, alter] = ['E', 1];
    if (keyFifths >= 7 && pc === 0) [step, alter] = ['B', 1];
  } else if (keyFifths < 0) {
    const n = FLAT_NAMES[pc];
    step = n[0];
    alter = n.length > 1 ? -1 : 0;
    if (keyFifths <= -6 && pc === 11) [step, alter] = ['C', -1];
    if (keyFifths <= -7 && pc === 4) [step, alter] = ['F', -1];
  } else {
    [step, alter] = NEUTRAL[pc];
  }
  // The octave follows the written letter, so B#3 sounds as C4 and Cb4 as B3.
  const octave = Math.floor((pitch - alter) / 12) - 1;
  return { step, alter, octave };
}

export type NameStyle = 'letter' | 'octave' | 'solfege';

const LETTERS_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const LETTERS_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const SOLFEGE_SHARP = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const SOLFEGE_FLAT = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

/** Display name of a key: "C♯", "C♯4" or "Do♯" (fixed do). */
export function noteLabel(pitch: number, style: NameStyle, preferFlats = false): string {
  const pc = ((pitch % 12) + 12) % 12;
  if (style === 'solfege') return (preferFlats ? SOLFEGE_FLAT : SOLFEGE_SHARP)[pc];
  const name = (preferFlats ? LETTERS_FLAT : LETTERS_SHARP)[pc];
  return style === 'octave' ? `${name}${Math.floor(pitch / 12) - 1}` : name;
}
