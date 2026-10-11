import { piano } from '../audio/piano';
import { perfToAudio } from '../audio/audio';

export type InputSource = 'midi' | 'mic' | 'keyboard' | 'screen';

export interface PlayedNote {
  pitch: number;
  velocity: number; // 1–127 (estimated for the microphone)
  time: number; // performance.now() ms when the key was struck (latency-corrected)
  source: InputSource;
}

type NoteListener = (n: PlayedNote) => void;
type OffListener = (pitch: number, time: number) => void;
type PedalListener = (down: boolean, time: number) => void;

/** Single stream of key presses from every input, with the sustain pedal and currently held keys. */
class InputHub {
  private onListeners = new Set<NoteListener>();
  private offListeners = new Set<OffListener>();
  private pedalListeners = new Set<PedalListener>();
  readonly held = new Map<number, PlayedNote>();
  pedal = false;
  /** Echo MIDI notes through the speakers (for keyboards without their own sound). */
  echoMidi = false;
  /** Milliseconds subtracted from MIDI timestamps to compensate for device latency. */
  midiLatency = 0;

  noteOn(n: PlayedNote): void {
    if (n.source === 'midi') n = { ...n, time: n.time - this.midiLatency };
    const prev = this.held.get(n.pitch);
    if (prev) this.noteOff(n.pitch, n.time, n.source);
    this.held.set(n.pitch, n);
    if (n.source === 'keyboard' || n.source === 'screen' || (n.source === 'midi' && this.echoMidi)) {
      piano.noteOn(n.pitch, n.velocity, { when: perfToAudio(performance.now()) });
    }
    this.onListeners.forEach((l) => l(n));
  }

  noteOff(pitch: number, time: number, source: InputSource): void {
    if (!this.held.has(pitch)) return;
    this.held.delete(pitch);
    if (source === 'keyboard' || source === 'screen' || (source === 'midi' && this.echoMidi)) {
      piano.noteOff(pitch);
    }
    this.offListeners.forEach((l) => l(pitch, time));
  }

  setPedal(down: boolean, time: number): void {
    if (down === this.pedal) return;
    this.pedal = down;
    piano.setPedal(down);
    this.pedalListeners.forEach((l) => l(down, time));
  }

  releaseAll(source?: InputSource): void {
    for (const [pitch, n] of [...this.held]) {
      if (!source || n.source === source) this.noteOff(pitch, performance.now(), n.source);
    }
  }

  onNote(l: NoteListener): () => void {
    this.onListeners.add(l);
    return () => this.onListeners.delete(l);
  }

  onNoteOff(l: OffListener): () => void {
    this.offListeners.add(l);
    return () => this.offListeners.delete(l);
  }

  onPedal(l: PedalListener): () => void {
    this.pedalListeners.add(l);
    return () => this.pedalListeners.delete(l);
  }
}

export const inputHub = new InputHub();
