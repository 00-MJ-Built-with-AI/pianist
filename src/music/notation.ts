import { parsePitch } from './pitch';
import { EPS, finalizeSong, measureLength } from './song';
import type { DynamicMark, Hand, Note, Song } from './types';
import { VELOCITY_FOR_DYNAMIC } from './types';
import { songToMusicXml } from './musicxml';

/**
 * Compact text notation for the built-in library, one string per hand:
 *   C4/q        quarter-note middle C      durations: w h q e s, "." dots (q. = dotted quarter)
 *   C4+E4+G4/h  chord
 *   r/e         rest
 *   C4/h~       tie into the next note of the same pitch
 *   !mf         dynamic for the following notes
 *   |           bar line (checked against the time signature)
 */
export interface TextSong {
  id: string;
  title: string;
  composer: string;
  level: number;
  bpm: number;
  time: string; // "3/4"
  key: number; // fifths
  pickup?: number; // beats
  rh: string;
  lh?: string;
}

const DUR: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };

function parseDuration(text: string, token: string): number {
  const m = /^([whqes])(\.{0,2})$/.exec(text);
  if (!m) throw new Error(`Bad duration in "${token}"`);
  let d = DUR[m[1]];
  let add = d / 2;
  for (let i = 0; i < m[2].length; i++) {
    d += add;
    add /= 2;
  }
  return d;
}

export interface ParsedHand {
  notes: Array<Omit<Note, 'id' | 'measure'>>;
  dynamics: DynamicMark[];
  endBeat: number;
}

export function parseHand(text: string, hand: Hand, measureLen: number, pickup: number): ParsedHand {
  const notes: ParsedHand['notes'] = [];
  const dynamics: DynamicMark[] = [];
  let beat = 0;
  let velocity = VELOCITY_FOR_DYNAMIC.mf;
  let bar = 0;
  // Notes waiting for a tie continuation, keyed by pitch.
  const tied = new Map<number, Omit<Note, 'id' | 'measure'>>();

  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (token === '|') {
      bar++;
      const expected = pickup > EPS ? pickup + (bar - 1) * measureLen : bar * measureLen;
      if (Math.abs(beat - expected) > EPS) {
        throw new Error(`${hand} hand bar ${bar}: ${beat} beats, expected ${expected}`);
      }
      continue;
    }
    if (token.startsWith('!')) {
      const mark = token.slice(1);
      if (!(mark in VELOCITY_FOR_DYNAMIC)) throw new Error(`Unknown dynamic "${token}"`);
      velocity = VELOCITY_FOR_DYNAMIC[mark];
      dynamics.push({ beat, hand, mark });
      continue;
    }
    const slash = token.lastIndexOf('/');
    if (slash < 0) throw new Error(`Missing duration in "${token}"`);
    const tie = token.endsWith('~');
    const dur = parseDuration(token.slice(slash + 1).replace(/~$/, ''), token);
    const head = token.slice(0, slash);
    if (head !== 'r') {
      for (const name of head.split('+')) {
        const pitch = parsePitch(name);
        const pending = tied.get(pitch);
        if (pending && Math.abs(pending.start + pending.dur - beat) < EPS) {
          pending.dur += dur;
          if (!tie) tied.delete(pitch);
          continue;
        }
        const note = { pitch, start: beat, dur, hand, velocity };
        notes.push(note);
        if (tie) tied.set(pitch, note);
      }
    }
    beat += dur;
  }
  return { notes, dynamics, endBeat: beat };
}

export function songFromText(def: TextSong): Song {
  const [num, den] = def.time.split('/').map(Number);
  const timeSig: [number, number] = [num, den];
  const len = measureLength(timeSig);
  const pickup = def.pickup ?? 0;
  const rh = parseHand(def.rh, 'R', len, pickup);
  const lh = def.lh ? parseHand(def.lh, 'L', len, pickup) : { notes: [], dynamics: [], endBeat: 0 };
  const song = finalizeSong({
    id: def.id,
    title: def.title,
    composer: def.composer,
    level: def.level,
    bpm: def.bpm,
    timeSig,
    keyFifths: def.key,
    pickup,
    notes: [...rh.notes, ...lh.notes],
    dynamics: [...rh.dynamics, ...lh.dynamics],
    source: 'builtin',
    totalBeats: Math.max(rh.endBeat, lh.endBeat),
  });
  song.scoreXml = songToMusicXml(song);
  return song;
}
