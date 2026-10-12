let ctx: AudioContext | null = null;
let master: GainNode | null = null; // instrument sounds (echo, accompaniment, guide)
let out: DynamicsCompressorNode | null = null; // final stage before the speakers
let tone: BiquadFilterNode | null = null; // colours the piano sound
let wet: GainNode | null = null; // reverb level
const buses = new Map<Bus, GainNode>();

export type Bus = 'echo' | 'accomp' | 'metronome' | 'guide';
export type PianoSound = 'grand' | 'bright' | 'mellow' | 'electric';

/** A generated room: stereo noise decaying over about two seconds. */
function impulse(c: AudioContext): AudioBuffer {
  const len = Math.round(c.sampleRate * 2.2);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * (i < 200 ? i / 200 : 1);
  }
  return buf;
}

export function audioCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    out = ctx.createDynamicsCompressor();
    out.threshold.value = -10;
    out.ratio.value = 4;
    out.connect(ctx.destination);
    // instruments → tone filter → master → (dry + reverb) → compressor
    tone = ctx.createBiquadFilter();
    tone.type = 'highshelf';
    tone.frequency.value = 3000;
    tone.gain.value = 0;
    master = ctx.createGain();
    master.gain.value = 0.9;
    tone.connect(master);
    master.connect(out);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.15;
    master.connect(verb).connect(wet).connect(out);
  }
  return ctx;
}

export function bus(name: Bus): GainNode {
  let g = buses.get(name);
  if (!g) {
    audioCtx();
    g = ctx!.createGain();
    // The metronome stays dry and uncoloured.
    g.connect(name === 'metronome' ? out! : tone!);
    buses.set(name, g);
  }
  return g;
}

export function setBusVolume(name: Bus, volume: number): void {
  bus(name).gain.value = volume;
}

/** Piano colour and room reverb (0–0.6). */
export function setSound(sound: PianoSound, reverb: number): void {
  audioCtx();
  const t = tone!;
  if (sound === 'bright') {
    t.type = 'highshelf';
    t.frequency.value = 2500;
    t.gain.value = 6;
  } else if (sound === 'mellow') {
    t.type = 'lowpass';
    t.frequency.value = 2200;
    t.Q.value = 0.5;
  } else {
    t.type = 'highshelf';
    t.frequency.value = 3000;
    t.gain.value = 0;
  }
  wet!.gain.value = Math.max(0, Math.min(0.6, reverb));
}

/** Must be called from a user gesture before anything is audible. */
export async function resumeAudio(): Promise<void> {
  const c = audioCtx();
  if (c.state !== 'running') await c.resume();
}

/** Converts a performance.now() timestamp to AudioContext time, so sound lines up with what is on screen. */
export function perfToAudio(perfMs: number): number {
  const c = audioCtx();
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.performanceTime && ts.contextTime !== undefined) {
    return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  return c.currentTime + (perfMs - performance.now()) / 1000;
}

/** Roughly when (performance.now ms) a sound scheduled at AudioContext time `t` comes out of the speakers. */
export function audioToPerf(t: number): number {
  const c = audioCtx();
  const latency = (c.outputLatency || 0) + (c.baseLatency || 0);
  return performance.now() + (t - c.currentTime + latency) * 1000;
}
