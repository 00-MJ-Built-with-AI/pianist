import { resumeAudio } from '../../audio/audio';
import { piano } from '../../audio/piano';
import { pitchName } from '../../music/pitch';
import { inputHub } from '../hub';
import { startMic, stopMic } from './mic';

export interface SelfTestResult {
  expected: Array<{ pitch: string; at: number }>;
  detected: Array<{ pitch: string; at: number }>;
  hits: number;
  falsePositives: number;
  meanOffsetMs: number | null;
}

/**
 * Plays a rendered piano clip through the microphone detector (instead of a real microphone)
 * and compares what it heard with what was played.
 */
export async function runMicSelfTest(
  notes: Array<{ pitch: number; at: number; dur: number; vel?: number }> = [
    { pitch: 60, at: 0.6, dur: 0.5 },
    { pitch: 64, at: 1.2, dur: 0.5 },
    { pitch: 67, at: 1.8, dur: 0.5 },
    { pitch: 60, at: 2.6, dur: 0.9 },
    { pitch: 64, at: 2.6, dur: 0.9 },
    { pitch: 67, at: 2.6, dur: 0.9 },
    { pitch: 57, at: 3.8, dur: 0.5 },
    { pitch: 72, at: 4.4, dur: 0.5 },
    { pitch: 53, at: 5.0, dur: 0.7 },
    { pitch: 69, at: 5.0, dur: 0.7 },
  ],
): Promise<SelfTestResult> {
  await resumeAudio();
  await piano.load();
  const sr = 48000;
  const length = Math.ceil((Math.max(...notes.map((n) => n.at + n.dur)) + 1.5) * sr);
  const off = new OfflineAudioContext(1, length, sr);
  for (const n of notes) piano.renderNote(off, off.destination, n.pitch, n.vel ?? 80, n.at, n.dur);
  const buffer = await off.startRendering();

  stopMic();
  const detected: Array<{ pitch: number; time: number }> = [];
  const unsub = inputHub.onNote((n) => {
    if (n.source === 'mic') detected.push({ pitch: n.pitch, time: n.time });
  });
  await startMic({ testBuffer: buffer });
  const playStart = performance.now(); // the buffer starts ~50 ms after the detector is ready
  await new Promise((r) => setTimeout(r, (length / sr) * 1000 + 1200));
  unsub();
  stopMic();

  // Align the clip's clock with the detections using the first note.
  const firstExpected = notes[0].at;
  const firstDetected = detected.find((d) => d.pitch === notes[0].pitch);
  const origin = firstDetected ? firstDetected.time - firstExpected * 1000 : playStart + 50;
  const det = detected.map((d) => ({ pitch: d.pitch, at: (d.time - origin) / 1000 }));
  const used = new Set<number>();
  const offsets: number[] = [];
  let hits = 0;
  for (const n of notes) {
    const i = det.findIndex((d, k) => !used.has(k) && d.pitch === n.pitch && Math.abs(d.at - n.at) < 0.15);
    if (i >= 0) {
      used.add(i);
      hits++;
      offsets.push((det[i].at - n.at) * 1000);
    }
  }
  return {
    expected: notes.map((n) => ({ pitch: pitchName(n.pitch), at: n.at })),
    detected: det.map((d) => ({ pitch: pitchName(d.pitch), at: Math.round(d.at * 1000) / 1000 })),
    hits,
    falsePositives: det.length - used.size,
    meanOffsetMs: offsets.length ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length) : null,
  };
}
