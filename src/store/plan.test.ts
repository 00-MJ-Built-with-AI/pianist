import { describe, expect, it } from 'vitest';
import type { Report } from '../engine/types';
import { builtinSongs } from '../music/library';
import { buildPlan, dayIndex } from './plan';
import type { Best } from './db';

const DAY = 86_400_000;
const today = new Date(2026, 9, 12, 18, 0, 0);

function report(songId: string, daysAgo: number, extra: Partial<Report> = {}): Report {
  return {
    id: `${songId}-${daysAgo}`,
    songId,
    songTitle: songId,
    mode: 'practice',
    date: today.getTime() - daysAgo * DAY,
    durationSec: 120,
    rate: 1,
    hands: ['R', 'L'],
    source: 'midi',
    completed: true,
    score: 95,
    stars: 3,
    accuracy: 0.95,
    notesExpected: 40,
    notesHit: 38,
    notesMissed: 2,
    extraNotes: 0,
    targetBpm: 100,
    playedBpm: 100,
    tempoStability: 3,
    measures: [],
    timing: [],
    tempoCurve: [],
    velocities: [],
    dynamicsRange: null,
    evenness: null,
    balance: null,
    chordSpreadMs: null,
    passes: [],
    tips: [],
    weakRange: null,
    recording: [],
    ...extra,
  };
}

const best = (songId: string, stars: number, mode: Best['mode'] = 'practice'): Best => ({
  key: `${songId}|${mode}`,
  songId,
  mode,
  score: stars * 30,
  stars,
  accuracy: 0.9,
  date: 0,
});

describe('daily plan', () => {
  const songs = builtinSongs();

  it('gives a beginner a warm-up, something new and sight-reading', () => {
    const plan = buildPlan({ today, sessions: [], songs, bests: [] });
    expect(plan.map((p) => p.kind)).toEqual(['warmup', 'new', 'sight']);
    expect(plan[1].preset).toMatchObject({ mode: 'learn', hands: ['R'] });
    expect(plan.every((p) => !p.done)).toBe(true);
  });

  it('turns weak bars from recent reports into loop items at a slower tempo', () => {
    const sessions = [report('minuet-in-g', 1, { score: 70, rate: 0.9, weakRange: { from: 8, to: 11 } })];
    const plan = buildPlan({ today, sessions, songs, bests: [best('minuet-in-g', 1)] });
    const fix = plan.find((p) => p.kind === 'fix')!;
    expect(fix.title).toBe('Fix bars 9–12 of Minuet in G (Simplified)');
    expect(fix.preset).toMatchObject({ mode: 'practice', loop: { from: 8, to: 11 }, rate: 0.7 });
  });

  it('brings back rusty pieces and ticks off what was played today', () => {
    const sessions = [report('twinkle', 6, { score: 80 }), report('ode-to-joy', 0)];
    const plan = buildPlan({ today, sessions, songs, bests: [best('twinkle', 2), best('ode-to-joy', 3)] });
    const review = plan.find((p) => p.kind === 'review')!;
    expect(review.songId).toBe('twinkle');
    expect(review.detail).toContain('6 days ago');
    expect(plan.some((p) => p.done)).toBe(false);
    const after = buildPlan({ today, sessions: [...sessions, report('twinkle', 0)], songs, bests: [] });
    expect(after.find((p) => p.songId === 'twinkle')).toBeUndefined();
  });

  it('rotates the warm-up key every day and keeps the sight-reading piece fixed for the day', () => {
    const a = buildPlan({ today, sessions: [], songs, bests: [] });
    const b = buildPlan({ today: new Date(today.getTime() + DAY), sessions: [], songs, bests: [] });
    expect(a[0].title).not.toBe(b[0].title);
    const later = buildPlan({ today: new Date(today.getTime() + 3_600_000), sessions: [], songs, bests: [] });
    expect(later.find((p) => p.kind === 'sight')!.songId).toBe(a.find((p) => p.kind === 'sight')!.songId);
    expect(dayIndex(today)).toBe(dayIndex(new Date(today.getTime() + 3_600_000)));
  });

  it('marks the warm-up done after playing it today', () => {
    const first = buildPlan({ today, sessions: [], songs, bests: [] });
    const done = buildPlan({ today, sessions: [report(first[0].songId, 0)], songs, bests: [] });
    expect(done[0].done).toBe(true);
  });
});
