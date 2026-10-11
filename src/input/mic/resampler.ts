/** Streaming windowed-sinc resampler (mono). Used to bring microphone audio down to 22 050 Hz. */
export class Resampler {
  private readonly step: number; // input samples per output sample
  private readonly cutoff: number;
  private readonly half: number;
  private history: Float32Array = new Float32Array(0);
  private pos: number; // position of the next output sample, in history coordinates

  constructor(
    readonly inRate: number,
    readonly outRate: number,
    taps = 12,
  ) {
    this.step = inRate / outRate;
    this.cutoff = Math.min(1, outRate / inRate) * 0.92;
    this.half = Math.ceil(taps / this.cutoff / 2);
    this.pos = this.half;
  }

  push(input: Float32Array): Float32Array {
    const merged = new Float32Array(this.history.length + input.length);
    merged.set(this.history);
    merged.set(input, this.history.length);
    const out: number[] = [];
    const H = this.half;
    const c = this.cutoff;
    while (this.pos + H < merged.length) {
      const center = Math.floor(this.pos);
      let acc = 0;
      let norm = 0;
      for (let k = center - H + 1; k <= center + H; k++) {
        const t = this.pos - k;
        const x = Math.PI * c * t;
        const sinc = x === 0 ? 1 : Math.sin(x) / x;
        const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / H) + 0.08 * Math.cos((2 * Math.PI * t) / H); // Blackman
        const h = sinc * w;
        acc += merged[k] * h;
        norm += h;
      }
      out.push(acc / norm);
      this.pos += this.step;
    }
    // Keep enough history for the next block's filter.
    const keepFrom = Math.max(0, Math.floor(this.pos) - H);
    this.history = merged.slice(keepFrom);
    this.pos -= keepFrom;
    return Float32Array.from(out);
  }
}
