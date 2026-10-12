import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import type { KeyKind } from '../engine/controllers';
import { Session, type Hud } from '../engine/session';
import { MODE_LABELS, type ModeKind, type Report } from '../engine/types';
import { inputHub } from '../input/hub';
import type { Hand, Song } from '../music/types';
import { addPracticeTime, saveSession, updateBest } from '../store/db';
import { loadPref, savePref, useSettings } from '../store/settings';
import { InputBar } from './InputBar';
import type { Queue } from './Library';
import { ReportView } from './Report';
import { ScoreView, type ScoreHandle } from './ScoreView';
import { keyNames, transposeRange, transposeSong } from '../music/transpose';
import { Stage } from './stage';

const MODES: ModeKind[] = ['learn', 'practice', 'audition', 'roll', 'listen'];

const KEEP_GOING_HELP =
  'The music keeps going at tempo, like a real performance. Play the notes as they reach the line; missed and wrong notes are marked.';

const MODE_HELP: Record<ModeKind, string> = {
  learn: 'The music waits for you. Play the highlighted keys to move on; chord notes can come in any order.',
  practice: 'Play at your own pace; the score follows you. Wrong notes are flagged and you get a bar-by-bar report.',
  audition: 'Perform it start to finish with no hints. Afterwards: accuracy, tempo, timing, dynamics and evenness.',
  roll: 'Notes fall in time. Strike them as they reach the line: Perfect, Good or Miss. Keep the combo going.',
  listen: 'Hear the piece at the chosen tempo while the score and notes scroll by.',
};

/** Settings a caller (the daily plan, exercises) can open the player with. */
export interface PlayerPreset {
  mode?: ModeKind;
  hands?: Hand[];
  rate?: number;
  loop?: { from: number; to: number } | null;
  transpose?: number;
}

type WaitMode = 'learn' | 'practice' | 'roll';

interface Props {
  song: Song;
  queue?: Queue; // the collection being practised, in order
  preset?: PlayerPreset;
  /** An extra "next" button, e.g. a new sight-reading exercise. */
  nextAction?: { label: string; run: () => void };
  onNavigate?: (song: Song) => void;
  onExit: () => void;
  onSaved?: () => void;
}

export function Player({ song: baseSong, queue, preset, nextAction, onNavigate, onExit, onSaved }: Props) {
  const settings = useSettings();
  const id = baseSong.id;
  const [transpose, setTranspose] = useState<number>(() => preset?.transpose ?? loadPref(`transpose.${id}`, 0));
  // Everything below works on the (possibly transposed) song.
  const song = useMemo(() => transposeSong(baseSong, transpose), [baseSong, transpose]);
  const [tMin, tMax] = useMemo(() => transposeRange(baseSong), [baseSong]);
  const [mode, setMode] = useState<ModeKind>(() => preset?.mode ?? loadPref<ModeKind>('mode', 'learn'));
  const [hands, setHands] = useState<Record<Hand, boolean>>(() =>
    preset?.hands ? { R: preset.hands.includes('R'), L: preset.hands.includes('L') } : loadPref(`hands.${id}`, { R: true, L: true }),
  );
  const [otherHand, setOtherHand] = useState<'app' | 'mute'>(() => loadPref('otherHand', 'app'));
  const [rate, setRate] = useState<number>(() => preset?.rate ?? loadPref(`rate.${id}`, 1));
  const [metronome, setMetronome] = useState(false);
  const firstBar = song.measures[0].number === 0 && song.measures.length > 1 ? 1 : 0;
  const [loopOn, setLoopOn] = useState(!!preset?.loop);
  const [loop, setLoop] = useState(preset?.loop ?? { from: firstBar, to: Math.min(song.measures.length - 1, firstBar + 3) });
  const [autoSpeed, setAutoSpeed] = useState(true);
  const [waitBy, setWaitBy] = useState<Record<WaitMode, boolean>>(() => loadPref('waitBy', { learn: true, practice: true, roll: false }));
  const canWait = mode === 'learn' || mode === 'practice' || mode === 'roll';
  const wait = canWait ? waitBy[mode as WaitMode] : true;
  const [scoreOn, setScoreOn] = useState<Record<ModeKind, boolean>>(() =>
    loadPref('scoreOn', { learn: true, practice: true, audition: true, roll: false, listen: true }),
  );
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [heat, setHeat] = useState<Report['measures'] | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pianoState, setPianoState] = useState<'idle' | 'loading' | 'ready'>(piano.loaded ? 'ready' : 'idle');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const scoreRef = useRef<ScoreHandle>(null);
  const sessionRef = useRef<Session | null>(null);
  const pointerPitch = useRef<number | null>(null);

  const queueIndex = queue ? queue.songs.findIndex((s) => s.id === song.id) : -1;
  const prevSong = queue && queueIndex > 0 ? queue.songs[queueIndex - 1] : null;
  const nextSong = queue && queueIndex >= 0 && queueIndex < queue.songs.length - 1 ? queue.songs[queueIndex + 1] : null;
  const userHands = useMemo<Hand[]>(() => (['R', 'L'] as Hand[]).filter((h) => hands[h]), [hands]);
  const bothHands = userHands.length === 2;
  const showScore = scoreOn[mode] && !!song.scoreXml;
  const loopBeats = loopOn
    ? { start: song.measures[loop.from].start, end: song.measures[loop.to].start + song.measures[loop.to].length }
    : null;

  // Values the animation loop reads every frame.
  const ui = useRef({
    userHands,
    showFalling: true,
    hideCues: false,
    rate,
    loopBeats,
    idleBeat: -0.5,
    noteNames: settings.noteNames,
  });
  ui.current = {
    userHands: mode === 'listen' ? ['R', 'L'] : userHands,
    showFalling: mode !== 'audition',
    hideCues: mode === 'audition',
    rate,
    loopBeats,
    idleBeat: (loopBeats?.start ?? 0) - 0.5,
    noteNames: settings.noteNames,
  };

  useEffect(() => savePref('mode', mode), [mode]);
  useEffect(() => savePref(`hands.${song.id}`, hands), [hands, song.id]);
  useEffect(() => savePref(`rate.${song.id}`, rate), [rate, song.id]);
  useEffect(() => savePref('otherHand', otherHand), [otherHand]);
  useEffect(() => savePref('scoreOn', scoreOn), [scoreOn]);
  useEffect(() => savePref('waitBy', waitBy), [waitBy]);
  useEffect(() => savePref(`transpose.${id}`, transpose), [transpose, id]);

  const finished = useCallback(
    async (s: Session) => {
      setRunning(false);
      setRate(Math.round(s.rate * 100) / 100);
      const r = s.report;
      if (!r) return;
      setReport(r);
      setHeat(r.measures);
      try {
        await saveSession(r);
        await updateBest(r);
        await addPracticeTime(r.durationSec);
        onSaved?.();
      } catch (err) {
        console.warn('Could not save the session', err);
      }
    },
    [onSaved],
  );

  const start = useCallback(async () => {
    await resumeAudio();
    if (!piano.loaded) {
      setPianoState('loading');
      piano.load().then(() => setPianoState('ready'));
    }
    sessionRef.current?.dispose();
    setReport(null);
    setHeat(null);
    setToast(null);
    const s = new Session(
      song,
      {
        mode,
        hands: userHands,
        otherHand: bothHands ? 'mute' : otherHand,
        rate,
        metronome,
        loop: loopOn ? loop : null,
        autoSpeedUp: autoSpeed,
        wait,
      },
      performance.now(),
    );
    s.subscribe(() => {
      if (s.message) setToast(s.message);
      setRate(Math.round(s.rate * 100) / 100);
      if (s.status === 'finished') void finished(s);
    });
    sessionRef.current = s;
    if (import.meta.env.DEV) (window as unknown as { __pianistSession?: Session }).__pianistSession = s;
    setHud(s.hud(performance.now()));
    setRunning(true);
  }, [song, mode, userHands, bothHands, otherHand, rate, metronome, loopOn, loop, autoSpeed, wait, finished]);

  const stop = useCallback(() => {
    const s = sessionRef.current;
    if (s && s.status === 'running') s.stop(performance.now());
    setRunning(false);
  }, []);

  // A finished run keeps its colours on screen until a setting changes.
  const resetView = useCallback(() => {
    if (sessionRef.current?.status === 'finished') {
      sessionRef.current.dispose();
      sessionRef.current = null;
    }
  }, []);

  useEffect(() => {
    resetView();
  }, [mode, hands, loopOn, loop, wait, otherHand, song, resetView]);

  // Live tweaks during a run
  useEffect(() => {
    const s = sessionRef.current;
    if (s?.status === 'running' && Math.abs(s.rate - rate) > 1e-6) s.setRate(rate);
  }, [rate]);
  useEffect(() => {
    sessionRef.current?.setMetronome(metronome);
  }, [metronome]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = new Stage(canvas);
    stageRef.current = stage;
    stage.setSong(song, settings.fullKeyboard);
    stage.resize();
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(canvas);
    let raf = 0;
    let lastHud = 0;
    const tick = () => {
      const now = performance.now();
      const s = sessionRef.current;
      const u = ui.current;
      s?.frame(now);
      const beat = s ? s.playhead(now) : u.idleBeat;
      const held = new Map<number, KeyKind>();
      for (const p of inputHub.held.keys()) held.set(p, s?.status === 'running' ? (s.keyKinds.get(p) ?? 'neutral') : 'neutral');
      stage.draw({
        beat,
        now,
        bps: (song.bpm * u.rate) / 60,
        marks: s?.marks ?? null,
        userHands: s ? s.hands : u.userHands,
        showFalling: u.showFalling,
        targets: s ? s.targets(now) : [],
        held,
        flashes: s?.flashes ?? [],
        waiting: s ? s.waiting(now) : false,
        loop: u.loopBeats,
        hideCues: u.hideCues,
        noteNames: u.noteNames,
      });
      scoreRef.current?.setBeat(beat);
      if (s && s.status === 'running' && now - lastHud > 150) {
        lastHud = now;
        setHud(s.hud(now));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [song, settings.fullKeyboard]);

  // Space starts / stops, Escape stops or closes the report.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (running) stop();
        else if (!report) void start();
      } else if (e.code === 'Escape') {
        if (running) stop();
        else if (report) setReport(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, report, start, stop]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onMeasureClick = useCallback(
    (index: number, shift: boolean) => {
      if (running) return;
      setLoopOn(true);
      setLoop((l) => (shift && loopOn ? { from: Math.min(l.from, index), to: Math.max(l.from, index) } : { from: index, to: index }));
    },
    [running, loopOn],
  );

  const practiceBars = (from: number, to: number) => {
    setReport(null);
    setLoopOn(true);
    setLoop({ from, to });
    if (mode === 'audition' || mode === 'listen') setMode('practice');
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = stage.pitchAt(e.clientX - r.left, e.clientY - r.top);
    if (p === null) return;
    void resumeAudio();
    void piano.load();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerPitch.current = p;
    inputHub.noteOn({ pitch: p, velocity: 80, time: e.timeStamp, source: 'screen' });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerPitch.current === null) return;
    inputHub.noteOff(pointerPitch.current, e.timeStamp, 'screen');
    pointerPitch.current = null;
  };

  const barOptions = useMemo(
    () =>
      song.measures.map((m) => (
        <option key={m.index} value={m.index}>
          {m.number === 0 ? 'pickup' : m.number}
        </option>
      )),
    [song],
  );

  const scoreLoop = loopOn ? loop : null;
  const heatData = !running && heat ? heat.map((m) => ({ index: m.index, score: m.score })) : null;
  const toggleHand = (h: Hand) => {
    const next = { ...hands, [h]: !hands[h] };
    if (!next.R && !next.L) next[h === 'R' ? 'L' : 'R'] = true;
    setHands(next);
  };

  return (
    <div className="player">
      <header className="player-head">
        <button className="btn ghost" onClick={onExit} title="Back to the library">
          ← Library
        </button>
        <div className="song-title">
          <h1>{song.title}</h1>
          <span className="muted">
            {[song.composer, `${song.timeSig[0]}/${song.timeSig[1]}`, `${song.bpm} bpm`].filter(Boolean).join(' · ')}
          </span>
        </div>
        {queue && queueIndex >= 0 && (
          <div className="queue-nav" title={`Collection: ${queue.name}`}>
            <button className="icon-btn" disabled={!prevSong || running} onClick={() => prevSong && onNavigate?.(prevSong)} aria-label="Previous piece">
              ‹
            </button>
            <span className="small">
              <span className="muted">{queue.name}</span> {queueIndex + 1}/{queue.songs.length}
            </span>
            <button className="icon-btn" disabled={!nextSong || running} onClick={() => nextSong && onNavigate?.(nextSong)} aria-label="Next piece">
              ›
            </button>
          </div>
        )}
        {nextAction && (
          <button className="btn" disabled={running} onClick={nextAction.run}>
            {nextAction.label}
          </button>
        )}
        <nav className="mode-tabs" aria-label="Practice mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={`tab ${mode === m ? 'active' : ''}`}
              disabled={running}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </nav>
        <InputBar />
      </header>

      <div className="toolbar">
        <button className={`btn start ${running ? 'stop' : 'primary'}`} onClick={running ? stop : () => void start()}>
          {running ? '■ Stop' : mode === 'listen' ? '▶ Listen' : '▶ Start'}
        </button>

        {mode !== 'listen' && (
          <div className="group" title="Which hands you play">
            <span className="label">Hands</span>
            <button className={`seg ${hands.L ? 'on l' : ''}`} disabled={running} onClick={() => toggleHand('L')}>
              Left
            </button>
            <button className={`seg ${hands.R ? 'on r' : ''}`} disabled={running} onClick={() => toggleHand('R')}>
              Right
            </button>
            {!bothHands && (
              <select
                value={otherHand}
                disabled={running}
                onChange={(e) => setOtherHand(e.target.value as 'app' | 'mute')}
                title="What happens to the other hand's part"
              >
                <option value="app">other hand: app plays</option>
                <option value="mute">other hand: silent</option>
              </select>
            )}
          </div>
        )}

        <div className="group tempo" title="Tempo">
          <span className="label">Tempo</span>
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          />
          <span className="value">
            {Math.round(rate * 100)}% <span className="muted">· {Math.round(song.bpm * rate)} bpm</span>
          </span>
        </div>

        <button className={`btn toggle ${metronome ? 'on' : ''}`} onClick={() => setMetronome(!metronome)} title="Metronome">
          ♩ Metronome
        </button>

        <div className="group" title="Repeat a range of bars">
            <button className={`btn toggle ${loopOn ? 'on' : ''}`} disabled={running} onClick={() => setLoopOn(!loopOn)}>
              ⟲ Loop
            </button>
            {loopOn && (
              <>
                <select
                  value={loop.from}
                  disabled={running}
                  onChange={(e) => {
                    const from = Number(e.target.value);
                    setLoop((l) => ({ from, to: Math.max(from, l.to) }));
                  }}
                >
                  {barOptions}
                </select>
                <span className="muted">to</span>
                <select
                  value={loop.to}
                  disabled={running}
                  onChange={(e) => {
                    const to = Number(e.target.value);
                    setLoop((l) => ({ from: Math.min(l.from, to), to }));
                  }}
                >
                  {barOptions}
                </select>
                {mode !== 'listen' && (
                  <label className="check" title="After a clean pass (90%+), go 5% faster, up to 100%">
                    <input type="checkbox" checked={autoSpeed} onChange={(e) => setAutoSpeed(e.target.checked)} />
                    speed up
                  </label>
                )}
              </>
            )}
        </div>

        {canWait && (
          <button
            className={`btn toggle ${wait ? 'on' : ''}`}
            disabled={running}
            onClick={() => setWaitBy({ ...waitBy, [mode]: !wait })}
            title={
              wait
                ? 'On: the music waits for the right notes. Click to keep going at tempo instead.'
                : 'Off: the music keeps going at tempo and missed notes are marked. Click to wait for you.'
            }
          >
            {wait ? '⏸ Wait for me' : '▶ Keep going'}
          </button>
        )}

        <div className="group" title="Transpose the whole piece. One step is a half step (C to C sharp); two steps take C to D.">
          <span className="label">Key</span>
          <button className="seg" disabled={running || transpose <= tMin} onClick={() => setTranspose(transpose - 1)} aria-label="Transpose down">
            −
          </button>
          <span className="value transpose-value">
            {keyNames(song.keyFifths)}
            {transpose !== 0 && <span className="muted"> ({transpose > 0 ? `+${transpose}` : transpose})</span>}
          </span>
          <button className="seg" disabled={running || transpose >= tMax} onClick={() => setTranspose(transpose + 1)} aria-label="Transpose up">
            +
          </button>
          {transpose !== 0 && (
            <button className="icon-btn" disabled={running} onClick={() => setTranspose(0)} title="Back to the original key">
              ↺
            </button>
          )}
        </div>

        <span className="spacer" />
        {song.scoreXml && (
          <button
            className={`btn toggle ${scoreOn[mode] ? 'on' : ''}`}
            onClick={() => setScoreOn({ ...scoreOn, [mode]: !scoreOn[mode] })}
            title="Show or hide the sheet music"
          >
            𝄞 Score
          </button>
        )}
      </div>

      {showScore && (
        <ScoreView
          ref={scoreRef}
          song={song}
          heat={heatData}
          loop={scoreLoop}
          onMeasureClick={onMeasureClick}
          showPlayhead={mode !== 'audition' || !running}
        />
      )}

      <div className="stage-wrap">
        <canvas
          ref={canvasRef}
          className="stage"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div className="hud">
          {running && hud && <HudView mode={mode} hud={hud} />}
          {!running && !report && (
            <div className="hint">
              <b>{MODE_LABELS[mode]}.</b> {canWait && !wait ? KEEP_GOING_HELP : MODE_HELP[mode]}
              <div className="muted small">
                Press <kbd>Space</kbd> or Start. {showScore ? 'Click bars in the score to loop them.' : ''}
                {pianoState === 'loading' ? ' Loading piano sound…' : ''}
              </div>
            </div>
          )}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>

      {report && (
        <ReportView
          report={report}
          song={song}
          onClose={() => setReport(null)}
          onPracticeBars={practiceBars}
          onAgain={() => {
            setReport(null);
            void start();
          }}
          onNext={nextSong ? () => onNavigate?.(nextSong) : nextAction?.run}
          nextTitle={nextSong?.title ?? nextAction?.label}
        />
      )}
    </div>
  );
}

function HudView({ mode, hud }: { mode: ModeKind; hud: Hud }) {
  const pct = hud.accuracy === null ? '—' : `${Math.round(hud.accuracy * 100)}%`;
  if (mode === 'listen') return <div className="hud-line">Listening at {Math.round(hud.rate * 100)}%</div>;
  if (mode === 'audition') return <div className="hud-line rec">● Performing. Feedback comes at the end.</div>;
  if (hud.timed) {
    return (
      <div className="hud-line">
        <span className="combo">{hud.combo}×</span> combo · <b>{hud.perfect}</b> perfect · <b>{hud.good}</b> good ·{' '}
        <b>{hud.miss}</b> miss · {pct}
      </div>
    );
  }
  return (
    <div className="hud-line">
      Accuracy <b>{pct}</b> · wrong notes <b>{hud.wrong}</b>
      {hud.pass > 1 ? ` · pass ${hud.pass}` : ''} · {Math.round(hud.rate * 100)}%
      {hud.waiting && <span className="waiting"> · waiting for you…</span>}
    </div>
  );
}
