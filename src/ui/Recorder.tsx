import { useEffect, useRef, useState } from 'react';
import { perfToAudio, resumeAudio } from '../audio/audio';
import { metronomeClick, piano } from '../audio/piano';
import type { KeyKind } from '../engine/controllers';
import { inputHub } from '../input/hub';
import { pitchName } from '../music/pitch';
import { buildRecordedSong, type RecordedNoteEvent as Ev } from '../music/recording';
import { clickUnit, measureLength } from '../music/song';
import type { Song } from '../music/types';
import { ScoreView, type ScoreHandle } from './ScoreView';
import { Stage } from './stage';

interface Props {
  onCancel: () => void;
  onSaved: (song: Song) => void;
}

const TIMES: Array<[string, [number, number]]> = [
  ['4/4', [4, 4]],
  ['3/4', [3, 4]],
  ['2/4', [2, 4]],
  ['6/8', [6, 8]],
];

export function Recorder({ onCancel, onSaved }: Props) {
  const [title, setTitle] = useState('My recording');
  const [bpm, setBpm] = useState(90);
  const [time, setTime] = useState('4/4');
  const [metro, setMetro] = useState(true);
  const [split, setSplit] = useState(60);
  const [grid, setGrid] = useState(4);
  const [status, setStatus] = useState<'idle' | 'recording' | 'review'>('idle');
  const [song, setSong] = useState<Song | null>(null);
  const [display, setDisplay] = useState('');
  const [noteCount, setNoteCount] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const events = useRef<Ev[]>([]);
  const t0 = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<ScoreHandle>(null);
  const previewStop = useRef<(() => void) | null>(null);
  const timeSig = TIMES.find(([k]) => k === time)![1];

  // Live keyboard
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new Stage(canvas);
    stage.setSong(null, true);
    stage.resize();
    const ro = new ResizeObserver(() => stage.resize());
    ro.observe(canvas);
    let raf = 0;
    const tick = () => {
      const held = new Map<number, KeyKind>();
      for (const p of inputHub.held.keys()) held.set(p, 'neutral');
      stage.draw({
        beat: 0,
        now: performance.now(),
        bps: 1,
        marks: null,
        userHands: ['L', 'R'],
        showFalling: false,
        targets: [],
        held,
        flashes: [],
        waiting: false,
        loop: null,
        hideCues: false,
        noteNames: 'c-only',
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [status]);

  // Recording: capture input, click the metronome, show bar and beat.
  useEffect(() => {
    if (status !== 'recording') return;
    const bps = bpm / 60;
    const unit = clickUnit(timeSig);
    const bar = measureLength(timeSig);
    let nextClick = -bar; // beats, count-in starts one bar early
    const offOn = inputHub.onNote((n) => {
      events.current.push({ type: 'on', pitch: n.pitch, velocity: n.velocity, t: n.time });
      setNoteCount((c) => c + 1);
    });
    const offOff = inputHub.onNoteOff((pitch, t) => events.current.push({ type: 'off', pitch, velocity: 0, t }));
    const timer = window.setInterval(() => {
      const now = performance.now();
      const beatNow = ((now - t0.current) / 1000) * bps;
      while (nextClick < beatNow + 0.15 * bps) {
        const t = t0.current + (nextClick / bps) * 1000;
        const inBar = ((nextClick % bar) + bar) % bar;
        if (metro || nextClick < 0) metronomeClick(perfToAudio(t), Math.abs(inBar) < 1e-6);
        nextClick += unit;
      }
      if (beatNow < 0) setDisplay(`Count-in… ${Math.ceil(-beatNow / unit)}`);
      else setDisplay(`Bar ${Math.floor(beatNow / bar) + 1} · beat ${Math.floor((beatNow % bar) / unit) + 1}`);
    }, 25);
    return () => {
      window.clearInterval(timer);
      offOn();
      offOff();
    };
  }, [status, bpm, metro, timeSig]);

  const start = async () => {
    await resumeAudio();
    void piano.load();
    events.current = [];
    setNoteCount(0);
    setSong(null);
    const bar = measureLength(timeSig);
    t0.current = performance.now() + 200 + (bar / (bpm / 60)) * 1000;
    setStatus('recording');
  };

  const stop = () => {
    const s = buildRecordedSong(events.current, { t0: t0.current, stopAt: performance.now(), bpm, timeSig, split, grid, title });
    setSong(s);
    setStatus(s ? 'review' : 'idle');
    setDisplay(s ? '' : 'Nothing was played. Try again.');
  };

  const preview = async () => {
    if (!song) return;
    if (previewing) {
      previewStop.current?.();
      return;
    }
    await resumeAudio();
    await piano.load();
    const startPerf = performance.now() + 150;
    const bps = song.bpm / 60;
    for (const n of song.notes) {
      piano.noteOn(n.pitch, n.velocity, { when: perfToAudio(startPerf + (n.start / bps) * 1000), duration: n.dur / bps, bus: 'accomp' });
    }
    setPreviewing(true);
    let raf = 0;
    const tick = () => {
      const beat = ((performance.now() - startPerf) / 1000) * bps;
      scoreRef.current?.setBeat(beat);
      if (beat > song.totalBeats) previewStop.current?.();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    previewStop.current = () => {
      cancelAnimationFrame(raf);
      piano.stopAll('accomp');
      setPreviewing(false);
      previewStop.current = null;
    };
  };
  useEffect(() => () => previewStop.current?.(), []);

  return (
    <div className="recorder">
      <div className="section-head">
        <h2>Record a song</h2>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted">
        Play anything on your piano. It becomes sheet music you can practise in every mode. Notes at or above the split key go to the right
        hand.
      </p>

      <div className="form">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={status === 'recording'} />
        </label>
        <label>
          Tempo
          <input type="number" min={30} max={240} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || 90)} disabled={status === 'recording'} />
        </label>
        <label>
          Time
          <select value={time} onChange={(e) => setTime(e.target.value)} disabled={status === 'recording'}>
            {TIMES.map(([k]) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Split
          <select value={split} onChange={(e) => setSplit(Number(e.target.value))} disabled={status === 'recording'}>
            {[48, 53, 55, 57, 60, 62, 64].map((p) => (
              <option key={p} value={p}>
                {pitchName(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rhythm grid
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} disabled={status === 'recording'}>
            <option value={2}>Eighth notes</option>
            <option value={4}>Sixteenth notes</option>
            <option value={12}>Sixteenths + triplets</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} />
          Metronome while recording
        </label>
      </div>

      <div className="rec-controls">
        {status === 'recording' ? (
          <button className="btn stop" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn rec" onClick={() => void start()}>
            ● {status === 'review' ? 'Record again' : 'Record'}
          </button>
        )}
        <span className="rec-display">{status === 'recording' ? `${display} · ${noteCount} notes` : display}</span>
      </div>

      {status === 'review' && song && (
        <div className="review">
          <ScoreView ref={scoreRef} song={song} heat={null} loop={null} showPlayhead={previewing} />
          <div className="rec-controls">
            <button className="btn" onClick={() => void preview()}>
              {previewing ? '■ Stop' : '▶ Preview'}
            </button>
            <span className="muted">
              {song.notes.length} notes · {song.measures.length} bars
            </span>
            <span className="spacer" />
            <button className="btn primary" onClick={() => onSaved(song)}>
              Save to My songs
            </button>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="rec-keys" />
    </div>
  );
}
