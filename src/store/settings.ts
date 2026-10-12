import { useSyncExternalStore } from 'react';

export interface Settings {
  echoMidi: boolean;
  midiLatency: number; // ms
  micLatency: number; // ms, extra correction on top of the detector's own timing
  accompVolume: number;
  metronomeVolume: number;
  echoVolume: number;
  /** Which piano keys show their name. */
  keyLabels: 'none' | 'c' | 'white' | 'all';
  nameStyle: 'letter' | 'octave' | 'solfege';
  noteLabels: boolean; // names on the falling notes
  showTargets: boolean; // highlight the keys to play next
  showFalling: boolean;
  keyboardSize: 'small' | 'medium' | 'large';
  fingering: boolean; // suggested finger numbers on the sheet music
  fullKeyboard: boolean;
  micSensitivity: number; // 0–1, higher hears quieter notes
}

const DEFAULTS: Settings = {
  echoMidi: false,
  midiLatency: 0,
  micLatency: 0,
  accompVolume: 0.7,
  metronomeVolume: 0.6,
  echoVolume: 0.9,
  keyLabels: 'c',
  nameStyle: 'octave',
  noteLabels: true,
  showTargets: true,
  showFalling: true,
  keyboardSize: 'medium',
  fingering: false,
  fullKeyboard: false,
  micSensitivity: 0.5,
};

const KEY = 'pianist.settings.v1';
let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<Settings> & { noteNames?: string };
    // v1 had a single "noteNames" option.
    if (saved.noteNames && !saved.keyLabels) {
      saved.keyLabels = saved.noteNames === 'all' ? 'white' : saved.noteNames === 'none' ? 'none' : 'c';
    }
    delete saved.noteNames;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode or full storage: settings last for this visit only.
  }
  listeners.forEach((l) => l());
}

export function subscribeSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}

/** Small per-browser preferences (last mode, hands, tempo per song). */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pianist.pref.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pianist.pref.${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
