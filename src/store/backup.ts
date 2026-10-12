import type { Song } from '../music/types';
import { readAll, SHARED_DB, writeAll } from './db';
import { listProfiles, profileDbName, saveProfiles, settingsKey, type Profile } from './profiles';

/*
 * One file with everything: the shared song library and, for every player profile, its settings,
 * preferences, sessions, best scores, practice days and collections.
 */

const PROFILE_STORES = ['sessions', 'bests', 'days', 'collections'] as const;

export interface BackupFile {
  app: 'pianist';
  format: 1;
  exportedAt: number;
  profiles: Profile[];
  songs: Song[];
  data: Record<
    string,
    {
      settings: unknown;
      prefs: Record<string, string>;
      stores: Record<(typeof PROFILE_STORES)[number], unknown[]>;
    }
  >;
}

function prefsOf(profileId: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('pianist.pref.')) continue;
      const rest = key.slice('pianist.pref.'.length);
      const own = profileId === 'default' ? !rest.startsWith('p-') : rest.startsWith(`${profileId}.`);
      if (own) out[profileId === 'default' ? rest : rest.slice(profileId.length + 1)] = localStorage.getItem(key)!;
    }
  } catch {
    // no storage
  }
  return out;
}

export async function createBackup(): Promise<BackupFile> {
  const profiles = listProfiles();
  const data: BackupFile['data'] = {};
  for (const p of profiles) {
    const stores = {} as BackupFile['data'][string]['stores'];
    for (const s of PROFILE_STORES) stores[s] = await readAll(profileDbName(p.id), s);
    let settings: unknown = null;
    try {
      settings = JSON.parse(localStorage.getItem(settingsKey(p.id)) ?? 'null');
    } catch {
      settings = null;
    }
    data[p.id] = { settings, prefs: prefsOf(p.id), stores };
  }
  return { app: 'pianist', format: 1, exportedAt: Date.now(), profiles, songs: await readAll<Song>(SHARED_DB, 'songs'), data };
}

export interface RestoreSummary {
  profiles: number;
  songs: number;
  sessions: number;
}

/** Adds everything in the file to this device; records with the same id are replaced. */
export async function restoreBackup(file: unknown): Promise<RestoreSummary> {
  const b = file as Partial<BackupFile>;
  if (!b || b.app !== 'pianist' || b.format !== 1 || !Array.isArray(b.profiles) || !b.data) {
    throw new Error("This isn't a Pianist backup file.");
  }
  // Profiles: keep the ones here, add the ones from the file.
  const here = listProfiles();
  const merged = [...here];
  for (const p of b.profiles) {
    const i = merged.findIndex((x) => x.id === p.id);
    if (i >= 0) merged[i] = { ...merged[i], ...p };
    else merged.push(p);
  }
  saveProfiles(merged);

  await writeAll(SHARED_DB, 'songs', b.songs ?? []);
  let sessions = 0;
  for (const [id, d] of Object.entries(b.data)) {
    for (const s of PROFILE_STORES) await writeAll(profileDbName(id), s, d.stores?.[s] ?? []);
    sessions += d.stores?.sessions?.length ?? 0;
    try {
      if (d.settings) localStorage.setItem(settingsKey(id), JSON.stringify(d.settings));
      for (const [k, v] of Object.entries(d.prefs ?? {})) {
        localStorage.setItem(`pianist.pref.${id === 'default' ? '' : `${id}.`}${k}`, v);
      }
    } catch {
      // storage full: the data in IndexedDB is restored anyway
    }
  }
  return { profiles: b.profiles.length, songs: b.songs?.length ?? 0, sessions };
}
