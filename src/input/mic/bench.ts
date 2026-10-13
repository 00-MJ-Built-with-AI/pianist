import { resumeAudio } from '../../audio/audio';
import { piano } from '../../audio/piano';
import { inputHub } from '../hub';
import { micTestOrigin, startMic, stopMic } from './mic';

/*
 * Development bench for the microphone detector (not part of the app bundle: load it from the
 * console). Renders piano clips, feeds them to the detector in real time and scores what it heard.
 */

export interface BenchNote {
  pitch: number;
  at: number; // seconds into the clip
  dur: number;
  vel: number;
}

export interface Scenario {
  name: string;
  notes: BenchNote[];
  /** Overall level of the clip (a far-away microphone is quiet). */
  gain?: number;
  /** What the "score" expects; defaults to the notes played. Null = no session running. */
  expect?: BenchNote[] | null;
  /** A real room: reverb (0-1) and background noise level. */
  room?: { reverb: number; noise: number; hiss?: number };
  /** Clip length when there are no notes. */
  seconds?: number;
}

export interface BenchResult {
  name: string;
  played: number;
  hits: number;
  missed: string[];
  extra: string[];
  /** Detections of notes the score expected but that were never played. */
  imagined: string[];
  meanAbsOffsetMs: number | null;
  /** Everything heard, lined up with the clip (for debugging). */
  heard: string[];
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const n = (pitch: number, at: number, dur = 0.5, vel = 75): BenchNote => ({ pitch, at, dur, vel });

function chords(list: number[][], start = 0.5, gap = 1.3, vel = 72): BenchNote[] {
  return list.flatMap((c, i) => c.map((p) => n(p, start + i * gap, 0.9, vel)));
}

const CHORDS = [
  [48, 60, 64, 67],
  [41, 53, 57, 60],
  [55, 59, 62, 67],
  [45, 52, 57, 60],
  [50, 53, 57, 62],
  [60, 64, 67, 72],
];

const ROOM = { reverb: 0.6, noise: 0.004 };
const HISS = { reverb: 0.3, noise: 0, hiss: 0.002 };

const MELODY = [60, 64, 67, 72, 71, 67, 65, 64, 62, 60, 57, 55].map((p, i) => n(p, 0.5 + i * 0.4, 0.38));

export function scenarios(): Scenario[] {
  const played = chords(CHORDS);
  // The player leaves out one note of every chord: the detector must not "hear" it anyway.
  const missingAudio = played.filter((_, i) => i % 4 !== 2);
  const wrongExpect = MELODY.map((m, i) => (i % 3 === 1 ? { ...m, pitch: m.pitch + 1 } : m));
  return [
    { name: 'melody', notes: MELODY },
    { name: 'soft', notes: [45, 50, 55, 60, 62, 64, 67, 69, 72, 76, 79, 84].map((p, i) => n(p, 0.5 + i * 0.6, 0.5, 24 + (i % 4) * 4)) },
    { name: 'far mic', notes: MELODY, gain: 0.08 },
    { name: 'chords', notes: played },
    {
      name: 'pedal ring',
      notes: [n(36, 0.8, 5.5, 105), n(43, 0.8, 5.5, 100), ...[76, 74, 72, 67, 69, 71, 72].map((p, i) => n(p, 1.6 + i * 0.55, 0.45, 48))],
    },
    { name: 'repeats', notes: [...[0, 1, 2, 3].map((i) => n(62, 0.5 + i * 0.18, 0.15)), ...[0, 1, 2, 3].map((i) => n(64, 1.6 + i * 0.25, 0.2))] },
    { name: 'missed notes', notes: missingAudio, expect: played },
    { name: 'wrong notes', notes: MELODY, expect: wrongExpect },
    { name: 'no session', notes: played, expect: null },
    // Octave above a low note left out: it rings as an overtone but must not count as played.
    {
      name: 'missed octave',
      notes: [n(45, 0.5, 0.9), n(41, 1.8, 0.9), n(36, 3.1, 0.9, 95), n(43, 4.4, 0.9)],
      expect: [n(45, 0.5, 0.9), n(57, 0.5, 0.9), n(41, 1.8, 0.9), n(53, 1.8, 0.9), n(36, 3.1, 0.9), n(48, 3.1, 0.9), n(43, 4.4, 0.9), n(55, 4.4, 0.9)],
    },
    { name: 'hiss only', notes: [], seconds: 8, room: HISS, expect: [] },
    { name: 'hiss, chord expected', notes: [], seconds: 8, room: HISS, expect: Array.from({ length: 27 }, (_, i) => CHORDS[0].map((p) => n(p, i * 0.3, 0.3))).flat() },
    { name: 'hiss soft', notes: [45, 50, 55, 60, 62, 64, 67, 69, 72, 76, 79, 84].map((p, i) => n(p, 0.8 + i * 0.6, 0.5, 26 + (i % 4) * 4)), room: HISS },
    { name: 'hiss far mic', notes: MELODY.map((m) => ({ ...m, at: m.at + 0.4 })), gain: 0.1, room: HISS },
    { name: 'hiss chords', notes: chords(CHORDS, 0.8), room: HISS },
    { name: 'room melody', notes: MELODY, room: ROOM },
    { name: 'room soft', notes: [45, 50, 55, 60, 62, 64, 67, 69, 72, 76, 79, 84].map((p, i) => n(p, 0.5 + i * 0.6, 0.5, 26 + (i % 4) * 4)), room: ROOM },
    { name: 'room chords', notes: played, room: ROOM },
    {
      name: 'room pedal',
      notes: [n(36, 0.8, 5.5, 105), n(43, 0.8, 5.5, 100), ...[76, 74, 72, 67, 69, 71, 72].map((p, i) => n(p, 1.6 + i * 0.55, 0.45, 48))],
      room: ROOM,
    },
  ];
}

/** Plays one scenario through the detector and compares what it heard with what was played. */
export async function runScenario(sc: Scenario): Promise<BenchResult> {
  await resumeAudio();
  await piano.loadAll();
  const sr = 48000;
  const end = sc.notes.length ? Math.max(...sc.notes.map((x) => x.at + x.dur)) + 1.5 : (sc.seconds ?? 8);
  const off = new OfflineAudioContext(1, Math.ceil(end * sr), sr);
  const out = off.createGain();
  out.gain.value = sc.gain ?? 1;
  out.connect(off.destination);
  // Every real microphone has a little noise (here about -90 dB); perfectly silent audio is unrealistic.
  const room = sc.room ?? { reverb: 0, noise: 0, hiss: 5e-5 };
  if (room) {
    // Reverb: an exponentially decaying noise tail (RT60 ~0.7 s), plus steady background noise.
    const ir = off.createBuffer(1, Math.round(sr * 0.9), sr);
    const d = ir.getChannelData(0);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < d.length; i++) d[i] = rnd() * Math.exp((-6.9 * i) / (sr * 0.7)) * 0.08;
    const conv = off.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const wet = off.createGain();
    wet.gain.value = room.reverb;
    out.connect(conv).connect(wet).connect(off.destination);
    const noise = off.createBuffer(1, Math.ceil(end * sr), sr);
    const nd = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < nd.length; i++) {
      b = 0.97 * b + 0.03 * rnd(); // soft, rumbly room noise
      nd[i] = b * room.noise * 6 + rnd() * (room.hiss ?? 0);
    }
    const src = off.createBufferSource();
    src.buffer = noise;
    src.connect(off.destination);
    src.start(0);
  }
  for (const x of sc.notes) piano.renderNote(off, out, x.pitch, x.vel, x.at, x.dur);
  const buffer = await off.startRendering();

  const expect = sc.expect === undefined ? sc.notes : sc.expect;
  stopMic();
  const heard: Array<{ pitch: number; time: number }> = [];
  const unsub = inputHub.onNote((x) => {
    if (x.source === 'mic') heard.push({ pitch: x.pitch, time: x.time });
  });
  inputHub.expectation = expect
    ? (time) => {
        const t = (time - micTestOrigin()) / 1000;
        return new Set(expect.filter((x) => Math.abs(x.at - t) < 0.35).map((x) => x.pitch));
      }
    : null;
  await startMic({ testBuffer: buffer });
  await new Promise((r) => setTimeout(r, end * 1000 + 1200));
  unsub();
  stopMic();
  inputHub.expectation = null;

  const origin = micTestOrigin();
  const det = heard.map((h) => ({ pitch: h.pitch, at: (h.time - origin) / 1000 }));
  // Line the clocks up by the median offset of same-pitch pairs.
  const offsets = det
    .map((d) => {
      const m = sc.notes.find((x) => x.pitch === d.pitch && Math.abs(x.at - d.at) < 0.25);
      return m ? d.at - m.at : null;
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const shift = offsets.length ? offsets[offsets.length >> 1] : 0;
  const used = new Set<number>();
  const errs: number[] = [];
  const missed: string[] = [];
  for (const x of sc.notes) {
    const i = det.findIndex((d, k) => !used.has(k) && d.pitch === x.pitch && Math.abs(d.at - shift - x.at) < 0.12);
    if (i < 0) missed.push(`${nm(x.pitch)}@${x.at.toFixed(2)}`);
    else {
      used.add(i);
      errs.push(Math.abs(det[i].at - shift - x.at) * 1000);
    }
  }
  const extras = det.filter((_, k) => !used.has(k));
  const imaginedNotes = (expect ?? []).filter((e) => !sc.notes.some((x) => x.pitch === e.pitch && Math.abs(x.at - e.at) < 0.05));
  const imagined = extras.filter((d) => imaginedNotes.some((e) => e.pitch === d.pitch && Math.abs(d.at - shift - e.at) < 0.15));
  return {
    name: sc.name,
    played: sc.notes.length,
    hits: used.size,
    missed,
    extra: extras.filter((d) => !imagined.includes(d)).map((d) => `${nm(d.pitch)}@${(d.at - shift).toFixed(2)}`),
    imagined: imagined.map((d) => `${nm(d.pitch)}@${(d.at - shift).toFixed(2)}`),
    meanAbsOffsetMs: errs.length ? Math.round(errs.reduce((a, b) => a + b, 0) / errs.length) : null,
    heard: det.map((d) => `${nm(d.pitch)}@${(d.at - shift).toFixed(3)}`),
  };
}

export async function runAll(only?: string[]): Promise<BenchResult[]> {
  const results: BenchResult[] = [];
  for (const sc of scenarios()) if (!only || only.includes(sc.name)) results.push(await runScenario(sc));
  return results;
}

/** Raw model output around the onsets of a few test notes (to tune the overtone rules). */
export async function probe(notes: BenchNote[], watch: number[]): Promise<Array<{ t: number; pitch: number; onset: number; frame: number }>> {
  const { setMicDebug } = await import('./mic');
  const rows: Array<{ t: number; pitch: number; onset: number; frame: number }> = [];
  setMicDebug((x) => {
    if (watch.includes(x.pitch)) rows.push({ t: (x.time - micTestOrigin()) / 1000, pitch: x.pitch, onset: +x.onset.toFixed(2), frame: +x.frame.toFixed(2) });
  });
  await runScenario({ name: 'probe', notes, expect: null });
  setMicDebug(null);
  return rows;
}
