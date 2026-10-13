import { piano } from '../audio/piano';
import { perfToAudio } from '../audio/audio';

export type InputSource = 'midi' | 'mic' | 'keyboard' | 'screen';

export interface PlayedNote {
  pitch: number;
  velocity: number; // 1–127 (estimated for the microphone)
  time: number; // performance.now() ms when the key was struck (latency-corrected)
  source: InputSource;
}

export type ControlAction = 'startStop' | 'nextBar' | 'prevBar' | 'skip' | 'restart';
export type ControlTrigger = { type: 'key'; pitch: number } | { type: 'cc'; cc: number };

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
  /**
   * The pitches the music expects around a moment (performance.now() ms), set by a running practice
   * session. The microphone detector hears these more readily; anything else needs clearer evidence.
   */
  expectation: ((time: number) => ReadonlySet<number>) | null = null;

  /* ---- hands-free control: piano keys or pedals that act as buttons */
  private controls = new Map<string, ControlAction>();
  private actionListeners = new Set<(a: ControlAction) => void>();
  private learner: ((t: ControlTrigger) => void) | null = null;
  private swallowed = new Set<number>(); // control keys held down (their release is ignored)
  private ccDown = new Set<number>();
  private ccListeners = new Set<(cc: number, value: number) => void>();

  /** Every pedal / controller message other than the sustain pedal (for the check-up). */
  onCC(l: (cc: number, value: number) => void): () => void {
    this.ccListeners.add(l);
    return () => this.ccListeners.delete(l);
  }

  setControls(map: Partial<Record<ControlAction, ControlTrigger>>): void {
    this.controls.clear();
    for (const [action, t] of Object.entries(map) as Array<[ControlAction, ControlTrigger]>) {
      if (t) this.controls.set(t.type === 'key' ? `key:${t.pitch}` : `cc:${t.cc}`, action);
    }
  }

  /** The next MIDI key or pedal press is handed to `cb` instead of being played (for assigning controls). */
  learnNextControl(cb: ((t: ControlTrigger) => void) | null): void {
    this.learner = cb;
  }

  onAction(l: (a: ControlAction) => void): () => void {
    this.actionListeners.add(l);
    return () => this.actionListeners.delete(l);
  }

  private fire(key: string): boolean {
    const action = this.controls.get(key);
    if (!action) return false;
    this.actionListeners.forEach((l) => l(action));
    return true;
  }

  /** A pedal or controller from the piano (other than the sustain pedal). */
  controlChange(cc: number, value: number): void {
    this.ccListeners.forEach((l) => l(cc, value));
    const down = value >= 64;
    if (!down) {
      this.ccDown.delete(cc);
      return;
    }
    if (this.ccDown.has(cc)) return;
    this.ccDown.add(cc);
    if (this.learner) {
      const l = this.learner;
      this.learner = null;
      l({ type: 'cc', cc });
      return;
    }
    this.fire(`cc:${cc}`);
  }

  noteOn(n: PlayedNote): void {
    if (n.source === 'midi') {
      if (this.learner) {
        const l = this.learner;
        this.learner = null;
        this.swallowed.add(n.pitch);
        l({ type: 'key', pitch: n.pitch });
        return;
      }
      if (this.fire(`key:${n.pitch}`)) {
        this.swallowed.add(n.pitch);
        return;
      }
    }
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
    if (source === 'midi' && this.swallowed.delete(pitch)) return;
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
