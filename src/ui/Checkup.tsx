import { useEffect, useMemo, useRef, useState } from 'react';
import { perfToAudio, resumeAudio } from '../audio/audio';
import { metronomeClick } from '../audio/piano';
import { measureOffsets } from '../engine/calibration';
import { evaluateCheckup, wavBase64, type CheckKind, type CheckupResult, type Finding, type StepLog } from '../engine/checkup';
import { inputHub } from '../input/hub';
import { connectMidi, midiStatus, onMidiStatus } from '../input/midi';
import { micSampleCount, micState, onMicState, setMicTap, startMic, stopMic } from '../input/mic/mic';
import { downloadFile } from '../music/export';
import { pitchName } from '../music/pitch';
import { getSettings, updateSettings } from '../store/settings';
import { DEFAULT_DISPLAY, Stage } from './stage';

interface StepDef {
  id: string;
  kind: CheckKind;
  title: string;
  text: string;
  keys?: number[];
  range: [number, number];
  /** Finished when this returns true (checked after every note). */
  done?: (log: StepLog) => boolean;
  /** Runs for this many seconds after Start. */
  seconds?: number;
  /** Play along with clicks to measure the delay. */
  timing?: boolean;
}

const count = (log: StepLog, pitch: number) => log.notes.filter((n) => n.pitch === pitch).length;
const heardAll = (pitches: number[]) => (log: StepLog) => pitches.every((p) => count(log, p) > 0);

const STEPS: StepDef[] = [
  {
    id: 'midi-range',
    kind: 'midi',
    title: 'Lowest and highest key',
    text: 'Play the lowest key on your piano, then the highest key.',
    range: [21, 108],
    done: (l) => l.notes.length >= 2 && Math.max(...l.notes.map((n) => n.pitch)) - Math.min(...l.notes.map((n) => n.pitch)) >= 48,
  },
  {
    id: 'midi-touch',
    kind: 'midi',
    title: 'Soft and loud',
    text: 'Play middle C as softly as you can, 3 times. Then as loudly as you can, 3 times.',
    keys: [60],
    range: [48, 72],
    done: (l) => count(l, 60) >= 6,
  },
  {
    id: 'midi-chord',
    kind: 'midi',
    title: 'Chords',
    text: 'Play C, E and G together, 3 times.',
    keys: [60, 64, 67],
    range: [48, 72],
    done: (l) => l.notes.filter((n) => [60, 64, 67].includes(n.pitch)).length >= 9,
  },
  {
    id: 'midi-pedals',
    kind: 'midi',
    title: 'Pedals',
    text: 'Press and release the right (sustain) pedal. If your piano has them, press the left and middle pedals too. Then press Next.',
    range: [48, 72],
    done: (l) => l.pedals.some((p) => !p.down) && [66, 67].every((cc) => l.ccs.some((c) => c.cc === cc)),
  },
  {
    id: 'midi-timing',
    kind: 'midi',
    title: 'Timing',
    text: 'You’ll hear 4 count-in clicks, then 12 more. Play any key exactly with each of the 12 clicks.',
    range: [48, 72],
    timing: true,
  },
  {
    id: 'mic-quiet',
    kind: 'mic',
    title: 'Room noise',
    text: 'Press Start, then stay quiet for 4 seconds so Pianist can listen to your room.',
    range: [48, 72],
    seconds: 4,
  },
  {
    id: 'mic-notes',
    kind: 'mic',
    title: 'Single notes',
    text: 'Play C, E, G and the next C up, one at a time, medium loud.',
    keys: [60, 64, 67, 72],
    range: [48, 84],
    done: heardAll([60, 64, 67, 72]),
  },
  {
    id: 'mic-range',
    kind: 'mic',
    title: 'Low and high',
    text: 'Play the low C (two octaves below middle C), then the high C (two octaves above).',
    keys: [36, 84],
    range: [36, 84],
    done: heardAll([36, 84]),
  },
  {
    id: 'mic-chords',
    kind: 'mic',
    title: 'Chords',
    text: 'Play C3 with your left hand and C, E, G with your right hand, all together. Do it 3 times, slowly.',
    keys: [48, 60, 64, 67],
    range: [36, 84],
  },
  {
    id: 'mic-soft',
    kind: 'mic',
    title: 'Soft notes',
    text: 'Play the G above middle C very softly, 4 times.',
    keys: [67],
    range: [48, 84],
    done: (l) => count(l, 67) >= 4,
  },
  {
    id: 'mic-pedal',
    kind: 'mic',
    title: 'Sustain pedal',
    text: 'Press Start. Hold the right pedal down, play the low C once, loudly, and let it ring until the bar is full.',
    keys: [36],
    range: [24, 84],
    seconds: 7,
  },
  {
    id: 'mic-repeats',
    kind: 'mic',
    title: 'Fast repeats',
    text: 'Play the D above middle C 4 times, quickly (about 4 per second).',
    keys: [62],
    range: [48, 84],
    done: (l) => count(l, 62) >= 4,
  },
  {
    id: 'mic-timing',
    kind: 'mic',
    title: 'Timing',
    text: 'Same as before: play a key in the middle with each of the 12 clicks after the count-in.',
    range: [48, 72],
    timing: true,
  },
];

const BEAT_MS = 600;
const COUNT_IN = 4;
const TAPS = 12;
const SR = 22050;

const emptyLog = (s: StepDef): StepLog => ({ id: s.id, kind: s.kind, skipped: true, notes: [], offs: [], pedals: [], ccs: [], levels: [] });

type Run = 'listen' | 'ready' | 'running' | 'done';

/** A guided test on the player's own piano: finds problems, recommends settings and saves a diagnostic file. */
export function Checkup({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'intro' | 'steps' | 'results'>('intro');
  const [useMidi, setUseMidi] = useState(() => midiStatus().devices.length > 0);
  const [useMic, setUseMic] = useState(true);
  const [withRecording, setWithRecording] = useState(true);
  const [midi, setMidi] = useState(midiStatus());
  const [mic, setMic] = useState(micState());
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState<Run>('listen');
  const [, redraw] = useState(0);
  const [beat, setBeat] = useState(-1);
  const [result, setResult] = useState<CheckupResult | null>(null);
  const [applied, setApplied] = useState(false);
  const logs = useRef(new Map<string, StepLog>());
  const recording = useRef<Float32Array[]>([]);
  const recorded = useRef(0);
  const micWasOn = useRef(micState().state === 'on');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => onMidiStatus(setMidi), []);
  useEffect(() => onMicState(() => setMic(micState())), []);

  const steps = useMemo(() => STEPS.filter((s) => (s.kind === 'midi' ? useMidi : useMic)), [useMidi, useMic]);
  const step = phase === 'steps' ? steps[index] : undefined;

  // Leave things as they were: the microphone off again if the check-up turned it on.
  useEffect(
    () => () => {
      setMicTap(null);
      inputHub.expectation = null;
      if (!micWasOn.current) stopMic();
    },
    [],
  );

  const begin = async () => {
    await resumeAudio();
    if (useMic && micState().state !== 'on') {
      await startMic();
      // No microphone (or permission refused): the intro shows why.
      if (micState().state !== 'on') return;
    }
    if (useMic) {
      recording.current = [];
      recorded.current = 0;
      setMicTap((x) => {
        if (recorded.current < SR * 240) {
          recording.current.push(x.slice());
          recorded.current += x.length;
        }
      });
    }
    logs.current.clear();
    setIndex(0);
    setPhase('steps');
  };

  // One step: listen to the right input and log everything.
  useEffect(() => {
    if (!step) return;
    const log: StepLog = { ...emptyLog(step), skipped: false };
    logs.current.set(step.id, log);
    const t0 = performance.now();
    const fromSample = micSampleCount();
    const auto = !step.seconds && !step.timing;
    setRun(auto ? 'listen' : 'ready');
    if (step.kind === 'mic') inputHub.expectation = () => new Set(step.keys ?? []);
    let finished = false;
    let advance = 0;
    const check = () => {
      redraw((n) => n + 1);
      if (!finished && auto && step.done?.(log)) {
        finished = true;
        setRun('done');
        advance = window.setTimeout(() => setIndex((i) => i + 1), 1100);
      }
    };
    const unsubs = [
      inputHub.onNote((n) => {
        if (n.source !== step.kind) return;
        log.notes.push({ pitch: n.pitch, velocity: n.velocity, t: Math.round(n.time - t0) });
        check();
      }),
      inputHub.onNoteOff((pitch, time) => log.offs.push({ pitch, t: Math.round(time - t0) })),
      inputHub.onPedal((down, time) => {
        log.pedals.push({ down, t: Math.round(time - t0) });
        check();
      }),
      inputHub.onCC((cc, value) => {
        log.ccs.push({ cc, value, t: Math.round(performance.now() - t0) });
        check();
      }),
    ];
    const levels = step.kind === 'mic' ? window.setInterval(() => log.levels.push(Math.round(micState().level * 1e5) / 1e5), 100) : 0;
    return () => {
      unsubs.forEach((u) => u());
      window.clearInterval(levels);
      window.clearTimeout(advance);
      inputHub.expectation = null;
      if (step.kind === 'mic') log.recording = [fromSample, micSampleCount()];
    };
  }, [step]);

  // The keyboard: keys to play glow, keys being played light up.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !step) return;
    const stage = new Stage(canvas);
    stage.setSong(null, true);
    stage.setRange(step.range[0], step.range[1]);
    stage.resize();
    const s = getSettings();
    const display = { ...DEFAULT_DISPLAY, keyLabels: 'white' as const, theme: s.theme, handColors: s.handColors, nameStyle: s.nameStyle, showTargets: true };
    let raf = 0;
    let sig = '';
    const tick = () => {
      const held = new Map([...inputHub.held.keys()].map((p) => [p, (step.keys ?? []).includes(p) ? ('good' as const) : ('neutral' as const)]));
      const next = [...held.keys()].join(',') + canvas.clientWidth;
      if (next !== sig) {
        sig = next;
        stage.draw({
          beat: 0,
          now: performance.now(),
          bps: 2,
          marks: null,
          userHands: ['R', 'L'],
          showFalling: false,
          targets: step.keys ?? [],
          held,
          flashes: [],
          waiting: false,
          loop: null,
          hideCues: false,
          display,
          preferFlats: false,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    const ro = new ResizeObserver(() => {
      stage.resize();
      sig = '';
    });
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [step]);

  const startTimed = () => {
    if (!step) return;
    const log = logs.current.get(step.id)!;
    setRun('running');
    const t0 = performance.now();
    if (step.seconds) {
      const timer = window.setInterval(() => {
        const el = (performance.now() - t0) / 1000;
        setBeat(el);
        if (el >= step.seconds!) {
          window.clearInterval(timer);
          setRun('done');
        }
      }, 100);
      return;
    }
    // Play along with clicks.
    const first = performance.now() + 700;
    const clicks = Array.from({ length: COUNT_IN + TAPS }, (_, i) => first + i * BEAT_MS);
    clicks.forEach((t, i) => metronomeClick(perfToAudio(t), i % 4 === 0));
    const presses: number[] = [];
    const off = inputHub.onNote((n) => {
      if (n.source === step.kind) presses.push(n.time);
    });
    const timer = window.setInterval(() => setBeat(Math.floor((performance.now() - first) / BEAT_MS)), 50);
    window.setTimeout(() => {
      off();
      window.clearInterval(timer);
      log.timing = measureOffsets(clicks.slice(COUNT_IN), presses);
      setRun('done');
    }, clicks[clicks.length - 1] - performance.now() + 700);
  };

  const next = (skip = false) => {
    if (!step) return;
    const log = logs.current.get(step.id);
    // Skipped = moved on before anything happened (a step that was played counts, finished or not).
    if (log && skip && run !== 'done') log.skipped = !log.notes.length && !log.pedals.length && !log.ccs.length;
    if (index + 1 < steps.length) setIndex(index + 1);
    else finish();
  };

  const redo = () => {
    if (!step) return;
    // Re-entering the step starts a fresh log.
    const i = index;
    setIndex(-1);
    window.setTimeout(() => setIndex(i), 0);
  };

  const finish = () => {
    setMicTap(null);
    inputHub.expectation = null;
    const s = getSettings();
    const all = steps.map((st) => logs.current.get(st.id) ?? emptyLog(st));
    setResult(evaluateCheckup(all, { midiLatency: s.midiLatency, micLatency: s.micLatency, micSensitivity: s.micSensitivity }));
    setPhase('results');
  };

  const saveFile = () => {
    const s = getSettings();
    const all = steps.map((st) => logs.current.get(st.id) ?? emptyLog(st));
    let audio: { sampleRate: number; wav: string } | undefined;
    if (withRecording && recorded.current) {
      const pcm = new Float32Array(recorded.current);
      let o = 0;
      for (const c of recording.current) {
        pcm.set(c.subarray(0, Math.min(c.length, pcm.length - o)), o);
        o += c.length;
      }
      audio = { sampleRate: SR, wav: wavBase64(pcm, SR) };
    }
    const ctx = new AudioContext();
    const file = {
      app: 'pianist-checkup',
      version: 1,
      date: new Date().toISOString(),
      browser: navigator.userAgent,
      audio: { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency },
      midiDevices: midiStatus().devices,
      microphone: { backend: micState().backend ?? null },
      settings: {
        midiLatency: s.midiLatency,
        micLatency: s.micLatency,
        micSensitivity: s.micSensitivity,
        headphones: s.headphones,
        echoMidi: s.echoMidi,
        strictness: s.strictness,
      },
      steps: all,
      result,
      recording: audio,
    };
    void ctx.close();
    const d = new Date();
    downloadFile(JSON.stringify(file), `pianist-checkup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`, 'application/json');
  };

  const heard = step ? (logs.current.get(step.id)?.notes ?? []) : [];

  return (
    <div className="checkup">
      <div className="checkup-head">
        <button className="btn ghost" onClick={onClose}>
          ← Back
        </button>
        <h1>Piano check-up</h1>
        {phase === 'steps' && step && (
          <span className="muted small">
            {step.kind === 'midi' ? 'MIDI' : 'Microphone'} · step {index + 1} of {steps.length}
          </span>
        )}
      </div>
      {phase === 'steps' && (
        <div className="goal-bar checkup-progress">
          <span style={{ width: `${(index / steps.length) * 100}%` }} />
        </div>
      )}

      {phase === 'intro' && (
        <section className="checkup-card">
          <p>
            About three minutes at your piano. Pianist checks how your piano reaches it, measures its delay, and suggests the best settings. You
            can also save a check-up file to send to whoever helps you tune Pianist.
          </p>
          <label className="setting">
            <div>
              <b>Test MIDI</b>
              <div className="muted small">
                {midi.devices.length ? `Connected: ${midi.devices.join(', ')}` : 'No MIDI piano connected.'}
                {!midi.devices.length && midi.supported && (
                  <button className="btn ghost small-btn" onClick={() => void connectMidi().then((st) => setUseMidi(st.devices.length > 0))}>
                    Connect MIDI…
                  </button>
                )}
              </div>
            </div>
            <input type="checkbox" checked={useMidi} disabled={!midi.devices.length} onChange={(e) => setUseMidi(e.target.checked)} />
          </label>
          <label className="setting">
            <div>
              <b>Test the microphone</b>
              <div className="muted small">Put the device where you usually practise. Pianist will ask to use the microphone.</div>
            </div>
            <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
          </label>
          <label className="setting">
            <div>
              <b>Keep a recording of the microphone tests in the file</b>
              <div className="muted small">Lets the sound be checked later (about 3 MB). It stays on this device unless you send the file.</div>
            </div>
            <input type="checkbox" checked={withRecording} disabled={!useMic} onChange={(e) => setWithRecording(e.target.checked)} />
          </label>
          {mic.state === 'loading' && <div className="notice">Loading the note detector…</div>}
          {mic.state === 'error' && <div className="notice error">{mic.error}</div>}
          <div className="report-actions">
            <span className="spacer" />
            <button className="btn primary" disabled={(!useMidi && !useMic) || mic.state === 'loading'} onClick={() => void begin()}>
              Start check-up
            </button>
          </div>
        </section>
      )}

      {phase === 'steps' && step && (
        <section className="checkup-card">
          <h2>{step.title}</h2>
          <p className="checkup-text">{step.text}</p>
          <canvas ref={canvasRef} className="checkup-keys" />
          {step.seconds && run === 'running' && (
            <div className="goal-bar">
              <span style={{ width: `${Math.min(100, (beat / step.seconds) * 100)}%` }} />
            </div>
          )}
          {step.timing && run === 'running' && (
            <div className="cal-stage">
              <div className={`cal-dot ${beat >= 0 ? 'beat' : ''}`} key={beat} />
              <div className="cal-text">
                {beat < 0 ? 'Get ready…' : beat < COUNT_IN ? `Count-in ${COUNT_IN - beat}` : `Play! ${Math.min(TAPS, beat - COUNT_IN + 1)} / ${TAPS}`}
              </div>
            </div>
          )}
          {step.timing && run === 'done' && (
            <div className="notice">
              {(() => {
                const r = logs.current.get(step.id)?.timing;
                if (!r || r.median === null) return `Only ${r?.offsets.length ?? 0} of ${TAPS} clicks had a note near them. Try again, or press Next.`;
                return `Your notes arrived ${Math.abs(r.median)} ms ${r.median >= 0 ? 'late' : 'early'} (steadiness ±${Math.round((r.spread ?? 0) / 2)} ms).`;
              })()}
            </div>
          )}
          {!step.timing && (
            <div className="checkup-heard">
              <span className="muted small">Heard:</span>
              {heard.length === 0 && <span className="muted small">nothing yet</span>}
              {heard.slice(-16).map((n, i) => (
                <span key={i} className={`tag ${step.keys && !step.keys.includes(n.pitch) ? 'off' : 'ok'}`} title={`loudness ${n.velocity}`}>
                  {pitchName(n.pitch)}
                </span>
              ))}
              {run === 'done' && <b className="checkup-ok">✓</b>}
            </div>
          )}
          <div className="report-actions">
            <button className="btn ghost" onClick={redo}>
              Redo step
            </button>
            <span className="spacer" />
            {run === 'ready' && (
              <button className="btn primary" onClick={startTimed}>
                Start
              </button>
            )}
            <button className={`btn ${run === 'done' || run === 'listen' ? 'primary' : ''}`} disabled={run === 'running'} onClick={() => next(true)}>
              {run === 'done' || (run === 'listen' && heard.length) ? 'Next' : 'Skip'}
            </button>
          </div>
        </section>
      )}

      {phase === 'results' && result && (
        <section className="checkup-card">
          {result.midi.length > 0 && <FindingList title="MIDI" items={result.midi} />}
          {result.mic.length > 0 && <FindingList title="Microphone" items={result.mic} />}
          <h2>Recommended settings</h2>
          {result.changeText.length ? (
            <>
              <ul className="checkup-changes">
                {result.changeText.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <button
                className="btn primary"
                disabled={applied}
                onClick={() => {
                  updateSettings(result.changes);
                  setApplied(true);
                }}
              >
                {applied ? '✓ Applied' : 'Apply these settings'}
              </button>
            </>
          ) : (
            <p className="muted">
              {result.midi.length || result.mic.length ? 'Everything looks good. No changes needed.' : 'Nothing was measured: every step was skipped.'}
            </p>
          )}
          <h2>Check-up file</h2>
          <p className="muted small">
            Everything measured, step by step{withRecording && useMic ? ', with the microphone recording' : ''}. Send it to whoever helps you
            tune Pianist so they can fine-tune it for your piano.
          </p>
          <div className="report-actions">
            <button className="btn" onClick={saveFile}>
              ⤓ Save check-up file
            </button>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => {
                setApplied(false);
                setPhase('intro');
              }}
            >
              Run again
            </button>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

const ICON: Record<Finding['level'], string> = { good: '✓', info: 'i', warn: '!', bad: '✕' };

function FindingList({ title, items }: { title: string; items: Finding[] }) {
  return (
    <>
      <h2>{title}</h2>
      <ul className="findings">
        {items.map((f, i) => (
          <li key={i} className={f.level}>
            <span className="finding-icon">{ICON[f.level]}</span>
            <div>
              <b>{f.title}</b>
              {f.detail && <div className="muted small">{f.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
