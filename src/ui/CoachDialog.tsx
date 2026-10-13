import { useMemo, useState } from 'react';
import {
  CLASSIC_ROUTINE,
  describeStep,
  newRoutineStep,
  ROUTINE_TEMPLATES,
  routineToSteps,
  type CoachOptions,
  type Routine,
  type RoutineStep,
  type RoutineStepKind,
} from '../engine/coach';
import type { Song } from '../music/types';
import { loadPref, savePref } from '../store/settings';

interface Props {
  song: Song;
  initial: { from: number; to: number };
  onStart: (o: CoachOptions, routine: Routine) => void;
  onClose: () => void;
}

export function myRoutines(): Routine[] {
  return loadPref<Routine[]>('routines', []);
}

function saveRoutines(list: Routine[]) {
  savePref('routines', list);
}

/** The routine attached to a piece (the Coach button starts with it). */
export function routineForSong(songId: string): string | null {
  return loadPref<string | null>(`routineFor.${songId}`, null);
}

/** Choose a routine and the passage for the practice coach. */
export function CoachDialog({ song, initial, onStart, onClose }: Props) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [startRate, setStartRate] = useState(0.6);
  const [targetRate, setTargetRate] = useState(1);
  const [mine, setMine] = useState<Routine[]>(myRoutines);
  const all = useMemo(() => [...ROUTINE_TEMPLATES, ...mine], [mine]);
  const [routineId, setRoutineId] = useState<string>(() => {
    const attached = routineForSong(song.id);
    return attached && [...ROUTINE_TEMPLATES, ...myRoutines()].some((r) => r.id === attached) ? attached : CLASSIC_ROUTINE;
  });
  const [attached, setAttached] = useState(() => routineForSong(song.id));
  const [editing, setEditing] = useState<Routine | null>(null);
  const routine = all.find((r) => r.id === routineId) ?? ROUTINE_TEMPLATES[0];
  const options: CoachOptions = { from, to, startRate, targetRate };
  const plan = useMemo(() => routineToSteps(song, routine, { from, to, startRate, targetRate }), [song, routine, from, to, startRate, targetRate]);
  const bars = song.measures.map((m) => (
    <option key={m.index} value={m.index}>
      {m.number === 0 ? 'pickup' : m.number}
    </option>
  ));

  const saveRoutine = (r: Routine) => {
    const list = mine.some((x) => x.id === r.id) ? mine.map((x) => (x.id === r.id ? r : x)) : [...mine, r];
    setMine(list);
    saveRoutines(list);
    setRoutineId(r.id);
    setEditing(null);
  };
  const copyOf = (r: Routine): Routine => ({
    id: `my-${Date.now().toString(36)}`,
    name: r.id === CLASSIC_ROUTINE ? 'My routine' : `${r.name} (mine)`,
    steps: r.id === CLASSIC_ROUTINE ? [newRoutineStep('play')] : r.steps.map((s) => ({ ...s })),
  });

  if (editing) return <RoutineEditor routine={editing} onSave={saveRoutine} onCancel={() => setEditing(null)} />;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal coach-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Practice coach">
        <h2>🎓 Practice coach</h2>
        <p className="muted">Pick a routine and a passage. Each step loops until it's clean, then the coach moves on by itself.</p>
        <div className="form">
          <label className="wide">
            Routine
            <select value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
              <optgroup label="Ready-made">
                {ROUTINE_TEMPLATES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
              {mine.length > 0 && (
                <optgroup label="Mine">
                  {mine.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <span className="routine-actions">
            <button className="btn" onClick={() => setEditing(copyOf(ROUTINE_TEMPLATES[0]))}>
              ＋ New
            </button>
            {routine.builtin ? (
              routine.id !== CLASSIC_ROUTINE && (
                <button className="btn" onClick={() => setEditing(copyOf(routine))} title="Make your own copy to change">
                  Copy & edit
                </button>
              )
            ) : (
              <>
                <button className="btn" onClick={() => setEditing(routine)}>
                  ✎ Edit
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (!window.confirm(`Delete the routine "${routine.name}"?`)) return;
                    const list = mine.filter((r) => r.id !== routine.id);
                    setMine(list);
                    saveRoutines(list);
                    setRoutineId(CLASSIC_ROUTINE);
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </span>
        </div>
        <div className="form">
          <label>
            From bar
            <select
              value={from}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFrom(v);
                if (to < v) setTo(v);
              }}
            >
              {bars}
            </select>
          </label>
          <label>
            To bar
            <select
              value={to}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTo(v);
                if (from > v) setFrom(v);
              }}
            >
              {bars}
            </select>
          </label>
          {routine.id === CLASSIC_ROUTINE && (
            <>
              <label>
                Start slowly at
                <select value={startRate} onChange={(e) => setStartRate(Number(e.target.value))}>
                  {[0.4, 0.5, 0.6, 0.7, 0.8].map((r) => (
                    <option key={r} value={r}>
                      {Math.round(r * 100)}%
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Goal tempo
                <select value={targetRate} onChange={(e) => setTargetRate(Number(e.target.value))}>
                  {[0.7, 0.8, 0.9, 1].map((r) => (
                    <option key={r} value={r}>
                      {Math.round(r * 100)}%
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <ol className="coach-steps">
          {plan.map((s) => (
            <li key={s.id}>
              <b>{s.title}</b>
              <span className="muted small"> · {s.hint}</span>
            </li>
          ))}
          {!plan.length && <li className="muted">Nothing to play here with this routine (the hands it uses aren't in these bars).</li>}
        </ol>
        <label className="check">
          <input
            type="checkbox"
            checked={attached === routineId}
            onChange={(e) => {
              const v = e.target.checked ? routineId : null;
              setAttached(v);
              savePref(`routineFor.${song.id}`, v);
            }}
          />
          Use this routine for this piece (the Coach button starts with it)
        </label>
        <div className="report-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!plan.length} onClick={() => onStart(options, routine)}>
            Start coaching
          </button>
        </div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<RoutineStepKind, string> = {
  play: 'Play',
  listen: '👂 Listen first',
  memory: '🎭 From memory',
  sheet: '🎼 Eyes on the sheet',
};

const RATES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2];

/** Build or change a routine step by step. */
function RoutineEditor({ routine, onSave, onCancel }: { routine: Routine; onSave: (r: Routine) => void; onCancel: () => void }) {
  const [name, setName] = useState(routine.name);
  const [steps, setSteps] = useState<RoutineStep[]>(routine.steps.map((s) => ({ ...s })));
  const update = (i: number, patch: Partial<RoutineStep>) => setSteps((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) =>
    setSteps((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const rate = (value: number, onChange: (v: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {RATES.map((r) => (
        <option key={r} value={r}>
          {Math.round(r * 100)}%
        </option>
      ))}
    </select>
  );
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal routine-editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Routine">
        <h2>Your routine</h2>
        <label className="opt-row">
          <span className="muted small">Name</span>
          <input className="name-field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <ol className="routine-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <div className="routine-step-head">
                <b>
                  {i + 1}. {KIND_LABEL[s.kind]}
                </b>
                <span className="muted small">{describeStep(s)}</span>
                <span className="spacer" />
                <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down">
                  ↓
                </button>
                <button className="icon-btn" onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label="Remove step">
                  ✕
                </button>
              </div>
              <div className="routine-step-fields">
                <label>
                  Hands
                  <select value={s.hands} onChange={(e) => update(i, { hands: e.target.value as RoutineStep['hands'] })}>
                    <option value="R">Right</option>
                    <option value="L">Left</option>
                    <option value="both">Together</option>
                  </select>
                </label>
                {s.kind !== 'listen' && (
                  <label>
                    How
                    <select value={s.how} onChange={(e) => update(i, { how: e.target.value as RoutineStep['how'] })}>
                      <option value="learn">The music waits</option>
                      <option value="follow">At my own pace</option>
                      <option value="keep">Keep going at tempo</option>
                    </select>
                  </label>
                )}
                <label>
                  Tempo
                  {rate(s.startRate, (v) => update(i, { startRate: v, targetRate: Math.max(v, s.targetRate) }))}
                </label>
                {s.kind !== 'listen' && (
                  <>
                    <label title="Above the tempo: every clean pass speeds up until here">
                      Speed up to
                      {rate(s.targetRate, (v) => update(i, { targetRate: Math.max(v, s.startRate) }))}
                    </label>
                    <label>
                      Clean passes
                      <select value={s.passes} onChange={(e) => update(i, { passes: Number(e.target.value) })}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Bars at a time
                      <select value={s.chunk} onChange={(e) => update(i, { chunk: Number(e.target.value) })}>
                        <option value={0}>All of it</option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={4}>4</option>
                      </select>
                    </label>
                    <label>
                      Rhythm
                      <select value={s.rhythm} onChange={(e) => update(i, { rhythm: e.target.value as RoutineStep['rhythm'] })}>
                        <option value="straight">As written</option>
                        <option value="dotted">Dotted (long-short)</option>
                        <option value="reverse">Reverse dotted (short-long)</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="routine-add">
          {(['play', 'listen', 'memory', 'sheet'] as RoutineStepKind[]).map((k) => (
            <button key={k} className="btn" onClick={() => setSteps([...steps, newRoutineStep(k)])}>
              ＋ {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="report-actions">
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={!steps.length || !name.trim()} onClick={() => onSave({ id: routine.id, name: name.trim(), steps })}>
            Save routine
          </button>
        </div>
      </div>
    </div>
  );
}
