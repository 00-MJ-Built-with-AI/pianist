import { Midi } from '@tonejs/midi';
import { songToMusicXml } from './musicxml';
import { finalizeSong } from './song';
import type { Hand, Measure, Note, Song } from './types';

const KEY_FIFTHS: Record<string, number> = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
};
const RELATIVE_MAJOR: Record<string, string> = {
  A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#',
  D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb', Ab: 'Cb',
};

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

type RawNote = Omit<Note, 'id' | 'measure'>;

/** Imports .mid / .midi / .musicxml / .xml / .mxl files. */
export async function importSongFile(file: File): Promise<Song> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mid' || ext === 'midi') return importMidi(await file.arrayBuffer(), baseName(file.name));
  if (ext === 'xml' || ext === 'musicxml') return importMusicXml(await file.text(), baseName(file.name));
  if (ext === 'mxl') {
    // OSMD unzips compressed MusicXML when given it as a binary string.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return importMusicXml(bin, baseName(file.name));
  }
  throw new Error('Choose a .mid, .midi, .musicxml, .xml or .mxl file.');
}

/* ---------------------------------------------------------------- MIDI */

const GRID = 12; // quantize to twelfths of a beat (keeps both sixteenths and triplets)
const q = (beats: number) => Math.round(beats * GRID) / GRID;

export function importMidi(data: ArrayBuffer, fallbackTitle: string): Song {
  const midi = new Midi(data);
  const ppq = midi.header.ppq;
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  const tsRaw = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const timeSig: [number, number] = [tsRaw[0] || 4, tsRaw[1] || 4];
  const ks = midi.header.keySignatures[0];
  let keyFifths = 0;
  if (ks) {
    const tonic = ks.scale === 'minor' ? (RELATIVE_MAJOR[ks.key] ?? 'C') : ks.key;
    keyFifths = KEY_FIFTHS[tonic] ?? 0;
  }

  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && !t.instrument.percussion && t.channel !== 9);
  if (!tracks.length) throw new Error('This MIDI file has no piano notes.');
  const avg = (t: (typeof tracks)[number]) => t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length;

  // Hands: two tracks → higher one is the right hand; one track → split at middle C.
  const handOfTrack = new Map<(typeof tracks)[number], Hand | null>();
  if (tracks.length === 1) handOfTrack.set(tracks[0], null);
  else {
    const sorted = [...tracks].sort((a, b) => avg(b) - avg(a));
    sorted.forEach((t, i) => handOfTrack.set(t, tracks.length === 2 ? (i === 0 ? 'R' : 'L') : avg(t) >= 60 ? 'R' : 'L'));
  }

  const notes: RawNote[] = [];
  const seen = new Set<string>();
  for (const t of tracks) {
    const hand = handOfTrack.get(t);
    for (const n of t.notes) {
      if (n.midi < 21 || n.midi > 108) continue;
      const start = q(n.ticks / ppq);
      const dur = Math.max(1 / GRID, q(n.durationTicks / ppq));
      const key = `${n.midi}@${start}`;
      if (seen.has(key)) continue; // doubled notes in different tracks
      seen.add(key);
      notes.push({
        pitch: n.midi,
        start,
        dur,
        hand: hand ?? (n.midi >= 60 ? 'R' : 'L'),
        velocity: Math.max(1, Math.round(n.velocity * 127)),
      });
    }
  }
  // Drop leading silence to the start of the bar the music begins in.
  const barLen = (timeSig[0] * 4) / timeSig[1];
  const first = Math.min(...notes.map((n) => n.start));
  const shift = Math.floor(first / barLen) * barLen;
  if (shift > 0) notes.forEach((n) => (n.start -= shift));

  const song = finalizeSong({
    id: newId('midi'),
    title: midi.name?.trim() || fallbackTitle,
    composer: '',
    level: 3,
    bpm,
    timeSig,
    keyFifths,
    notes,
    source: 'midi',
    createdAt: Date.now(),
  });
  song.scoreXml = songToMusicXml(song);
  return song;
}

/* ---------------------------------------------------------------- MusicXML (parsed by OpenSheetMusicDisplay) */

export async function importMusicXml(content: string, fallbackTitle: string): Promise<Song> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px';
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
    await osmd.load(content);
    const sheet = osmd.Sheet;
    const sms = sheet.SourceMeasures;
    if (!sms.length) throw new Error('This file has no measures.');

    const measures: Measure[] = sms.map((m, i) => {
      const start = m.AbsoluteTimestamp.RealValue * 4;
      const next = sms[i + 1];
      const length = next ? next.AbsoluteTimestamp.RealValue * 4 - start : m.Duration.RealValue * 4;
      return { index: i, number: i, start, length };
    });
    const first = sms[0];
    const nominal = first.ActiveTimeSignature ? first.ActiveTimeSignature.RealValue * 4 : measures[0].length;
    const hasPickup = measures.length > 1 && measures[0].length < nominal - 1e-6;
    measures.forEach((m, i) => (m.number = hasPickup ? i : i + 1));

    // Staves of the whole score in order; the first is the right hand, the second the left.
    const staffOrder: number[] = [];
    for (const inst of sheet.Instruments) for (const st of inst.Staves) staffOrder.push(st.idInMusicSheet);

    const notes: RawNote[] = [];
    for (const m of sms) {
      for (const container of m.VerticalSourceStaffEntryContainers) {
        for (const se of container.StaffEntries) {
          if (!se) continue;
          const order = staffOrder.indexOf(se.ParentStaff.idInMusicSheet);
          const start = se.AbsoluteTimestamp.RealValue * 4;
          for (const ve of se.VoiceEntries) {
            for (const note of ve.Notes) {
              if (note.isRest() || note.IsGraceNote || note.IsCueNote || !note.Pitch) continue;
              const tie = note.NoteTie;
              if (tie && tie.StartNote !== note) continue; // continuation of a tied note
              const dur = (tie ? tie.Duration.RealValue : note.Length.RealValue) * 4;
              const pitch = note.halfTone + 12;
              if (pitch < 21 || pitch > 108) continue;
              const hand: Hand = order === 0 ? 'R' : order === 1 ? 'L' : pitch >= 60 ? 'R' : 'L';
              notes.push({ pitch, start, dur: Math.max(1 / 16, dur), hand, velocity: 78 });
            }
          }
        }
      }
    }
    if (!notes.length) throw new Error('No notes found in this score.');

    let keyFifths = 0;
    for (const se of first.FirstInstructionsStaffEntries) {
      const ki = se?.Instructions.find((i) => 'Key' in i && 'keyTypeOriginal' in i) as { Key?: number } | undefined;
      if (ki?.Key !== undefined) {
        keyFifths = ki.Key;
        break;
      }
    }
    const ts = first.ActiveTimeSignature;
    const song = finalizeSong({
      id: newId('xml'),
      title: sheet.TitleString?.trim() || fallbackTitle,
      composer: sheet.ComposerString?.trim() || '',
      level: 3,
      bpm: Math.round(sheet.DefaultStartTempoInBpm || first.TempoInBPM || 100),
      timeSig: ts ? [ts.Numerator, ts.Denominator] : [4, 4],
      keyFifths,
      pickup: hasPickup ? measures[0].length : 0,
      notes,
      measures,
      source: 'musicxml',
      scoreXml: content,
      createdAt: Date.now(),
    });
    return song;
  } finally {
    host.remove();
  }
}
