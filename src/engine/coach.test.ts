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
