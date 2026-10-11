import type * as TF from '@tensorflow/tfjs';
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

const SR = 22050;
const N_SAMPLES = SR * 2 - 256; // model window, 43 844 samples
const FFT_HOP = 256;
const HOP_MS = 128;
const EDGE_FRAMES = 9; // frames at the right edge the model can't judge yet (~100 ms)
const MIN_PITCH = 21;
const REFRACTORY_MS = 90;
const OFF_FRAMES = 3;

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
let tf: typeof TF | null = null;
let model: TF.GraphModel | null = null;

async function loadModel(): Promise<void> {
  if (model) return;
  tf = await import('@tensorflow/tfjs');
  try {
    await tf.setBackend('webgl');
  } catch {
    await tf.setBackend('cpu');
  }
  await tf.ready();
  model = await tf.loadGraphModel(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`);
  // Warm-up so the first real window isn't slow.
  const warm = tf.zeros([1, N_SAMPLES, 1]);
  const out = model.execute(warm, ['Identity_1', 'Identity_2']) as TF.Tensor[];
  await Promise.all(out.map((t) => t.data()));
  out.forEach((t) => t.dispose());
  warm.dispose();
}

/** Detector state over the stream of 22 050 Hz samples. */
class Detector {
  ring = new Float32Array(N_SAMPLES);
  total = 0; // samples received
  processedUpTo = 0; // stream sample index up to which frames have been analysed
  active = new Map<number, { since: number; low: number }>();
  lastOnset = new Map<number, number>();
  busy = false;

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
  const P = 88;
  const lastFrame = nFrames - 1 - EDGE_FRAMES;
  const at = (arr: Float32Array, f: number, k: number) => arr[f * P + k];

  for (let f = 1; f <= lastFrame; f++) {
    const sample = windowStart + f * FFT_HOP;
    if (sample < d.processedUpTo || sample < 0) continue;
    const time = perfOfSample(sample) - settings.micLatency;

    // Onsets: local peaks of the onset curve with the note actually sounding.
    const found: Array<{ k: number; o: number }> = [];
    for (let k = 0; k < P; k++) {
      const o = at(onsets, f, k);
      if (o < onsetThresh) continue;
      if (o < at(onsets, f - 1, k) || o < at(onsets, f + 1, k)) continue;
      const sounding = Math.max(at(frames, f, k), at(frames, f + 1, k), at(frames, Math.min(nFrames - 1, f + 2), k));
      if (sounding < frameThresh) continue;
      found.push({ k, o });
    }
    // Drop overtones (octave, twelfth, double octave) that are weaker than a note found below them.
    const keep = found.filter(
      ({ k, o }) => !found.some((g) => (k - g.k === 12 || k - g.k === 19 || k - g.k === 24) && g.o > o * 1.1),
    );
    for (const { k, o } of keep) {
      const pitch = k + MIN_PITCH;
      const prev = d.lastOnset.get(pitch);
      if (prev !== undefined && time - prev < REFRACTORY_MS) continue;
      if (isAppSound(pitch, time)) continue;
      d.lastOnset.set(pitch, time);
      if (d.active.has(pitch)) inputHub.noteOff(pitch, time, 'mic');
      d.active.set(pitch, { since: time, low: 0 });
      const velocity = Math.round(Math.max(20, Math.min(120, 30 + o * 70 + at(frames, f, k) * 20)));
      inputHub.noteOn({ pitch, velocity, time, source: 'mic' });
    }
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
