import { audioCtx, resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import { useState } from 'react';
import type { SelfTestResult } from '../input/mic/selftest';
import { updateSettings, useSettings } from '../store/settings';

function Slider(props: { label: string; hint?: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="setting">
      <div>
        <b>{props.label}</b>
        {props.hint && <div className="muted small">{props.hint}</div>}
      </div>
      <div className="control">
        <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
        <span className="value">
          {props.unit === '%' ? `${Math.round(props.value * 100)}%` : `${props.value}${props.unit ?? ''}`}
        </span>
      </div>
    </label>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const [selfTest, setSelfTest] = useState<SelfTestResult | 'running' | string | null>(null);
  const runSelfTest = async () => {
    setSelfTest('running');
    try {
      const { runMicSelfTest } = await import('../input/mic/selftest');
      setSelfTest(await runMicSelfTest());
    } catch (err) {
      setSelfTest(err instanceof Error ? err.message : String(err));
    }
  };
  const test = async () => {
    await resumeAudio();
    await piano.load();
    const t = audioCtx().currentTime + 0.05;
    [60, 64, 67, 72].forEach((p, i) => piano.noteOn(p, 80, { when: t + i * 0.15, duration: 0.8, bus: 'accomp' }));
  };
  return (
    <div className="settings">
      <section>
        <h2>Sound</h2>
        <Slider label="Accompaniment & Listen volume" value={s.accompVolume} min={0} max={1} step={0.05} unit="%" onChange={(v) => updateSettings({ accompVolume: v })} />
        <Slider label="Metronome volume" value={s.metronomeVolume} min={0} max={1} step={0.05} unit="%" onChange={(v) => updateSettings({ metronomeVolume: v })} />
        <Slider
          label="Your notes volume"
          hint="For the computer keyboard, on-screen keys, and MIDI echo."
          value={s.echoVolume}
          min={0}
          max={1}
          step={0.05}
          unit="%"
          onChange={(v) => updateSettings({ echoVolume: v })}
        />
        <label className="setting">
          <div>
            <b>Play my MIDI notes through the speakers</b>
            <div className="muted small">Turn on for keyboards without their own sound. A digital piano already makes sound.</div>
          </div>
          <input type="checkbox" checked={s.echoMidi} onChange={(e) => updateSettings({ echoMidi: e.target.checked })} />
        </label>
        <button className="btn" onClick={() => void test()}>
          ♪ Test sound
        </button>
      </section>

      <section>
        <h2>Timing</h2>
        <Slider
          label="MIDI latency correction"
          hint="If Piano Roll says you're always late, raise this a little."
          value={s.midiLatency}
          min={0}
          max={150}
          step={5}
          unit=" ms"
          onChange={(v) => updateSettings({ midiLatency: v })}
        />
        <Slider
          label="Microphone latency correction"
          hint="Extra correction for slow audio interfaces or Bluetooth."
          value={s.micLatency}
          min={0}
          max={200}
          step={5}
          unit=" ms"
          onChange={(v) => updateSettings({ micLatency: v })}
        />
        <Slider
          label="Microphone sensitivity"
          hint="Higher hears soft notes; lower ignores room noise and overtones."
          value={s.micSensitivity}
          min={0}
          max={1}
          step={0.05}
          unit="%"
          onChange={(v) => updateSettings({ micSensitivity: v })}
        />
        <div className="setting">
          <div>
            <b>Check the microphone detector</b>
            <div className="muted small">
              Feeds a short piano clip straight into the note detector (no microphone needed) to check it works on this computer.
            </div>
            {selfTest === 'running' && <div className="small">Running… about 8 seconds.</div>}
            {typeof selfTest === 'string' && selfTest !== 'running' && <div className="small error">{selfTest}</div>}
            {selfTest && typeof selfTest === 'object' && (
              <div className="small">
                Heard <b>{selfTest.hits}</b> of {selfTest.expected.length} notes, {selfTest.falsePositives} extra
                {selfTest.meanOffsetMs !== null ? `, timing within ${Math.abs(selfTest.meanOffsetMs)} ms` : ''}.
                <div className="muted">Detected: {selfTest.detected.map((d) => d.pitch).join(' ')}</div>
              </div>
            )}
          </div>
          <button className="btn" disabled={selfTest === 'running'} onClick={() => void runSelfTest()}>
            Run check
          </button>
        </div>
      </section>

      <section>
        <h2>Display</h2>
        <label className="setting">
          <div>
            <b>Note names on the keyboard</b>
          </div>
          <select value={s.noteNames} onChange={(e) => updateSettings({ noteNames: e.target.value as typeof s.noteNames })}>
            <option value="c-only">Only C keys</option>
            <option value="all">All white keys</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="setting">
          <div>
            <b>Always show all 88 keys</b>
            <div className="muted small">Otherwise the keyboard zooms to the range of the piece.</div>
          </div>
          <input type="checkbox" checked={s.fullKeyboard} onChange={(e) => updateSettings({ fullKeyboard: e.target.checked })} />
        </label>
      </section>

      <section className="about muted small">
        <h2>About</h2>
        <p>
          Pianist listens to your piano through MIDI or the microphone. Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0),
          served by the Tone.js project. Microphone note detection: Basic Pitch by Spotify (Apache 2.0), running entirely in your browser.
          Sheet music: OpenSheetMusicDisplay (BSD-3). Your progress is stored only in this browser.
        </p>
      </section>
    </div>
  );
}
