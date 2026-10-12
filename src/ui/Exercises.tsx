import { useState } from 'react';
import {
  arpeggioExercise,
  PROGRESSIONS,
  progressionExercise,
  scaleExercise,
  SIGHT_LEVELS,
  sightReading,
  TONICS,
  type HandsOption,
  type ScaleKind,
} from '../music/exercises';
import type { Song } from '../music/types';
import { EAR_LEVELS, type EarKind } from '../music/ear';
import type { PlayerPreset } from './Player';
import { loadPref, savePref } from '../store/settings';

export interface ExerciseLaunch {
  song: Song;
  preset?: PlayerPreset;
  /** For sight-reading: make the next piece. */
  next?: () => Song;
}

type TechniqueKind = ScaleKind | 'arp-major' | 'arp-minor';

interface Prefs {
  pc: number;
  kind: TechniqueKind;
  octaves: 1 | 2;
  hands: HandsOption;
  beats: 1 | 0.5;
  bpm: number;
  progPc: number;
  progMinor: boolean;
  progression: string;
  chordBeats: 4 | 2;
  level: number;
  bars: 4 | 8;
}

const DEFAULTS: Prefs = {
  pc: 0,
  kind: 'major',
  octaves: 1,
  hands: 'R',
  beats: 1,
  bpm: 80,
  progPc: 0,
  progMinor: false,
  progression: 'I-IV-V-I',
  chordBeats: 4,
  level: 1,
  bars: 4,
};

export function newSeed(): number {
  return Math.floor(Math.random() * 1e9);
}

export function Exercises({ onStart, onEar }: { onStart: (launch: ExerciseLaunch) => void; onEar: (kind: EarKind) => void }) {
  const [p, setP] = useState<Prefs>(() => ({ ...DEFAULTS, ...loadPref<Partial<Prefs>>('exercises', {}) }));
  const set = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    savePref('exercises', next);
  };
  const minorKind = p.kind === 'natural-minor' || p.kind === 'harmonic-minor' || p.kind === 'arp-minor';

  const technique = () => {
    if (p.kind === 'arp-major' || p.kind === 'arp-minor') {
      return arpeggioExercise({ pc: p.pc, quality: p.kind === 'arp-major' ? 'major' : 'minor', octaves: p.octaves, hands: p.hands, beats: p.beats, bpm: p.bpm });
    }
    return scaleExercise({ pc: p.pc, kind: p.kind, octaves: p.octaves, hands: p.hands, beats: p.beats, bpm: p.bpm });
  };

  const sight = () => sightReading(p.level, p.bars, newSeed());

  const earLevels = loadPref<Partial<Record<EarKind, { level: number }>>>('ear', {});

  return (
    <div className="exercises">
      <section className="ex-card">
        <h2>Ear training</h2>
        <p className="muted small">The app plays something; you play it back on your piano. It gets harder as you get it right.</p>
        <div className="levels">
          {(
            [
              ['notes', 'Notes'],
              ['intervals', 'Intervals'],
              ['chords', 'Chords'],
              ['melodies', 'Melodies'],
            ] as Array<[EarKind, string]>
          ).map(([k, label]) => {
            const lv = earLevels[k]?.level ?? 1;
            return (
              <button key={k} className="level-pick" onClick={() => onEar(k)}>
                <b>
                  {label} <span className="muted small">· level {lv}</span>
                </b>
                <span className="muted small">{EAR_LEVELS[k][lv - 1]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ex-card">
        <h2>Scales & arpeggios</h2>
        <p className="muted small">Every major and minor key, one or two octaves. Hands separately first, then together.</p>
        <div className="form">
          <label>
            Key
            <select value={p.pc} onChange={(e) => set({ pc: Number(e.target.value) })}>
              {TONICS.map((t) => (
                <option key={t.pc} value={t.pc}>
                  {minorKind ? t.minor : t.major}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={p.kind} onChange={(e) => set({ kind: e.target.value as TechniqueKind })}>
              <option value="major">Major scale</option>
              <option value="natural-minor">Natural minor scale</option>
              <option value="harmonic-minor">Harmonic minor scale</option>
              <option value="arp-major">Major arpeggio</option>
              <option value="arp-minor">Minor arpeggio</option>
            </select>
          </label>
          <label>
            Octaves
            <select value={p.octaves} onChange={(e) => set({ octaves: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label>
            Hands
            <select value={p.hands} onChange={(e) => set({ hands: e.target.value as HandsOption })}>
              <option value="R">Right</option>
              <option value="L">Left</option>
              <option value="both">Together</option>
            </select>
          </label>
          <label>
            Notes
            <select value={p.beats} onChange={(e) => set({ beats: Number(e.target.value) as 1 | 0.5 })}>
              <option value={1}>Quarter notes</option>
              <option value={0.5}>Eighth notes</option>
            </select>
          </label>
          <label>
            Tempo
            <input type="number" min={40} max={200} value={p.bpm} onChange={(e) => set({ bpm: Number(e.target.value) || 80 })} />
          </label>
        </div>
        <button className="btn primary" onClick={() => onStart({ song: technique(), preset: { mode: 'learn' } })}>
          ▶ Practise
        </button>
      </section>

      <section className="ex-card">
        <h2>Chord progressions</h2>
        <p className="muted small">Block chords in the right hand with smooth voice leading, roots in the left. Played twice, ending on the home chord.</p>
        <div className="form">
          <label>
            Key
            <select value={p.progPc} onChange={(e) => set({ progPc: Number(e.target.value) })}>
              {TONICS.map((t) => (
                <option key={t.pc} value={t.pc}>
                  {p.progMinor ? t.minor : t.major}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select
              value={p.progMinor ? 'minor' : 'major'}
              onChange={(e) => {
                const minor = e.target.value === 'minor';
                set({ progMinor: minor, progression: PROGRESSIONS[minor ? 'minor' : 'major'][0].id });
              }}
            >
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
          </label>
          <label>
            Progression
            <select value={p.progression} onChange={(e) => set({ progression: e.target.value })}>
              {PROGRESSIONS[p.progMinor ? 'minor' : 'major'].map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Each chord
            <select value={p.chordBeats} onChange={(e) => set({ chordBeats: Number(e.target.value) as 4 | 2 })}>
              <option value={4}>Whole bar</option>
              <option value={2}>Half bar</option>
            </select>
          </label>
        </div>
        <button
          className="btn primary"
          onClick={() =>
            onStart({
              song: progressionExercise({ pc: p.progPc, minor: p.progMinor, progression: p.progression, beatsPerChord: p.chordBeats, bpm: 72 }),
              preset: { mode: 'learn' },
            })
          }
        >
          ▶ Practise
        </button>
      </section>

      <section className="ex-card">
        <h2>Sight-reading</h2>
        <p className="muted small">A brand-new piece every time. Read it once, then play it through in Practice without stopping.</p>
        <div className="levels">
          {[1, 2, 3, 4].map((lv) => (
            <button key={lv} className={`level-pick ${p.level === lv ? 'active' : ''}`} onClick={() => set({ level: lv })}>
              <b>Level {lv}</b>
              <span className="muted small">{SIGHT_LEVELS[lv].description}</span>
            </button>
          ))}
        </div>
        <div className="form">
          <label>
            Length
            <select value={p.bars} onChange={(e) => set({ bars: Number(e.target.value) as 4 | 8 })}>
              <option value={4}>4 bars</option>
              <option value={8}>8 bars</option>
            </select>
          </label>
        </div>
        <button className="btn primary" onClick={() => onStart({ song: sight(), preset: { mode: 'practice' }, next: sight })}>
          ▶ New piece
        </button>
      </section>
    </div>
  );
}
