import type { ModeKind, Report } from '../engine/types';
import { TONICS, type HandsOption, type ScaleKind } from '../music/exercises';
import type { Hand, Song } from '../music/types';
import type { Best } from './db';

/*
 * Today's practice: a short plan built from the player's own history — a rotating warm-up, the
 * weakest bars from recent reports, a piece that is getting rusty, something new, and sight-reading.
 */

export type PlanLaunch =
  | { type: 'song'; songId: string }
  | { type: 'scale'; pc: number; kind: ScaleKind; octaves: 1 | 2; hands: HandsOption }
  | { type: 'sight'; level: number; bars: 4 | 8; seed: number };

export interface PlanItem {
  key: string;
  kind: 'warmup' | 'fix' | 'review' | 'new' | 'sight';
  title: string;
  detail: string;
  minutes: number;
  songId: string; // a session of this song today ticks the item off
  launch: PlanLaunch;
  preset: { mode: ModeKind; loop?: { from: number; to: number } | null; rate?: number; hands?: Hand[] };
  done: boolean;
}

export const DAILY_GOAL_MIN = 15;

const DAY_MS = 86_400_000;

export function dayIndex(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / DAY_MS);
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

const isExercise = (id: string) => id.startsWith('ex-');

export function scalePlanId(pc: number, kind: ScaleKind, octaves: number, hands: HandsOption): string {
  return `ex-scale-${pc}-${kind}-${octaves}-${hands}-1`;
}

/** A rough level from what the player already plays well (1–4). */
export function estimateLevel(songs: Song[], bests: Best[]): number {
  let level = 1;
  for (const b of bests) {
    if (b.stars < 2) continue;
    const s = songs.find((x) => x.id === b.songId);
    if (s) level = Math.max(level, Math.min(4, s.level + (b.stars === 3 ? 1 : 0)));
  }
  return Math.min(4, level);
}

export function buildPlan(input: { today: Date; sessions: Report[]; songs: Song[]; bests: Best[] }): PlanItem[] {
  const { today, sessions, songs, bests } = input;
  const day = dayIndex(today);
  const midnight = startOfDay(today);
  const level = estimateLevel(songs, bests);
  const items: PlanItem[] = [];
  const doneToday = (songId: string) => sessions.some((r) => r.songId === songId && r.date >= midnight);
  const byId = new Map(songs.map((s) => [s.id, s]));

  // 1. Warm-up: a different key every day, major and harmonic minor alternating.
  const tonic = TONICS[((day % 12) + 12) % 12];
  const kind: ScaleKind = level === 1 || day % 2 === 0 ? 'major' : 'harmonic-minor';
  const hands: HandsOption = level === 1 ? (day % 2 === 0 ? 'R' : 'L') : 'both';
  const octaves: 1 | 2 = level >= 3 ? 2 : 1;
  const warmId = scalePlanId(tonic.pc, kind, octaves, hands);
  items.push({
    key: 'warmup',
    kind: 'warmup',
    title: `Warm-up: ${kind === 'major' ? tonic.major : tonic.minor} ${kind === 'major' ? 'major' : 'harmonic minor'} scale`,
    detail: `${octaves} octave${octaves > 1 ? 's' : ''}, ${hands === 'both' ? 'hands together' : hands === 'R' ? 'right hand' : 'left hand'} · Learn`,
    minutes: 3,
    songId: warmId,
    launch: { type: 'scale', pc: tonic.pc, kind, octaves, hands },
    preset: { mode: 'learn' },
    done: doneToday(warmId),
  });

  // Latest report per song (recent pieces only, not exercises).
  const latest = new Map<string, Report>();
  for (const r of [...sessions].sort((a, b) => b.date - a.date)) {
    if (isExercise(r.songId) || !byId.has(r.songId)) continue;
    if (!latest.has(r.songId)) latest.set(r.songId, r);
  }

  // 2. Fix the weakest bars from recent sessions.
  const fixes = [...latest.values()]
    .filter((r) => r.weakRange && r.score < 90 && today.getTime() - r.date < 21 * DAY_MS)
    .slice(0, 2);
  for (const r of fixes) {
    const s = byId.get(r.songId)!;
    const { from, to } = r.weakRange!;
    const a = s.measures[from]?.number ?? from + 1;
    const b = s.measures[to]?.number ?? to + 1;
    const rate = Math.max(0.5, Math.min(1, Math.round(r.rate * 0.8 * 20) / 20));
    items.push({
      key: `fix-${r.songId}`,
      kind: 'fix',
      title: `Fix ${a === b ? `bar ${a}` : `bars ${a}–${b}`} of ${s.title}`,
      detail: `Loop at ${Math.round(rate * 100)}% in Practice until clean (scored ${r.score} last time)`,
      minutes: 5,
      songId: s.id,
      launch: { type: 'song', songId: s.id },
      preset: { mode: 'practice', loop: { from, to }, rate, hands: r.hands },
      done: doneToday(s.id),
    });
  }

  // 3. Review a piece that is getting rusty (not played for 4+ days, not yet mastered).
  const starsOf = (id: string) => Math.max(0, ...bests.filter((x) => x.songId === id).map((x) => x.stars));
  const rusty = [...latest.values()]
    .filter((r) => !fixes.includes(r) && today.getTime() - r.date >= 4 * DAY_MS && starsOf(r.songId) < 3)
    .sort((a, b) => a.date - b.date)[0];
  const mastered = [...latest.values()].find(
    (r) => !fixes.includes(r) && starsOf(r.songId) === 3 && !bests.some((x) => x.songId === r.songId && x.mode === 'audition'),
  );
  if (rusty) {
    const s = byId.get(rusty.songId)!;
    items.push({
      key: `review-${s.id}`,
      kind: 'review',
      title: `Review ${s.title}`,
      detail: `Last played ${Math.floor((today.getTime() - rusty.date) / DAY_MS)} days ago · play it through in Practice`,
      minutes: 4,
      songId: s.id,
      launch: { type: 'song', songId: s.id },
      preset: { mode: 'practice', loop: null },
      done: doneToday(s.id),
    });
  } else if (mastered) {
    const s = byId.get(mastered.songId)!;
    items.push({
      key: `audition-${s.id}`,
      kind: 'review',
      title: `Perform ${s.title}`,
      detail: 'Three stars in practice: try a full performance in Audition',
      minutes: 4,
      songId: s.id,
      launch: { type: 'song', songId: s.id },
      preset: { mode: 'audition', loop: null },
      done: doneToday(s.id),
    });
  }

  // 4. Something new when the repertoire is small or nothing else needs work.
  const played = new Set(sessions.map((r) => r.songId));
  const fresh = songs
    .filter((s) => s.source === 'builtin' && !isExercise(s.id) && !played.has(s.id) && s.level <= level + 1)
    .sort((a, b) => a.level - b.level)[0];
  const repertoire = [...played].filter((id) => !isExercise(id)).length;
  if (fresh && (repertoire < 4 || items.length < 3)) {
    items.push({
      key: `new-${fresh.id}`,
      kind: 'new',
      title: `Start learning ${fresh.title}`,
      detail: 'Right hand first, in Learn mode',
      minutes: 5,
      songId: fresh.id,
      launch: { type: 'song', songId: fresh.id },
      preset: { mode: 'learn', hands: ['R'], loop: null },
      done: doneToday(fresh.id),
    });
  }

  // 5. Sight-reading at the player's level, the same piece all day.
  const seed = day * 7 + level;
  const sightId = `ex-sight-${level}-4-${seed}`;
  items.push({
    key: 'sight',
    kind: 'sight',
    title: `Sight-read a new piece (level ${level})`,
    detail: 'Read it once, then play it through in Practice without stopping',
    minutes: 3,
    songId: sightId,
    launch: { type: 'sight', level, bars: 4, seed },
    preset: { mode: 'practice' },
    done: doneToday(sightId),
  });

  return items;
}
