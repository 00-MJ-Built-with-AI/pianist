import type { Hand } from '../music/types';
import { loadPref, savePref } from './settings';

/** A Piano Roll game result. */
export interface HighScore {
  points: number;
  date: number;
  rate: number;
  hands: Hand[];
  maxCombo: number;
}

const KEEP = 5;

/** The best Piano Roll scores for a song (this player's), highest first. */
export function highScores(songId: string): HighScore[] {
  return loadPref<HighScore[]>(`highScores.${songId}`, []);
}

/** Adds a result; returns its place in the table (0 = best) or null when it didn't make the table. */
export function addHighScore(songId: string, entry: HighScore): number | null {
  if (entry.points <= 0) return null;
  const list = [...highScores(songId), entry].sort((a, b) => b.points - a.points).slice(0, KEEP);
  const rank = list.indexOf(entry);
  if (rank < 0) return null;
  savePref(`highScores.${songId}`, list);
  return rank;
}
