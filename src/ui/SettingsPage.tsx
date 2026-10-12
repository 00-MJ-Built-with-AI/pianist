import { useEffect, useRef, useState, type ReactNode } from 'react';
import { audioCtx, resumeAudio } from '../audio/audio';
import { metronomeClick, piano } from '../audio/piano';
import type { SelfTestResult } from '../input/mic/selftest';
import { inputHub } from '../input/hub';
import { pitchName } from '../music/pitch';
import { downloadFile } from '../music/export';
import { createBackup, restoreBackup } from '../store/backup';
import { activeProfile, AVATARS, addProfile, deleteProfile, listProfiles, switchProfile, updateProfile } from '../store/profiles';
import {
  HAND_COLOR_PRESETS,
  TUNING_PRESETS,
  updateSettings,
  useSettings,
  type ControlAction,
  type ControlTrigger,
  type Settings,
} from '../store/settings';
import { Calibrate } from './Calibrate';
import { DisplayOptionsForm } from './DisplayMenu';
import { say } from './feedback';

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

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting">
      <div>
        <b>{props.label}</b>
        {props.hint && <div className="muted small">{props.hint}</div>}
      </div>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

function Choice<T extends string | number>(props: { label: string; hint?: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="setting">
      <div>
        <b>{props.label}</b>
        {props.hint && <div className="muted small">{props.hint}</div>}
      </div>
      <div className="segmented">
        {props.options.map(([v, label]) => (
          <button key={String(v)} className={`seg ${props.value === v ? 'on r' : ''}`} onClick={() => props.onChange(v)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`set-${id}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const SECTIONS: Array<[string, string]> = [
  ['players', 'Players'],
  ['practice', 'Practice'],
  ['metronome', 'Metronome'],
  ['sound', 'Sound'],
  ['look', 'Look'],
  ['sheet', 'Sheet music'],
  ['controls', 'Hands-free'],
  ['feedback', 'Score & feedback'],
  ['plan', 'Daily plan'],
  ['timing', 'Timing'],
  ['backup', 'Backup'],
];

const ACTIONS: Array<[ControlAction, string]> = [
  ['startStop', 'Start / stop'],
  ['restart', 'Start again from the beginning'],
  ['nextBar', 'Next bar'],
  ['prevBar', 'Previous bar'],
  ['skip', 'Skip the note I’m stuck on'],
];

function triggerName(t: ControlTrigger | undefined): string {
  if (!t) return 'Not set';
  if (t.type === 'key') return `Key ${pitchName(t.pitch)}`;
  return t.cc === 67 ? 'Soft pedal (left)' : t.cc === 66 ? 'Middle pedal' : `Pedal / controller ${t.cc}`;
}

const sameTrigger = (a: ControlTrigger, b: ControlTrigger) =>
  a.type === 'key' ? b.type === 'key' && a.pitch === b.pitch : b.type === 'cc' && a.cc === b.cc;

export function SettingsPage() {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const [selfTest, setSelfTest] = useState<SelfTestResult | 'running' | string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [learning, setLearning] = useState<ControlAction | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState('');
  const [, refresh] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const me = activeProfile();

  useEffect(() => () => inputHub.learnNextControl(null), []);

  const runSelfTest = async () => {
    setSelfTest('running');
    try {
      const { runMicSelfTest } = await import('../input/mic/selftest');
      setSelfTest(await runMicSelfTest());
    } catch (err) {
      setSelfTest(err instanceof Error ? err.message : String(err));
    }
  };
  const testSound = async () => {
    await resumeAudio();
    await piano.load();
    const t = audioCtx().currentTime + 0.05;
    [60, 64, 67, 72].forEach((p, i) => piano.noteOn(p, 80, { when: t + i * 0.15, duration: 0.8, bus: 'accomp' }));
  };
  const testClick = async () => {
    await resumeAudio();
    const t = audioCtx().currentTime + 0.05;
    // One bar of 4/4 at 120 bpm.
    for (let i = 0; i < 8; i++) {
      const off = i % 2 === 1;
      if (off && s.clickSubdivision === 'beat') continue;
      metronomeClick(t + i * 0.25, off ? 'sub' : i === 0 && s.clickAccent ? 'accent' : 'beat', s.clickSound);
    }
  };
  const learn = (action: ControlAction) => {
    setLearning(action);
    inputHub.learnNextControl((trigger) => {
      // A key or pedal can only do one thing.
      const controls = { ...s.controls };
      for (const [a, t] of Object.entries(controls) as Array<[ControlAction, ControlTrigger]>) {
        if (t && sameTrigger(t, trigger)) delete controls[a];
      }
      updateSettings({ controls: { ...controls, [action]: trigger }, handsFree: true });
      setLearning(null);
    });
  };
  const stopLearning = () => {
    inputHub.learnNextControl(null);
    setLearning(null);
  };
  const tuning = s.strictness === 'custom' ? s.tuning : TUNING_PRESETS[s.strictness];
  const setTuning = (patch: Partial<Settings['tuning']>) => set({ strictness: 'custom', tuning: { ...tuning, ...patch } });

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#set-${id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {label}
          </a>
        ))}
      </nav>

      <Section id="players" title="Players">
        <p className="muted small">Each player has their own progress, history, lists and settings. Songs in the library are shared by everyone.</p>
        {listProfiles().map((p) => (
          <div key={p.id} className="setting">
            <div className="player-row">
              <select
                value={p.avatar}
                aria-label="Avatar"
                onChange={(e) => {
                  updateProfile(p.id, { avatar: e.target.value });
                  refresh((n) => n + 1);
                }}
              >
                {AVATARS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <input className="name-field" defaultValue={p.name} maxLength={30} aria-label="Name" onBlur={(e) => updateProfile(p.id, { name: e.target.value.trim() || p.name })} />
              {p.id === me.id && <span className="muted small">playing now</span>}
            </div>
            <div className="control">
              {p.id !== me.id && (
                <button className="btn" onClick={() => switchProfile(p.id)}>
                  Switch to
                </button>
              )}
              {p.id !== 'default' && (
                <button
                  className="btn ghost danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete ${p.name} and all of their progress? Songs stay in the library.`)) return;
                    await deleteProfile(p.id);
                    refresh((n) => n + 1);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="setting">
          <input className="name-field" placeholder="New player's name" value={newPlayer} maxLength={30} onChange={(e) => setNewPlayer(e.target.value)} />
          <button
            className="btn"
            disabled={!newPlayer.trim()}
            onClick={() => {
              addProfile(newPlayer.trim(), AVATARS[listProfiles().length % AVATARS.length]);
              setNewPlayer('');
              refresh((n) => n + 1);
            }}
          >
            ＋ Add player
          </button>
        </div>
      </Section>

      <Section id="practice" title="Practice">
        <Choice
          label="Strictness"
          hint={
            s.strictness === 'relaxed'
              ? 'Forgiving timing; 80% counts as a clean pass.'
              : s.strictness === 'strict'
                ? 'Tight timing; 95% counts as a clean pass.'
                : s.strictness === 'custom'
                  ? 'Your own values below.'
                  : 'Balanced timing; 90% counts as a clean pass.'
          }
          value={s.strictness}
          options={[
            ['relaxed', 'Relaxed'],
            ['normal', 'Normal'],
            ['strict', 'Strict'],
            ['custom', 'Custom'],
          ]}
          onChange={(v) => set(v === 'custom' ? { strictness: v, tuning } : { strictness: v })}
        />
        <Slider label="Perfect within" hint="Piano Roll and keep-going runs" value={tuning.perfectMs} min={20} max={150} step={5} unit=" ms" onChange={(v) => setTuning({ perfectMs: v })} />
        <Slider label="Good within" hint="Further off than this is a miss" value={tuning.goodMs} min={60} max={350} step={10} unit=" ms" onChange={(v) => setTuning({ goodMs: v })} />
        <Slider
          label="Chord notes together within"
          hint="Learn mode: how close together the notes of a chord must be"
          value={tuning.chordWindowMs}
          min={200}
          max={3000}
          step={100}
          unit=" ms"
          onChange={(v) => setTuning({ chordWindowMs: v })}
        />
        <Slider label="Clean pass" hint="Accuracy that counts as clean (loops, coach)" value={tuning.cleanPass} min={0.6} max={1} step={0.05} unit="%" onChange={(v) => setTuning({ cleanPass: v })} />
        <Slider label="Speed-up step" hint="Tempo added after each clean loop" value={tuning.speedStep} min={0.02} max={0.2} step={0.01} unit="%" onChange={(v) => setTuning({ speedStep: v })} />
        <Slider label="Speed up to" hint="Auto speed-up stops here (over 100% for a challenge)" value={tuning.maxRate} min={0.6} max={1.5} step={0.05} unit="%" onChange={(v) => setTuning({ maxRate: v })} />
        <Toggle
          label="Guide notes"
          hint="Softly plays the notes you should play as you reach them. Turn it down as you learn the piece."
          checked={s.guideNotes}
          onChange={(v) => set({ guideNotes: v })}
        />
        <Slider label="Guide volume" value={s.guideVolume} min={0} max={1} step={0.05} unit="%" onChange={(v) => set({ guideVolume: v })} />
        <Slider label="Other hand & Listen volume" value={s.accompVolume} min={0} max={1} step={0.05} unit="%" onChange={(v) => set({ accompVolume: v })} />
      </Section>

      <Section id="metronome" title="Metronome & count-in">
        <Choice
          label="Count-in"
          hint="Before timed runs (Piano Roll, keep going)"
          value={s.countInBars}
          options={[
            [0, 'None'],
            [1, '1 bar'],
            [2, '2 bars'],
          ]}
          onChange={(v) => set({ countInBars: v })}
        />
        <Choice
          label="Clicks on"
          value={s.clickSubdivision}
          options={[
            ['beat', 'Every beat'],
            ['eighth', 'Eighths too'],
          ]}
          onChange={(v) => set({ clickSubdivision: v })}
        />
        <Toggle label="Accent the first beat of each bar" checked={s.clickAccent} onChange={(v) => set({ clickAccent: v })} />
        <Choice
          label="Click sound"
          value={s.clickSound}
          options={[
            ['beep', 'Beep'],
            ['wood', 'Wood block'],
            ['cowbell', 'Cowbell'],
          ]}
          onChange={(v) => set({ clickSound: v })}
        />
        <Slider label="Metronome volume" value={s.metronomeVolume} min={0} max={1} step={0.05} unit="%" onChange={(v) => set({ metronomeVolume: v })} />
        <button className="btn" onClick={() => void testClick()}>
          ♩ Test click
        </button>
      </Section>

      <Section id="sound" title="Sound">
        <Choice
          label="Piano sound"
          hint="For the other hand, Listen, guide notes and on-screen keys"
          value={s.pianoSound}
          options={[
            ['grand', 'Concert grand'],
            ['bright', 'Bright'],
            ['mellow', 'Mellow'],
            ['electric', 'Electric piano'],
          ]}
          onChange={(v) => set({ pianoSound: v })}
        />
        <Slider label="Room reverb" value={s.reverb} min={0} max={0.6} step={0.05} unit="%" onChange={(v) => set({ reverb: v })} />
        <Slider
          label="Your notes volume"
          hint="Computer keyboard, on-screen keys and MIDI echo"
          value={s.echoVolume}
          min={0}
          max={1}
          step={0.05}
          unit="%"
          onChange={(v) => set({ echoVolume: v })}
        />
        <Toggle
          label="Play my MIDI notes through the speakers"
          hint="Turn on for keyboards without their own sound. A digital piano already makes sound."
          checked={s.echoMidi}
          onChange={(v) => set({ echoMidi: v })}
        />
        <button className="btn" onClick={() => void testSound()}>
          ♪ Test sound
        </button>
      </Section>

      <Section id="look" title="Look">
        <Choice
          label="Theme"
          value={s.theme}
          options={[
            ['dark', 'Dark'],
            ['light', 'Light'],
            ['contrast', 'High contrast'],
          ]}
          onChange={(v) => set({ theme: v })}
        />
        <div className="setting">
          <div>
            <b>Hand colours</b>
            <div className="muted small">Right hand, then left hand</div>
          </div>
          <div className="control">
            {Object.entries(HAND_COLOR_PRESETS).map(([name, c]) => (
              <button key={name} className="hand-preset" onClick={() => set({ handColors: c })} title={name === 'colorblind' ? 'Colour-blind friendly' : name}>
                <span style={{ background: c.R }} />
                <span style={{ background: c.L }} />
              </button>
            ))}
            <input type="color" value={s.handColors.R} onChange={(e) => set({ handColors: { ...s.handColors, R: e.target.value } })} title="Right hand" />
            <input type="color" value={s.handColors.L} onChange={(e) => set({ handColors: { ...s.handColors, L: e.target.value } })} title="Left hand" />
          </div>
        </div>
        <Slider
          label="Falling-note speed"
          hint="Seconds of music shown ahead: more means slower, longer notes"
          value={s.fallSeconds}
          min={1.5}
          max={6}
          step={0.25}
          unit=" s"
          onChange={(v) => set({ fallSeconds: v })}
        />
        <Choice
          label="Falling-note colours"
          value={s.noteColors}
          options={[
            ['hand', 'By hand'],
            ['pitch', 'By note (rainbow)'],
            ['finger', 'By finger'],
          ]}
          onChange={(v) => set({ noteColors: v })}
        />
        <Toggle label="Glow on the notes being played" checked={s.noteGlow} onChange={(v) => set({ noteGlow: v })} />
        <DisplayOptionsForm />
      </Section>

      <Section id="sheet" title="Sheet music">
        <Slider label="Size" value={s.scoreZoom} min={0.6} max={1.4} step={0.05} unit="%" onChange={(v) => set({ scoreZoom: v })} />
        <Choice
          label="Layout"
          hint="One scrolling line, or whole pages that turn by themselves"
          value={s.scoreLayout}
          options={[
            ['line', 'Scrolling line'],
            ['page', 'Pages'],
          ]}
          onChange={(v) => set({ scoreLayout: v })}
        />
      </Section>

      <Section id="controls" title="Hands-free control">
        <Toggle
          label="Control Pianist from the piano"
          hint="Use spare keys (the lowest ones work well) or the soft and middle pedals as buttons. Needs MIDI."
          checked={s.handsFree}
          onChange={(v) => set({ handsFree: v })}
        />
        {ACTIONS.map(([action, label]) => (
          <div key={action} className="setting">
            <div>
              <b>{label}</b>
              <div className="muted small">{learning === action ? 'Press a key or pedal on your piano now…' : triggerName(s.controls[action])}</div>
            </div>
            <div className="control">
              <button className={`btn ${learning === action ? 'primary' : ''}`} onClick={() => (learning === action ? stopLearning() : learn(action))}>
                {learning === action ? 'Cancel' : 'Set…'}
              </button>
              {s.controls[action] && (
                <button
                  className="btn ghost"
                  onClick={() => {
                    const controls = { ...s.controls };
                    delete controls[action];
                    set({ controls });
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section id="feedback" title="Score & feedback">
        <p className="muted small">How much each part counts in Practice and Audition scores (0 = not at all). Dynamics only count with MIDI.</p>
        <Slider label="Right notes" value={s.scoreWeights.notes} min={0} max={3} step={1} onChange={(v) => set({ scoreWeights: { ...s.scoreWeights, notes: v } })} />
        <Slider label="Timing" value={s.scoreWeights.timing} min={0} max={3} step={1} onChange={(v) => set({ scoreWeights: { ...s.scoreWeights, timing: v } })} />
        <Slider label="Steady tempo" value={s.scoreWeights.tempo} min={0} max={3} step={1} onChange={(v) => set({ scoreWeights: { ...s.scoreWeights, tempo: v } })} />
        <Slider label="Dynamics" value={s.scoreWeights.dynamics} min={0} max={3} step={1} onChange={(v) => set({ scoreWeights: { ...s.scoreWeights, dynamics: v } })} />
        <div className="setting">
          <div>
            <b>The report shows</b>
          </div>
          <div className="control checks">
            {(
              [
                ['tips', "Coach's notes"],
                ['timing', 'Timing'],
                ['tempo', 'Tempo'],
                ['dynamics', 'Dynamics'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={s.reportSections[k]} onChange={(e) => set({ reportSections: { ...s.reportSections, [k]: e.target.checked } })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Toggle label="Sound effects" hint="A soft sound for misses, chimes for streaks and success" checked={s.sfx} onChange={(v) => set({ sfx: v })} />
        <Toggle label="Celebrations" hint="Confetti for 3 stars, new bests, level-ups and finished coaching" checked={s.celebrations} onChange={(v) => set({ celebrations: v })} />
        <Toggle label="Spoken coach" hint="Reads coach steps, scores and tips aloud" checked={s.voice} onChange={(v) => set({ voice: v })} />
        <Slider label="Voice speed" value={s.voiceRate} min={0.6} max={1.6} step={0.1} unit="×" onChange={(v) => set({ voiceRate: v })} />
        <button className="btn" disabled={!s.voice} onClick={() => say('Bar five was rushed. Loop it at seventy percent.')}>
          🔈 Test voice
        </button>
      </Section>

      <Section id="plan" title="Daily plan">
        <Slider label="Daily goal" value={s.dailyGoalMin} min={5} max={90} step={5} unit=" min" onChange={(v) => set({ dailyGoalMin: v })} />
        <div className="setting">
          <div>
            <b>Today's plan includes</b>
          </div>
          <div className="control checks">
            {(
              [
                ['warmup', 'Warm-up'],
                ['fix', 'Weak bars'],
                ['review', 'Review'],
                ['new', 'New piece'],
                ['sight', 'Sight-reading'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={s.planItems[k]} onChange={(e) => set({ planItems: { ...s.planItems, [k]: e.target.checked } })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Slider label="Weak-bar items" value={s.maxFix} min={1} max={3} step={1} onChange={(v) => set({ maxFix: v })} />
        <div className="setting">
          <div>
            <b>Practice reminder</b>
            <div className="muted small">While Pianist is open (or installed as an app), it reminds you at this time if today's goal isn't reached.</div>
          </div>
          <div className="control">
            <input type="time" value={s.reminder.time} aria-label="Reminder time" onChange={(e) => set({ reminder: { ...s.reminder, time: e.target.value } })} />
            <input
              type="checkbox"
              aria-label="Reminder on"
              checked={s.reminder.on}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
                set({ reminder: { ...s.reminder, on } });
              }}
            />
          </div>
        </div>
      </Section>

      <Section id="timing" title="Timing & microphone">
        <div className="setting">
          <div>
            <b>Calibrate timing</b>
            <div className="muted small">Play along with 12 clicks; Pianist measures your piano's delay and sets the correction below.</div>
          </div>
          <button className="btn primary" onClick={() => setCalibrating(true)}>
            Calibrate…
          </button>
        </div>
        <Slider
          label="MIDI latency correction"
          hint="If Piano Roll says you're always late, raise this a little."
          value={s.midiLatency}
          min={0}
          max={250}
          step={5}
          unit=" ms"
          onChange={(v) => set({ midiLatency: v })}
        />
        <Slider
          label="Microphone latency correction"
          hint="Extra correction for slow audio interfaces or Bluetooth."
          value={s.micLatency}
          min={0}
          max={300}
          step={5}
          unit=" ms"
          onChange={(v) => set({ micLatency: v })}
        />
        <Slider
          label="Microphone sensitivity"
          hint="Higher hears soft notes; lower ignores room noise and overtones."
          value={s.micSensitivity}
          min={0}
          max={1}
          step={0.05}
          unit="%"
          onChange={(v) => set({ micSensitivity: v })}
        />
        <div className="setting">
          <div>
            <b>Check the microphone detector</b>
            <div className="muted small">Feeds a short piano clip straight into the note detector (no microphone needed) to check it works on this computer.</div>
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
      </Section>

      <Section id="backup" title="Backup & restore">
        <p className="muted small">
          Everything lives in this browser. Save a backup file to keep it safe or to move to another computer: songs, lists, progress and settings for every
          player. Restoring adds the file's contents to what's here.
        </p>
        <div className="rec-controls">
          <button
            className="btn primary"
            onClick={async () => {
              const b = await createBackup();
              const d = new Date();
              const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              downloadFile(JSON.stringify(b), `pianist-backup-${date}.json`, 'application/json');
              setBackupMsg(`Saved ${b.songs.length} imported songs and ${b.profiles.length} player${b.profiles.length > 1 ? 's' : ''}.`);
            }}
          >
            ⤓ Save backup file
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⤒ Restore from file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const r = await restoreBackup(JSON.parse(await f.text()));
                setBackupMsg(`Restored ${r.songs} songs, ${r.sessions} practice sessions and ${r.profiles} player${r.profiles === 1 ? '' : 's'}. Reloading…`);
                window.setTimeout(() => location.reload(), 1500);
              } catch (err) {
                setBackupMsg(err instanceof SyntaxError ? "This isn't a Pianist backup file." : err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>
        {backupMsg && <div className="notice">{backupMsg}</div>}
      </Section>

      {calibrating && <Calibrate onClose={() => setCalibrating(false)} />}
      <section className="about muted small">
        <h2>About</h2>
        <p>
          Pianist listens to your piano through MIDI or the microphone. Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0), served by the Tone.js
          project. Microphone note detection: Basic Pitch by Spotify (Apache 2.0), running entirely in your browser. Sheet music: OpenSheetMusicDisplay (BSD-3).
          Your progress is stored only in this browser.
        </p>
      </section>
    </div>
  );
}
