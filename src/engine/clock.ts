/** Maps wall-clock time (performance.now ms) to a position in the piece (beats). */
export class Clock {
  private anchorBeat = 0;
  private anchorTime = 0;
  running = false;
  bps = 1; // beats per second

  beatAt(t: number): number {
    return this.running ? this.anchorBeat + ((t - this.anchorTime) / 1000) * this.bps : this.anchorBeat;
  }

  timeAt(beat: number): number {
    return this.anchorTime + ((beat - this.anchorBeat) / this.bps) * 1000;
  }

  start(beat: number, t: number): void {
    this.anchorBeat = beat;
    this.anchorTime = t;
    this.running = true;
  }

  pause(t: number): void {
    this.anchorBeat = this.beatAt(t);
    this.anchorTime = t;
    this.running = false;
  }

  /** Re-anchors so that `beat` is reached at time `t`, keeping the current speed. */
  anchor(beat: number, t: number): void {
    this.anchorBeat = beat;
    this.anchorTime = t;
  }

  setBps(bps: number, t: number): void {
    this.anchorBeat = this.beatAt(t);
    this.anchorTime = t;
    this.bps = bps;
  }
}
