import type { Hand, Song } from '../music/types';
import type { InputSource } from '../input/hub';
import type { Judgments } from './controllers';
import type { ScoreWeights } from '../store/settings';
import type { ExtraNote, MeasureStat, ModeKind, PassSummary, RecordedEvent, Report, StepResult } from './types';

export interface AnalysisInput {
  song: Song;
  mode: ModeKind;
  hands: Hand[];
  rate: number;
  steps: StepResult[];
  extras: ExtraNote[];
  judgments: Judgments | null;
  passes: PassSummary[];
  recording: RecordedEvent[];
  durationSec: number;
  completed: boolean;
  source: InputSource | 'none';
  regionMeasures: [number, number];
  /** How much notes, timing, steady tempo and dynamics count in Practice and Audition scores. */
  weights?: ScoreWeights;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Least-squares line time = a + b·beat. */
function fitLine(pts: Array<{ beat: number; time: number }>): { a: number; b: number } | null {
  if (pts.length < 2) return null;
  const mx = mean(pts.map((p) => p.beat));
  const my = mean(pts.map((p) => p.time));
  const sxx = pts.reduce((a, p) => a + (p.beat - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const b = pts.reduce((a, p) => a + (p.beat - mx) * (p.time - my), 0) / sxx;
  return { a: my - b * mx, b };
}

function barLabel(song: Song, from: number, to: number): string {
  const a = song.measures[from].number;
  const b = song.measures[to].number;
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

/** Groups consecutive bar indexes into ranges. */
function ranges(idx: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const i of [...idx].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

export function analyze(input: AnalysisInput): Report {
  const { song, steps } = input;
  const targetBps = (song.bpm * input.rate) / 60;
  const [fromM, toM] = input.regionMeasures;
  const isRoll = input.mode === 'roll' && input.judgments !== null;

  // Only steps the player reached count, so stopping halfway doesn't count the rest as missed.
  const lastTouched = steps.reduce((m, s, i) => (s.played.length || s.missed.length ? i : m), -1);
  const considered = input.completed ? steps : steps.slice(0, lastTouched + 1);

  const notesExpected = considered.reduce((a, s) => a + s.expected.length, 0);
  const notesHit = considered.reduce((a, s) => a + new Set(s.played.map((p) => p.pitch)).size, 0);
  const notesMissed = Math.max(0, notesExpected - notesHit);
  const extraNotes = input.extras.length;

  /* ---- timing: one onset per step (its first note) */
  const onsets = considered
    .map((s) => ({ beat: s.beat, measure: s.measure, time: s.played.length ? Math.min(...s.played.map((p) => p.time)) : NaN }))
    .filter((o) => !Number.isNaN(o.time));

  // Timing is judged against the player's local pulse (a line through the neighbouring notes), so a
  // deliberate tempo change doesn't make every note look early or late; drift shows in the tempo curve.
  const timing: Report['timing'] = [];
  let playedBpm: number | null = null;
  if (onsets.length >= 3 && input.mode !== 'learn' && !isRoll) {
    const global = fitLine(onsets);
    if (global && global.b > 0) playedBpm = 60000 / global.b;
    onsets.forEach((o, i) => {
      const neighbours = onsets.slice(Math.max(0, i - 3), i).concat(onsets.slice(i + 1, i + 4));
      const local = fitLine(neighbours) ?? global;
      if (local) timing.push({ beat: o.beat, devMs: o.time - (local.a + local.b * o.beat), measure: o.measure });
    });
  }
  if (isRoll) {
    // Piano Roll runs at a fixed tempo, so deviations are measured against the clock itself.
    timing.length = 0;
    const t0 = onsets[0];
    if (t0) {
      for (const o of onsets) {
        const expected = t0.time + ((o.beat - t0.beat) / targetBps) * 1000;
        timing.push({ beat: o.beat, devMs: o.time - expected, measure: o.measure });
      }
      // Re-centre so the first note's own offset doesn't shift everything.
      const off = median(timing.map((t) => t.devMs));
      timing.forEach((t) => (t.devMs -= off));
    }
    playedBpm = song.bpm * input.rate;
  }

  /* ---- local tempo and hesitations */
  const tempoCurve: Report['tempoCurve'] = [];
  const hesitationsByBar = new Map<number, number>();
  const segTempos: Array<{ measure: number; bps: number; beat: number }> = [];
  for (let i = 1; i < onsets.length; i++) {
    const dBeat = onsets[i].beat - onsets[i - 1].beat;
    const dt = (onsets[i].time - onsets[i - 1].time) / 1000;
    if (dBeat <= 0 || dt <= 0) continue;
    segTempos.push({ measure: onsets[i - 1].measure, bps: dBeat / dt, beat: onsets[i - 1].beat });
  }
  const typicalBps = median(segTempos.map((s) => s.bps));
  if (input.mode !== 'learn') {
    for (let i = 1; i < onsets.length; i++) {
      const dBeat = onsets[i].beat - onsets[i - 1].beat;
      const dt = (onsets[i].time - onsets[i - 1].time) / 1000;
      const expected = dBeat / (Number.isNaN(typicalBps) ? targetBps : typicalBps);
      if (dt > Math.max(expected * 2, expected + 0.6)) {
        hesitationsByBar.set(onsets[i].measure, (hesitationsByBar.get(onsets[i].measure) ?? 0) + 1);
      }
    }
    // Tempo curve: a moving window of about one bar, so single notes don't dominate.
    const win = Math.max(2, song.timeSig[0]);
    for (let i = 0; i + 1 < onsets.length; i++) {
      const j = Math.min(onsets.length - 1, i + win);
      const dBeat = onsets[j].beat - onsets[i].beat;
      const dt = (onsets[j].time - onsets[i].time) / 1000;
      if (dBeat > 0 && dt > 0) tempoCurve.push({ beat: onsets[i].beat, bpm: (dBeat / dt) * 60 });
      if (j === onsets.length - 1) break;
    }
  } else {
    for (const s of considered) {
      if (s.waitedMs > 1500) hesitationsByBar.set(s.measure, (hesitationsByBar.get(s.measure) ?? 0) + 1);
    }
  }

  /* ---- per-bar statistics */
  const measures: MeasureStat[] = [];
  for (let mi = fromM; mi <= toM; mi++) {
    const m = song.measures[mi];
    const inBar = considered.filter((s) => s.measure === mi);
    const expected = inBar.reduce((a, s) => a + s.expected.length, 0);
    const hit = inBar.reduce((a, s) => a + new Set(s.played.map((p) => p.pitch)).size, 0);
    const extra = input.extras.filter((e) => e.measure === mi).length;
    const hes = hesitationsByBar.get(mi) ?? 0;
    const segs = segTempos.filter((s) => s.measure === mi);
    let tempoRatio: number | null = null;
    if (segs.length && !Number.isNaN(typicalBps) && input.mode !== 'learn') {
      tempoRatio = median(segs.map((s) => s.bps)) / typicalBps;
      // A single interval is too noisy to call rushing unless it is far off.
      if (segs.length < 2 && Math.abs(tempoRatio - 1) < 0.25) tempoRatio = 1;
    }
    const devs = timing.filter((t) => t.measure === mi).map((t) => Math.abs(t.devMs));
    const meanAbsDevMs = devs.length ? mean(devs) : null;
    let score: number | null = null;
    if (expected > 0) {
      score = hit / expected;
      score -= Math.min(0.4, (extra / expected) * 0.5);
      score -= Math.min(0.3, hes * 0.15);
      if (tempoRatio !== null && Math.abs(tempoRatio - 1) > 0.12) score -= 0.15;
      if (meanAbsDevMs !== null && meanAbsDevMs > 120) score -= 0.1;
      score = clamp01(score);
    }
    measures.push({
      index: mi,
      number: m.number,
      expected,
      hit,
      missed: expected - hit,
      extra,
      hesitations: hes,
      tempoRatio,
      meanAbsDevMs,
      score,
    });
  }

  /* ---- dynamics */
  const velocities: Report['velocities'] = [];
  for (const s of considered) {
    for (const p of s.played) {
      const exp = s.expected.find((e) => e.pitch === p.pitch);
      if (exp) velocities.push({ beat: s.beat, velocity: p.velocity, expected: exp.velocity, hand: exp.hand });
    }
  }
  // Only MIDI reports how hard keys were struck; other inputs give a fixed or estimated velocity.
  const hasVelocity = input.source === 'midi';
  const vels = velocities.map((v) => v.velocity);
  const dynamicsRange = hasVelocity && vels.length >= 8 ? percentile(vels, 0.9) - percentile(vels, 0.1) : null;
  const rh = velocities.filter((v) => v.hand === 'R').map((v) => v.velocity);
  const lh = velocities.filter((v) => v.hand === 'L').map((v) => v.velocity);
  const balance = hasVelocity && rh.length >= 4 && lh.length >= 4 ? mean(rh) - mean(lh) : null;

  // Evenness: velocity spread inside runs of short single notes in one hand.
  const runVels: number[][] = [];
  let run: number[] = [];
  let runHand: Hand | null = null;
  for (const s of considered) {
    const single = s.expected.length === 1 && s.expected[0].dur <= 0.5 && s.played.length === 1;
    if (single && s.expected[0].hand === runHand) {
      run.push(s.played[0].velocity);
    } else {
      if (run.length >= 4) runVels.push(run);
      run = single ? [s.played[0].velocity] : [];
      runHand = single ? s.expected[0].hand : null;
    }
  }
  if (run.length >= 4) runVels.push(run);
  const evenness = hasVelocity && runVels.length ? mean(runVels.map(std)) : null;

  // Chord spread: how far apart notes meant to sound together actually land.
  const spreads = considered
    .filter((s) => s.expected.length >= 2 && s.played.length >= 2)
    .map((s) => {
      const ts = s.played.map((p) => p.time);
      return Math.max(...ts) - Math.min(...ts);
    });
  const chordSpreadMs = spreads.length >= 3 ? mean(spreads) : null;

  const tempoStability =
    segTempos.length >= 4 && input.mode !== 'learn' && !isRoll
      ? (std(tempoCurve.map((t) => t.bpm)) / mean(tempoCurve.map((t) => t.bpm))) * 100
      : null;

  /* ---- score */
  const accuracy = notesExpected ? clamp01((notesHit - extraNotes * 0.5) / notesExpected) : 0;
  const meanDev = timing.length ? mean(timing.map((t) => Math.abs(t.devMs))) : null;
  const timingScore = meanDev === null ? 1 : clamp01(1 - (meanDev - 30) / 200);
  const stabilityScore = tempoStability === null ? 1 : clamp01(1 - (tempoStability - 5) / 25);
  let score: number;
  if (input.mode === 'learn') {
    const firstTry = considered.length ? considered.filter((s) => s.wrongBefore === 0).length / considered.length : 0;
    score = 100 * (0.5 * firstTry + 0.5 * accuracy);
  } else if (isRoll && input.judgments) {
    const j = input.judgments;
    const judged = j.perfect + j.good + j.miss;
    score = judged ? (100 * (j.perfect + 0.7 * j.good)) / (judged + 0.5 * j.wrong) : 0;
  } else if (input.weights && (input.mode === 'practice' || input.mode === 'audition')) {
    const w = input.weights;
    const parts: Array<[number, number]> = [
      [w.notes, accuracy],
      [w.timing, timingScore],
      [w.tempo, stabilityScore],
    ];
    if (dynamicsRange !== null) parts.push([w.dynamics, clamp01(dynamicsRange / 40)]);
    const total = parts.reduce((a, [wt]) => a + wt, 0);
    score = total > 0 ? (100 * parts.reduce((a, [wt, v]) => a + wt * v, 0)) / total : 100 * accuracy;
  } else if (input.mode === 'audition') {
    const dyn = dynamicsRange === null ? 0.7 : clamp01(dynamicsRange / 40);
    score = 100 * (0.45 * accuracy + 0.2 * stabilityScore + 0.2 * timingScore + 0.15 * dyn);
  } else {
    score = 100 * (0.65 * accuracy + 0.2 * timingScore + 0.15 * stabilityScore);
  }
  score = Math.round(Math.max(0, Math.min(100, score)));
  const stars = notesExpected === 0 ? 0 : score >= 90 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0;

  /* ---- weakest stretch: the lowest-scoring window of up to 4 bars */
  let weakRange: Report['weakRange'] = null;
  const scored = measures.filter((m) => m.score !== null);
  if (scored.length >= 2) {
    let best = { from: 0, to: 0, avg: Infinity };
    for (let i = 0; i < measures.length; i++) {
      for (let len = 1; len <= 4 && i + len <= measures.length; len++) {
        const win = measures.slice(i, i + len).filter((m) => m.score !== null);
        if (!win.length) continue;
        const avg = mean(win.map((m) => m.score!)) + len * 0.01; // prefer short ranges on ties
        if (avg < best.avg) best = { from: measures[i].index, to: measures[i + len - 1].index, avg };
      }
    }
    if (best.avg < 0.85) weakRange = { from: best.from, to: best.to };
  }

  const tips = buildTips({
    song,
    mode: input.mode,
    rate: input.rate,
    measures,
    weakRange,
    playedBpm,
    targetBpm: song.bpm * input.rate,
    accuracy,
    chordSpreadMs,
    dynamicsRange,
    balance,
    evenness,
    velocities,
    recording: input.recording,
    source: input.source,
    score,
    hands: input.hands,
    isRoll,
  });

  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    songId: song.id,
    songTitle: song.title,
    mode: input.mode,
    date: Date.now(),
    durationSec: input.durationSec,
    rate: input.rate,
    hands: input.hands,
    source: input.source,
    completed: input.completed,
    score,
    stars,
    accuracy,
    notesExpected,
    notesHit,
    notesMissed,
    extraNotes,
    targetBpm: Math.round(song.bpm * input.rate),
    playedBpm: playedBpm === null ? null : Math.round(playedBpm),
    tempoStability: tempoStability === null ? null : Math.round(tempoStability * 10) / 10,
    measures,
    timing,
    tempoCurve,
    velocities,
    dynamicsRange,
    evenness,
    balance,
    chordSpreadMs,
    judgments: input.judgments
      ? {
          perfect: input.judgments.perfect,
          good: input.judgments.good,
          miss: input.judgments.miss,
          wrong: input.judgments.wrong,
          maxCombo: input.judgments.maxCombo,
        }
      : undefined,
    passes: input.passes,
    tips,
    weakRange,
    recording: input.recording,
  };
}

interface TipInput {
  song: Song;
  mode: ModeKind;
  rate: number;
  measures: MeasureStat[];
  weakRange: Report['weakRange'];
  playedBpm: number | null;
  targetBpm: number;
  accuracy: number;
  chordSpreadMs: number | null;
  dynamicsRange: number | null;
  balance: number | null;
  evenness: number | null;
  velocities: Report['velocities'];
  recording: RecordedEvent[];
  source: InputSource | 'none';
  score: number;
  hands: Hand[];
  isRoll: boolean;
}

function buildTips(t: TipInput): string[] {
  const tips: string[] = [];
  const { song } = t;
  const hasVelocity = t.source === 'midi';

  if (t.weakRange) {
    const bars = t.measures.filter((m) => m.index >= t.weakRange!.from && m.index <= t.weakRange!.to);
    const missed = bars.reduce((a, m) => a + m.missed, 0);
    const extra = bars.reduce((a, m) => a + m.extra, 0);
    const hes = bars.reduce((a, m) => a + m.hesitations, 0);
    const what: string[] = [];
    if (missed) what.push(`${missed} missed note${missed > 1 ? 's' : ''}`);
    if (extra) what.push(`${extra} wrong note${extra > 1 ? 's' : ''}`);
    if (hes) what.push(`${hes} hesitation${hes > 1 ? 's' : ''}`);
    const slower = Math.max(25, Math.round((t.rate * 0.75) / 0.05) * 5);
    tips.push(
      `Focus on ${barLabel(song, t.weakRange.from, t.weakRange.to)}${what.length ? ` (${what.join(', ')})` : ''}. ` +
        `Loop ${t.weakRange.from === t.weakRange.to ? 'just that bar' : 'just those bars'} at ${slower}% tempo until ` +
        `${t.weakRange.from === t.weakRange.to ? "it's" : "they're"} clean, then speed up.`,
    );
  }

  if (!t.isRoll && t.mode !== 'learn') {
    const rushed = t.measures.filter((m) => m.tempoRatio !== null && m.tempoRatio > 1.12).map((m) => m.index);
    const dragged = t.measures.filter((m) => m.tempoRatio !== null && m.tempoRatio < 0.88).map((m) => m.index);
    for (const [a, b] of ranges(rushed).slice(0, 2)) {
      const pct = Math.round(
        (mean(t.measures.filter((m) => m.index >= a && m.index <= b).map((m) => m.tempoRatio!)) - 1) * 100,
      );
      tips.push(`You rushed ${barLabel(song, a, b)} (about ${pct}% faster than your own pulse). Practise them with the metronome on.`);
    }
    for (const [a, b] of ranges(dragged).slice(0, 2)) {
      const pct = Math.round(
        (1 - mean(t.measures.filter((m) => m.index >= a && m.index <= b).map((m) => m.tempoRatio!))) * 100,
      );
      tips.push(`You slowed down in ${barLabel(song, a, b)} (about ${pct}% slower). Check the fingering there so it flows.`);
    }
    const hes = t.measures.filter((m) => m.hesitations > 0).map((m) => m.index);
    if (hes.length && !t.weakRange) {
      const [a, b] = ranges(hes)[0];
      tips.push(`You paused before ${barLabel(song, a, b)}. Look ahead while you play so the next notes are ready.`);
    }
    if (t.playedBpm !== null && t.playedBpm < t.targetBpm * 0.85 && t.mode !== 'audition') {
      const pct = Math.max(25, Math.round(((t.playedBpm / song.bpm) * 100) / 5) * 5);
      tips.push(
        `Your overall tempo was ${Math.round(t.playedBpm)} bpm against a target of ${Math.round(t.targetBpm)}. ` +
          `Set the tempo slider to ${pct}% and raise it 5% at a time.`,
      );
    }
  }

  if (t.chordSpreadMs !== null && t.chordSpreadMs > 60 && t.hands.length === 2) {
    tips.push(
      `Notes meant to sound together landed about ${Math.round(t.chordSpreadMs)} ms apart. ` +
        'Drop both hands into chords together, as one motion.',
    );
  }

  if (hasVelocity) {
    if (t.dynamicsRange !== null && t.dynamicsRange < 18 && (t.mode === 'audition' || t.mode === 'practice')) {
      tips.push('Your dynamics stayed in a narrow range. Exaggerate the contrast: make the soft parts really soft.');
    }
    // Compare soft and loud sections of the score with what was played.
    const marked = t.velocities.filter((v) => v.expected !== 78);
    if (marked.length >= 6 && song.dynamics.length >= 2) {
      const softExp = t.velocities.filter((v) => v.expected <= 64).map((v) => v.velocity);
      const loudExp = t.velocities.filter((v) => v.expected >= 78).map((v) => v.velocity);
      if (softExp.length >= 3 && loudExp.length >= 3 && mean(softExp) >= mean(loudExp) - 4) {
        tips.push('The passages marked p were not softer than the f / mf passages. Follow the dynamic markings.');
      }
    }
    if (t.balance !== null && t.balance < 3 && t.hands.length === 2) {
      tips.push('Your left hand is as loud as the melody. Let the right hand sing and keep the accompaniment lighter.');
    }
    if (t.evenness !== null && t.evenness > 14) {
      tips.push('Your runs are uneven in volume. Play them slowly, aiming for every note at the same loudness.');
    }
    // Pedal held through more than two bars blurs the harmony.
    const pedal = t.recording.filter((e) => e.type === 'pedal');
    let downAt: number | null = null;
    for (const e of pedal) {
      if (e.pitch === 1) downAt = e.beat;
      else if (downAt !== null) {
        const len = e.beat - downAt;
        if (len > 2 * (song.measures[1]?.length ?? 4)) {
          tips.push('You held the sustain pedal through several bars. Change it with each new harmony to keep the sound clear.');
          break;
        }
        downAt = null;
      }
    }
  } else if (t.source === 'mic' && (t.mode === 'audition' || t.mode === 'practice')) {
    tips.push('Dynamics, balance and pedalling are only analysed with a MIDI connection; the microphone gives notes and timing.');
  }

  if (tips.length === 0) {
    tips.push(
      t.rate < 1
        ? `Clean run! Try raising the tempo to ${Math.min(150, Math.round((t.rate + 0.1) * 100))}%.`
        : t.mode === 'audition'
          ? 'A polished performance. Well done!'
          : 'Excellent! This piece is ready. Try Audition mode for a full performance check.',
    );
  } else if (t.score >= 92) {
    tips.unshift('Notes and rhythm are clean. Now polish the musical details:');
  }
  return tips.slice(0, 6);
}
