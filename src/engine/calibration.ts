/** Result of playing along with metronome clicks. */
export interface CalibrationResult {
  offsets: number[]; // ms, positive = the key press arrived after the click
  median: number | null;
  spread: number | null; // middle-half range of the offsets, ms
}

const WINDOW_MS = 280;

/** Pairs each click with the nearest key press and measures how late (or early) the presses arrive. */
export function measureOffsets(clicks: number[], presses: number[]): CalibrationResult {
  const used = new Set<number>();
  const offsets: number[] = [];
  for (const c of clicks) {
    let best = -1;
    for (let i = 0; i < presses.length; i++) {
      if (used.has(i) || Math.abs(presses[i] - c) > WINDOW_MS) continue;
      if (best < 0 || Math.abs(presses[i] - c) < Math.abs(presses[best] - c)) best = i;
    }
    if (best >= 0) {
      used.add(best);
      offsets.push(presses[best] - c);
    }
  }
  if (offsets.length < 6) return { offsets, median: null, spread: null };
  const sorted = [...offsets].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.round((sorted.length - 1) * p)];
  return { offsets, median: Math.round(q(0.5)), spread: Math.round(q(0.75) - q(0.25)) };
}
