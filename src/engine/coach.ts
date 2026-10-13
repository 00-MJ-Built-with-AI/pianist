import type { Hand, Song } from '../music/types';
import type { Variant } from '../music/rhythm';
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
  /** Clean passes in a row the step needs (default 1). */
  passesNeeded?: number;
  /** From memory (no sheet music, no falling notes) or eyes on the sheet (no falling notes, no key lights). */
  view?: 'memory' | 'sheet';
  /** Practise the passage in a rhythm variation. */
  variant?: Variant;
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

/** The step is done when its last passes (as many as it needs, in a row) all count. */
export function stepDone(step: CoachStep, passes: readonly PassSummary[]): boolean {
  const need = Math.max(1, step.passesNeeded ?? 1);
  if (passes.length < need) return false;
  return passes.slice(-need).every((p) => passCompletesStep(step, p));
}

/* ---------------------------------------------------------------- your own routines */

export type RoutineStepKind = 'play' | 'listen' | 'memory' | 'sheet';

/** One step of a routine, as the player builds it. */
export interface RoutineStep {
  kind: RoutineStepKind;
  hands: 'R' | 'L' | 'both';
  /** learn = the music waits; follow = at your own pace; keep = keeps going at tempo. */
  how: 'learn' | 'follow' | 'keep';
  startRate: number;
  /** Above startRate, every clean pass speeds up until this tempo. */
  targetRate: number;
  passes: number;
  /** Bars at a time (0 = the whole passage at once). */
  chunk: number;
  rhythm: 'straight' | Variant;
}

export interface Routine {
  id: string;
  name: string;
  steps: RoutineStep[];
  builtin?: boolean;
}

export const CLASSIC_ROUTINE = 'classic';

const step = (patch: Partial<RoutineStep>): RoutineStep => ({
  kind: 'play',
  hands: 'both',
  how: 'learn',
  startRate: 0.6,
  targetRate: 0.6,
  passes: 1,
  chunk: 0,
  rhythm: 'straight',
  ...patch,
});

export const newRoutineStep = (kind: RoutineStepKind = 'play'): RoutineStep =>
  kind === 'listen' ? step({ kind, how: 'keep', startRate: 1, targetRate: 1 }) : kind === 'play' ? step({}) : step({ kind, how: 'follow', startRate: 0.8, targetRate: 0.8 });

/** Ready-made routines (copy one to change it). */
export const ROUTINE_TEMPLATES: Routine[] = [
  { id: CLASSIC_ROUTINE, name: 'Classic coach', steps: [], builtin: true },
  {
    id: 'hands-separately',
    name: 'Hands separately, then together',
    builtin: true,
    steps: [
      step({ hands: 'R' }),
      step({ hands: 'L' }),
      step({ hands: 'both' }),
      step({ how: 'follow', startRate: 0.6, targetRate: 1 }),
      step({ how: 'keep', startRate: 1, targetRate: 1 }),
    ],
  },
  {
    id: 'slow-fast',
    name: 'Slow → fast',
    builtin: true,
    steps: [step({ how: 'follow', startRate: 0.5, targetRate: 1 }), step({ how: 'keep', startRate: 1, targetRate: 1, passes: 2 })],
  },
  {
    id: 'chunks',
    name: 'Chunks: 2 bars at a time, then join',
    builtin: true,
    steps: [
      step({ chunk: 2, startRate: 0.7, targetRate: 0.7 }),
      step({ chunk: 2, how: 'follow', startRate: 0.7, targetRate: 1 }),
      step({ how: 'keep', startRate: 1, targetRate: 1 }),
    ],
  },
  {
    id: 'rhythms',
    name: 'Rhythm variations',
    builtin: true,
    steps: [
      step({ how: 'follow', startRate: 0.7, targetRate: 0.7, rhythm: 'dotted' }),
      step({ how: 'follow', startRate: 0.7, targetRate: 0.7, rhythm: 'reverse' }),
      step({ how: 'follow', startRate: 0.7, targetRate: 1 }),
      step({ how: 'keep', startRate: 1, targetRate: 1 }),
    ],
  },
  {
    id: 'listen-memory',
    name: 'Listen, learn, then from memory',
    builtin: true,
    steps: [
      newRoutineStep('listen'),
      step({ startRate: 0.7, targetRate: 0.7 }),
      step({ kind: 'sheet', how: 'follow', startRate: 0.7, targetRate: 1 }),
      step({ kind: 'memory', how: 'keep', startRate: 1, targetRate: 1 }),
    ],
  },
];

const HANDS_TEXT = { R: 'Right hand', L: 'Left hand', both: 'Hands together' };
const HOW_TEXT = { learn: 'the music waits', follow: 'at your own pace', keep: 'keep going' };

/** One line describing a routine step. */
export function describeStep(s: RoutineStep): string {
  const tempo = s.targetRate > s.startRate + 1e-6 ? `${pct(s.startRate)} → ${pct(s.targetRate)}` : pct(s.startRate);
  if (s.kind === 'listen') return `👂 Listen (${s.hands === 'both' ? 'both hands' : HANDS_TEXT[s.hands].toLowerCase()}) at ${pct(s.startRate)}`;
  const icon = s.kind === 'memory' ? '🎭 From memory: ' : s.kind === 'sheet' ? '🎼 Eyes on the sheet: ' : '';
  const extras = [
    s.chunk ? `${s.chunk} bar${s.chunk > 1 ? 's' : ''} at a time` : '',
    s.rhythm !== 'straight' ? (s.rhythm === 'dotted' ? 'dotted rhythm' : 'reverse dotted') : '',
    s.passes > 1 ? `${s.passes} clean passes` : '',
  ].filter(Boolean);
  return `${icon}${HANDS_TEXT[s.hands]}, ${HOW_TEXT[s.how]}, ${tempo}${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

const HINTS: Record<RoutineStepKind, string> = {
  play: 'Loops until it counts as clean, then moves on.',
  listen: 'Pianist plays it once. Listen to how it should go.',
  memory: 'No sheet music, no falling notes. Play it by heart.',
  sheet: 'No falling notes or key lights: read it from the sheet music.',
};

/** The coach steps of a routine on a passage (chunks become a step per chunk). */
export function routineToSteps(song: Song, routine: Routine, o: CoachOptions): CoachStep[] {
  if (routine.id === CLASSIC_ROUTINE) return buildCoachPlan(song, o);
  const passTarget = o.cleanPass ?? 0.9;
  const notesIn = (from: number, to: number) => {
    const start = song.measures[from].start;
    const end = song.measures[to].start + song.measures[to].length;
    return song.notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6);
  };
  const present = (['R', 'L'] as Hand[]).filter((h) => notesIn(o.from, o.to).some((n) => n.hand === h));
  const out: CoachStep[] = [];
  routine.steps.forEach((rs, k) => {
    const hands: Hand[] = rs.hands === 'both' ? present : present.includes(rs.hands) ? [rs.hands] : [];
    if (!hands.length) return;
    const regions: Array<{ from: number; to: number }> = [];
    const size = rs.kind === 'listen' ? 0 : rs.chunk;
    if (size > 0 && o.to - o.from + 1 > size) for (let f = o.from; f <= o.to; f += size) regions.push({ from: f, to: Math.min(o.to, f + size - 1) });
    else regions.push({ from: o.from, to: o.to });
    regions.forEach((region, c) => {
      if (!notesIn(region.from, region.to).some((n) => hands.includes(n.hand))) return;
      const a = song.measures[region.from].number;
      const b = song.measures[region.to].number;
      const where = regions.length > 1 ? `Bars ${a === b ? a : `${a}–${b}`}: ` : '';
      const speedUp = rs.kind !== 'listen' && rs.targetRate > rs.startRate + 1e-6;
      out.push({
        id: `r${k}-${c}`,
        title: where + describeStep(rs),
        hint: HINTS[rs.kind] + (speedUp ? ' Every clean pass goes faster.' : ''),
        mode: rs.kind === 'listen' ? 'listen' : rs.how === 'learn' ? 'learn' : 'practice',
        hands,
        wait: rs.kind !== 'listen' && rs.how !== 'keep',
        rate: rs.startRate,
        autoSpeedUp: speedUp,
        passTarget,
        finishAtRate: speedUp ? rs.targetRate : undefined,
        region,
        passesNeeded: rs.kind === 'listen' ? 1 : rs.passes,
        view: rs.kind === 'memory' ? 'memory' : rs.kind === 'sheet' ? 'sheet' : undefined,
        variant: rs.rhythm === 'straight' || rs.kind === 'listen' ? undefined : rs.rhythm,
      });
    });
  });
  return out;
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
