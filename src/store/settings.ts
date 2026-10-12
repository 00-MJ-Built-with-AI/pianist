import { useSyncExternalStore } from 'react';
import { profilePrefix, settingsKey } from './profiles';

/** How strictly playing is judged. */
export interface Tuning {
  perfectMs: number; // timed modes: within this is Perfect
  goodMs: number; // timed modes: within this is Good, beyond is a miss
  chordWindowMs: number; // Learn: chord notes must arrive within this of each other
  cleanPass: number; // accuracy (0–1) that counts as a clean pass
  speedStep: number; // auto speed-up step
  maxRate: number; // auto speed-up stops here
}

export const TUNING_PRESETS: Record<'relaxed' | 'normal' | 'strict', Tuning> = {
  relaxed: { perfectMs: 100, goodMs: 220, chordWindowMs: 1500, cleanPass: 0.8, speedStep: 0.05, maxRate: 1 },
  normal: { perfectMs: 70, goodMs: 160, chordWindowMs: 1000, cleanPass: 0.9, speedStep: 0.05, maxRate: 1 },
  strict: { perfectMs: 45, goodMs: 110, chordWindowMs: 500, cleanPass: 0.95, speedStep: 0.05, maxRate: 1 },
};

export type ControlAction = 'startStop' | 'nextBar' | 'prevBar' | 'skip' | 'restart';
/** A piano key (note number) or a pedal / controller number that triggers an action. */
export type ControlTrigger = { type: 'key'; pitch: number } | { type: 'cc'; cc: number };

export interface ScoreWeights {
  notes: number;
  timing: number;
  tempo: number;
  dynamics: number;
}

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
  // Practice
  strictness: 'relaxed' | 'normal' | 'strict' | 'custom';
  tuning: Tuning; // used when strictness is custom
  countInBars: 0 | 1 | 2;
  clickSubdivision: 'beat' | 'eighth';
  clickAccent: boolean;
  clickSound: 'beep' | 'wood' | 'cowbell';
  guideNotes: boolean; // the app softly plays your own notes as a guide
  guideVolume: number;
  // Falling notes
  fallSeconds: number; // how far ahead the falling notes show
  noteColors: 'hand' | 'pitch' | 'finger';
  noteGlow: boolean;
  // Look
  theme: 'dark' | 'light' | 'contrast';
  handColors: { R: string; L: string };
  // Sound
  pianoSound: 'grand' | 'bright' | 'mellow' | 'electric';
  reverb: number; // 0–0.6
  // Sheet music
  scoreZoom: number;
  scoreLayout: 'line' | 'page';
  // Hands-free control
  handsFree: boolean;
  controls: Partial<Record<ControlAction, ControlTrigger>>;
  // Feedback
  scoreWeights: ScoreWeights;
  reportSections: { tips: boolean; timing: boolean; tempo: boolean; dynamics: boolean };
  sfx: boolean;
  celebrations: boolean;
  voice: boolean;
  voiceRate: number;
  // Daily plan
  dailyGoalMin: number;
  planItems: { warmup: boolean; fix: boolean; review: boolean; new: boolean; sight: boolean };
  maxFix: number;
  reminder: { on: boolean; time: string }; // "18:30"
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
  strictness: 'normal',
  tuning: { ...TUNING_PRESETS.normal },
  countInBars: 1,
  clickSubdivision: 'beat',
  clickAccent: true,
  clickSound: 'beep',
  guideNotes: false,
  guideVolume: 0.35,
  fallSeconds: 3.2,
  noteColors: 'hand',
  noteGlow: true,
  theme: 'dark',
  handColors: { R: '#4c9dff', L: '#38c98a' },
  pianoSound: 'grand',
  reverb: 0.15,
  scoreZoom: 0.85,
  scoreLayout: 'line',
  handsFree: false,
  controls: {},
  scoreWeights: { notes: 3, timing: 1, tempo: 1, dynamics: 1 },
  reportSections: { tips: true, timing: true, tempo: true, dynamics: true },
  sfx: false,
  celebrations: true,
  voice: false,
  voiceRate: 1,
  dailyGoalMin: 15,
  planItems: { warmup: true, fix: true, review: true, new: true, sight: true },
  maxFix: 2,
  reminder: { on: false, time: '18:00' },
};

/** The timing and pass rules in effect. */
export function tuningOf(s: Settings): Tuning {
  return s.strictness === 'custom' ? s.tuning : TUNING_PRESETS[s.strictness];
}

/** Hand colour pairs; "colorblind" is blue / orange. */
export const HAND_COLOR_PRESETS: Record<string, { R: string; L: string }> = {
  default: { R: '#4c9dff', L: '#38c98a' },
  colorblind: { R: '#3b8fe0', L: '#f0a020' },
  warm: { R: '#ff7a59', L: '#ffd166' },
  purple: { R: '#a78bfa', L: '#f472b6' },
};

let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(settingsKey());
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<Settings> & { noteNames?: string };
    // v1 had a single "noteNames" option.
    if (saved.noteNames && !saved.keyLabels) {
      saved.keyLabels = saved.noteNames === 'all' ? 'white' : saved.noteNames === 'none' ? 'none' : 'c';
    }
    delete saved.noteNames;
    // Nested groups merge with their defaults so new options get sensible values.
    return {
      ...DEFAULTS,
      ...saved,
      tuning: { ...DEFAULTS.tuning, ...saved.tuning },
      handColors: { ...DEFAULTS.handColors, ...saved.handColors },
      scoreWeights: { ...DEFAULTS.scoreWeights, ...saved.scoreWeights },
      reportSections: { ...DEFAULTS.reportSections, ...saved.reportSections },
      planItems: { ...DEFAULTS.planItems, ...saved.planItems },
      reminder: { ...DEFAULTS.reminder, ...saved.reminder },
      controls: { ...saved.controls },
    };
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
    localStorage.setItem(settingsKey(), JSON.stringify(current));
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
    const raw = localStorage.getItem(`pianist.pref.${profilePrefix()}${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pianist.pref.${profilePrefix()}${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
