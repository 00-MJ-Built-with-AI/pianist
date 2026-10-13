import { describe, expect, it } from 'vitest';
import { builtinSongs } from '../music/library';
import { buildCoachPlan, passCompletesStep } from './coach';

const song = (id: string) => builtinSongs().find((s) => s.id === id)!;

describe('practice coach', () => {
  it('builds the full routine for a two-handed passage', () => {
    const plan = buildCoachPlan(song('minuet-in-g'), { from: 8, to: 11, startRate: 0.6, targetRate: 1 });
    expect(plan.map((s) => s.id)).toEqual(['rh', 'lh', 'together', 'speed', 'perform']);
    expect(plan[0]).toMatchObject({ mode: 'learn', hands: ['R'], wait: true, rate: 0.6 });
    expect(plan[3]).toMatchObject({ mode: 'practice', autoSpeedUp: true, finishAtRate: 1 });
    expect(plan[4]).toMatchObject({ wait: false, rate: 1 });
  });

  it('skips the hands-separate steps when only one hand plays', () => {
    const plan = buildCoachPlan(song('fur-elise'), { from: 1, to: 1, startRate: 0.5, targetRate: 0.8 });
    expect(plan.map((s) => s.id)).toEqual(['together', 'speed', 'perform']);
    expect(plan[0].hands).toEqual(['R']);
  });

  it('advances only on clean passes, and on the speed step only at the target tempo', () => {
    const [rh, , , speed] = buildCoachPlan(song('minuet-in-g'), { from: 0, to: 3, startRate: 0.6, targetRate: 0.9 });
    const pass = (accuracy: number, rate: number) => ({ accuracy, rate, durationSec: 10, clean: accuracy >= 0.9 });
    expect(passCompletesStep(rh, pass(0.8, 0.6))).toBe(false);
    expect(passCompletesStep(rh, pass(0.95, 0.6))).toBe(true);
    expect(passCompletesStep(speed, pass(1, 0.75))).toBe(false);
    expect(passCompletesStep(speed, pass(1, 0.9))).toBe(true);
  });
});

describe('fix my mistakes', () => {
  it('turns weak bars into slowed-down loops', async () => {
    const { buildFixPlan } = await import('./coach');
    const m = (index: number, score: number | null) => ({
      index,
      number: index + 1,
      expected: 4,
      hit: 4,
      missed: 0,
      extra: 0,
      hesitations: 0,
      tempoRatio: null,
      meanAbsDevMs: null,
      score,
    });
    const report = {
      rate: 0.8,
      hands: ['R', 'L'],
      measures: [m(0, 1), m(1, 0.5), m(2, 1), m(3, 0.6), m(4, 1), m(5, 1), m(6, 1), m(7, 0.3), m(8, null)],
    } as unknown as Parameters<typeof buildFixPlan>[0];
    const plan = buildFixPlan(report);
    expect(plan.map((s) => s.region)).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 7 },
    ]);
    expect(plan[0]).toMatchObject({ rate: 0.6, finishAtRate: 0.8, autoSpeedUp: true, mode: 'practice' });
    expect(plan[1].title).toBe('Bar 8: 60% → 80%');
  });
});

describe('your own coach routines', () => {
  it('turns templates into steps, chunks included', async () => {
    const { ROUTINE_TEMPLATES, routineToSteps } = await import('./coach');
    const s = song('ode-to-joy');
    const chunks = ROUTINE_TEMPLATES.find((r) => r.id === 'chunks')!;
    const steps = routineToSteps(s, chunks, { from: 0, to: 3, startRate: 0.6, targetRate: 1 });
    // Two chunks of 2 bars learned, the same two sped up, then the whole passage at tempo.
    expect(steps.map((x) => [x.region!.from, x.region!.to])).toEqual([
      [0, 1], [2, 3], [0, 1], [2, 3], [0, 3],
    ]);
    expect(steps[2].autoSpeedUp).toBe(true);
    expect(steps[4].wait).toBe(false);
  });

  it('skips a hand the passage does not have, and sets special steps', async () => {
    const { routineToSteps } = await import('./coach');
    const s = song('ode-to-joy');
    const onlyRight = s.notes.every((n) => n.hand === 'R');
    const steps = routineToSteps(
      s,
      {
        id: 'x',
        name: 'x',
        steps: [
          { kind: 'listen', hands: 'both', how: 'keep', startRate: 1, targetRate: 1, passes: 1, chunk: 2, rhythm: 'straight' },
          { kind: 'play', hands: 'L', how: 'learn', startRate: 0.6, targetRate: 0.6, passes: 1, chunk: 0, rhythm: 'straight' },
          { kind: 'memory', hands: 'both', how: 'keep', startRate: 1, targetRate: 1, passes: 2, chunk: 0, rhythm: 'dotted' },
        ],
      },
      { from: 0, to: 3, startRate: 0.6, targetRate: 1 },
    );
    expect(steps[0]).toMatchObject({ mode: 'listen', region: { from: 0, to: 3 } }); // listening isn't chunked
    expect(steps.some((x) => x.hands.length === 1 && x.hands[0] === 'L')).toBe(!onlyRight);
    const memory = steps[steps.length - 1];
    expect(memory).toMatchObject({ view: 'memory', passesNeeded: 2, variant: 'dotted', wait: false });
  });

  it('needs the given number of clean passes in a row', async () => {
    const { stepDone } = await import('./coach');
    const st = { id: 'a', title: '', hint: '', mode: 'practice' as const, hands: ['R' as const], wait: true, rate: 1, autoSpeedUp: false, passTarget: 0.9, passesNeeded: 2 };
    const pass = (accuracy: number) => ({ accuracy, rate: 1, durationSec: 10, clean: accuracy >= 0.9 });
    expect(stepDone(st, [pass(0.95)])).toBe(false);
    expect(stepDone(st, [pass(0.95), pass(0.5), pass(0.95)])).toBe(false);
    expect(stepDone(st, [pass(0.5), pass(0.95), pass(0.92)])).toBe(true);
  });
});
