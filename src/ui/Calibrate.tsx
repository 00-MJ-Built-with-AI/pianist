import { useEffect, useRef, useState } from 'react';
import { perfToAudio, resumeAudio } from '../audio/audio';
import { metronomeClick } from '../audio/piano';
import { measureOffsets, type CalibrationResult } from '../engine/calibration';
import { inputHub, type InputSource } from '../input/hub';
import { getSettings, updateSettings } from '../store/settings';

const BEAT_MS = 600; // 100 bpm
const COUNT_IN = 4;
const TAPS = 12;

type Phase = 'intro' | 'running' | 'done';

/** Play-along wizard that measures how late key presses arrive and sets the latency correction. */
export function Calibrate({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [beat, setBeat] = useState(-1);
  const [result, setResult] = useState<{ r: CalibrationResult; source: InputSource | null; applied: string } | null>(null);
  const cancel = useRef<() => void>(() => {});

  useEffect(() => () => cancel.current(), []);

  const start = async () => {
    await resumeAudio();
    const t0 = performance.now() + 700;
    const clicks = Array.from({ length: COUNT_IN + TAPS }, (_, i) => t0 + i * BEAT_MS);
    clicks.forEach((t, i) => metronomeClick(perfToAudio(t), i % 4 === 0));
    const presses: Array<{ time: number; source: InputSource }> = [];
    const off = inputHub.onNote((n) => presses.push({ time: n.time, source: n.source }));
    setPhase('running');
    let raf = 0;
    const tick = () => {
      setBeat(Math.floor((performance.now() - t0) / BEAT_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = window.setTimeout(() => {
      off();
      cancelAnimationFrame(raf);
      const counted = clicks.slice(COUNT_IN);
      const r = measureOffsets(
        counted,
        presses.map((p) => p.time),
      );
      const sources = presses.map((p) => p.source);
      const source = (['midi', 'mic', 'keyboard', 'screen'] as InputSource[]).sort(
        (a, b) => sources.filter((s) => s === b).length - sources.filter((s) => s === a).length,
      )[0];
      let applied = '';
      if (r.median !== null && sources.length) {
        const s = getSettings();
        if (source === 'midi') {
          const v = Math.max(0, Math.min(250, s.midiLatency + r.median));
          updateSettings({ midiLatency: v });
          applied = `MIDI latency correction set to ${v} ms.`;
        } else if (source === 'mic') {
          const v = Math.max(0, Math.min(300, s.micLatency + r.median));
          updateSettings({ micLatency: v });
          applied = `Microphone latency correction set to ${v} ms.`;
        } else {
          applied = 'The computer keyboard and on-screen keys have no correction setting; connect MIDI or use the microphone.';
        }
      }
      setResult({ r, source: sources.length ? source : null, applied });
      setPhase('done');
    }, clicks[clicks.length - 1] - performance.now() + 700);
    cancel.current = () => {
      window.clearTimeout(done);
      cancelAnimationFrame(raf);
      off();
    };
  };

  const counting = beat < COUNT_IN;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal calibrate" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Calibrate timing">
        <h2>Calibrate timing</h2>
        {phase === 'intro' && (
          <>
            <p className="muted">
              You'll hear 4 count-in clicks, then 12 more. Play any key on your piano exactly with each of the 12 clicks. Pianist measures how
              late the notes reach it and corrects for that, so Practice, Audition and Piano Roll judge your timing fairly.
            </p>
            <p className="muted small">Use the input you practise with (MIDI or microphone). With the microphone, any key in the middle works best.</p>
            <div className="report-actions">
              <span className="spacer" />
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void start()}>
                Start
              </button>
            </div>
          </>
        )}
        {phase === 'running' && (
          <div className="cal-stage">
            <div className={`cal-dot ${beat >= 0 ? 'beat' : ''}`} key={beat} />
            <div className="cal-text">
              {beat < 0 ? 'Get ready…' : counting ? `Count-in ${COUNT_IN - beat}` : `Play! ${Math.min(TAPS, beat - COUNT_IN + 1)} / ${TAPS}`}
            </div>
          </div>
        )}
        {phase === 'done' && result && (
          <>
            {result.r.median === null ? (
              <p>
                Only {result.r.offsets.length} of {TAPS} clicks had a note close to them, which isn't enough to measure. Try again and play
                one key with every click.
              </p>
            ) : (
              <>
                <p>
                  Your notes arrived <b>{Math.abs(result.r.median)} ms {result.r.median >= 0 ? 'late' : 'early'}</b> on average (
                  {result.r.offsets.length} of {TAPS} clicks, steadiness ±{Math.round((result.r.spread ?? 0) / 2)} ms).
                </p>
                <p className="notice">{result.applied}</p>
                {(result.r.spread ?? 0) > 80 && (
                  <p className="muted small">The taps were quite uneven, so the measurement is rough. Running it again usually helps.</p>
                )}
              </>
            )}
            <div className="report-actions">
              <span className="spacer" />
              <button className="btn" onClick={() => void start()}>
                Run again
              </button>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
