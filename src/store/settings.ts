import { useSyncExternalStore } from 'react';

export interface Settings {
  echoMidi: boolean;
  midiLatency: number; // ms
  micLatency: number; // ms, extra correction on top of the detector's own timing
  accompVolume: number;
  metronomeVolume: number;
  echoVolume: number;
  noteNames: 'c-only' | 'all' | 'none';
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
  noteNames: 'c-only',
  fullKeyboard: false,
  micSensitivity: 0.5,
};

const KEY = 'pianist.settings.v1';
let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
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
