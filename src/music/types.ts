export type Hand = 'R' | 'L';

/** One note of a song. Time is measured in beats, where one beat is a quarter note. */
export interface Note {
  id: number;
  pitch: number; // MIDI note number (60 = middle C)
  start: number; // beats from the start of the piece
  dur: number; // beats
  hand: Hand;
  velocity: number; // 1–127, from the score's dynamics (64 when unmarked)
  measure: number; // index into Song.measures
  /** Spell this note with a sharp or a flat regardless of the key (e.g. a raised leading tone). */
  spell?: 'sharp' | 'flat';
}

export interface Measure {
  index: number;
  number: number; // printed bar number (a pickup bar is 0)
  start: number; // beats
  length: number; // beats
}

export interface DynamicMark {
  beat: number;
  hand: Hand;
  mark: string; // pp, p, mp, mf, f, ff
}

export type SongSource = 'builtin' | 'midi' | 'musicxml' | 'recording' | 'audio';

export interface Song {
  id: string;
  title: string;
  composer: string;
  level: number; // 1 (first steps) … 5 (advanced)
  bpm: number; // quarter notes per minute
  timeSig: [number, number];
  keyFifths: number; // -7 … 7, sharps positive
  pickup: number; // beats in the anacrusis bar, 0 when none
  notes: Note[]; // sorted by start, then pitch
  measures: Measure[];
  totalBeats: number;
  dynamics: DynamicMark[];
  source: SongSource;
  /** MusicXML rendered on the staff. Generated for built-in, MIDI and recorded songs. */
  scoreXml?: string;
  createdAt?: number;
}

export type SongMeta = Pick<Song, 'id' | 'title' | 'composer' | 'level' | 'source' | 'createdAt'>;

export const VELOCITY_FOR_DYNAMIC: Record<string, number> = {
  ppp: 24,
  pp: 36,
  p: 50,
  mp: 64,
  mf: 78,
  f: 94,
  ff: 108,
  fff: 120,
};
