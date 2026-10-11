import { songToMusicXml } from './musicxml';
import { finalizeSong } from './song';
import { tidyDurations } from './tidy';
import type { Hand, Note, Song } from './types';

export interface RecordedNoteEvent {
  type: 'on' | 'off';
  pitch: number;
  velocity: number;
  t: number;
}

export function buildRecordedSong(
  events: RecordedNoteEvent[],
  opts: { t0: number; stopAt: number; bpm: number; timeSig: [number, number]; split: number; grid: number; title: string },
): Song | null {
  const bps = opts.bpm / 60;
  const toBeat = (t: number) => ((t - opts.t0) / 1000) * bps;
  const open = new Map<number, RecordedNoteEvent>();
  const notes: Array<Omit<Note, 'id' | 'measure'>> = [];
  const add = (on: RecordedNoteEvent, offT: number) => {
    let start = toBeat(on.t);
    if (start < -0.5) return; // played before the count-in finished
    start = Math.max(0, Math.round(start * opts.grid) / opts.grid);
    const dur = Math.max(1 / opts.grid, Math.round((toBeat(offT) - toBeat(on.t)) * opts.grid) / opts.grid);
    const hand: Hand = on.pitch >= opts.split ? 'R' : 'L';
    notes.push({ pitch: on.pitch, start, dur, hand, velocity: on.velocity });
  };
  for (const e of events) {
    if (e.type === 'on') {
      const prev = open.get(e.pitch);
      if (prev) add(prev, e.t);
      open.set(e.pitch, e);
    } else {
      const on = open.get(e.pitch);
      if (on) add(on, e.t);
      open.delete(e.pitch);
    }
  }
  for (const on of open.values()) add(on, opts.stopAt);
  if (!notes.length) return null;
  // Same pitch twice on one grid point: keep the longer one.
  const unique = new Map<string, (typeof notes)[number]>();
  for (const n of notes) {
    const k = `${n.pitch}@${n.start}`;
    const p = unique.get(k);
    if (!p || p.dur < n.dur) unique.set(k, n);
  }
  const tidy = tidyDurations([...unique.values()], opts.grid);
  const song = finalizeSong({
    id: `rec-${Date.now().toString(36)}`,
    title: opts.title.trim() || 'My recording',
    composer: 'Me',
    level: 2,
    bpm: opts.bpm,
    timeSig: opts.timeSig,
    keyFifths: 0,
    notes: tidy,
    source: 'recording',
    createdAt: Date.now(),
  });
  song.scoreXml = songToMusicXml(song);
  return song;
}
