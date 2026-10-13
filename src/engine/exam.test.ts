import { describe, expect, it } from 'vitest';
import { examTotal, gradeFor } from './exam';

describe('mock exam', () => {
  it('weights pieces 60%, scales and sight-reading 20% each', () => {
    const total = examTotal([
      { part: 'scales', score: 80 },
      { part: 'scales', score: 100 },
      { part: 'pieces', score: 90 },
      { part: 'sight', score: 50 },
    ]);
    expect(total).toBe(Math.round((20 * 90 + 60 * 90 + 20 * 50) / 100));
    expect(gradeFor(total)).toBe('Merit');
  });

  it('counts items not played as 0 and leaves out parts not chosen', () => {
    expect(examTotal([{ part: 'pieces', score: 90 }, { part: 'pieces', score: null }])).toBe(45);
    expect(examTotal([{ part: 'scales', score: 88 }])).toBe(88);
    expect(gradeFor(88)).toBe('Distinction');
    expect(gradeFor(59)).toBe('Not yet');
  });
});
