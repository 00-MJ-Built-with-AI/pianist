import { dropOvertones, type HeardNote } from '../music/transcribe';
import { loadBasicPitch, SAMPLE_RATE } from './basicPitch';

export const MAX_SECONDS = 10 * 60;

/** Decodes any audio file the browser understands (mp3, wav, m4a, ogg, flac) to mono 22 050 Hz. */
export async function decodeAudioFile(file: File): Promise<{ samples: Float32Array; duration: number }> {
  const data = await file.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  } catch {
    throw new Error("This file couldn't be read as audio. Try an MP3, WAV, M4A, OGG or FLAC file.");
  }
  if (decoded.duration > MAX_SECONDS) {
    throw new Error(`This recording is ${Math.round(decoded.duration / 60)} minutes long; use a clip under 10 minutes.`);
  }
  // Rendering through a 22 050 Hz mono context resamples and mixes the channels down in one step.
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), duration: decoded.duration };
}

/** Raw model output for a whole file; note extraction can be re-run on it with other settings. */
export interface ModelOutput {
  frames: number[][];
  onsets: number[][];
}

export async function analyseAudio(samples: Float32Array, onProgress: (p: number) => void): Promise<ModelOutput> {
  const { model } = await loadBasicPitch();
  const { BasicPitch } = await import('@spotify/basic-pitch');
  const bp = new BasicPitch(Promise.resolve(model));
  const frames: number[][] = [];
  const onsets: number[][] = [];
  await bp.evaluateModel(
    samples,
    (f, o) => {
      frames.push(...f);
      onsets.push(...o);
    },
    onProgress,
  );
  return { frames, onsets };
}

/**
 * Turns the model output into notes. `detail` 0–1: higher keeps quieter and shorter notes.
 * Basic Pitch's "infer onsets" and "melodia" extras are off: on piano they mostly add split
 * sustained notes and overtone ghosts (tuned on rendered piano recordings).
 */
export async function extractNotes(out: ModelOutput, detail: number): Promise<HeardNote[]> {
  const { outputToNotesPoly, noteFramesToTime } = await import('@spotify/basic-pitch');
  const onsetThresh = 0.7 - 0.3 * detail;
  const frameThresh = 0.4 - 0.16 * detail;
  const minNoteFrames = Math.round(9 - 4 * detail); // 5–9 frames ≈ 58–105 ms
  const events = noteFramesToTime(
    outputToNotesPoly(out.frames, out.onsets, onsetThresh, frameThresh, minNoteFrames, false, null, null, false),
  );
  const notes = events.map((e) => ({ start: e.startTimeSeconds, dur: e.durationSeconds, pitch: e.pitchMidi, amplitude: e.amplitude }));
  return dropOvertones(notes).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}
