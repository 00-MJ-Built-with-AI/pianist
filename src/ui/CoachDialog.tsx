import { useMemo, useState } from 'react';
import { buildCoachPlan, type CoachOptions } from '../engine/coach';
import type { Song } from '../music/types';

interface Props {
  song: Song;
  initial: { from: number; to: number };
  onStart: (o: CoachOptions) => void;
  onClose: () => void;
}

/** Choose the passage and tempos for the practice coach. */
export function CoachDialog({ song, initial, onStart, onClose }: Props) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [startRate, setStartRate] = useState(0.6);
  const [targetRate, setTargetRate] = useState(1);
  const plan = useMemo(() => buildCoachPlan(song, { from, to, startRate, targetRate }), [song, from, to, startRate, targetRate]);
  const bars = song.measures.map((m) => (
    <option key={m.index} value={m.index}>
      {m.number === 0 ? 'pickup' : m.number}
    </option>
  ));
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal coach-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Practice coach">
        <h2>🎓 Practice coach</h2>
        <p className="muted">
          Pick a passage. The coach takes you through it the way a teacher would, moving on by itself after each clean pass (90%+).
        </p>
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
        </div>
        <ol className="coach-steps">
          {plan.map((s) => (
            <li key={s.id}>
              <b>{s.title}</b>
              <span className="muted small"> · {s.hint}</span>
            </li>
          ))}
        </ol>
        <div className="report-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onStart({ from, to, startRate, targetRate })}>
            Start coaching
          </button>
        </div>
      </div>
    </div>
  );
}
