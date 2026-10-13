import { useMemo, useState } from 'react';
import {
  buildExercise,
  CHORD_TYPES,
  chordDrill,
  describeSpec,
  parsePattern,
  patternExercise,
  scaleExercise,
  TONICS,
  type ChordSpec,
  type ChordType,
  type ExerciseSpec,
  type HandsOption,
  type PatternSpec,
  type SavedExercise,
  type ScaleKind,
  type ScaleSpec,
} from '../music/exercises';
import { RHYTHM_LABEL, type ExerciseRhythm } from '../music/rhythm';
import type { Song } from '../music/types';
import { loadPref, savePref } from '../store/settings';

export function savedExercises(): SavedExercise[] {
  return loadPref<SavedExercise[]>('myExercises', []);
}

const RHYTHMS = Object.keys(RHYTHM_LABEL) as ExerciseRhythm[];

interface Draft {
  type: ExerciseSpec['type'];
  patternText: string;
  pattern: Omit<PatternSpec, 'pattern'>;
  chords: ChordSpec;
  scale: ScaleSpec;
}

const DEFAULT_DRAFT: Draft = {
  type: 'pattern',
  patternText: '1 2 3 4 5 4 3 2',
  pattern: { type: 'pattern', keys: [0], minor: false, climb: 7, mirror: true, hands: 'R', beats: 0.5, rhythm: 'straight', bpm: 80 },
  chords: { type: 'chords', chords: ['maj', 'min'], inversions: [0, 1, 2], style: 'block', keys: [0, 7, 5], hands: 'both', rhythm: 'straight', bpm: 70 },
  scale: { type: 'scale', pc: 0, kind: 'major', octaves: 1, hands: 'R', beats: 0.5, rhythm: 'dotted', bpm: 80 },
};

function KeyChips({ keys, minor, onChange }: { keys: number[]; minor: boolean; onChange: (keys: number[]) => void }) {
  return (
    <div className="chip-row">
      {TONICS.map((t) => {
        const on = keys.includes(t.pc);
        return (
          <button
            key={t.pc}
            className={`chip ${on ? 'on' : ''}`}
            onClick={() => {
              const next = on ? keys.filter((k) => k !== t.pc) : [...keys, t.pc];
              if (next.length) onChange(next);
            }}
          >
            {minor ? t.minor : t.major}
          </button>
        );
      })}
    </div>
  );
}

function Common({ hands, rhythm, bpm, onChange, rhythmOff }: { hands: HandsOption; rhythm: ExerciseRhythm; bpm: number; onChange: (p: { hands?: HandsOption; rhythm?: ExerciseRhythm; bpm?: number }) => void; rhythmOff?: boolean }) {
  return (
    <>
      <label>
        Hands
        <select value={hands} onChange={(e) => onChange({ hands: e.target.value as HandsOption })}>
          <option value="R">Right</option>
          <option value="L">Left</option>
          <option value="both">Together</option>
        </select>
      </label>
      {!rhythmOff && (
        <label>
          Rhythm
          <select value={rhythm} onChange={(e) => onChange({ rhythm: e.target.value as ExerciseRhythm })}>
            {RHYTHMS.map((r) => (
              <option key={r} value={r}>
                {RHYTHM_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Tempo
        <input type="number" min={30} max={220} value={bpm} onChange={(e) => onChange({ bpm: Number(e.target.value) || bpm })} />
      </label>
    </>
  );
}

/** Build your own exercises: patterns through keys, chord drills, scales in rhythms; save them and use them as warm-ups. */
export function MyExercises({ onStart }: { onStart: (song: Song) => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...DEFAULT_DRAFT, ...loadPref<Partial<Draft>>('exerciseDraft', {}) }));
  const [list, setList] = useState<SavedExercise[]>(savedExercises);
  const [name, setName] = useState('');
  const set = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    savePref('exerciseDraft', next);
  };
  const store = (next: SavedExercise[]) => {
    setList(next);
    savePref('myExercises', next);
  };
  const pattern = parsePattern(draft.patternText);
  const spec: ExerciseSpec | null = useMemo(() => {
    if (draft.type === 'pattern') return pattern ? { ...draft.pattern, pattern } : null;
    if (draft.type === 'chords') return draft.chords.chords.length && draft.chords.inversions.length ? draft.chords : null;
    return draft.scale;
  }, [draft, pattern]);
  const preview = useMemo(() => {
    if (!spec) return null;
    const song = spec.type === 'pattern' ? patternExercise(spec) : spec.type === 'chords' ? chordDrill(spec) : scaleExercise(spec);
    const beats = song.totalBeats;
    return { bars: song.measures.length, seconds: Math.round((beats / song.bpm) * 60) };
  }, [spec]);

  const p = draft.pattern;
  const c = draft.chords;
  const sc = draft.scale;
  return (
    <section className="ex-card">
      <h2>Your own exercises</h2>
      <p className="muted small">
        Make a drill, try it, and save it. Saved exercises marked <b>warm-up</b> take turns as the warm-up in Today's practice.
      </p>
      <div className="segmented">
        {(
          [
            ['pattern', 'Pattern'],
            ['chords', 'Chords'],
            ['scale', 'Scale in a rhythm'],
          ] as const
        ).map(([t, label]) => (
          <button key={t} className={`seg ${draft.type === t ? 'on r' : ''}`} onClick={() => set({ type: t })}>
            {label}
          </button>
        ))}
      </div>

      {draft.type === 'pattern' && (
        <>
          <div className="form">
            <label className="wide" title="Scale degrees: 1 is the key note, 8 is an octave up">
              Pattern (scale degrees)
              <input value={draft.patternText} onChange={(e) => set({ patternText: e.target.value })} placeholder="1 2 3 4 5 4 3 2" />
            </label>
            <label>
              Moves up
              <select value={p.climb} onChange={(e) => set({ pattern: { ...p, climb: Number(e.target.value) } })}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Stays put' : n === 7 ? '7 steps (an octave)' : n === 14 ? '14 steps (2 octaves)' : `${n} steps`}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={p.mirror} onChange={(e) => set({ pattern: { ...p, mirror: e.target.checked } })} />
              and back down
            </label>
            <label className="check">
              <input type="checkbox" checked={p.minor} onChange={(e) => set({ pattern: { ...p, minor: e.target.checked } })} />
              minor
            </label>
            <label>
              Notes
              <select value={p.beats} onChange={(e) => set({ pattern: { ...p, beats: Number(e.target.value) as PatternSpec['beats'] } })}>
                <option value={1}>Quarters</option>
                <option value={0.5}>Eighths</option>
                <option value={0.25}>Sixteenths</option>
              </select>
            </label>
            <Common hands={p.hands} rhythm={p.rhythm} bpm={p.bpm} onChange={(x) => set({ pattern: { ...p, ...x } })} />
          </div>
          {!pattern && <div className="small error">Write the pattern as scale degrees, e.g. 1 2 3 4 5 4 3 2.</div>}
          <div className="muted small">Keys, one after another:</div>
          <KeyChips keys={p.keys} minor={p.minor} onChange={(keys) => set({ pattern: { ...p, keys } })} />
        </>
      )}

      {draft.type === 'chords' && (
        <>
          <div className="muted small">Chords:</div>
          <div className="chip-row">
            {(Object.keys(CHORD_TYPES) as ChordType[]).map((t) => {
              const on = c.chords.includes(t);
              return (
                <button key={t} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ chords: { ...c, chords: on ? c.chords.filter((x) => x !== t) : [...c.chords, t] } })}>
                  {CHORD_TYPES[t].label}
                </button>
              );
            })}
          </div>
          <div className="muted small">Positions:</div>
          <div className="chip-row">
            {['Root', '1st inversion', '2nd inversion', '3rd inversion (7ths)'].map((label, i) => {
              const on = c.inversions.includes(i);
              return (
                <button
                  key={i}
                  className={`chip ${on ? 'on' : ''}`}
                  onClick={() => set({ chords: { ...c, inversions: on ? c.inversions.filter((x) => x !== i) : [...c.inversions, i].sort() } })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="form">
            <label>
              Played
              <select value={c.style} onChange={(e) => set({ chords: { ...c, style: e.target.value as ChordSpec['style'] } })}>
                <option value="block">Block (together)</option>
                <option value="broken">Broken (one by one)</option>
              </select>
            </label>
            <Common hands={c.hands} rhythm={c.rhythm} bpm={c.bpm} rhythmOff={c.style === 'block'} onChange={(x) => set({ chords: { ...c, ...x } })} />
          </div>
          <div className="muted small">Keys:</div>
          <KeyChips keys={c.keys} minor={false} onChange={(keys) => set({ chords: { ...c, keys } })} />
        </>
      )}

      {draft.type === 'scale' && (
        <div className="form">
          <label>
            Key
            <select value={sc.pc} onChange={(e) => set({ scale: { ...sc, pc: Number(e.target.value) } })}>
              {TONICS.map((t) => (
                <option key={t.pc} value={t.pc}>
                  {sc.kind === 'major' ? t.major : t.minor}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scale
            <select value={sc.kind} onChange={(e) => set({ scale: { ...sc, kind: e.target.value as ScaleKind } })}>
              <option value="major">Major</option>
              <option value="natural-minor">Natural minor</option>
              <option value="harmonic-minor">Harmonic minor</option>
            </select>
          </label>
          <label>
            Octaves
            <select value={sc.octaves} onChange={(e) => set({ scale: { ...sc, octaves: Number(e.target.value) as 1 | 2 } })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <label>
            Notes
            <select value={sc.beats} onChange={(e) => set({ scale: { ...sc, beats: Number(e.target.value) as 1 | 0.5 } })}>
              <option value={1}>Quarters</option>
              <option value={0.5}>Eighths</option>
            </select>
          </label>
          <Common hands={sc.hands} rhythm={sc.rhythm} bpm={sc.bpm} onChange={(x) => set({ scale: { ...sc, ...x } })} />
        </div>
      )}

      <div className="rec-controls">
        <button className="btn primary" disabled={!spec} onClick={() => spec && onStart(buildExercise(spec, 'try'))}>
          ▶ Try it
        </button>
        {preview && (
          <span className="muted small">
            {preview.bars} bars · about {preview.seconds} s at full tempo
          </span>
        )}
        <span className="spacer" />
        <input className="name-field" placeholder="Name to save it as" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        <button
          className="btn"
          disabled={!spec || !name.trim()}
          onClick={() => {
            if (!spec) return;
            store([...list, { id: Date.now().toString(36), name: name.trim(), spec, warmup: false }]);
            setName('');
          }}
        >
          Save
        </button>
      </div>

      {list.length > 0 && (
        <ul className="my-exercises">
          {list.map((x) => (
            <li key={x.id}>
              <div>
                <b>{x.name}</b>
                <div className="muted small">{describeSpec(x.spec)}</div>
              </div>
              <label className="check" title="Today's practice may pick it as the warm-up">
                <input type="checkbox" checked={x.warmup} onChange={(e) => store(list.map((y) => (y.id === x.id ? { ...y, warmup: e.target.checked } : y)))} />
                warm-up
              </label>
              <button className="btn" onClick={() => onStart(buildExercise(x.spec, x.id))}>
                ▶ Practise
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${x.name}`}
                onClick={() => window.confirm(`Delete "${x.name}"?`) && store(list.filter((y) => y.id !== x.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
