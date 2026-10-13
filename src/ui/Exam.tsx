import { lazy, Suspense, useMemo, useState } from 'react';
import type { Report } from '../engine/types';
import { examTotal, gradeFor, type ExamPart } from '../engine/exam';
import { scaleExercise, sightReading, TONICS, type ScaleKind } from '../music/exercises';
import type { Song } from '../music/types';
import { loadPref, savePref } from '../store/settings';
import { celebrate } from './feedback';
import { newSeed } from './Exercises';

const Player = lazy(() => import('./Player').then((m) => ({ default: m.Player })));

type Part = ExamPart;

interface ExamItem {
  part: Part;
  label: string;
  song: Song;
}

interface ExamSetup {
  pieces: string[]; // song ids
  scales: Array<{ pc: number; kind: ScaleKind }>;
  sightLevel: number; // 0 = no sight-reading
}

interface ExamResult {
  date: number;
  total: number;
  grade: string;
  items: Array<{ part: Part; label: string; score: number | null }>;
}

const PART_LABEL: Record<Part, string> = { scales: 'Scales', pieces: 'Pieces', sight: 'Sight-reading' };

/** An item stopped part-way only earns marks for the part that was played. */
function examMark(r: Report, song: Song): number {
  if (r.completed) return r.score;
  return Math.round(r.score * Math.min(1, r.notesHit / Math.max(1, song.notes.length)));
}

const KIND_NAME: Record<ScaleKind, string> = { major: 'major', 'natural-minor': 'natural minor', 'harmonic-minor': 'harmonic minor' };

/** A mock exam: scales, pieces and sight-reading performed one after another, with one combined mark. */
export function Exam({ songs, onExit }: { songs: Song[]; onExit: () => void }) {
  const [setup, setSetup] = useState<ExamSetup>(() =>
    loadPref<ExamSetup>('examSetup', { pieces: [], scales: [{ pc: 0, kind: 'major' }, { pc: 9, kind: 'natural-minor' }], sightLevel: 1 }),
  );
  const [items, setItems] = useState<ExamItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<Record<number, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const history = loadPref<ExamResult[]>('exams', []);
  const update = (patch: Partial<ExamSetup>) => {
    const next = { ...setup, ...patch };
    setSetup(next);
    savePref('examSetup', next);
  };
  const playable = useMemo(() => songs.filter((s) => s.notes.length > 0), [songs]);

  const begin = () => {
    const list: ExamItem[] = [
      ...setup.scales.map((sc) => {
        const t = TONICS.find((x) => x.pc === sc.pc)!;
        const label = `${sc.kind === 'major' ? t.major : t.minor} ${KIND_NAME[sc.kind]} scale`;
        return { part: 'scales' as Part, label, song: scaleExercise({ pc: sc.pc, kind: sc.kind, octaves: 2, hands: 'both', beats: 0.5, bpm: 80 }) };
      }),
      ...setup.pieces
        .map((id) => playable.find((s) => s.id === id))
        .filter((s): s is Song => !!s)
        .map((s) => ({ part: 'pieces' as Part, label: s.title, song: s })),
      ...(setup.sightLevel ? [{ part: 'sight' as Part, label: `Sight-reading (level ${setup.sightLevel})`, song: sightReading(setup.sightLevel, 8, newSeed()) }] : []),
    ];
    if (!list.length) return;
    setItems(list);
    setIndex(0);
    setScores({});
    setResult(null);
  };

  const finish = (final: Record<number, number>) => {
    if (!items) return;
    const rows = items.map((it, i) => ({ part: it.part, label: it.label, score: final[i] ?? null }));
    const total = examTotal(rows);
    const r: ExamResult = { date: Date.now(), total, grade: gradeFor(total), items: rows };
    savePref('exams', [r, ...history].slice(0, 20));
    setResult(r);
    setItems(null);
    if (total >= 75) celebrate();
  };

  /* ---------------- running */
  if (items) {
    const item = items[index];
    const last = index === items.length - 1;
    const next = () => (last ? finish(scores) : setIndex(index + 1));
    return (
      <div className="exam-run">
        <div className="exam-bar">
          <b>🎓 Exam</b>
          <span className="muted small">
            {index + 1} of {items.length} · {PART_LABEL[item.part]}: {item.label}
          </span>
          <span className="spacer" />
          {scores[index] !== undefined && <span className="small">Mark: {scores[index]}</span>}
          <button className="btn ghost" onClick={() => finish(scores)}>
            End exam
          </button>
        </div>
        <Suspense fallback={<div className="empty muted">Loading…</div>}>
          <Player
            key={`${index}-${item.song.id}`}
            song={item.song}
            preset={{ mode: 'audition', hands: ['R', 'L'], rate: 1, loop: null, transpose: 0 }}
            nextAction={{ label: last ? 'Finish exam ›' : 'Next item ›', run: next }}
            onReport={(r: Report) => setScores((sc) => ({ ...sc, [index]: examMark(r, item.song) }))}
            onExit={() => finish(scores)}
          />
        </Suspense>
      </div>
    );
  }

  /* ---------------- set-up and result */
  return (
    <div className="exam">
      <div className="checkup-head">
        <button className="btn ghost" onClick={onExit}>
          ← Back
        </button>
        <h1>Mock exam</h1>
      </div>

      {result && (
        <section className="checkup-card exam-result">
          <div className="exam-total">
            <div className="big">{result.total}</div>
            <div>
              <b className={`grade ${result.grade.toLowerCase().replace(' ', '-')}`}>{result.grade}</b>
              <div className="muted small">Pass 60 · Merit 75 · Distinction 87</div>
            </div>
          </div>
          <table className="exam-table">
            <tbody>
              {result.items.map((r, i) => (
                <tr key={i}>
                  <td className="muted small">{PART_LABEL[r.part]}</td>
                  <td>{r.label}</td>
                  <td className="num">{r.score ?? 'not played'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="checkup-card">
        <p className="muted">
          Like a grade exam: scales, then your pieces, then a piece you've never seen. Each item is played once as an Audition (your Audition
          options apply: countdown, restarts, what you see). Pieces count 60%, scales 20%, sight-reading 20%.
        </p>

        <h2>Scales</h2>
        {setup.scales.map((sc, i) => (
          <div key={i} className="exam-row">
            <select value={sc.pc} onChange={(e) => update({ scales: setup.scales.map((x, k) => (k === i ? { ...x, pc: Number(e.target.value) } : x)) })}>
              {TONICS.map((t) => (
                <option key={t.pc} value={t.pc}>
                  {sc.kind === 'major' ? t.major : t.minor}
                </option>
              ))}
            </select>
            <select
              value={sc.kind}
              onChange={(e) => update({ scales: setup.scales.map((x, k) => (k === i ? { ...x, kind: e.target.value as ScaleKind } : x)) })}
            >
              <option value="major">major</option>
              <option value="natural-minor">natural minor</option>
              <option value="harmonic-minor">harmonic minor</option>
            </select>
            <span className="muted small">2 octaves, hands together</span>
            <button className="icon-btn" onClick={() => update({ scales: setup.scales.filter((_, k) => k !== i) })} aria-label="Remove scale">
              ✕
            </button>
          </div>
        ))}
        {setup.scales.length < 4 && (
          <button className="btn ghost" onClick={() => update({ scales: [...setup.scales, { pc: 7, kind: 'major' }] })}>
            ＋ Add a scale
          </button>
        )}

        <h2>Pieces (up to 3)</h2>
        <div className="exam-pieces">
          {playable.map((s) => {
            const on = setup.pieces.includes(s.id);
            return (
              <label key={s.id} className={`check ${!on && setup.pieces.length >= 3 ? 'muted' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && setup.pieces.length >= 3}
                  onChange={() => update({ pieces: on ? setup.pieces.filter((x) => x !== s.id) : [...setup.pieces, s.id] })}
                />
                {s.title}
              </label>
            );
          })}
        </div>

        <h2>Sight-reading</h2>
        <div className="segmented">
          {[0, 1, 2, 3, 4].map((l) => (
            <button key={l} className={`seg ${setup.sightLevel === l ? 'on r' : ''}`} onClick={() => update({ sightLevel: l })}>
              {l === 0 ? 'None' : `Level ${l}`}
            </button>
          ))}
        </div>

        <div className="report-actions">
          <span className="spacer" />
          <button className="btn primary" disabled={!setup.scales.length && !setup.pieces.length && !setup.sightLevel} onClick={begin}>
            Start the exam
          </button>
        </div>
      </section>

      {history.length > 0 && (
        <section className="checkup-card">
          <h2>Earlier exams</h2>
          <table className="exam-table">
            <tbody>
              {history.slice(0, 8).map((h) => (
                <tr key={h.date}>
                  <td className="muted small">{new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td>{h.items.length} items</td>
                  <td className="num">
                    {h.total} · {h.grade}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
