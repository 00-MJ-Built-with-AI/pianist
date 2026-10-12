import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { inputHub } from '../input/hub';
import { keyboardBase, onKeyboardBase } from '../input/keyboard';
import { connectMidi, midiStatus, onMidiStatus } from '../input/midi';
import { micState, onMicState, startMic, stopMic } from '../input/mic/mic';
import { pitchName } from '../music/pitch';
import { Calibrate } from './Calibrate';

function useMidi() {
  return useSyncExternalStore(onMidiStatus, midiStatus, midiStatus);
}

function useMic() {
  return useSyncExternalStore(onMicState, micState, micState);
}

/** Shows which inputs are live and lets the player connect MIDI or the microphone. */
export function InputBar() {
  const midi = useMidi();
  const mic = useMic();
  const [open, setOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [active, setActive] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [base, setBase] = useState(keyboardBase());
  const timer = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => onKeyboardBase(setBase), []);
  useEffect(
    () =>
      inputHub.onNote((n) => {
        setActive(true);
        setLastNote(`${pitchName(n.pitch)} · ${n.source}${n.source === 'midi' || n.source === 'mic' ? ` · vel ${n.velocity}` : ''}`);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setActive(false), 180);
      }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const midiReady = midi.state === 'ready' && midi.devices.length > 0;
  const label = midiReady ? midi.devices[0] : mic.state === 'on' ? 'Microphone' : 'Computer keys';

  return (
    <div className="inputbar" ref={box}>
      <button className={`chip-btn ${midiReady || mic.state === 'on' ? 'live' : ''}`} onClick={() => setOpen(!open)}>
        <span className={`led ${active ? 'blink' : ''} ${midiReady ? 'midi' : mic.state === 'on' ? 'mic' : ''}`} />
        {label}
      </button>
      {open && (
        <div className="popover">
          <h4>Your piano</h4>
          <div className="row">
            <div>
              <b>MIDI (USB / Bluetooth)</b>
              <div className="muted small">
                {!midi.supported
                  ? 'Not available in this browser. Use Chrome or Edge.'
                  : midi.state === 'ready'
                    ? midi.devices.length
                      ? `Connected: ${midi.devices.join(', ')}`
                      : 'Allowed, but no device found. Plug the piano in and switch it on.'
                    : midi.state === 'denied'
                      ? `Blocked: ${midi.error ?? ''}`
                      : 'Exact notes, velocity and pedal.'}
              </div>
            </div>
            {midi.supported && midi.state !== 'ready' && (
              <button className="btn primary" onClick={() => void connectMidi()}>
                Connect
              </button>
            )}
          </div>
          <div className="row">
            <div>
              <b>Microphone</b>
              <div className="muted small">
                {mic.state === 'on'
                  ? `Listening${mic.backend ? ` (${mic.backend})` : ''}. Hears chords with ~0.25 s delay.`
                  : mic.state === 'loading'
                    ? 'Loading the note detector…'
                    : mic.state === 'error'
                      ? `Problem: ${mic.error}`
                      : 'For acoustic pianos. Hears notes and chords; no velocity or pedal.'}
              </div>
              {mic.state === 'on' && (
                <div className="meter">
                  <span style={{ width: `${Math.min(100, mic.level * 300)}%` }} />
                </div>
              )}
            </div>
            {mic.state === 'on' || mic.state === 'loading' ? (
              <button className="btn" onClick={() => stopMic()}>
                Stop
              </button>
            ) : (
              <button className="btn" onClick={() => void startMic()}>
                Use mic
              </button>
            )}
          </div>
          <div className="row">
            <div>
              <b>Computer keyboard</b>
              <div className="muted small">
                Keys <kbd>A</kbd>–<kbd>'</kbd> play {pitchName(base)}–{pitchName(base + 17)} (<kbd>W E T Y U O P</kbd> are the black
                keys). <kbd>Z</kbd>/<kbd>X</kbd> change octave, <kbd>Shift</kbd> is the pedal. You can also click the keys on screen.
              </div>
            </div>
          </div>
          <div className="last-note muted small">
            Last note: {lastNote ?? '—'}
            <button
              className="link-btn"
              onClick={() => {
                setOpen(false);
                setCalibrating(true);
              }}
            >
              Calibrate timing…
            </button>
          </div>
        </div>
      )}
      {calibrating && <Calibrate onClose={() => setCalibrating(false)} />}
    </div>
  );
}
