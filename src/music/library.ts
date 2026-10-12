import { songFromText, type TextSong } from './notation';
import type { Song } from './types';

// Public-domain melodies. Arrangements are simplified for practice.
export const LIBRARY_TEXT: TextSong[] = [
  {
    id: 'c-major-scale',
    title: 'C Major Scale',
    composer: 'Exercise',
    level: 1,
    bpm: 80,
    time: '4/4',
    key: 0,
    rh: 'C4/q D4/q E4/q F4/q | G4/q A4/q B4/q C5/q | B4/q A4/q G4/q F4/q | E4/q D4/q C4/h |',
    lh: 'C3/q D3/q E3/q F3/q | G3/q A3/q B3/q C4/q | B3/q A3/q G3/q F3/q | E3/q D3/q C3/h |',
  },
  {
    id: 'five-finger',
    title: 'Five-Finger Warm-up',
    composer: 'Exercise',
    level: 1,
    bpm: 90,
    time: '4/4',
    key: 0,
    rh: 'C4/q D4/q E4/q F4/q | G4/q F4/q E4/q D4/q | C4/q E4/q G4/q E4/q | C4/w |',
    lh: 'G3/q F3/q E3/q D3/q | C3/q D3/q E3/q F3/q | G3/q E3/q C3/q E3/q | C3/w |',
  },
  {
    id: 'chord-basics',
    title: 'Chord Basics: I–IV–V–I',
    composer: 'Exercise',
    level: 1,
    bpm: 70,
    time: '4/4',
    key: 0,
    rh:
      'C4+E4+G4/w | C4+F4+A4/w | B3+D4+G4/w | C4+E4+G4/w | ' +
      'C4+E4+G4/h C4+F4+A4/h | B3+D4+G4/h C4+E4+G4/h |',
    lh: 'C3/w | F2/w | G2/w | C3/w | C3/h F2/h | G2/h C3/h |',
  },
  {
    id: 'mary-lamb',
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    level: 1,
    bpm: 100,
    time: '4/4',
    key: 0,
    rh:
      'E4/q D4/q C4/q D4/q | E4/q E4/q E4/h | D4/q D4/q D4/h | E4/q G4/q G4/h | ' +
      'E4/q D4/q C4/q D4/q | E4/q E4/q E4/q E4/q | D4/q D4/q E4/q D4/q | C4/w |',
    lh: 'C3/w | C3/w | G2/w | C3/w | C3/w | C3/w | G2/w | C3/w |',
  },
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional',
    level: 1,
    bpm: 100,
    time: '4/4',
    key: 0,
    rh:
      'C4/q C4/q G4/q G4/q | A4/q A4/q G4/h | F4/q F4/q E4/q E4/q | D4/q D4/q C4/h | ' +
      'G4/q G4/q F4/q F4/q | E4/q E4/q D4/h | G4/q G4/q F4/q F4/q | E4/q E4/q D4/h | ' +
      'C4/q C4/q G4/q G4/q | A4/q A4/q G4/h | F4/q F4/q E4/q E4/q | D4/q D4/q C4/h |',
    lh:
      'C3/w | F3/h C3/h | G2/h C3/h | G2/h C3/h | C3/h G2/h | C3/h G2/h | C3/h G2/h | C3/h G2/h | ' +
      'C3/w | F3/h C3/h | G2/h C3/h | G2/h C3/h |',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'L. van Beethoven',
    level: 2,
    bpm: 100,
    time: '4/4',
    key: 0,
    rh:
      '!mf E4/q E4/q F4/q G4/q | G4/q F4/q E4/q D4/q | C4/q C4/q D4/q E4/q | E4/q. D4/e D4/h | ' +
      '!p E4/q E4/q F4/q G4/q | G4/q F4/q E4/q D4/q | C4/q C4/q D4/q E4/q | D4/q. C4/e C4/h |',
    lh: '!mp C3/w | G2/w | C3/w | G2/w | !pp C3/w | G2/w | C3/w | G2/h C3/h |',
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells (Chorus)',
    composer: 'J. Pierpont',
    level: 2,
    bpm: 110,
    time: '4/4',
    key: 0,
    rh:
      '!f E4/q E4/q E4/h | E4/q E4/q E4/h | E4/q G4/q C4/q. D4/e | E4/w | ' +
      'F4/q F4/q F4/q. F4/e | F4/q E4/q E4/q E4/e E4/e | E4/q D4/q D4/q E4/q | D4/h G4/h | ' +
      'E4/q E4/q E4/h | E4/q E4/q E4/h | E4/q G4/q C4/q. D4/e | E4/w | ' +
      'F4/q F4/q F4/q. F4/e | F4/q E4/q E4/q E4/e E4/e | G4/q G4/q F4/q D4/q | C4/w |',
    lh:
      '!mp C3/w | C3/w | C3/w | C3/w | F3/w | C3/w | G2/w | G2/w | ' +
      'C3/w | C3/w | C3/w | C3/w | F3/w | C3/w | G2/w | C3/w |',
  },
  {
    id: 'canon-in-d',
    title: 'Canon in D (Simplified)',
    composer: 'J. Pachelbel',
    level: 2,
    bpm: 72,
    time: '4/4',
    key: 2,
    rh:
      '!p F#5/h E5/h | D5/h C#5/h | B4/h A4/h | B4/h C#5/h | ' +
      '!mp D5/h C#5/h | B4/h A4/h | G4/h F#4/h | G4/h E4/h | ' +
      '!mf D4/q F#4/q A4/q G4/q | F#4/q D4/q F#4/q E4/q | D4/q B3/q D4/q A4/q | G4/q B4/q A4/q G4/q | ' +
      'F#4+A4+D5/w |',
    lh:
      '!p D3/h A2/h | B2/h F#2/h | G2/h D2/h | G2/h A2/h | ' +
      'D3/h A2/h | B2/h F#2/h | G2/h D2/h | G2/h A2/h | ' +
      'D3/h A2/h | B2/h F#2/h | G2/h D2/h | G2/h A2/h | D3/w |',
  },
  {
    // An original composition for Pianist: a slow pentatonic lullaby over open fifths.
    id: 'lantern-river-lullaby',
    title: 'Lantern River Lullaby',
    composer: 'Pianist (original)',
    level: 2,
    bpm: 66,
    time: '4/4',
    key: 1,
    rh:
      '!p D5/h B4/q A4/q | G4/h. E4/q | D4/q E4/q G4/q A4/q | B4/w | ' +
      'D5/h E5/q D5/q | B4/h A4/q G4/q | A4/q B4/q A4/q E4/q | A4/w | ' +
      '!mp B4/q. A4/e G4/q E4/q | D4/h E4/h | G4/q A4/q B4/q D5/q | E5/h. D5/q | ' +
      'B4/q. D5/e E5/q D5/q | B4/h A4/h | !p A4/q. G4/e E4/q A4/q | G4/w |',
    lh:
      '!pp G2+D3/w | E2+B2/w | C3+G3/w | G2+D3/w | ' +
      'G2+D3/w | E2+B2/w | A2+E3/w | D2+A2/w | ' +
      '!p E2/h B2/h | C3/h G3/h | G2/h D3/h | C3/h G3/h | ' +
      'G2/h D3/h | E2/h D2/h | !pp C3/h D3/h | G2+D3+G3/w |',
  },
  {
    id: 'minuet-in-g',
    title: 'Minuet in G (Simplified)',
    composer: 'C. Petzold (attr. J.S. Bach)',
    level: 3,
    bpm: 100,
    time: '3/4',
    key: 1,
    rh:
      '!mf D5/q G4/e A4/e B4/e C5/e | D5/q G4/q G4/q | E5/q C5/e D5/e E5/e F#5/e | G5/q G4/q G4/q | ' +
      'C5/q D5/e C5/e B4/e A4/e | B4/q C5/e B4/e A4/e G4/e | F#4/q G4/e A4/e B4/e G4/e | A4/h. | ' +
      'D5/q G4/e A4/e B4/e C5/e | D5/q G4/q G4/q | E5/q C5/e D5/e E5/e F#5/e | G5/q G4/q G4/q | ' +
      'C5/q D5/e C5/e B4/e A4/e | B4/q C5/e B4/e A4/e G4/e | A4/q B4/e A4/e G4/e F#4/e | G4/h. |',
    lh:
      '!mp G3/h A3/q | B3/h. | C4/h. | B3/h. | A3/h. | G3/h. | D4/q B3/q G3/q | D4/q D3/e C4/e B3/e A3/e | ' +
      'B3/h A3/q | G3/q B3/q G3/q | C4/h. | B3/q C4/e B3/e A3/e G3/e | A3/h F#3/q | G3/q B3/q G3/q | ' +
      'C4/q D4/q D3/q | G3/h G2/q |',
  },
  {
    id: 'fur-elise',
    title: 'Für Elise (Opening)',
    composer: 'L. van Beethoven',
    level: 3,
    bpm: 66,
    time: '3/8',
    key: 0,
    pickup: 0.5,
    rh:
      '!pp E5/s D#5/s | E5/s D#5/s E5/s B4/s D5/s C5/s | A4/e r/s C4/s E4/s A4/s | ' +
      'B4/e r/s E4/s G#4/s B4/s | C5/e r/s E4/s E5/s D#5/s | E5/s D#5/s E5/s B4/s D5/s C5/s | ' +
      'A4/e r/s C4/s E4/s A4/s | B4/e r/s E4/s C5/s B4/s | A4/q. |',
    lh:
      'r/e | r/q. | !pp A2/s E3/s A3/s r/s r/e | E2/s E3/s G#3/s r/s r/e | A2/s E3/s A3/s r/s r/e | ' +
      'r/q. | A2/s E3/s A3/s r/s r/e | E2/s E3/s G#3/s r/s r/e | A2/s E3/s A3/s r/s r/e |',
  },
];

let cache: Song[] | null = null;

export function builtinSongs(): Song[] {
  cache ??= LIBRARY_TEXT.map(songFromText);
  return cache;
}
