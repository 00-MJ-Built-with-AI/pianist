import { useEffect, useRef, useState } from 'react';
import type { Report } from '../engine/types';
import { listSessions } from '../store/db';
import { replayRecording } from './replay';

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}`);
const cls = (x: number | null) => (x === null ? 'none' : x >= 0.9 ? 'good' : x >= 0.7 ? 'ok' : 'bad');

/** This take next to the best earlier take of the same piece in the same mode, bar by bar. */
export function CompareTakes({ report, onClose }: { report: Report; onClose: () => void }) {
  const [best, setBest] = useState<Report | null | undefined>(undefined);
  const [playing, setPlaying] = useState<'this' | 'best' | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void listSessions(2000).then((all) => {
      const earlier = all.filter((r) => r.songId === report.songId && r.mode === report.mode && r.id !== report.id && r.date < report.date);
      setBest(earlier.length ? earlier.reduce((a, b) => (b.score > a.score ? b : a)) : null);
    });
  }, [report]);
  useEffect(() => () => stopRef.current?.(), []);

  const play = async (which: 'this' | 'best') => {
    stopRef.current?.();
    if (playing === which) {
      setPlaying(null);
      return;
    }
    const r = which === 'this' ? report : best;
    if (!r) return;
    setPlaying(which);
    const h = await replayRecording(r.recording, () => setPlaying((p) => (p === which ? null : p)));
    stopRef.current = h.stop;
  };

  const bars = report.measures.filter((m) => m.score !== null || best?.measures.find((b) => b.index === m.index)?.score != null);
  // Only bars both takes played are compared.
  const diff = (m: (typeof bars)[number]) => {
    const b = best?.measures.find((x) => x.index === m.index)?.score;
    return m.score === null || b === null || b === undefined ? 0 : m.score - b;
  };
  const better = best ? bars.filter((m) => diff(m) >= 0.1) : [];
  const worse = best ? bars.filter((m) => diff(m) <= -0.1) : [];
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal compare" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compare with best take">
        <h2>This take vs your best</h2>
        {best === undefined && <p className="muted">Looking for your best take…</p>}
        {best === null && <p className="muted">This is your first {report.mode === 'audition' ? 'audition' : 'take'} of this piece. Next time you can compare.</p>}
        {best && (
          <>
            <div className="compare-head">
              <div>
                <div className="muted small">Best take · {date(best.date)}</div>
                <div className="big">{best.score}</div>
                <button className="btn" onClick={() => void play('best')}>
                  {playing === 'best' ? '■ Stop' : '▶ Listen'}
                </button>
              </div>
              <div>
                <div className="muted small">This take</div>
                <div className="big">{report.score}</div>
                <button className="btn" onClick={() => void play('this')}>
                  {playing === 'this' ? '■ Stop' : '▶ Listen'}
                </button>
              </div>
              <div className="compare-sum">
                {report.score > best.score ? (
                  <b className="good-text">New best, +{report.score - best.score}! 🎉</b>
                ) : report.score === best.score ? (
                  <b>Equal to your best.</b>
                ) : (
                  <b>{best.score - report.score} below your best.</b>
                )}
                <div className="small">
                  {better.length > 0 && <div>▲ Better in bar{better.length > 1 ? 's' : ''} {better.map((m) => m.number).join(', ')}</div>}
                  {worse.length > 0 && <div>▼ Slipped in bar{worse.length > 1 ? 's' : ''} {worse.map((m) => m.number).join(', ')}</div>}
                </div>
              </div>
            </div>
            <div className="compare-grid" style={{ gridTemplateColumns: `auto repeat(${bars.length}, minmax(26px, 1fr))` }}>
              <span className="muted small">Bar</span>
              {bars.map((m) => (
                <span key={m.index} className="muted small center">
                  {m.number}
                </span>
              ))}
              <span className="muted small">Best</span>
              {bars.map((m) => {
                const b = best.measures.find((x) => x.index === m.index)?.score ?? null;
                return (
                  <span key={m.index} className={`cmp ${cls(b)}`} title={`${pct(b)}%`}>
                    {pct(b)}
                  </span>
                );
              })}
              <span className="muted small">Now</span>
              {bars.map((m) => (
                <span key={m.index} className={`cmp ${cls(m.score)}`} title={`${pct(m.score)}%`}>
                  {pct(m.score)}
                </span>
              ))}
            </div>
            <div className="stat-row">
              <div className="stat">
                <b>
                  {pct(best.accuracy)} → {pct(report.accuracy)}%
                </b>
                Notes
              </div>
              {best.tempoStability !== null && report.tempoStability !== null && (
                <div className="stat">
                  <b>
                    ±{best.tempoStability} → ±{report.tempoStability}%
                  </b>
                  Tempo drift
                </div>
              )}
              {best.dynamicsRange !== null && report.dynamicsRange !== null && (
                <div className="stat">
                  <b>
                    {best.dynamicsRange} → {report.dynamicsRange}
                  </b>
                  Loudness range
                </div>
              )}
            </div>
          </>
        )}
        <div className="report-actions">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
