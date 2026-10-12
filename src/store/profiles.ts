/*
 * Player profiles: several people on one device. Each profile has its own settings, preferences,
 * progress, history and collections; the song library (imported and recorded songs) is shared.
 */

export interface Profile {
  id: string; // 'default' or 'p-…'
  name: string;
  avatar: string; // an emoji
}

const LIST_KEY = 'pianist.profiles';
const ACTIVE_KEY = 'pianist.activeProfile';

export const DEFAULT_PROFILE: Profile = { id: 'default', name: 'Me', avatar: '🎹' };
export const AVATARS = ['🎹', '🎵', '🎻', '🎸', '🎺', '🥁', '🦊', '🐱', '🐼', '🦄', '🚀', '🌟'];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked
  }
}

export function listProfiles(): Profile[] {
  const saved = read<Profile[]>(LIST_KEY, []);
  const def = saved.find((p) => p.id === 'default') ?? DEFAULT_PROFILE;
  return [def, ...saved.filter((p) => p.id !== 'default')];
}

export function saveProfiles(list: Profile[]): void {
  write(LIST_KEY, list);
}

export function activeProfileId(): string {
  const id = read<string>(ACTIVE_KEY, 'default');
  return listProfiles().some((p) => p.id === id) ? id : 'default';
}

export function activeProfile(): Profile {
  const id = activeProfileId();
  return listProfiles().find((p) => p.id === id) ?? DEFAULT_PROFILE;
}

/** Key prefix for a profile's own localStorage entries ('' for the first profile, for compatibility). */
export function profilePrefix(id = activeProfileId()): string {
  return id === 'default' ? '' : `${id}.`;
}

/** IndexedDB database holding a profile's progress (the first profile keeps the original database). */
export function profileDbName(id = activeProfileId()): string {
  return id === 'default' ? 'pianist' : `pianist-${id}`;
}

export function settingsKey(id = activeProfileId()): string {
  return id === 'default' ? 'pianist.settings.v1' : `pianist.settings.v1.${id}`;
}

export function addProfile(name: string, avatar: string): Profile {
  const p: Profile = { id: `p-${Date.now().toString(36)}`, name: name.trim() || 'Player', avatar };
  saveProfiles([...listProfiles(), p]);
  return p;
}

export function updateProfile(id: string, patch: Partial<Omit<Profile, 'id'>>): void {
  saveProfiles(listProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

/** Switches player; the app reloads so every screen picks up that player's data. */
export function switchProfile(id: string): void {
  write(ACTIVE_KEY, id);
  location.reload();
}

export async function deleteProfile(id: string): Promise<void> {
  if (id === 'default') return;
  saveProfiles(listProfiles().filter((p) => p.id !== id));
  try {
    for (const key of Object.keys(localStorage)) {
      if (key === settingsKey(id) || key.startsWith(`pianist.pref.${id}.`)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(profileDbName(id));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  if (activeProfileId() === id) switchProfile('default');
}
