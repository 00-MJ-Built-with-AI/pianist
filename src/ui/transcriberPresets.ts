import type { Simplify } from '../music/transcribe';
import { loadPref, savePref } from '../store/settings';

/** Everything about turning a recording into sheet music that a preset remembers (not the title or tempo itself). */
export interface TxSettings {
  detail: number;
  time: string; // "4/4"
  split: number; // hand split pitch
  grid: number; // subdivisions per beat
  simplify: Simplify;
  /** The detected tempo as found, halved or doubled. */
  tempo: 1 | 0.5 | 2;
}

export interface TxPreset {
  name: string;
  settings: TxSettings;
  builtin?: boolean;
}

export const DEFAULT_TX: TxSettings = { detail: 0.5, time: '4/4', split: 60, grid: 4, simplify: 'all', tempo: 1 };

export const BUILTIN_TX_PRESETS: TxPreset[] = [
  { name: 'Solo piano', builtin: true, settings: { detail: 0.5, time: '4/4', split: 60, grid: 4, simplify: 'all', tempo: 1 } },
  { name: 'Song with singing → melody', builtin: true, settings: { detail: 0.35, time: '4/4', split: 60, grid: 2, simplify: 'melody', tempo: 1 } },
  { name: 'Lead sheet (melody + bass)', builtin: true, settings: { detail: 0.45, time: '4/4', split: 55, grid: 4, simplify: 'melody-bass', tempo: 1 } },
  { name: 'Beginner (simplest)', builtin: true, settings: { detail: 0.3, time: '4/4', split: 60, grid: 2, simplify: 'melody-bass', tempo: 1 } },
];

export function myTxPresets(): TxPreset[] {
  return loadPref<TxPreset[]>('txPresets', []);
}

export function saveMyTxPresets(list: TxPreset[]): void {
  savePref('txPresets', list);
}

/** The settings used last time (new files start with them). */
export function lastTxSettings(): TxSettings {
  return { ...DEFAULT_TX, ...loadPref<Partial<TxSettings>>('txLast', {}) };
}

export function rememberTxSettings(s: TxSettings): void {
  savePref('txLast', s);
}

export const sameTx = (a: TxSettings, b: TxSettings) =>
  a.detail === b.detail && a.time === b.time && a.split === b.split && a.grid === b.grid && a.simplify === b.simplify && a.tempo === b.tempo;
