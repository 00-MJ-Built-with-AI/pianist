import { inputHub } from './hub';

// Two rows of the computer keyboard laid out like piano keys (DAW style). Z / X shift octaves.
const KEY_OFFSETS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9,
  KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

let baseOctaveC = 60;
const down = new Map<string, number>();
const listeners = new Set<(base: number) => void>();

export function keyboardBase(): number {
  return baseOctaveC;
}

export function onKeyboardBase(l: (base: number) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function installComputerKeyboard(): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      baseOctaveC = Math.max(24, Math.min(96, baseOctaveC + (e.code === 'KeyZ' ? -12 : 12)));
      listeners.forEach((l) => l(baseOctaveC));
      return;
    }
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (e.code !== 'Space') inputHub.setPedal(true, e.timeStamp);
      return;
    }
    const off = KEY_OFFSETS[e.code];
    if (off === undefined) return;
    e.preventDefault();
    const pitch = baseOctaveC + off;
    down.set(e.code, pitch);
    inputHub.noteOn({ pitch, velocity: 80, time: e.timeStamp, source: 'keyboard' });
  };
  const onUp = (e: KeyboardEvent) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      inputHub.setPedal(false, e.timeStamp);
      return;
    }
    const pitch = down.get(e.code);
    if (pitch === undefined) return;
    down.delete(e.code);
    inputHub.noteOff(pitch, e.timeStamp, 'keyboard');
  };
  const onBlur = () => {
    down.clear();
    inputHub.releaseAll('keyboard');
  };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
  };
}
