import { songToMusicXml } from './musicxml';
import { finalizeSong, measureLength } from './song';
import { tidyDurations } from './tidy';
import type { Hand, Note, Song } from './types';

/** A note heard in an audio file, in seconds (as Basic Pitch reports it). */
export interface HeardNote {
  start: number;
  dur: number;
  pitch: number;
  amplitude: number; // 0–1
}

export interface BeatGrid {
  bpm: number;
  phase: number; // seconds: time of a beat
  confidence: number; // 0–1
}

const ENV_RATE = 100; // onset envelope frames per second

/**
 * Estimates tempo and beat phase from note onsets: autocorrelation of an onset envelope with a
 * preference for moderate tempos, then a fine search that lines a beat comb up with the onsets.
 */
export function estimateBeat(notes: HeardNote[], minBpm = 50, maxBpm = 200): BeatGrid {
  if (notes.length < 4) return { bpm: 100, phase: notes[0]?.start ?? 0, confidence: 0 };
  const end = Math.max(...notes.map((n) => n.start)) + 2;
  const len = Math.ceil(end * ENV_RATE);
  const env = new Float32Array(len);
  for (const n of notes) {
    const i = Math.round(n.start * ENV_RATE);
    // Bass notes mark the beat more reliably than ornaments.
    const w = Math.sqrt(n.amplitude) * (n.pitch < 55 ? 1.5 : 1);
    for (let d = -2; d <= 2; d++) if (i + d >= 0 && i + d < len) env[i + d] += w * Math.exp(-(d * d) / 2);
  }
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < len; i++) s += env[i] * env[i + lag];
    return s;
  };
  let bestLag = 60;
  let bestScore = -Infinity;
  const lagMin = Math.floor((60 / maxBpm) * ENV_RATE);
  const lagMax = Math.ceil((60 / minBpm) * ENV_RATE);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * ENV_RATE) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 105) / 0.9) ** 2);
    const score = (ac(lag) + 0.5 * ac(2 * lag)) * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // Fine tune: strongest alignment (circular statistics) within ±4 % of the coarse tempo.
  const coarse = (60 * ENV_RATE) / bestLag;
  let best: BeatGrid = { bpm: coarse, phase: 0, confidence: 0 };
  const total = notes.reduce((a, n) => a + Math.sqrt(n.amplitude), 0);
  for (let bpm = coarse * 0.96; bpm <= coarse * 1.04; bpm += 0.05) {
    const period = 60 / bpm;
    let c = 0;
    let s = 0;
    for (const n of notes) {
      const w = Math.sqrt(n.amplitude);
      const a = (2 * Math.PI * n.start) / period;
      c += w * Math.cos(a);
      s += w * Math.sin(a);
    }
    const r = Math.hypot(c, s) / total;
    if (r > best.confidence) {
      let phase = (Math.atan2(s, c) / (2 * Math.PI)) * period;
      if (phase < 0) phase += period;
      best = { bpm, phase, confidence: r };
    }
  }
  best.bpm = Math.round(best.bpm * 10) / 10;
  return best;
}

/**
 * Removes overtones the detector reports as notes: a much quieter note an octave, a twelfth or two
 * octaves above a note struck at the same moment. Real octaves are played at similar loudness.
 */
export function dropOvertones(notes: HeardNote[], ratio = 0.6): HeardNote[] {
  return notes.filter(
    (n) =>
      !notes.some(
        (m) => m !== n && Math.abs(m.start - n.start) < 0.08 && [12, 19, 24].includes(n.pitch - m.pitch) && n.amplitude < ratio * m.amplitude,
      ),
  );
}

export type Simplify = 'all' | 'melody-bass' | 'melody';

/** Where the beats fall at a chosen tempo: the detected phase, or realigned when the tempo was changed. */
export function phaseAt(heard: HeardNote[], beat: BeatGrid, bpm: number): number {
  if (!heard.length) return 0;
  if (Math.abs(bpm - beat.bpm) < 0.01) return beat.phase;
  const period = 60 / bpm;
  let c = 0;
  let s = 0;
  for (const n of heard) {
    const a = (2 * Math.PI * n.start) / period;
    c += Math.sqrt(n.amplitude) * Math.cos(a);
    s += Math.sqrt(n.amplitude) * Math.sin(a);
  }
  const p = (Math.atan2(s, c) / (2 * Math.PI)) * period;
  return p < 0 ? p + period : p;
}

export interface ArrangeOptions {
  title: string;
  bpm: number;
  phase: number; // seconds, time of any beat
  timeSig: [number, number];
  split: number; // MIDI pitch: notes at or above go to the right hand
  grid: number; // subdivisions per beat for quantizing
  simplify: Simplify;
  maxPerHand: number;
}

/** Turns heard notes into a practisable song: beat grid, bar lines, hands, quantized rhythm. */
export function arrangeSong(heard: HeardNote[], o: ArrangeOptions): Song | null {
  if (!heard.length) return null;
  const period = 60 / o.bpm;
  // beats per bar in quarter-note beats → number of grid beats per bar (the detected beat is a quarter)
  const barBeats = measureLength(o.timeSig);
  const beatsPerBar = Math.max(1, Math.round(barBeats));
  const first = Math.min(...heard.map((n) => n.start));
  // Index of the first beat that has music (a slightly early note still belongs to its beat).
  const firstBeat = Math.floor((first - o.phase) / period + 0.25);
  const beatTime = (k: number) => o.phase + k * period;

  // Downbeats: the bar alignment with the most (bass-weighted) energy on beat one.
  const weightOnBeat = new Array(beatsPerBar).fill(0);
  for (const n of heard) {
    const k = Math.round((n.start - o.phase) / period);
    if (Math.abs(n.start - beatTime(k)) > period * 0.2) continue;
    weightOnBeat[((k % beatsPerBar) + beatsPerBar) % beatsPerBar] += n.amplitude * (n.pitch < 55 ? 2 : 1);
  }
  const downClass = weightOnBeat.indexOf(Math.max(...weightOnBeat));
  let firstDown = firstBeat;
  while (((firstDown % beatsPerBar) + beatsPerBar) % beatsPerBar !== downClass) firstDown++;
  const pickup = firstDown - firstBeat;

  const toBeat = (t: number) => (t - beatTime(firstBeat)) / period;
  const q = (b: number) => Math.round(b * o.grid) / o.grid;

  let notes: Array<Omit<Note, 'id' | 'measure'>> = heard
    .map((n) => {
      const start = Math.max(0, q(toBeat(n.start)));
      const dur = Math.max(1 / o.grid, q(n.dur / period));
      const hand: Hand = n.pitch >= o.split ? 'R' : 'L';
      return { pitch: n.pitch, start, dur, hand, velocity: Math.round(Math.max(20, Math.min(120, 30 + n.amplitude * 90))) };
    })
    .filter((n) => n.pitch >= 21 && n.pitch <= 108);

  // One note per pitch per grid point (keep the longest).
  const byKey = new Map<string, (typeof notes)[number]>();
  for (const n of notes) {
    const k = `${n.pitch}@${n.start}`;
    const p = byKey.get(k);
    if (!p || p.dur < n.dur) byKey.set(k, n);
  }
  notes = [...byKey.values()];

  // Simplify: keep the top line (melody) and optionally the bottom line (bass) at every onset.
  const onsets = new Map<number, typeof notes>();
  for (const n of notes) {
    const list = onsets.get(n.start) ?? [];
    list.push(n);
    onsets.set(n.start, list);
  }
  const kept: typeof notes = [];
  for (const group of onsets.values()) {
    group.sort((a, b) => b.pitch - a.pitch);
    if (o.simplify === 'all') {
      const rh = group.filter((n) => n.hand === 'R').slice(0, o.maxPerHand);
      const lh = group.filter((n) => n.hand === 'L').slice(-o.maxPerHand);
      kept.push(...rh, ...lh);
    } else {
      const top = group[0];
      kept.push({ ...top, hand: 'R' });
      if (o.simplify === 'melody-bass') {
        const bottom = group[group.length - 1];
        if (bottom !== top && bottom.pitch < o.split) kept.push({ ...bottom, hand: 'L' });
      }
    }
  }
  if (!kept.length) return null;

  // A final chord rings on in the recording; end everything with the bar the last note starts in.
  const pickupBeats = pickup > 0 ? pickup * (barBeats / beatsPerBar) : 0;
  const lastStart = Math.max(...kept.map((n) => n.start));
  const barEnd = pickupBeats + (Math.floor((lastStart - pickupBeats) / barBeats + 1e-6) + 1) * barBeats;
  const tidied = tidyDurations(kept, o.grid, { minGap: 0.5, ratio: 1 }).map((n) => ({
    ...n,
    dur: Math.max(1 / o.grid, Math.min(n.dur, barEnd - n.start)),
  }));

  const song = finalizeSong({
    id: `audio-${Date.now().toString(36)}`,
    title: o.title,
    composer: 'Transcribed from audio',
    level: 3,
    bpm: Math.round(o.bpm),
    timeSig: o.timeSig,
    keyFifths: guessKeyFifths(kept.map((n) => n.pitch)),
    pickup: pickupBeats,
    // Piano notes fade, so the detector ends long notes early; they are held like the sustain pedal would.
    notes: tidied,
    source: 'audio',
    createdAt: Date.now(),
  });
  song.scoreXml = songToMusicXml(song);
  return song;
}

// Krumhansl–Kessler major profile, used to pick the key signature that fits the notes best.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

export function guessKeyFifths(pitches: number[]): number {
  if (!pitches.length) return 0;
  const hist = new Array(12).fill(0);
  for (const p of pitches) hist[p % 12]++;
  let bestTonic = 0;
  let best = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += hist[(tonic + i) % 12] * MAJOR[i];
    if (s > best) {
      best = s;
      bestTonic = tonic;
    }
  }
  // tonic pitch class → fifths (C=0, G=1, D=2, … F=-1, Bb=-2 …), preferring flats for Db, Gb as 6 sharps are rare
  const fifths = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][bestTonic];
  return fifths === 6 ? -6 : fifths;
}
