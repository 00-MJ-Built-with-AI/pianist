import { inputHub } from './hub';

export interface MidiStatus {
  supported: boolean;
  state: 'idle' | 'requesting' | 'ready' | 'denied';
  devices: string[];
  error?: string;
}

type Listener = (s: MidiStatus) => void;

let access: MIDIAccess | null = null;
let status: MidiStatus = {
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  state: 'idle',
  devices: [],
};
const listeners = new Set<Listener>();

function publish(next: Partial<MidiStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}

export function midiStatus(): MidiStatus {
  return status;
}

export function onMidiStatus(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function handleMessage(e: MIDIMessageEvent) {
  const data = e.data;
  if (!data || data.length < 2) return;
  const cmd = data[0] & 0xf0;
  const time = e.timeStamp || performance.now();
  if (cmd === 0x90 && data[2] > 0) {
    inputHub.noteOn({ pitch: data[1], velocity: data[2], time, source: 'midi' });
  } else if (cmd === 0x80 || (cmd === 0x90 && data[2] === 0)) {
    inputHub.noteOff(data[1], time, 'midi');
  } else if (cmd === 0xb0 && data[1] === 64) {
    inputHub.setPedal(data[2] >= 64, time);
  } else if (cmd === 0xb0 && (data[1] === 123 || data[1] === 120)) {
    inputHub.releaseAll('midi');
  }
}

function attach() {
  if (!access) return;
  const names: string[] = [];
  access.inputs.forEach((input) => {
    input.onmidimessage = handleMessage;
    if (input.state === 'connected') names.push(input.name ?? 'MIDI device');
  });
  publish({ devices: names, state: 'ready' });
}

export async function connectMidi(): Promise<MidiStatus> {
  if (!status.supported) {
    publish({ error: 'This browser has no Web MIDI. Use Chrome or Edge.' });
    return status;
  }
  if (access) {
    attach();
    return status;
  }
  publish({ state: 'requesting', error: undefined });
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => attach();
    attach();
  } catch (err) {
    publish({ state: 'denied', error: err instanceof Error ? err.message : String(err) });
  }
  return status;
}
