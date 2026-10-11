import { describe, expect, it } from 'vitest';
import { builtinSongs } from '../music/library';
import { buildSteps, wholeSong } from '../music/steps';
import type { Hand, Song } from '../music/types';
import { analyze } from './analysis';
import { Clock } from './clock';
import { FollowController, LearnController, RollController, type Flash, type SessionContext } from './controllers';
import { NoteMark } from './types';

const song = (id: string) => builtinSongs().find((s) => s.id === id)!;

function context(s: Song, hands: Hand[], bpm = s.bpm): SessionContext {
  const region = wholeSong(s);
  const flashes: Flash[] = [];
  return {
    clock: new Clock(),
    region,
    hands,
    userNotes: s.notes.filter((n) => hands.includes(n.hand)),
    allNotes: s.notes,
    marks: new Uint8Array(s.notes.length),
    targetBps: bpm / 60,
    leadIn: 1,
    flash: (f) => flashes.push(f),
    inputLag: () => 0,
  };
}

const press = (pitch: number, time: number, velocity = 80) => ({ pitch, time, velocity, source: 'midi' as const });

describe('Learn mode', () => {
  it('waits for every chord note, in any order', () => {
    const s = song('chord-basics');
    const ctx = context(s, ['L', 'R']);
    const c = new LearnController(ctx);
    c.start(0);
    const steps = buildSteps(ctx.userNotes, new Set(['L', 'R']));
    expect(c.targets().sort()).toEqual([...steps[0].pitches].sort());
    expect(c.onNote(press(61, 100))).toBe('wrong');
    let t = 200;
    for (const step of steps) {
      for (const p of [...step.pitches].reverse()) {
        expect(c.onNote(press(p, t))).toBe('good');
        t += 30;
      }
      t += 500;
    }
    expect(c.isComplete(t + 100000)).toBe(true);
    for (const n of ctx.userNotes) expect(ctx.marks[n.id]).toBe(NoteMark.Hit);
    expect(c.stepResults()[0].wrongBefore).toBe(1);
  });

  it('does not let a chord build up over a long gap', () => {
    const s = song('chord-basics');
    const ctx = context(s, ['R']);
    const c = new LearnController(ctx);
    c.start(0);
    c.onNote(press(60, 100));
    c.onNote(press(64, 200));
    c.onNote(press(67, 3000)); // C and E were released long ago
    expect(c.targets().sort()).toEqual([60, 64]);
  });
});

/** Plays the given hands through a song at a steady tempo, with optional changes per step. */
function perform(
  s: Song,
  hands: Hand[],
  bpm: number,
  tweak: (stepIndex: number, beat: number) => { skip?: boolean; extra?: number; tempo?: number } = () => ({}),
) {
  const ctx = context(s, hands, bpm);
  const c = new FollowController(ctx, false);
  c.start(0);
  const steps = buildSteps(ctx.userNotes, new Set(hands));
  let t = 1000;
  let prevBeat = steps[0].beat;
  for (const step of steps) {
    const tw = tweak(step.index, step.beat);
    t += ((step.beat - prevBeat) * 60000) / (bpm * (tw.tempo ?? 1));
    prevBeat = step.beat;
    if (tw.extra) c.onNote(press(tw.extra, t - 5));
    if (!tw.skip) step.pitches.forEach((p, i) => c.onNote(press(p, t + i * 8, hands.includes('R') ? 80 : 60)));
    c.update(t);
  }
  c.update(t + 5000);
  return { ctx, c, steps, end: t + 5000 };
}

describe('Practice mode (following)', () => {
  it('counts skipped notes as missed and stray notes as extra', () => {
    const s = song('ode-to-joy');
    const { c, ctx } = perform(s, ['R'], 100, (i) => (i === 5 ? { skip: true } : i === 9 ? { extra: 49 } : {}));
    const res = c.stepResults();
    expect(res[5].missed).toHaveLength(1);
    expect(c.extras()).toHaveLength(1);
    expect(ctx.marks[res.length ? ctx.userNotes[5].id : 0]).toBe(NoteMark.Missed);
    expect(c.isComplete(1e9)).toBe(true);
  });

  it('reports rushed bars and the weakest stretch', () => {
    const s = song('ode-to-joy');
    // Bars 5-6 (indexes 4-5) played 30% faster.
    const { c } = perform(s, ['R'], 100, (_i, beat) => ({ tempo: beat > 16 && beat <= 24 ? 1.3 : 1 }));
    const r = analyze({
      song: s,
      mode: 'practice',
      hands: ['R'],
      rate: 1,
      steps: c.stepResults(),
      extras: c.extras(),
      judgments: null,
      passes: [],
      recording: [],
      durationSec: 30,
      completed: true,
      source: 'midi',
      regionMeasures: [0, s.measures.length - 1],
    });
    expect(r.accuracy).toBe(1);
    const rushed = r.measures.filter((m) => m.tempoRatio !== null && m.tempoRatio > 1.12).map((m) => m.number);
    expect(rushed).toEqual(expect.arrayContaining([5, 6]));
    expect(r.tips.join(' ')).toMatch(/rushed bars 5–6/);
    expect(r.playedBpm).toBeGreaterThan(95);
  });

  it('accepts a late chord note after the cursor moved on', () => {
    const s = song('chord-basics');
    const ctx = context(s, ['R']);
    const c = new FollowController(ctx, false);
    c.start(0);
    c.onNote(press(60, 1000));
    c.onNote(press(64, 1010));
    // Next chord starts before G arrives
    c.onNote(press(65, 3400));
    c.onNote(press(67, 1200)); // timestamps are what matter, not arrival order
    expect(c.stepResults()[0].missed).toEqual([]);
  });
});

describe('Piano Roll mode', () => {
  it('judges timing against the clock', () => {
    const s = song('mary-lamb');
    const ctx = context(s, ['R']);
    const c = new RollController(ctx);
    c.start(0);
    const notes = ctx.userNotes;
    // Perfect, late, early, and then nothing for the rest.
    c.onNote(press(notes[0].pitch, ctx.clock.timeAt(notes[0].start) + 10));
    c.onNote(press(notes[1].pitch, ctx.clock.timeAt(notes[1].start) + 120));
    c.onNote(press(notes[2].pitch, ctx.clock.timeAt(notes[2].start) - 120));
    c.onNote(press(30, ctx.clock.timeAt(notes[3].start)));
    c.update(ctx.clock.timeAt(s.totalBeats) + 1000);
    const j = c.judgments();
    expect(j.perfect).toBe(1);
    expect(j.good).toBe(2);
    expect(j.wrong).toBe(1);
    expect(j.miss).toBe(notes.length - 3);
    expect(ctx.marks[notes[1].id]).toBe(NoteMark.Late);
    expect(ctx.marks[notes[2].id]).toBe(NoteMark.Early);
  });
});
