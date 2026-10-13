import type * as TF from '@tensorflow/tfjs';
import { FFT_HOP, loadBasicPitch, SAMPLE_RATE as SR, WINDOW_SAMPLES as N_SAMPLES, type LoadedModel } from '../../ai/basicPitch';
import { isAppSound } from '../../audio/appSounds';
import { getSettings } from '../../store/settings';
import { inputHub } from '../hub';
import { Resampler } from './resampler';

/*
 * Real-time polyphonic note detection with Spotify's Basic Pitch model (Apache-2.0), run in the browser.
 * Every HOP_MS the last two seconds of 22 050 Hz audio go through the model; new note onsets in the
 * window (minus a small right-hand margin the model needs for context) become key presses with their
 * true timestamps, so timing judgments stay accurate even though detection lags by ~0.25 s.
 */

const HOP_MS = 128;
const EDGE_FRAMES = 9; // frames at the right edge the model can't judge yet (~100 ms)
const MIN_PITCH = 21;
const REFRACTORY_MS = 90;
const RESTRIKE_MS = 150;
const WARMUP_SEC = 0.5;
const FRAMES_PER_SEC = Math.round(SR / FFT_HOP);
const FLOOR_RISE = Math.pow(10, 1 / 20 / (2 * FRAMES_PER_SEC));
/** A note must be this much louder than the room's background (6 dB) to count. */
const NOISE_GATE = 2;
const OFF_FRAMES = 3;
const RECHECK_FRAMES = 4;
const NONE: ReadonlySet<number> = new Set();

export interface MicState {
  state: 'off' | 'loading' | 'on' | 'error';
  error?: string;
  level: number;
  backend?: string;
  latencyMs: number;
}

let state: MicState = { state: 'off', level: 0, latencyMs: 0 };
const listeners = new Set<() => void>();
function publish(next: Partial<MicState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
export function micState(): MicState {
  return state;
}
export function onMicState(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Expected delay between striking a key and the detector reporting it. */
const DETECTION_LAG_MS = HOP_MS + EDGE_FRAMES * ((FFT_HOP / SR) * 1000) + 60;

export function micLag(): number {
  return state.state === 'on' ? DETECTION_LAG_MS : 0;
}

const WORKLET = `
class PianistCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage({ samples: this.buf, endFrame: currentFrame + i + 1 }, [this.buf.buffer]);
          this.buf = new Float32Array(1024);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pianist-capture', PianistCapture);
`;

interface Engine {
  ctx: AudioContext;
  stream: MediaStream | null;
  node: AudioWorkletNode;
  source: AudioNode;
  timer: number;
  stop: () => void;
}

let engine: Engine | null = null;
let tf: LoadedModel['tf'] | null = null;
let model: LoadedModel['model'] | null = null;

async function loadModel(): Promise<void> {
  ({ tf, model } = await loadBasicPitch());
}

/** Detector state over the stream of 22 050 Hz samples. */
class Detector {
  ring = new Float32Array(N_SAMPLES);
  total = 0; // samples received
  processedUpTo = 0; // stream sample index up to which frames have been analysed
  active = new Map<number, { since: number; low: number }>();
  lastOnset = new Map<number, number>();
  busy = false;
  /** Loudness of the last second of frames. */
  recentLoud = new Float32Array(FRAMES_PER_SEC);
  recentCount = 0;
  /**
   * The room's background level. It follows quiet moments down at once but rises only slowly
   * (about 1 dB every 2 s), so ringing notes don't raise it but a fan switched on is learnt in a while.
   */
  floor = -1;

  addLoudness(rms: number) {
    // Perfect silence is a microphone that isn't delivering yet (or is muted), not the room.
    if (rms < 1e-7) return;
    this.recentLoud[this.recentCount++ % FRAMES_PER_SEC] = rms;
    const n = Math.min(this.recentCount, FRAMES_PER_SEC);
    // Half a second of the room first; the frames where the microphone was just starting are among the quietest
    // tenth and so don't drag the estimate down.
    if (n < FRAMES_PER_SEC / 2) return;
    // The quietest tenth of the last second (a single dropout frame doesn't count).
    const quiet = this.recentLoud.slice(0, n).sort()[Math.floor(n * 0.1)];
    this.floor = this.floor < 0 ? quiet : Math.min(quiet, this.floor * FLOOR_RISE);
  }

  push(x: Float32Array) {
    if (x.length >= N_SAMPLES) {
      this.ring.set(x.subarray(x.length - N_SAMPLES));
    } else {
      this.ring.copyWithin(0, x.length);
      this.ring.set(x, N_SAMPLES - x.length);
    }
    this.total += x.length;
  }

  level(): number {
    let sum = 0;
    const n = 2048;
    for (let i = N_SAMPLES - n; i < N_SAMPLES; i++) sum += this.ring[i] * this.ring[i];
    return Math.sqrt(sum / n);
  }
}

let detector = new Detector();

/** Development hook: receives raw model activations. */
let debugSink: ((x: { time: number; pitch: number; onset: number; frame: number }) => void) | null = null;
export function setMicDebug(sink: typeof debugSink): void {
  debugSink = sink;
}

/** Receives the microphone audio (22 050 Hz mono) as it arrives, e.g. to record the check-up. */
let tap: ((samples: Float32Array) => void) | null = null;
export function setMicTap(t: typeof tap): void {
  tap = t;
}
/** Samples received since the microphone started. */
export function micSampleCount(): number {
  return detector.total;
}

/** performance.now() time at which a test buffer starts playing into the detector. */
let testOrigin = 0;
export function micTestOrigin(): number {
  return testOrigin;
}

/** Maps a stream sample index to performance.now() time. */
let clockRef = { sample: 0, perf: 0 };

function perfOfSample(sample: number): number {
  return clockRef.perf - ((clockRef.sample - sample) / SR) * 1000;
}

async function analyse() {
  if (!model || !tf || detector.busy) return;
  const d = detector;
  const windowEnd = d.total;
  const windowStart = windowEnd - N_SAMPLES;
  if (windowEnd - d.processedUpTo < (SR * HOP_MS) / 1000 / 2) return;
  d.busy = true;
  const audio = d.ring.slice();
  const tfl = tf;
  let frames: Float32Array;
  let onsets: Float32Array;
  let nFrames: number;
  try {
    const input = tfl.tensor3d(audio, [1, N_SAMPLES, 1]);
    const out = model.execute(input, ['Identity_1', 'Identity_2']) as TF.Tensor[];
    nFrames = out[0].shape[1]!;
    [frames, onsets] = (await Promise.all(out.map((t) => t.data()))) as [Float32Array, Float32Array];
    input.dispose();
    out.forEach((t) => t.dispose());
  } catch (err) {
    d.busy = false;
    publish({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    return;
  }
  d.busy = false;

  const settings = getSettings();
  const s = settings.micSensitivity;
  const onsetThresh = 0.62 - 0.3 * s;
  const frameThresh = 0.4 - 0.18 * s;
  const offThresh = frameThresh * 0.6;
  // While a piece is being practised, the notes it expects need less evidence and anything else a little more,
  // so soft notes and inner chord notes come through and stray overtones don't.
  const expectation = inputHub.expectation;
  const expOnset = Math.max(0.2, onsetThresh - 0.18);
  const expFrame = Math.max(0.12, frameThresh - 0.12);
  const otherOnset = expectation ? onsetThresh + 0.05 : onsetThresh;
  const otherFrame = expectation ? frameThresh + 0.03 : frameThresh;
  const P = 88;
  const lastFrame = nFrames - 1 - EDGE_FRAMES;
  // Loudness of every frame (without any constant offset the microphone may add).
  let mean = 0;
  for (let i = 0; i < N_SAMPLES; i++) mean += audio[i];
  mean /= N_SAMPLES;
  const loud = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    const a = Math.max(0, f * FFT_HOP - FFT_HOP);
    const b = Math.min(N_SAMPLES, f * FFT_HOP + 2 * FFT_HOP);
    for (let i = a; i < b; i++) sum += (audio[i] - mean) * (audio[i] - mean);
    loud[f] = b > a ? Math.sqrt(sum / (b - a)) : 0;
  }
  for (let f = 0; f <= lastFrame; f++) if (windowStart + f * FFT_HOP >= d.processedUpTo) d.addLoudness(loud[f]);
  // Microphone hiss can look like notes to the model: whatever isn't clearly louder than the room is ignored.
  // Until the room has been heard, nothing counts (the first half second after the microphone starts).
  const gate = d.floor < 0 ? Infinity : d.floor * NOISE_GATE;
  const audible = (f: number) => {
    let m = 0;
    for (let g = f; g <= Math.min(nFrames - 1, f + 3); g++) m = Math.max(m, loud[g]);
    return m >= gate;
  };
  const at = (arr: Float32Array, f: number, k: number) => arr[f * P + k];

  const peakOver = (arr: Float32Array, k: number, from: number, to: number) => {
    let m = 0;
    for (let g = Math.max(0, from); g <= Math.min(nFrames - 1, to); g++) m = Math.max(m, at(arr, g, k));
    return m;
  };
  /*
   * Overtones: a note struck at the same moment, or still ringing under the sustain pedal, makes its
   * harmonics sound too. They are weaker than the note itself; a real note played on top is louder
   * relative to its partner. Below C3 an octave overtone is nearly as strong as a played octave, so an
   * expected octave gets the benefit of the doubt there.
   */
  const OVERTONES: Array<[interval: number, maxRatio: number]> = [
    [12, 0.6],
    [19, 0.45],
    [24, 0.45],
    [28, 0.35],
    [31, 0.35],
  ];
  const isOvertone = (f: number, k: number, level: number, onset: number, expected: boolean) =>
    OVERTONES.some(([iv, ratio]) => {
      const lk = k - iv;
      if (lk < 0) return false;
      const struckTogether = peakOver(onsets, lk, f - 3, f + 3) >= 0.45;
      const ringing = d.active.has(lk + MIN_PITCH) && onset < 0.7;
      if (!struckTogether && !ringing) return false;
      const lowLevel = peakOver(frames, lk, f, f + 3);
      if (lowLevel <= 0) return false;
      // Below middle C the octave overtone can even outshine its note; unexpected, it must strike harder.
      if (!expected && expectation && iv === 12 && lk + MIN_PITCH < 60 && struckTogether && onset <= peakOver(onsets, lk, f - 3, f + 3)) return true;
      // Not expected while practising: an octave over a struck note must be clearly louder than it to count.
      const strict = iv === 12 ? 1.2 : ratio * 2;
      const limit = expected ? (iv === 12 && lk + MIN_PITCH < 48 ? 0 : ratio * 0.75) : expectation ? strict : ratio;
      return level / lowLevel < limit;
    });

  const emit = (pitch: number, time: number, o: number, level: number) => {
    d.lastOnset.set(pitch, time);
    if (d.active.has(pitch)) inputHub.noteOff(pitch, time, 'mic');
    d.active.set(pitch, { since: time, low: 0 });
    const velocity = Math.round(Math.max(20, Math.min(120, 30 + o * 70 + level * 20)));
    inputHub.noteOn({ pitch, velocity, time, source: 'mic' });
  };
  // The same key again: a note that is still sounding needs a clear gap before it counts as struck again
  // (otherwise one long low note can be heard twice as the model's view of it shifts between windows).
  const recent = (pitch: number, time: number) => {
    const prev = d.lastOnset.get(pitch);
    return prev !== undefined && Math.abs(time - prev) < (d.active.has(pitch) || pitch < 48 ? RESTRIKE_MS : REFRACTORY_MS);
  };
  const appSound = (pitch: number, time: number) => !settings.headphones && isAppSound(pitch, time);

  for (let f = 1; f <= lastFrame; f++) {
    const sample = windowStart + f * FFT_HOP;
    // Frames near the previous window's edge are checked again: the model sees them better with more context.
    if (sample < d.processedUpTo - RECHECK_FRAMES * FFT_HOP || sample < 0) continue;
    // The first moments after the microphone starts are a jump from silence: nothing to hear yet.
    if (sample < SR * WARMUP_SEC) continue;
    const fresh = sample >= d.processedUpTo;
    const time = perfOfSample(sample) - settings.micLatency;
    if (debugSink && fresh) {
      for (let k = 0; k < P; k++) {
        const o = at(onsets, f, k);
        if (o > 0.15) debugSink({ time, pitch: k + MIN_PITCH, onset: o, frame: at(frames, f, k) });
      }
    }
    const expected = expectation ? expectation(time) : NONE;

    // Onsets: local peaks of the onset curve with the note actually sounding.
    let struck = false;
    for (let k = 0; k < P; k++) {
      const pitch = k + MIN_PITCH;
      const exp = expected.has(pitch);
      const o = at(onsets, f, k);
      if (o < (exp ? expOnset : otherOnset) || !audible(f)) continue;
      if (o < peakOver(onsets, k, f - 2, f - 1) || o < peakOver(onsets, k, f + 1, f + 2)) continue;
      // The model's view of an attack can swell a little before the real one: wait for the stronger peak.
      if (o < 0.6 * peakOver(onsets, k, f + 3, f + 8)) continue;
      const level = peakOver(frames, k, f, f + 3);
      if (level < (exp ? expFrame : otherFrame) || isOvertone(f, k, level, o, exp)) continue;
      // A note that is still ringing only counts again when it really got louder (struck again).
      if (d.active.has(pitch) && o < 0.75 && level < 1.15 * peakOver(frames, k, f - 5, f - 2)) continue;
      if (recent(pitch, time) || appSound(pitch, time)) continue;
      emit(pitch, time, o, level);
      struck = true;
    }
    // Chords: an expected note that starts sounding with the others counts even when its own onset is faint.
    if (struck && expected.size && audible(f)) {
      for (const pitch of expected) {
        const k = pitch - MIN_PITCH;
        if (k < 0 || k >= P || d.active.has(pitch) || recent(pitch, time)) continue;
        const before = peakOver(frames, k, f - 6, f - 2);
        const after = peakOver(frames, k, f, f + 4);
        const o = peakOver(onsets, k, f - 2, f + 2);
        if (after < expFrame || after < before * 1.5 + 0.05 || o < 0.12) continue;
        if (isOvertone(f, k, after, o, true) || appSound(pitch, time)) continue;
        emit(pitch, time, o, after);
      }
    }
    if (!fresh) continue;
    // Releases: the note's frame activation stays low for a few frames.
    for (const [pitch, a] of d.active) {
      const k = pitch - MIN_PITCH;
      if (at(frames, f, k) < offThresh) {
        a.low++;
        if (a.low >= OFF_FRAMES) {
          d.active.delete(pitch);
          inputHub.noteOff(pitch, time, 'mic');
        }
      } else a.low = 0;
    }
  }
  d.processedUpTo = Math.max(d.processedUpTo, windowStart + (lastFrame + 1) * FFT_HOP);
}

export interface MicOptions {
  /** Feed this buffer instead of the microphone (used to test the detector without a piano). */
  testBuffer?: AudioBuffer;
}

export async function startMic(opts: MicOptions = {}): Promise<void> {
  if (engine) return;
  publish({ state: 'loading', error: undefined });
  try {
    const modelReady = loadModel();
    const stream = opts.testBuffer
      ? null
      : await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: opts.testBuffer?.sampleRate });
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    await modelReady;

    detector = new Detector();
    clockRef = { sample: 0, perf: performance.now() };
    const resampler = new Resampler(ctx.sampleRate, SR);
    const node = new AudioWorkletNode(ctx, 'pianist-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    let source: AudioNode;
    if (opts.testBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = opts.testBuffer;
      src.connect(ctx.destination);
      src.start(ctx.currentTime + 0.05);
      testOrigin = performance.now() + 50;
      source = src;
    } else {
      source = ctx.createMediaStreamSource(stream!);
    }
    source.connect(node);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);

    const inputLatency = ((stream?.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0.01) * 1000;
    let lastLevel = 0;
    node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; endFrame: number }>) => {
      const out = resampler.push(e.data.samples);
      detector.push(out);
      tap?.(out);
      // The last sample in this block was captured (endFrame - now) ago, plus the device's input latency.
      const lagSec = ctx.currentTime - e.data.endFrame / ctx.sampleRate;
      clockRef = { sample: detector.total, perf: performance.now() - Math.max(0, lagSec) * 1000 - inputLatency };
      const now = performance.now();
      if (now - lastLevel > 100) {
        lastLevel = now;
        publish({ level: detector.level() });
      }
    };
    const timer = window.setInterval(() => void analyse(), HOP_MS);
    engine = {
      ctx,
      stream,
      node,
      source,
      timer,
      stop: () => {
        window.clearInterval(timer);
        node.port.onmessage = null;
        stream?.getTracks().forEach((t) => t.stop());
        void ctx.close();
        inputHub.releaseAll('mic');
      },
    };
    publish({ state: 'on', backend: tf?.getBackend(), latencyMs: DETECTION_LAG_MS });
  } catch (err) {
    engine = null;
    const msg =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone permission was refused.'
        : err instanceof Error
          ? err.message
          : String(err);
    publish({ state: 'error', error: msg });
  }
}

export function stopMic(): void {
  engine?.stop();
  engine = null;
  publish({ state: 'off', level: 0 });
}
