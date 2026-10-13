import { audioCtx, audioToPerf, bus, type Bus } from './audio';
import { logAppSound } from './appSounds';

// Salamander Grand Piano samples (CC-BY 3.0, Alexander Holm), as hosted by the Tone.js project.
const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NAMES = ['C', 'Ds', 'Fs', 'A'];

function sampleList(): Array<{ pitch: number; file: string }> {
  const list = [{ pitch: 21, file: 'A0' }];
  for (let octave = 1; octave <= 7; octave++) {
    SAMPLE_NAMES.forEach((n, i) => list.push({ pitch: 12 * (octave + 1) + i * 3, file: `${n}${octave}` }));
  }
  list.push({ pitch: 108, file: 'C8' });
  return list;
}

/** Runs `fn` over `items`, at most `n` at a time, in order of the list. */
async function inPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * The recorded samples are stereo and ring for up to 25 seconds, which takes ~160 MB once decoded.
 * Mono and only as long as a held note can usefully sound (low strings ring longest) is ~25 MB.
 */
function compactSample(ctx: BaseAudioContext, buf: AudioBuffer, pitch: number): AudioBuffer {
  const maxSec = pitch < 48 ? 12 : pitch < 72 ? 8 : 5;
  const len = Math.min(buf.length, Math.round(maxSec * buf.sampleRate));
  const out = ctx.createBuffer(1, len, buf.sampleRate);
  const o = out.getChannelData(0);
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  let stereoEnergy = 0;
  let monoEnergy = 0;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const ch of chs) {
      sum += ch[i];
      stereoEnergy += ch[i] * ch[i];
    }
    o[i] = sum / chs.length;
    monoEnergy += o[i] * o[i];
  }
  // The two microphones don't line up exactly, so the mix is quieter than either one: level it back up.
  const lift = Math.min(1.5, Math.sqrt(stereoEnergy / chs.length / Math.max(1e-9, monoEnergy)));
  for (let i = 0; i < len; i++) o[i] *= lift;
  // Fade out the end so a cut-short note doesn't click.
  const fade = Math.min(len, Math.round(0.6 * buf.sampleRate));
  for (let i = 0; i < fade; i++) o[len - fade + i] *= 1 - (i + 1) / fade;
  return out;
}

interface Voice {
  pitch: number;
  stop: (when: number) => void;
  kill: () => void;
  bus: Bus;
  endAt: number; // Infinity while held
}

class PianoSampler {
  private buffers = new Map<number, AudioBuffer>();
  private loadPromise: Promise<void> | null = null;
  private voices = new Map<string, Voice[]>();
  private pedal = false;
  private sustained = new Set<Voice>();
  private scheduled = new Set<Voice>();
  loaded = false;
  loadError: string | null = null;
  /** The electric piano is synthesised; the other sounds use the grand-piano samples. */
  electric = false;

  private allPromise: Promise<void> | null = null;

  /**
   * Downloads the piano sound. Resolves once the middle of the keyboard is ready so playing can start;
   * the lowest and highest notes keep arriving in the background (until then their neighbours are used).
   */
  load(): Promise<void> {
    this.loadPromise ??= (async () => {
      const ctx = audioCtx();
      const list = sampleList().sort((a, b) => Math.abs(a.pitch - 64) - Math.abs(b.pitch - 64));
      let failed = 0;
      const fetchOne = async ({ pitch, file }: { pitch: number; file: string }) => {
        try {
          const res = await fetch(`${SAMPLE_BASE}${file}.mp3`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(pitch, compactSample(ctx, buf, pitch));
        } catch {
          failed++;
        }
      };
      const core = list.filter((x) => x.pitch >= 45 && x.pitch <= 84);
      const rest = list.filter((x) => !core.includes(x));
      await inPool(core, 4, fetchOne);
      this.allPromise = inPool(rest, 2, fetchOne).then(() => {
        if (failed === list.length) this.loadError = 'Piano samples could not be downloaded; using a synth tone.';
        this.loaded = this.buffers.size > 0;
      });
      if (!this.buffers.size) await this.allPromise;
      this.loaded = this.buffers.size > 0;
    })();
    return this.loadPromise;
  }

  /** Waits for every sample, the extremes included (for offline rendering). */
  async loadAll(): Promise<void> {
    await this.load();
    await this.allPromise;
  }

  private nearest(pitch: number): [number, AudioBuffer] | null {
    let best: [number, AudioBuffer] | null = null;
    for (const [p, b] of this.buffers) {
      if (!best || Math.abs(p - pitch) < Math.abs(best[0] - pitch)) best = [p, b];
    }
    return best;
  }

  /** Renders a note into any (e.g. offline) audio context; used to test the microphone detector. */
  renderNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, velocity: number, when: number, duration: number): void {
    const sample = this.nearest(pitch);
    if (!sample) return;
    const src = ctx.createBufferSource();
    src.buffer = sample[1];
    src.playbackRate.value = Math.pow(2, (pitch - sample[0]) / 12);
    const gain = ctx.createGain();
    const level = Math.pow(velocity / 127, 1.7) * 0.9 + 0.02;
    gain.gain.setValueAtTime(level, when);
    gain.gain.setValueAtTime(level, when + duration);
    gain.gain.setTargetAtTime(0, when + duration, 0.09);
    src.connect(gain).connect(dest);
    src.start(when);
    src.stop(when + duration + 1);
  }

  /** Starts a note. `when` is AudioContext time; with `duration` the note is released automatically. */
  noteOn(pitch: number, velocity: number, opts: { when?: number; duration?: number; bus?: Bus } = {}): void {
    const ctx = audioCtx();
    const when = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
    logAppSound(pitch, audioToPerf(when));
    const out = bus(opts.bus ?? 'echo');
    const level = Math.pow(Math.max(1, Math.min(127, velocity)) / 127, 1.7) * 0.9 + 0.02;
    const gain = ctx.createGain();
    gain.connect(out);
    let stop: (t: number) => void;
    let kill: () => void;

    const sample = this.electric ? null : this.nearest(pitch);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample[1];
      src.playbackRate.value = Math.pow(2, (pitch - sample[0]) / 12);
      src.connect(gain);
      gain.gain.setValueAtTime(level, when);
      src.start(when);
      stop = (t) => {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(level, t);
        gain.gain.setTargetAtTime(0, t, 0.09);
        src.stop(t + 1);
      };
      kill = () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        try {
          src.stop(now + 0.1);
        } catch {
          // already stopped
        }
      };
    } else if (this.electric) {
      // Electric piano: FM synthesis, a bell-like attack that mellows as the note sustains.
      const freq = 440 * Math.pow(2, (pitch - 69) / 12);
      const carrier = ctx.createOscillator();
      carrier.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.frequency.value = freq;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 2.2, when);
      modGain.gain.setTargetAtTime(freq * 0.35, when, 0.25);
      mod.connect(modGain).connect(carrier.frequency);
      const tine = ctx.createOscillator();
      tine.frequency.value = freq * 14;
      const tineGain = ctx.createGain();
      tineGain.gain.setValueAtTime(level * 0.12, when);
      tineGain.gain.setTargetAtTime(0, when, 0.04);
      tine.connect(tineGain).connect(gain);
      carrier.connect(gain);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level * 0.55, when + 0.004);
      gain.gain.setTargetAtTime(level * 0.2, when + 0.01, 1.2);
      const oscs = [carrier, mod, tine];
      oscs.forEach((o) => o.start(when));
      stop = (t) => {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.12);
        oscs.forEach((o) => o.stop(t + 0.8));
      };
      kill = () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        oscs.forEach((o) => {
          try {
            o.stop(now + 0.1);
          } catch {
            // already stopped
          }
        });
      };
    } else {
      // Fallback tone: two detuned partials with a piano-like decay.
      const freq = 440 * Math.pow(2, (pitch - 69) / 12);
      const oscs = [1, 2].map((mult) => {
        const o = ctx.createOscillator();
        o.type = mult === 1 ? 'triangle' : 'sine';
        o.frequency.value = freq * mult;
        o.connect(gain);
        o.start(when);
        return o;
      });
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level * 0.5, when + 0.005);
      gain.gain.setTargetAtTime(level * 0.15, when + 0.01, 0.6);
      stop = (t) => {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.08);
        oscs.forEach((o) => o.stop(t + 0.6));
      };
      kill = () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.01);
        oscs.forEach((o) => {
          try {
            o.stop(now + 0.1);
          } catch {
            // already stopped
          }
        });
      };
    }

    const voice: Voice = { pitch, stop, kill, bus: opts.bus ?? 'echo', endAt: Infinity };
    if (opts.duration !== undefined) {
      const end = when + Math.max(0.08, opts.duration);
      stop(end);
      voice.endAt = end + 1;
      for (const v of this.scheduled) if (v.endAt < ctx.currentTime) this.scheduled.delete(v);
      this.scheduled.add(voice);
      return;
    }
    const key = `${voice.bus}:${pitch}`;
    const list = this.voices.get(key) ?? [];
    list.push(voice);
    this.voices.set(key, list);
  }

  noteOff(pitch: number, opts: { when?: number; bus?: Bus } = {}): void {
    const ctx = audioCtx();
    const key = `${opts.bus ?? 'echo'}:${pitch}`;
    const list = this.voices.get(key);
    if (!list?.length) return;
    const voice = list.shift()!;
    if (this.pedal && voice.bus === 'echo') {
      this.sustained.add(voice);
      return;
    }
    voice.stop(Math.max(ctx.currentTime, opts.when ?? ctx.currentTime));
  }

  setPedal(down: boolean): void {
    this.pedal = down;
    if (!down) {
      const t = audioCtx().currentTime;
      this.sustained.forEach((v) => v.stop(t));
      this.sustained.clear();
    }
  }

  /** Silences a bus immediately (used when practice stops or jumps). */
  stopAll(onlyBus?: Bus): void {
    for (const [key, list] of this.voices) {
      if (onlyBus && !key.startsWith(`${onlyBus}:`)) continue;
      list.forEach((v) => v.kill());
      this.voices.delete(key);
    }
    for (const v of this.scheduled) {
      if (onlyBus && v.bus !== onlyBus) continue;
      v.kill();
      this.scheduled.delete(v);
    }
    if (!onlyBus || onlyBus === 'echo') {
      this.sustained.forEach((v) => v.kill());
      this.sustained.clear();
    }
  }
}

export const piano = new PianoSampler();

export type ClickLevel = 'accent' | 'beat' | 'sub';

/** A metronome click: beep (sine), wood (filtered noise) or cowbell; subdivisions are quieter. */
export function metronomeClick(when: number, level: ClickLevel | boolean, sound: 'beep' | 'wood' | 'cowbell' = 'beep'): void {
  const lv: ClickLevel = level === true ? 'accent' : level === false ? 'beat' : level;
  if (sound === 'wood' || sound === 'cowbell') {
    otherClick(when, lv, sound);
    return;
  }
  const accent = lv === 'accent';
  const ctx = audioCtx();
  logAppSound(-1, audioToPerf(when));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1760 : 1175;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(accent ? 0.6 : 0.4, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
  if (lv === 'sub') gain.gain.value = 0;
  osc.connect(gain).connect(bus('metronome'));
  osc.start(when);
  osc.stop(when + 0.08);
  if (lv === 'sub') {
    // quieter, higher tick for subdivisions
    gain.gain.cancelScheduledValues(when);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.18, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  }
}

let noise: AudioBuffer | null = null;

function otherClick(when: number, lv: ClickLevel, sound: 'wood' | 'cowbell') {
  const ctx = audioCtx();
  logAppSound(-1, audioToPerf(when));
  const peak = lv === 'accent' ? 0.7 : lv === 'beat' ? 0.45 : 0.18;
  const gain = ctx.createGain();
  gain.connect(bus('metronome'));
  if (sound === 'wood') {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length / 6));
    }
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = lv === 'accent' ? 2400 : 1800;
    bp.Q.value = 6;
    gain.gain.value = peak * 3;
    src.connect(bp).connect(gain);
    src.start(when);
    return;
  }
  // Cowbell: two detuned square waves through a band-pass, quick decay.
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 800;
  bp.Q.value = 2;
  bp.connect(gain);
  for (const f of [587, 845]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = lv === 'accent' ? f * 1.12 : f;
    o.connect(bp);
    o.start(when);
    o.stop(when + 0.25);
  }
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak * 0.5, when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, when + (lv === 'sub' ? 0.08 : 0.22));
}
