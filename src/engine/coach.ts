import type { Hand, Song } from '../music/types';
import type { ModeKind, PassSummary, Report } from './types';

/*
 * Practice coach: the routine a teacher would give for a hard passage — each hand alone slowly,
 * then together slowly, then gradually up to tempo, and finally one clean run that keeps going.
 * Each step loops the passage until a clean pass, then moves on by itself.
 */

export interface CoachStep {
  id: string;
  title: string;
  hint: string;
  mode: ModeKind;
  hands: Hand[];
  wait: boolean;
  rate: number;
  autoSpeedUp: boolean;
  /** Accuracy a pass needs to count as clean. */
  passTarget: number;
  /** For the speed-up step: done after a clean pass at this tempo. */
  finishAtRate?: number;
  /** Bars this step loops (otherwise the coach's passage). */
  region?: { from: number; to: number };
}

export interface CoachOptions {
  from: number; // bar indexes
  to: number;
  startRate: number;
  targetRate: number;
  cleanPass?: number; // accuracy that counts as clean (default 0.9)
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function buildCoachPlan(song: Song, o: CoachOptions): CoachStep[] {
  const start = song.measures[o.from].start;
  const end = song.measures[o.to].start + song.measures[o.to].length;
  const inRange = song.notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6);
  const has = (h: Hand) => inRange.some((n) => n.hand === h);
  const hands: Hand[] = (['R', 'L'] as Hand[]).filter(has);
  const both = hands.length === 2;
  const steps: CoachStep[] = [];
  const slow = o.startRate;
  const passTarget = o.cleanPass ?? 0.9;

  if (both) {
    steps.push({
      id: 'rh',
      title: `Right hand alone, slowly (${pct(slow)})`,
      hint: 'The music waits for you. Play it cleanly once.',
      mode: 'learn',
      hands: ['R'],
      wait: true,
      rate: slow,
      autoSpeedUp: false,
      passTarget,
    });
    steps.push({
      id: 'lh',
      title: `Left hand alone, slowly (${pct(slow)})`,
      hint: 'Now the other hand on its own.',
      mode: 'learn',
      hands: ['L'],
      wait: true,
      rate: slow,
      autoSpeedUp: false,
      passTarget,
    });
  }
  steps.push({
    id: 'together',
    title: both ? `Hands together, slowly (${pct(slow)})` : `Slowly (${pct(slow)})`,
    hint: both ? 'Put the hands together. The music still waits.' : 'The music waits for you. Play it cleanly once.',
    mode: 'learn',
    hands,
    wait: true,
    rate: slow,
    autoSpeedUp: false,
    passTarget,
  });
  if (o.targetRate > slow + 1e-6) {
    steps.push({
      id: 'speed',
      title: `Up to tempo: ${pct(slow)} → ${pct(o.targetRate)}`,
      hint: 'At your own pace; every clean pass goes 5% faster.',
      mode: 'practice',
      hands,
      wait: true,
      rate: slow,
      autoSpeedUp: true,
      passTarget,
      finishAtRate: o.targetRate,
    });
  }
  steps.push({
    id: 'perform',
    title: `Keep going at ${pct(o.targetRate)}`,
    hint: "One clean run that doesn't stop, like a performance.",
    mode: 'practice',
    hands,
    wait: false,
    rate: o.targetRate,
    autoSpeedUp: false,
    passTarget,
  });
  return steps;
}

/** Whether a finished pass completes the step. */
export function passCompletesStep(step: CoachStep, pass: PassSummary): boolean {
  if (pass.accuracy < step.passTarget) return false;
  if (step.finishAtRate !== undefined) return pass.rate >= step.finishAtRate - 1e-6;
  return true;
}

/**
 * "Fix my mistakes": the stretches of bars that went wrong in a report, each looped slowly in
 * Practice and sped back up to the tempo of the run, one after the other.
 */
export function buildFixPlan(report: Report, cleanPass = 0.9): CoachStep[] {
  const bad = report.measures.filter((m) => m.score !== null && m.score < 0.9).map((m) => m.index);
  const ranges: Array<{ from: number; to: number }> = [];
  for (const i of bad) {
    const last = ranges[ranges.length - 1];
    if (last && i - last.to <= 2) last.to = i; // one good bar between two bad ones joins them
    else ranges.push({ from: i, to: i });
  }
  const target = report.rate;
  const slow = Math.max(0.4, Math.round(target * 0.75 * 20) / 20);
  return ranges.slice(0, 4).map((r, k) => {
    const a = report.measures.find((m) => m.index === r.from)?.number ?? r.from + 1;
    const b = report.measures.find((m) => m.index === r.to)?.number ?? r.to + 1;
    return {
      id: `fix-${k}`,
      title: `${a === b ? `Bar ${a}` : `Bars ${a}–${b}`}: ${pct(slow)} → ${pct(target)}`,
      hint: 'Slowly first; every clean pass goes faster until you are back at your tempo.',
      mode: 'practice',
      hands: report.hands,
      wait: true,
      rate: slow,
      autoSpeedUp: true,
      passTarget: cleanPass,
      finishAtRate: target,
      region: r,
    };
  });
}
