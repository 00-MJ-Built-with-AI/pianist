import { useSyncExternalStore } from 'react';
import { loadPref, savePref } from './settings';

/** The player's own details for a song (works for built-in pieces too). Stored per profile. */
export interface SongMeta {
  title?: string; // display name override
  level?: number;
  tags?: string[];
  notes?: string;
  emoji?: string;
  color?: string;
  favorite?: boolean;
}

type Store = Record<string, SongMeta>;

let current: Store = loadPref<Store>('songMeta', {});
const listeners = new Set<() => void>();

export function getSongMeta(id: string): SongMeta {
  return current[id] ?? {};
}

export function setSongMeta(id: string, patch: Partial<SongMeta>): void {
  const next = { ...current[id], ...patch };
  // Drop empty fields so the store stays small.
  for (const k of Object.keys(next) as Array<keyof SongMeta>) {
    const v = next[k];
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length) || v === false) delete next[k];
  }
  current = { ...current, [id]: next };
  if (!Object.keys(next).length) delete current[id];
  savePref('songMeta', current);
  listeners.forEach((l) => l());
}

export function allTags(): string[] {
  return [...new Set(Object.values(current).flatMap((m) => m.tags ?? []))].sort((a, b) => a.localeCompare(b));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSongMetaStore(): Store {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
