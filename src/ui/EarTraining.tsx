import { useCallback, useEffect, useRef, useState } from 'react';
import { audioCtx, resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import type { KeyKind } from '../engine/controllers';
import { inputHub } from '../input/hub';
import { checkAnswer, EAR_LEVELS, groupPresses, makeQuestion, nextLevel, seededRng, type EarKind, type EarQuestion, type EarResult } from '../music/ear';
import { addPracticeTime } from '../store/db';
import { loadPref, savePref, useSettings } from '../store/settings';
import { Stage } from './stage';

interface Stats {
  level: number;
  streak: number;
  misses: number;
  right: number;
  total: number;
  best: number;
}

const KINDS: Array<[EarKind, string, string]> = [
  ['notes', 'Notes', 'Hear a C, then another note. Find it.'],
  ['intervals', 'Intervals', 'Two notes one after the other. Play both.'],
  ['chords', 'Chords', 'Three or four notes together. Play the chord.'],
  ['melodies', 'Melodies', 'A short tune. Play it back.'],
];

const freshStats = (): Stats => ({ level: 1, streak: 0, misses: 0, right: 0, total: 0, best: 0 });

type Phase = 'idle' | 'playing' | 'listening' | 'result';

export function EarTraining({ initialKind, onExit }: { initialKind: EarKind; onExit: () => void }) {
  const settings = useSettings();
  const [kind, setKind] = useState<EarKind>(initialKind);
  const [allStats, setAllStats] = useState<Record<EarKind, Stats>>(() => ({
    notes: freshStats(),
    intervals: freshStats(),
    chords: freshStats(),
    melodies: freshStats(),
    ...loadPref<Partial<Record<EarKind, Stats>>>('ear', {}),
  }));
  const [q, setQ] = useState<EarQuestion | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<EarResult | null>(null);
  const [played, setPlayed] = useState<number[][]>([]);
  const [revealed, setRevealed] = useState(false);
  const [anyOctave, setAnyOctave] = useState(() => loadPref('earAnyOctave', true));
  const [message, setMessage] = useState<string | null>(null);
  const presses = useRef<Array<{ pitch: number; time: number }>>([]);
  const timers = useRef<number[]>([]);
  const rng = useRef(seededRng(Date.now()));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ q, phase, result, played, revealed });
  view.current = { q, phase, result, played, revealed };
  if (import.meta.env.DEV) Object.assign(window, { __pianistEar: view });
  const stats = allStats[kind];

  // Time spent here counts as practice.
  useEffect(() => {
    const started = performance.now();
    return () => {
      const sec = (performance.now() - started) / 1000;
      if (sec >= 20) void addPracticeTime(sec).catch(() => {});
    };
  }, []);

  useEffect(() => savePref('earAnyOctave', anyOctave), [anyOctave]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const finish = useCallback(() => {
    const cur = view.current;
    if (!cur.q || cur.phase !== 'listening') return;
    const groups = groupPresses(presses.current);
    const r = checkAnswer(cur.q, groups, anyOctave);
    setPlayed(groups);
    setResult(r);
    setPhase('result');
    setAllStats((all) => {
      const s = { ...all[kind] };
      s.total++;
      if (r.correct) {
        s.right++;
        s.streak++;
        s.misses = 0;
        s.best = Math.max(s.best, s.streak);
      } else {
        s.streak = 0;
        s.misses++;
      }
      const lv = nextLevel(s.level, s.streak, s.misses);
      if (lv !== s.level) {
        setMessage(lv > s.level ? `Level up! Now: ${EAR_LEVELS[kind][lv - 1]}` : `Back to level ${lv} for a bit`);
        s.level = lv;
        s.streak = 0;
        s.misses = 0;
      } else setMessage(null);
      const next = { ...all, [kind]: s };
      savePref('ear', next);
      return next;
    });
  }, [anyOctave, kind]);

  // Listen for the answer.
  useEffect(() => {
    if (phase !== 'listening' || !q) return;
    presses.current = [];
    const expected = q.answer.flat().length;
    const isChord = q.answer.some((g) => g.length > 1);
    let doneTimer = 0;
    const off = inputHub.onNote((n) => {
      presses.current.push({ pitch: n.pitch, time: n.time });
      window.clearTimeout(doneTimer);
      const count = presses.current.length;
      if (count >= expected) doneTimer = window.setTimeout(finish, isChord ? 350 : 250);
      else if (isChord) doneTimer = window.setTimeout(finish, 1500);
    });
    return () => {
      off();
      window.clearTimeout(doneTimer);
    };
  }, [phase, q, finish]);

  const play = useCallback(async (question: EarQuestion) => {
    clearTimers();
    await resumeAudio();
    await piano.load();
    setPhase('playing');
    setResult(null);
    setPlayed([]);
    setRevealed(false);
    const t0 = audioCtx().currentTime + 0.15;
    let t = t0;
    if (question.reference !== undefined) {
      piano.noteOn(question.reference, 80, { when: t, duration: 0.8, bus: 'accomp' });
      t += 1.3;
    }
    for (const g of question.answer) {
      for (const p of g) piano.noteOn(p, 82, { when: t, duration: g.length > 1 ? 1.4 : 0.6, bus: 'accomp' });
      t += g.length > 1 ? 1.6 : 0.7;
    }
    // Chords are also played broken, low to high, to help hear the notes.
    const chord = question.answer.find((g) => g.length > 1);
    if (chord) {
      chord.forEach((p, i) => piano.noteOn(p, 72, { when: t + i * 0.35, duration: 0.6, bus: 'accomp' }));
      t += chord.length * 0.35 + 0.4;
    }
    timers.current.push(window.setTimeout(() => setPhase('listening'), (t - audioCtx().currentTime) * 1000));
  }, []);

  const next = useCallback(() => {
    const question = makeQuestion(kind, allStats[kind].level, rng.current);
    setQ(question);
    setMessage(null);
    void play(question);
  }, [kind, allStats, play]);

  useEffect(() => () => clearTimers(), []);

  // Space: play / next. Enter: check now.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'idle' || phase === 'result') next();
        else if (q) void play(q);
      } else if (e.code === 'Enter' && phase === 'listening') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, q, next, play, finish]);

  // Keyboard drawing: hint before answering, then right / wrong keys and the answer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Stage(canvas);
    stage.setSong(null, false);
    stage.setRange(48, 84);
    stage.resize();
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(canvas);
    let raf = 0;
    const tick = () => {
      const v = view.current;
      const held = new Map<number, KeyKind>();
      let targets: number[] = [];
      if (v.phase === 'result' && v.q) {
        const answerPcs = new Set(v.q.answer.flat().map((p) => (anyOctave ? p % 12 : p)));
        for (const p of v.played.flat()) held.set(p, answerPcs.has(anyOctave ? p % 12 : p) ? 'good' : 'wrong');
        if (!v.result?.correct || v.revealed) targets = v.q.answer.flat();
      } else {
        for (const p of inputHub.held.keys()) held.set(p, 'neutral');
        if (v.q?.hint !== undefined && v.phase === 'listening') targets = [v.q.hint];
      }
      stage.draw({
        beat: 0,
        now: performance.now(),
        bps: 1,
        marks: null,
        userHands: ['R', 'L'],
        showFalling: false,
        targets,
        held,
        flashes: [],
        waiting: false,
        loop: null,
        hideCues: false,
        display: { ...settings, showTargets: true },
        preferFlats: false,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [anyOctave, settings]);

  const pct = stats.total ? Math.round((stats.right / stats.total) * 100) : 0;

  return (
    <div className="ear">
      <div className="section-head">
        <button className="btn ghost" onClick={onExit}>
          ← Exercises
        </button>
        <h2>Ear training</h2>
      </div>
      <nav className="shelf">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            className={`shelf-chip ${kind === k ? 'active' : ''}`}
            onClick={() => {
              clearTimers();
              setKind(k);
              setQ(null);
              setPhase('idle');
              setResult(null);
              setMessage(null);
            }}
          >
            {label} <span className="count">L{allStats[k].level}</span>
          </button>
        ))}
      </nav>

      <section className="ex-card ear-card">
        <div className="ear-info">
          <div>
            <b>
              Level {stats.level}: {EAR_LEVELS[kind][stats.level - 1]}
            </b>
            <div className="muted small">{KINDS.find(([k]) => k === kind)![2]} Three right in a row moves you up a level.</div>
          </div>
          <div className="ear-stats">
            <span>
              Streak <b>{stats.streak}</b>
            </span>
            <span>
              Best <b>{stats.best}</b>
            </span>
            <span>
              Right <b>{pct}%</b> <span className="muted">of {stats.total}</span>
            </span>
          </div>
        </div>

        <div className="ear-status">
          {phase === 'idle' && <span>Press Play (or Space) to hear the first one.</span>}
          {phase === 'playing' && <span>Listen…</span>}
          {phase === 'listening' && (
            <span>
              Your turn: play it on the piano{q?.hint !== undefined ? ', starting on the highlighted key' : ''}.
            </span>
          )}
          {phase === 'result' && result && (
            <span className={result.correct ? 'ok' : 'bad'}>
              {result.correct ? '✓ Right!' : '✗ Not quite.'} {result.correct || revealed ? q?.label : ''}
            </span>
          )}
          {message && <div className="ear-message">{message}</div>}
        </div>

        <div className="rec-controls">
          {phase === 'idle' || phase === 'result' ? (
            <button className="btn primary" onClick={next}>
              {phase === 'idle' ? '▶ Play' : 'Next ▶'}
            </button>
          ) : (
            <button className="btn" disabled={phase === 'playing'} onClick={() => q && void play(q)}>
              ↻ Hear again
            </button>
          )}
          {phase === 'result' && q && (
            <button className="btn" onClick={() => void play(q)}>
              ↻ Try again
            </button>
          )}
          {phase === 'listening' && (
            <button className="btn" onClick={finish}>
              Check
            </button>
          )}
          {phase === 'result' && result && !result.correct && !revealed && (
            <button
              className="btn"
              onClick={() => {
                setRevealed(true);
                if (q) {
                  const t = audioCtx().currentTime + 0.1;
                  q.answer.forEach((g, i) => g.forEach((p) => piano.noteOn(p, 80, { when: t + i * 0.7, duration: 0.6, bus: 'accomp' })));
                }
              }}
            >
              Show answer
            </button>
          )}
          <span className="spacer" />
          <label className="check" title="Accept the right notes in any octave">
            <input type="checkbox" checked={anyOctave} onChange={(e) => setAnyOctave(e.target.checked)} />
            Any octave
          </label>
        </div>
        <canvas ref={canvasRef} className="ear-keys" />
      </section>
    </div>
  );
}
