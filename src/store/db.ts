import type { ModeKind, Report } from '../engine/types';
import type { Song } from '../music/types';

const DB_NAME = 'pianist';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('songs', { keyPath: 'id' });
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('date', 'date');
      sessions.createIndex('songId', 'songId');
      db.createObjectStore('bests', { keyPath: 'key' });
      db.createObjectStore('days', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

/* ---- songs the player added */

export async function saveSong(song: Song): Promise<void> {
  await promisify((await store('songs', 'readwrite')).put(song));
}

export async function listSongs(): Promise<Song[]> {
  const songs = await promisify((await store('songs')).getAll() as IDBRequest<Song[]>);
  return songs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function deleteSong(id: string): Promise<void> {
  await promisify((await store('songs', 'readwrite')).delete(id));
}

/* ---- session history */

export async function saveSession(report: Report): Promise<void> {
  await promisify((await store('sessions', 'readwrite')).put(report));
}

export async function listSessions(limit = 200): Promise<Report[]> {
  const all = await promisify((await store('sessions')).getAll() as IDBRequest<Report[]>);
  return all.sort((a, b) => b.date - a.date).slice(0, limit);
}

export async function deleteSession(id: string): Promise<void> {
  await promisify((await store('sessions', 'readwrite')).delete(id));
}

/* ---- best scores per song and mode */

export interface Best {
  key: string; // songId|mode
  songId: string;
  mode: ModeKind;
  score: number;
  stars: number;
  accuracy: number;
  date: number;
}

export async function updateBest(r: Report): Promise<Best | null> {
  if (!r.completed || r.notesExpected === 0) return null;
  const key = `${r.songId}|${r.mode}`;
  const prev = (await promisify((await store('bests')).get(key))) as Best | undefined;
  if (prev && prev.score >= r.score) return prev;
  const best: Best = { key, songId: r.songId, mode: r.mode, score: r.score, stars: r.stars, accuracy: r.accuracy, date: r.date };
  await promisify((await store('bests', 'readwrite')).put(best));
  return best;
}

export async function listBests(): Promise<Best[]> {
  return promisify((await store('bests')).getAll() as IDBRequest<Best[]>);
}

/* ---- practice time per day */

export interface Day {
  date: string; // YYYY-MM-DD, local time
  seconds: number;
  sessions: number;
}

export function dayKey(d = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function addPracticeTime(seconds: number): Promise<void> {
  if (seconds < 5) return;
  const key = dayKey();
  const prev = (await promisify((await store('days')).get(key))) as Day | undefined;
  const next: Day = { date: key, seconds: (prev?.seconds ?? 0) + Math.round(seconds), sessions: (prev?.sessions ?? 0) + 1 };
  await promisify((await store('days', 'readwrite')).put(next));
}

export async function listDays(): Promise<Day[]> {
  return promisify((await store('days')).getAll() as IDBRequest<Day[]>);
}

/** Consecutive days with practice, ending today (or yesterday, if today hasn't started yet). */
export function streak(days: Day[]): number {
  const set = new Set(days.filter((d) => d.seconds >= 60).map((d) => d.date));
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
