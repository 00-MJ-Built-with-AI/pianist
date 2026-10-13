import { describe, expect, it } from 'vitest';
import { builtinSongs } from '../music/library';
import { buildSteps, wholeSong } from '../music/steps';
import type { Hand, Song } from '../music/types';
import { analyze } from './analysis';
import { Clock } from './clock';
import { FollowController, LearnController, RollController, type Flash, type SessionContext } from './controllers';
import { NoteMark } from './types';
import { DEFAULT_MODE_OPTIONS, TUNING_PRESETS } from '../store/settings';

const song = (id: string) => builtinSongs().find((s) => s.id === id)!;

function context(s: Song, hands: Hand[], bpm = s.bpm, extra: Partial<SessionContext> = {}): SessionContext {
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
    tuning: TUNING_PRESETS.normal,
    judging: 'both',
    learn: DEFAULT_MODE_OPTIONS.learn,
    roll: { lives: 0, perfectOnly: false, multiplier: true },
    phraseStart: (beat) => s.measures[Math.max(0, s.measures.findIndex((m) => m.start + m.length > beat))].start,
    ...extra,
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

  it('weights the score by what the player chose to count', () => {
    const s = song('ode-to-joy');
    // Every note right, but bars 5-6 rushed.
    const { c } = perform(s, ['R'], 100, (_i, beat) => ({ tempo: beat > 16 && beat <= 24 ? 1.4 : 1 }));
    const input = {
      song: s,
      mode: 'practice' as const,
      hands: ['R' as Hand],
      rate: 1,
      steps: c.stepResults(),
      extras: c.extras(),
      judgments: null,
      passes: [],
      recording: [],
      durationSec: 30,
      completed: true,
      source: 'midi' as const,
      regionMeasures: [0, s.measures.length - 1] as [number, number],
    };
    const notesOnly = analyze({ ...input, weights: { notes: 1, timing: 0, tempo: 0, dynamics: 0 } });
    const tempoOnly = analyze({ ...input, weights: { notes: 0, timing: 0, tempo: 1, dynamics: 0 } });
    expect(notesOnly.score).toBe(100);
    expect(tempoOnly.score).toBeLessThan(100);
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

describe('moving around while playing', () => {
  it('skips a step in Learn and marks it missed', () => {
    const s = song('ode-to-joy');
    const ctx = context(s, ['R']);
    const c = new LearnController(ctx);
    c.start(0);
    c.skip(500);
    expect(c.stepResults()[0].missed).toEqual([64]);
    expect(ctx.marks[ctx.userNotes[0].id]).toBe(NoteMark.Missed);
    expect(c.targets()).toEqual([64]); // the second E
    expect(c.onNote(press(64, 600))).toBe('good');
  });

  it('jumps to a bar in Learn and plays it again', () => {
    const s = song('ode-to-joy');
    const ctx = context(s, ['R']);
    const c = new LearnController(ctx);
    c.start(0);
    c.seek(s.measures[2].start, 1000);
    expect(c.clampBeat()).toBe(8);
    expect(c.targets()).toEqual([60]); // bar 3 starts on C
    c.seek(0, 2000);
    expect(c.clampBeat()).toBe(0);
  });

  it('jumps in Practice and Piano Roll', () => {
    const s = song('mary-lamb');
    const ctx = context(s, ['R']);
    const f = new FollowController(ctx, false);
    f.start(0);
    f.onNote(press(64, 1000));
    f.seek(s.measures[1].start, 2000);
    expect(f.targets()).toEqual([64]);
    f.seek(0, 3000);
    expect(f.stepResults()[0].played).toEqual([]);

    const ctx2 = context(s, ['R']);
    const r = new RollController(ctx2);
    r.start(0);
    r.seek(4, 5000);
    const n = ctx2.userNotes.find((x) => x.start === 4)!;
    expect(r.onNote(press(n.pitch, ctx2.clock.timeAt(4)))).toBe('good');
  });
});

describe('practice settings', () => {
  it('clicks on eighths with an accented downbeat', async () => {
    const { buildClicks } = await import('./scheduler');
    const s = song('ode-to-joy');
    const clicks = buildClicks(s, 0, 4, { subdivision: 'eighth', accent: true, sound: 'wood' });
    const countIn = clicks.filter((c) => c.beat < 0);
    expect(countIn).toHaveLength(8);
    expect(countIn.map((c) => c.level).slice(0, 3)).toEqual(['accent', 'sub', 'beat']);
    expect(clicks.find((c) => c.beat === 0)!.level).toBe('accent');
    const noAccent = buildClicks(s, 0, 4, { subdivision: 'beat', accent: false, sound: 'beep' });
    expect(noAccent.every((c) => c.level === 'beat')).toBe(true);
  });

  it('judges more strictly with the strict preset', () => {
    const s = song('mary-lamb');
    const strict = { ...context(s, ['R']), tuning: TUNING_PRESETS.strict };
    const r = new RollController(strict);
    r.start(0);
    const n = strict.userNotes[0];
    r.onNote(press(n.pitch, strict.clock.timeAt(n.start) + 130)); // inside normal (160), outside strict (110)
    expect(r.judgments().wrong).toBe(1);
    const relaxed = { ...context(s, ['R']), tuning: TUNING_PRESETS.relaxed };
    const r2 = new RollController(relaxed);
    r2.start(0);
    r2.onNote(press(n.pitch, relaxed.clock.timeAt(n.start) + 90)); // Perfect when relaxed (100)
    expect(r2.judgments().perfect).toBe(1);
  });
});

describe('mode customisations', () => {
  const learnWith = (s: Song, learn: Partial<SessionContext['learn']>, judging: SessionContext['judging'] = 'both') =>
    context(s, ['R'], s.bpm, { learn: { ...DEFAULT_MODE_OPTIONS.learn, ...learn }, judging });

  it('Learn, rhythm only: any key plays the step', () => {
    const s = song('ode-to-joy');
    const c = new LearnController(learnWith(s, {}, 'rhythm'));
    c.start(0);
    expect(c.onNote(press(30, 100))).toBe('good');
    expect(c.targets()).toEqual([64]); // on to the second E
    expect(c.accuracy()).toBe(1);
  });

  it('Learn wrong-note rules: ignore, or back to the start of the phrase', () => {
    const s = song('ode-to-joy');
    const ignore = new LearnController(learnWith(s, { wrongNote: 'ignore' }));
    ignore.start(0);
    expect(ignore.onNote(press(30, 100))).toBe('neutral');
    expect(ignore.accuracy()).toBe(null);

    const ctx = learnWith(s, { wrongNote: 'restart' });
    const c = new LearnController(ctx);
    c.start(0);
    // Play into bar 2, then a wrong note sends the cursor back to bar 2's start.
    const steps = buildSteps(ctx.userNotes, new Set(['R']));
    let t = 100;
    for (const step of steps.slice(0, 6)) step.pitches.forEach((p) => c.onNote(press(p, (t += 300))));
    expect(c.clampBeat()).toBe(steps[6].beat);
    c.onNote(press(30, (t += 300)));
    expect(c.clampBeat()).toBe(s.measures[1].start);
  });

  it('Learn, hold notes full length', async () => {
    const { inputHub } = await import('../input/hub');
    const s = song('ode-to-joy');
    const c = new LearnController(learnWith(s, { holdFull: true }));
    c.start(0);
    // Let go too soon: the same note again.
    c.onNote(press(64, 1000));
    c.update(1050);
    expect(c.targets()).toEqual([64]);
    expect(c.stepResults()[0].wrongBefore).toBe(1);
    // Held: it moves on once the note has sounded long enough (a quarter at 100 bpm, 80%).
    c.onNote(press(64, 2000));
    inputHub.held.set(64, press(64, 2000));
    c.update(2200);
    expect(c.targets()).toEqual([]); // still holding
    c.update(2000 + 0.8 * 600 + 10);
    inputHub.held.delete(64);
    expect(c.targets()).toEqual([64]); // the next E
  });

  it('Learn look-ahead lists the next steps', () => {
    const s = song('ode-to-joy');
    const c = new LearnController(learnWith(s, {}));
    c.start(0);
    expect(c.upcoming(3)).toEqual([[64], [65], [67]]);
  });

  it('Piano Roll game: lives run out, points multiply with the combo', () => {
    const s = song('mary-lamb');
    const ctx = context(s, ['R'], s.bpm, { roll: { lives: 2, perfectOnly: false, multiplier: true } });
    const r = new RollController(ctx);
    r.start(0);
    const n = ctx.userNotes;
    r.onNote(press(n[0].pitch, ctx.clock.timeAt(n[0].start)));
    expect(r.judgments().points).toBe(100);
    expect(r.judgments().lives).toBe(2);
    r.onNote(press(30, ctx.clock.timeAt(n[1].start)));
    r.onNote(press(31, ctx.clock.timeAt(n[1].start) + 5));
    expect(r.judgments().lives).toBe(0);
    expect(r.judgments().gameOver).toBe(true);

    const ctx2 = context(s, ['R'], s.bpm, { roll: { lives: 0, perfectOnly: true, multiplier: true } });
    const r2 = new RollController(ctx2);
    r2.start(0);
    r2.onNote(press(ctx2.userNotes[0].pitch, ctx2.clock.timeAt(ctx2.userNotes[0].start) + 120)); // good, not perfect
    expect(r2.judgments()).toMatchObject({ good: 0, miss: 1, points: 0 });
  });

  it('Piano Roll rhythm only and notes only', () => {
    const s = song('mary-lamb');
    const rhythm = context(s, ['R'], s.bpm, { judging: 'rhythm' });
    const r = new RollController(rhythm);
    r.start(0);
    expect(r.onNote(press(30, rhythm.clock.timeAt(rhythm.userNotes[0].start)))).toBe('good');

    const notes = context(s, ['R'], s.bpm, { judging: 'notes' });
    const r2 = new RollController(notes);
    r2.start(0);
    const first = notes.userNotes[0];
    expect(r2.onNote(press(first.pitch, notes.clock.timeAt(first.start) + 400))).toBe('good');
    expect(r2.judgments().perfect).toBe(1);
  });

  it('fading metronome', async () => {
    const { buildClicks } = await import('./scheduler');
    const s = song('ode-to-joy');
    const o = { subdivision: 'beat' as const, accent: true, sound: 'beep' as const };
    const fade = buildClicks(s, 0, 4, { ...o, fade: 'fade', fadeAfter: 2 });
    expect(fade.filter((c) => c.beat >= 0).map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fade.filter((c) => c.beat < 0)).toHaveLength(4); // the count-in stays
    const beat1 = buildClicks(s, 0, 4, { ...o, fade: 'beat1' }).filter((c) => c.beat >= 0);
    expect(beat1.every((c) => c.beat % 4 === 0)).toBe(true);
    const alt = buildClicks(s, 0, 4, { ...o, fade: 'alternate' }).filter((c) => c.beat >= 0 && c.beat < 16);
    expect(alt.map((c) => c.beat)).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
  });
});
