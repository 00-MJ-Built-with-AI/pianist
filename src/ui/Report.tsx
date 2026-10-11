import { useEffect, useRef, useState } from 'react';
import { MODE_LABELS, type Report } from '../engine/types';
import type { Song } from '../music/types';
import { replayRecording } from './replay';

interface Props {
  report: Report;
  song: Song | null;
  onClose: () => void;
  onPracticeBars?: (from: number, to: number) => void;
  onAgain?: () => void;
}

const W = 640;

function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? 'on' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

function heatClass(score: number | null): string {
  if (score === null) return 'none';
  if (score >= 0.9) return 'good';
  if (score >= 0.7) return 'ok';
  return 'bad';
}

function Axis({ song, minBeat, maxBeat, h }: { song: Song | null; minBeat: number; maxBeat: number; h: number }) {
  if (!song) return null;
  const x = (b: number) => ((b - minBeat) / Math.max(1e-6, maxBeat - minBeat)) * W;
  return (
    <g>
      {song.measures
        .filter((m) => m.start >= minBeat - 1e-6 && m.start <= maxBeat + 1e-6 && m.number > 0)
        .map((m) => (
          <g key={m.index}>
            <line x1={x(m.start)} x2={x(m.start)} y1={0} y2={h} className="grid" />
            <text x={x(m.start) + 3} y={h - 3} className="tick">
              {m.number}
            </text>
          </g>
        ))}
    </g>
  );
}

function TimingChart({ report, song }: { report: Report; song: Song | null }) {
  const pts = report.timing;
  if (pts.length < 3) return null;
  const H = 150;
  const minB = Math.min(...pts.map((p) => p.beat));
  const maxB = Math.max(...pts.map((p) => p.beat), minB + 1);
  const x = (b: number) => ((b - minB) / (maxB - minB)) * W;
  const lim = 250;
  const y = (d: number) => H / 2 - (Math.max(-lim, Math.min(lim, d)) / lim) * (H / 2 - 12);
  return (
    <section className="chart">
      <h4>
        Timing{' '}
        <span className="muted">
          dots above the line came late, below came early ({report.mode === 'roll' ? 'against the beat' : 'against your own pulse'})
        </span>
      </h4>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Axis song={song} minBeat={minB} maxBeat={maxB} h={H} />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="zero" />
        {[-120, 120].map((d) => (
          <line key={d} x1={0} x2={W} y1={y(d)} y2={y(d)} className="band" />
        ))}
        {pts.map((p, i) => {
          const a = Math.abs(p.devMs);
          return (
            <circle
              key={i}
              cx={x(p.beat)}
              cy={y(p.devMs)}
              r={3}
              className={a < 60 ? 'dot-good' : a < 120 ? 'dot-ok' : 'dot-bad'}
            >
              <title>{`${p.devMs > 0 ? '+' : ''}${Math.round(p.devMs)} ms`}</title>
            </circle>
          );
        })}
      </svg>
    </section>
  );
}

function TempoChart({ report, song }: { report: Report; song: Song | null }) {
  const pts = report.tempoCurve;
  if (pts.length < 3) return null;
  const H = 130;
  const minB = pts[0].beat;
  const maxB = Math.max(pts[pts.length - 1].beat, minB + 1);
  const bpms = pts.map((p) => p.bpm).concat(report.targetBpm);
  const lo = Math.min(...bpms) * 0.9;
  const hi = Math.max(...bpms) * 1.1;
  const x = (b: number) => ((b - minB) / (maxB - minB)) * W;
  const y = (v: number) => H - 14 - ((v - lo) / (hi - lo)) * (H - 28);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.beat).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ');
  return (
    <section className="chart">
      <h4>
        Tempo <span className="muted">your speed through the piece; dashed line = target {report.targetBpm} bpm</span>
      </h4>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Axis song={song} minBeat={minB} maxBeat={maxB} h={H} />
        <line x1={0} x2={W} y1={y(report.targetBpm)} y2={y(report.targetBpm)} className="target" />
        <path d={d} className="line" />
        <text x={4} y={12} className="tick">
          {Math.round(hi)} bpm
        </text>
        <text x={4} y={H - 16} className="tick">
          {Math.round(lo)}
        </text>
      </svg>
    </section>
  );
}

function DynamicsChart({ report, song }: { report: Report; song: Song | null }) {
  const pts = report.velocities;
  if (pts.length < 6 || report.source !== 'midi') return null;
  const H = 140;
  const minB = Math.min(...pts.map((p) => p.beat));
  const maxB = Math.max(...pts.map((p) => p.beat), minB + 1);
  const plotW = W - 30; // room for the pp…ff labels
  const x = (b: number) => ((b - minB) / (maxB - minB)) * plotW;
  const y = (v: number) => H - 8 - (v / 127) * (H - 16);
  const hasMarks = (song?.dynamics.length ?? 0) > 0;
  return (
    <section className="chart">
      <h4>
        Dynamics{' '}
        <span className="muted">
          how hard each key was struck (blue = right hand, green = left){hasMarks ? '; dashed = the markings' : ''}
        </span>
      </h4>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <g transform={`scale(${plotW / W},1)`}>
          <Axis song={song} minBeat={minB} maxBeat={maxB} h={H} />
        </g>
        {hasMarks &&
          pts.map((p, i) => (
            <line key={`e${i}`} x1={x(p.beat) - 5} x2={x(p.beat) + 5} y1={y(p.expected)} y2={y(p.expected)} className="target" />
          ))}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.beat)} cy={y(p.velocity)} r={2.6} className={p.hand === 'R' ? 'dot-r' : 'dot-l'} />
        ))}
        {['pp', 'p', 'mf', 'f', 'ff'].map((m, i) => (
          <text key={m} x={W - 4} y={y([36, 50, 78, 94, 108][i]) + 3} className="tick end">
            {m}
          </text>
        ))}
      </svg>
      <div className="chips">
        {report.dynamicsRange !== null && <span className="chip">Range {Math.round(report.dynamicsRange)}</span>}
        {report.balance !== null && (
          <span className="chip">
            Melody vs. accompaniment {report.balance >= 0 ? '+' : ''}
            {Math.round(report.balance)}
          </span>
        )}
        {report.evenness !== null && <span className="chip">Run evenness ±{Math.round(report.evenness)}</span>}
      </div>
    </section>
  );
}

export function ReportView({ report, song, onClose, onPracticeBars, onAgain }: Props) {
  const [replaying, setReplaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const toggleReplay = async () => {
    if (replaying) {
      stopRef.current?.();
      return;
    }
    setReplaying(true);
    const r = await replayRecording(report.recording, () => {
      setReplaying(false);
      stopRef.current = null;
    });
    stopRef.current = r.stop;
  };

  const j = report.judgments;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Session report">
        <header className="report-head">
          <div>
            <div className="eyebrow">
              {MODE_LABELS[report.mode]} · {report.hands.length === 2 ? 'both hands' : report.hands[0] === 'R' ? 'right hand' : 'left hand'} ·{' '}
              {Math.round(report.rate * 100)}% tempo{report.completed ? '' : ' · stopped early'}
            </div>
            <h2>{report.songTitle}</h2>
          </div>
          <div className="score-badge">
            <div className="big">{report.score}</div>
            <Stars n={report.stars} />
          </div>
        </header>

        <div className="stat-row">
          {j ? (
            <>
              <div className="stat">
                <b>{j.perfect}</b>Perfect
              </div>
              <div className="stat">
                <b>{j.good}</b>Good
              </div>
              <div className="stat">
                <b>{j.miss}</b>Missed
              </div>
              <div className="stat">
                <b>{j.wrong}</b>Wrong
              </div>
              <div className="stat">
                <b>{j.maxCombo}</b>Best combo
              </div>
            </>
          ) : (
            <>
              <div className="stat">
                <b>{pct(report.accuracy)}</b>Accuracy
              </div>
              <div className="stat">
                <b>
                  {report.notesHit}/{report.notesExpected}
                </b>
                Notes
              </div>
              <div className="stat">
                <b>{report.extraNotes}</b>Wrong notes
              </div>
              {report.playedBpm !== null && (
                <div className="stat">
                  <b>{report.playedBpm}</b>bpm (target {report.targetBpm})
                </div>
              )}
              {report.tempoStability !== null && (
                <div className="stat">
                  <b>±{report.tempoStability}%</b>Tempo drift
                </div>
              )}
            </>
          )}
        </div>

        <section>
          <h4>
            Bar by bar <span className="muted">click a bar to loop it</span>
          </h4>
          <div className="heat-strip">
            {report.measures.map((m) => (
              <button
                key={m.index}
                className={`heat ${heatClass(m.score)}`}
                title={
                  m.score === null
                    ? `Bar ${m.number}: nothing to play`
                    : `Bar ${m.number}: ${m.hit}/${m.expected} notes` +
                      (m.extra ? `, ${m.extra} wrong` : '') +
                      (m.hesitations ? `, ${m.hesitations} pause${m.hesitations > 1 ? 's' : ''}` : '') +
                      (m.tempoRatio !== null && Math.abs(m.tempoRatio - 1) > 0.12
                        ? `, ${m.tempoRatio > 1 ? 'rushed' : 'dragged'} ${Math.round(Math.abs(m.tempoRatio - 1) * 100)}%`
                        : '')
                }
                onClick={() => onPracticeBars?.(m.index, m.index)}
              >
                {m.number}
              </button>
            ))}
          </div>
        </section>

        <section className="tips">
          <h4>Coach's notes</h4>
          <ul>
            {report.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>

        <TimingChart report={report} song={song} />
        <TempoChart report={report} song={song} />
        <DynamicsChart report={report} song={song} />

        {report.passes.length > 0 && (
          <section>
            <h4>Loop passes</h4>
            <div className="chips">
              {report.passes.map((p, i) => (
                <span key={i} className={`chip ${p.clean ? 'chip-good' : ''}`}>
                  #{i + 1}: {pct(p.accuracy)} @ {Math.round(p.rate * 100)}%
                </span>
              ))}
            </div>
          </section>
        )}

        <footer className="report-actions">
          {report.recording.some((e) => e.type === 'on') && (
            <button className="btn" onClick={toggleReplay}>
              {replaying ? '■ Stop replay' : '▶ Replay my performance'}
            </button>
          )}
          {report.weakRange && onPracticeBars && song && (
            <button className="btn" onClick={() => onPracticeBars(report.weakRange!.from, report.weakRange!.to)}>
              {report.weakRange.from === report.weakRange.to
                ? `Loop bar ${song.measures[report.weakRange.from].number}`
                : `Loop bars ${song.measures[report.weakRange.from].number}–${song.measures[report.weakRange.to].number}`}
            </button>
          )}
          <span className="spacer" />
          {onAgain && (
            <button className="btn primary" onClick={onAgain}>
              Play again
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
