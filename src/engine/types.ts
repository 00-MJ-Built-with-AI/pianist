import type { Hand } from '../music/types';
import type { InputSource } from '../input/hub';

export type ModeKind = 'learn' | 'practice' | 'audition' | 'roll' | 'listen';

export const MODE_LABELS: Record<ModeKind, string> = {
  learn: 'Learn',
  practice: 'Practice',
  audition: 'Audition',
  roll: 'Piano Roll',
  listen: 'Listen',
};

export interface SessionOptions {
  mode: ModeKind;
  hands: Hand[]; // hands the player plays
  otherHand: 'app' | 'mute';
  rate: number; // tempo factor, 0.25 … 1.5
  metronome: boolean;
  loop: { from: number; to: number } | null; // bar indexes, inclusive
  /** Without a loop: start from this bar instead of the beginning. */
  startMeasure?: number;
  autoSpeedUp: boolean;
  /** Wait for the right notes (Learn, Piano Roll) or for the player's pace (Practice); off keeps going at tempo. */
  wait: boolean;
  /** Timing windows and pass rules; defaults to the "normal" strictness. */
  tuning?: import('../store/settings').Tuning;
  countInBars?: number; // timed modes: bars of count-in clicks (0 = none)
  clicks?: { subdivision: 'beat' | 'eighth'; accent: boolean; sound: ClickSound };
  /** Softly play the player's own notes as a guide. */
  guide?: boolean;
  weights?: import('../store/settings').ScoreWeights;
}

export type ClickSound = 'beep' | 'wood' | 'cowbell';

/** What happened to each note of the score. */
export const NoteMark = {
  Pending: 0,
  Hit: 1,
  Early: 2,
  Late: 3,
  Missed: 4,
  Auto: 5, // played by the app
} as const;

export interface RecordedEvent {
  t: number; // ms since the session started
  type: 'on' | 'off' | 'pedal';
  pitch: number; // 1 = down / 0 = up for pedal events
  velocity: number;
  beat: number; // playhead position when it happened
}

/** Per-step data the analysis works from. */
export interface StepResult {
  beat: number;
  measure: number;
  hands: Hand[];
  expected: Array<{ pitch: number; hand: Hand; velocity: number; dur: number }>;
  played: Array<{ pitch: number; time: number; velocity: number }>; // matched presses
  missed: number[]; // pitches never played
  wrongBefore: number; // wrong presses while this step was current (Learn)
  waitedMs: number; // time the cursor waited for this step (Learn)
}

export interface ExtraNote {
  pitch: number;
  time: number;
  measure: number;
  beat: number; // where in the piece it was played
}

export interface PassSummary {
  accuracy: number; // 0–1
  rate: number;
  durationSec: number;
  clean: boolean;
}

export interface MeasureStat {
  index: number;
  number: number;
  expected: number;
  hit: number;
  missed: number;
  extra: number;
  hesitations: number;
  tempoRatio: number | null; // local tempo / the player's typical tempo
  meanAbsDevMs: number | null;
  score: number | null; // 0–1, null when the bar has nothing to play
}

export interface Report {
  id: string;
  songId: string;
  songTitle: string;
  mode: ModeKind;
  date: number;
  durationSec: number;
  rate: number;
  hands: Hand[];
  source: InputSource | 'none';
  completed: boolean;
  score: number; // 0–100
  stars: number; // 0–3
  accuracy: number; // 0–1
  notesExpected: number;
  notesHit: number;
  notesMissed: number;
  extraNotes: number;
  targetBpm: number;
  playedBpm: number | null;
  tempoStability: number | null; // coefficient of variation of local tempo, %
  measures: MeasureStat[];
  timing: Array<{ beat: number; devMs: number; measure: number }>;
  tempoCurve: Array<{ beat: number; bpm: number }>;
  velocities: Array<{ beat: number; velocity: number; expected: number; hand: Hand }>;
  dynamicsRange: number | null;
  evenness: number | null; // velocity std-dev in runs
  balance: number | null; // mean right-hand minus mean left-hand velocity
  chordSpreadMs: number | null;
  judgments?: { perfect: number; good: number; miss: number; wrong: number; maxCombo: number };
  passes: PassSummary[];
  tips: string[];
  weakRange: { from: number; to: number } | null; // bar indexes
  recording: RecordedEvent[];
}
