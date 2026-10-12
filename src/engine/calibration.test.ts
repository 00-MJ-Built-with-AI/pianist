import { describe, expect, it } from 'vitest';
import { measureOffsets } from './calibration';

describe('latency calibration', () => {
  const clicks = Array.from({ length: 12 }, (_, i) => 1000 + i * 600);

  it('measures a steady delay', () => {
    const presses = clicks.map((c, i) => c + 40 + (i % 3) * 6 - 6);
    const r = measureOffsets(clicks, presses);
    expect(r.median).toBe(40);
    expect(r.spread).toBeLessThanOrEqual(12);
  });

  it('ignores stray notes and missed clicks', () => {
    const presses = clicks.filter((_, i) => i % 4 !== 0).map((c) => c + 25).concat([1300, 3900]);
    const r = measureOffsets(clicks, presses);
    expect(r.offsets).toHaveLength(9);
    expect(r.median).toBe(25);
  });

  it('needs enough taps', () => {
    expect(measureOffsets(clicks, [1030, 1630]).median).toBeNull();
  });
});
