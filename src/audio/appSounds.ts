/**
 * A short log of notes the app itself played through the speakers (accompaniment, echo, metronome),
 * so the microphone detector can ignore them instead of mistaking them for the player.
 */
interface AppSound {
  pitch: number; // -1 for a metronome click
  time: number; // performance.now() ms when it is heard
}

const log: AppSound[] = [];
const KEEP_MS = 4000;

export function logAppSound(pitch: number, time: number): void {
  log.push({ pitch, time });
  const cutoff = performance.now() - KEEP_MS;
  while (log.length && log[0].time < cutoff) log.shift();
}

/** True when a detected onset at `time` is most likely the app's own sound. */
export function isAppSound(pitch: number, time: number): boolean {
  for (const s of log) {
    const d = time - s.time;
    if (d < -80 || d > 260) continue;
    if (s.pitch === -1) {
      if (pitch >= 82) return true;
      continue;
    }
    const diff = pitch - s.pitch;
    if (diff === 0 || diff === 12 || diff === 19 || diff === 24) return true;
  }
  return false;
}
