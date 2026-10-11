import { audioCtx, resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import type { RecordedEvent } from '../engine/types';

/** Plays a recorded performance back through the piano sound. Returns a stop function. */
export async function replayRecording(events: RecordedEvent[], onEnd: () => void): Promise<{ stop: () => void; duration: number }> {
  await resumeAudio();
  void piano.load();
  const ctx = audioCtx();
  const first = events.find((e) => e.type === 'on');
  if (!first) {
    onEnd();
    return { stop: () => {}, duration: 0 };
  }
  const t0 = ctx.currentTime + 0.15 - first.t / 1000;

  // Resolve the sustain pedal into note lengths: a release while the pedal is down lasts until it lifts.
  const pedalUps: number[] = [];
  let down = false;
  for (const e of events) {
    if (e.type !== 'pedal') continue;
    if (e.pitch === 1) down = true;
    else if (down) {
      pedalUps.push(e.t);
      down = false;
    }
  }
  const pedalDownAt = (t: number) => {
    let state = false;
    for (const e of events) {
      if (e.t > t) break;
      if (e.type === 'pedal') state = e.pitch === 1;
    }
    return state;
  };

  const open = new Map<number, Array<{ t: number; v: number }>>();
  let last = first.t;
  const play = (pitch: number, start: number, end: number, velocity: number) => {
    piano.noteOn(pitch, velocity, { when: t0 + start / 1000, duration: Math.max(0.05, (end - start) / 1000), bus: 'accomp' });
  };
  for (const e of events) {
    if (e.type === 'on') {
      const list = open.get(e.pitch) ?? [];
      list.push({ t: e.t, v: e.velocity });
      open.set(e.pitch, list);
    } else if (e.type === 'off') {
      const n = open.get(e.pitch)?.shift();
      if (!n) continue;
      let end = e.t;
      if (pedalDownAt(e.t)) end = pedalUps.find((u) => u >= e.t) ?? end + 2000;
      play(e.pitch, n.t, end, n.v);
      last = Math.max(last, end);
    }
  }
  for (const [pitch, list] of open) for (const n of list) play(pitch, n.t, n.t + 800, n.v);

  const duration = (last - first.t) / 1000 + 0.6;
  const timer = window.setTimeout(onEnd, duration * 1000 + 200);
  return {
    duration,
    stop: () => {
      window.clearTimeout(timer);
      piano.stopAll('accomp');
      onEnd();
    },
  };
}
