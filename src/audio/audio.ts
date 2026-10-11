let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buses = new Map<Bus, GainNode>();

export type Bus = 'echo' | 'accomp' | 'metronome';

export function audioCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  return ctx;
}

export function bus(name: Bus): GainNode {
  let g = buses.get(name);
  if (!g) {
    const c = audioCtx();
    g = c.createGain();
    g.connect(master!);
    buses.set(name, g);
  }
  return g;
}

export function setBusVolume(name: Bus, volume: number): void {
  bus(name).gain.value = volume;
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
