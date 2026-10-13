import { pitchName } from '../music/pitch';
import type { CalibrationResult } from './calibration';

/*
 * The piano check-up: a short guided test on the player's own piano. Each step logs what came in;
 * evaluateCheckup turns the logs into plain-language findings and recommended settings.
 */

export type CheckKind = 'midi' | 'mic';

export interface CheckNote {
  pitch: number;
  velocity: number;
  t: number; // ms since the step started
}

export interface StepLog {
  id: string;
  kind: CheckKind;
  skipped: boolean;
  notes: CheckNote[];
  offs: Array<{ pitch: number; t: number }>;
  pedals: Array<{ down: boolean; t: number }>;
  ccs: Array<{ cc: number; value: number; t: number }>;
  /** Microphone input level (RMS), every 100 ms. */
  levels: number[];
  timing?: CalibrationResult;
  /** Where this step is in the saved recording (samples at 22 050 Hz). */
  recording?: [from: number, to: number];
}

export interface Finding {
  level: 'good' | 'info' | 'warn' | 'bad';
  title: string;
  detail?: string;
}

export interface CheckupChanges {
  midiLatency?: number;
  micLatency?: number;
  micSensitivity?: number;
}

export interface CheckupResult {
  midi: Finding[];
  mic: Finding[];
  changes: CheckupChanges;
  /** The changes, described ("Microphone sensitivity: 50% → 65%"). */
  changeText: string[];
}

export interface CurrentSettings {
  midiLatency: number;
  micLatency: number;
  micSensitivity: number;
}

/** Splits notes into groups struck together (chords): a gap of more than `gapMs` starts a new group. */
export function chordGroups(notes: CheckNote[], gapMs = 250): CheckNote[][] {
  const groups: CheckNote[][] = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const g = groups[groups.length - 1];
    if (g && n.t - g[0].t <= gapMs) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const names = (ps: number[]) => ps.map((p) => pitchName(p)).join(', ');
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function timingFinding(r: CalibrationResult | undefined, what: string): Finding | null {
  if (!r) return null;
  if (r.median === null) {
    return {
      level: 'warn',
      title: `${what} timing couldn't be measured`,
      detail: `Only ${r.offsets.length} of 12 clicks had a note close to them. Run the timing check again from Settings → Timing.`,
    };
  }
  const late = r.median >= 0;
  return {
    level: (r.spread ?? 0) > 80 ? 'info' : 'good',
    title: `${what} notes arrive ${Math.abs(r.median)} ms ${late ? 'late' : 'early'}`,
    detail: `Steadiness ±${Math.round((r.spread ?? 0) / 2)} ms.${(r.spread ?? 0) > 80 ? ' The taps were uneven, so this is a rough measurement.' : ''}`,
  };
}

/** Turns the step logs into findings and recommended settings. */
export function evaluateCheckup(logs: StepLog[], current: CurrentSettings): CheckupResult {
  const step = (id: string) => logs.find((l) => l.id === id && !l.skipped);
  const midi: Finding[] = [];
  const mic: Finding[] = [];
  const changes: CheckupChanges = {};
  const changeText: string[] = [];

  /* ---------- MIDI */
  const range = step('midi-range');
  if (range && range.notes.length >= 2) {
    const lo = Math.min(...range.notes.map((n) => n.pitch));
    const hi = Math.max(...range.notes.map((n) => n.pitch));
    const keys = hi - lo + 1;
    midi.push(
      lo <= 21 && hi >= 108
        ? { level: 'good', title: 'All 88 keys come through' }
        : { level: 'info', title: `Keys from ${pitchName(lo)} to ${pitchName(hi)} (${keys} keys)`, detail: 'Pieces that go beyond this range will show notes your keyboard can’t play.' },
    );
  }

  const touch = step('midi-touch');
  if (touch) {
    const v = touch.notes.filter((n) => n.pitch === 60).map((n) => n.velocity);
    if (v.length >= 2) {
      const half = Math.max(1, Math.floor(v.length / 2));
      const soft = Math.round(avg(v.slice(0, half)));
      const loud = Math.round(avg(v.slice(half)));
      if (Math.max(...v) - Math.min(...v) <= 2) {
        midi.push({
          level: 'bad',
          title: 'Every key press arrives equally loud',
          detail: 'Your keyboard seems to send a fixed loudness. Turn touch (velocity) sensitivity on in the piano’s settings, otherwise dynamics can’t be judged.',
        });
      } else if (loud - soft < 30) {
        midi.push({
          level: 'warn',
          title: `Narrow loudness range (soft ${soft}, loud ${loud} of 127)`,
          detail: 'Dynamics feedback will be rough. If your piano has a touch setting, try a lighter one.',
        });
      } else {
        midi.push({ level: 'good', title: `Soft and loud both come through (soft ${soft}, loud ${loud} of 127)` });
      }
    }
  }

  const chord = step('midi-chord');
  if (chord) {
    const groups = chordGroups(chord.notes.filter((n) => [60, 64, 67].includes(n.pitch))).filter((g) => g.length >= 2);
    if (groups.length) {
      const spread = Math.round(median(groups.map((g) => Math.max(...g.map((n) => n.t)) - Math.min(...g.map((n) => n.t)))));
      midi.push(
        spread <= 60
          ? { level: 'good', title: `Chords arrive together (notes within ${spread} ms)` }
          : {
              level: 'info',
              title: `Your chord notes are about ${spread} ms apart`,
              detail: 'Pianist allows for that in Learn mode. Practising chords so all fingers land at once makes them sound fuller.',
            },
      );
    }
  }

  const pedals = step('midi-pedals');
  if (pedals) {
    if (pedals.pedals.some((p) => p.down)) midi.push({ level: 'good', title: 'Sustain pedal works' });
    else midi.push({ level: 'warn', title: 'No sustain pedal signal', detail: 'Check the pedal is plugged into the piano. Ignore this if you don’t use one.' });
    const other = [67, 66].filter((cc) => pedals.ccs.some((c) => c.cc === cc && c.value >= 64));
    if (other.length) {
      midi.push({
        level: 'good',
        title: other.length === 2 ? 'Soft and middle pedals work' : `${other[0] === 67 ? 'Soft' : 'Middle'} pedal works`,
        detail: 'You can use it to control Pianist hands-free (Settings → Hands-free).',
      });
    }
  }

  const midiTiming = step('midi-timing');
  const mt = timingFinding(midiTiming?.timing, 'MIDI');
  if (mt) midi.push(mt);
  if (midiTiming?.timing?.median != null) {
    const v = clamp(current.midiLatency + midiTiming.timing.median, 0, 250);
    if (v !== current.midiLatency) {
      changes.midiLatency = v;
      changeText.push(`MIDI latency correction: ${current.midiLatency} → ${v} ms`);
    }
  }

  /* ---------- Microphone */
  let sensVote = 0;
  const quiet = step('mic-quiet');
  let quietRoom = true;
  if (quiet) {
    const level = avg(quiet.levels);
    const db = Math.round(20 * Math.log10(Math.max(1e-6, level)));
    quietRoom = level < 0.01;
    mic.push(
      level < 0.003
        ? { level: 'good', title: `Quiet room (${db} dB)` }
        : level < 0.01
          ? { level: 'info', title: `A little background noise (${db} dB)` }
          : {
              level: 'warn',
              title: `Noisy room (${db} dB)`,
              detail: 'Background noise can hide soft notes. Turn off fans or music, or put the device closer to the piano.',
            },
    );
    if (quiet.notes.length) {
      mic.push({
        level: 'warn',
        title: `Heard ${quiet.notes.length} note${quiet.notes.length > 1 ? 's' : ''} while it was quiet (${names(quiet.notes.map((n) => n.pitch))})`,
        detail: 'Lowering the microphone sensitivity stops the room from playing notes by itself.',
      });
      sensVote -= 0.1;
    }
  }

  const heardOf = (log: StepLog | undefined, wanted: number[]) => wanted.filter((p) => log?.notes.some((n) => n.pitch === p));

  const single = step('mic-notes');
  if (single) {
    const wanted = [60, 64, 67, 72];
    const hit = heardOf(single, wanted);
    const missing = wanted.filter((p) => !hit.includes(p));
    const extra = [...new Set(single.notes.map((n) => n.pitch).filter((p) => !wanted.includes(p)))];
    mic.push(
      missing.length
        ? { level: 'warn', title: `Single notes: heard ${hit.length} of 4`, detail: `Missed ${names(missing)}.` }
        : { level: 'good', title: 'Single notes: all 4 heard' },
    );
    if (extra.length) mic.push({ level: 'info', title: `Also heard ${names(extra)}`, detail: 'Usually the ring of a nearby string; Pianist ignores most of these while you practise.' });
    if (missing.length >= 2 && quietRoom) sensVote += 0.1;
  }

  const lowHigh = step('mic-range');
  if (lowHigh) {
    const hit = heardOf(lowHigh, [36, 84]);
    mic.push(
      hit.length === 2
        ? { level: 'good', title: 'Low and high notes heard' }
        : {
            level: 'warn',
            title: hit.includes(36) ? 'The high C wasn’t heard' : hit.includes(84) ? 'The low C wasn’t heard' : 'Neither the low nor the high C was heard',
            detail: 'Very low and very high notes are hardest for a microphone. Point it towards the middle of the piano.',
          },
    );
  }

  const chords = step('mic-chords');
  if (chords) {
    const wanted = [48, 60, 64, 67];
    const groups = chordGroups(chords.notes).slice(0, 3);
    const heard = groups.reduce((sum, g) => sum + wanted.filter((p) => g.some((n) => n.pitch === p)).length, 0);
    const total = Math.max(1, groups.length) * wanted.length;
    if (!groups.length) mic.push({ level: 'warn', title: 'No chords were heard' });
    else
      mic.push(
        heard >= total - 1
          ? { level: 'good', title: `Chords: heard ${heard} of ${total} notes` }
          : {
              level: heard >= total * 0.66 ? 'info' : 'warn',
              title: `Chords: heard ${heard} of ${total} notes`,
              detail: 'The middle notes of chords are the hardest to hear. While practising, Pianist listens harder for the notes the music expects.',
            },
      );
    if (groups.length && heard < total * 0.75 && quietRoom) sensVote += 0.1;
  }

  const soft = step('mic-soft');
  if (soft) {
    const count = soft.notes.filter((n) => n.pitch === 67).length;
    if (count >= 4) mic.push({ level: 'good', title: 'Soft notes: all heard' });
    else {
      mic.push({
        level: count >= 2 ? 'info' : 'warn',
        title: `Soft notes: heard ${count} of 4`,
        detail: 'Raising the microphone sensitivity helps Pianist hear quiet playing.',
      });
      if (quietRoom) sensVote += count >= 2 ? 0.1 : 0.15;
    }
  }

  const ring = step('mic-pedal');
  if (ring) {
    const low = ring.notes.filter((n) => n.pitch === 36);
    const ghosts = ring.notes.length - Math.min(1, low.length);
    if (!low.length) mic.push({ level: 'warn', title: 'The low C wasn’t heard with the pedal down' });
    if (ghosts === 0) mic.push({ level: 'good', title: 'Sustain pedal: no ghost notes while the string rang' });
    else {
      mic.push({
        level: ghosts <= 2 ? 'info' : 'warn',
        title: `Sustain pedal: ${ghosts} ghost note${ghosts > 1 ? 's' : ''} while the string rang`,
        detail: ghosts > 2 ? 'Other strings ringing along were taken for notes. A lower sensitivity helps.' : undefined,
      });
      if (ghosts > 2) sensVote -= 0.1;
    }
  }

  const repeats = step('mic-repeats');
  if (repeats) {
    const count = repeats.notes.filter((n) => n.pitch === 62).length;
    mic.push(
      count >= 4
        ? { level: 'good', title: 'Fast repeated notes: all heard' }
        : { level: 'info', title: `Fast repeated notes: heard ${count} of 4`, detail: 'Very quick repeats can blur together for a microphone; MIDI catches every one.' },
    );
  }

  const micTiming = step('mic-timing');
  const at = timingFinding(micTiming?.timing, 'Microphone');
  if (at) mic.push(at);
  if (micTiming?.timing?.median != null) {
    const v = clamp(current.micLatency + micTiming.timing.median, 0, 300);
    if (v !== current.micLatency) {
      changes.micLatency = v;
      changeText.push(`Microphone latency correction: ${current.micLatency} → ${v} ms`);
    }
  }

  if (sensVote !== 0) {
    const v = clamp(Math.round((current.micSensitivity + clamp(sensVote, -0.15, 0.2)) * 20) / 20, 0, 1);
    if (v !== current.micSensitivity) {
      changes.micSensitivity = v;
      changeText.push(`Microphone sensitivity: ${Math.round(current.micSensitivity * 100)}% → ${Math.round(v * 100)}%`);
    }
  }

  return { midi, mic, changes, changeText };
}

/** 16-bit mono WAV of the microphone recording, base64-encoded, for the check-up file. */
export function wavBase64(samples: Float32Array, sampleRate: number): string {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
