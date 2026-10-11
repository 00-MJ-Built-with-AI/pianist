/** A named, ordered list of songs (built-in or the player's own). */
export interface Collection {
  id: string;
  name: string;
  songIds: string[];
  createdAt: number;
}

export function newCollection(name: string): Collection {
  return {
    id: `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'My collection',
    songIds: [],
    createdAt: Date.now(),
  };
}

export function hasSong(c: Collection, songId: string): boolean {
  return c.songIds.includes(songId);
}

export function addSongs(c: Collection, songIds: string[]): Collection {
  const fresh = [...new Set(songIds)].filter((id) => !c.songIds.includes(id));
  return fresh.length ? { ...c, songIds: [...c.songIds, ...fresh] } : c;
}

export function toggleSong(c: Collection, songId: string): Collection {
  return hasSong(c, songId) ? { ...c, songIds: c.songIds.filter((id) => id !== songId) } : addSongs(c, [songId]);
}

/** Moves a song up (-1) or down (+1) in the list. */
export function moveSong(c: Collection, songId: string, delta: number): Collection {
  const i = c.songIds.indexOf(songId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= c.songIds.length) return c;
  const ids = [...c.songIds];
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { ...c, songIds: ids };
}

/** Collections that change when a song is deleted from the library. */
export function withoutSong(cols: Collection[], songId: string): Collection[] {
  return cols.filter((c) => hasSong(c, songId)).map((c) => ({ ...c, songIds: c.songIds.filter((id) => id !== songId) }));
}
