import { useEffect, useRef, useState } from 'react';
import type { ModeKind } from '../engine/types';
import { MODE_LABELS } from '../engine/types';
import { updateModeOptions, updateSettings, useSettings, type Settings } from '../store/settings';

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={String(v)} className={`seg ${value === v ? 'on r' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mode-opt">
      <div>
        <b>{label}</b>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mode-opt">
      <div>
        <b>{label}</b>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** What gets judged, for every mode that judges. */
export function JudgingRow() {
  const s = useSettings();
  return (
    <Row label="Judge" hint={s.judging === 'rhythm' ? 'Any key counts; only the rhythm is judged.' : s.judging === 'notes' ? 'Right notes count whenever you play them.' : undefined}>
      <Seg<Settings['judging']>
        value={s.judging}
        options={[
          ['both', 'Notes & rhythm'],
          ['rhythm', 'Rhythm only'],
          ['notes', 'Notes only'],
        ]}
        onChange={(v) => updateSettings({ judging: v })}
      />
    </Row>
  );
}

/** The metronome options that train an inner pulse. */
export function MetronomeFadeRow() {
  const s = useSettings();
  return (
    <>
      <Row label="Fading metronome" hint="When the metronome is on: let it drop out so you keep the beat yourself.">
        <Seg<Settings['metronomeFade']>
          value={s.metronomeFade}
          options={[
            ['off', 'Always'],
            ['fade', 'Fade out'],
            ['beat1', 'Beat 1 only'],
            ['alternate', 'Every other bar'],
          ]}
          onChange={(v) => updateSettings({ metronomeFade: v })}
        />
      </Row>
      {s.metronomeFade === 'fade' && (
        <Row label="Clicks for">
          <Seg<number>
            value={s.fadeAfterBars}
            options={[
              [1, '1 bar'],
              [2, '2 bars'],
              [4, '4 bars'],
            ]}
            onChange={(v) => updateSettings({ fadeAfterBars: v })}
          />
        </Row>
      )}
    </>
  );
}

/** The customisations of one practice mode. */
export function ModeOptionsForm({ mode }: { mode: ModeKind }) {
  const s = useSettings();
  const m = s.modes;
  if (mode === 'learn') {
    const o = m.learn;
    return (
      <div className="mode-form">
        <Row label="Hear it first" hint="Pianist plays each phrase, then waits for you to play it.">
          <Seg
            value={o.hearFirst}
            options={[
              [0, 'Off'],
              [1, '1 bar'],
              [2, '2 bars'],
              [4, '4 bars'],
            ]}
            onChange={(v) => updateModeOptions('learn', { hearFirst: v })}
          />
        </Row>
        <Check
          label="Hold notes for their full length"
          hint="Moves on only after each note is held long enough, so you learn the rhythm too."
          checked={o.holdFull}
          onChange={(v) => updateModeOptions('learn', { holdFull: v })}
        />
        <Row label="A wrong note">
          <Seg
            value={o.wrongNote}
            options={[
              ['ignore', 'Nothing'],
              ['flash', 'Red flash'],
              ['mistake', 'Counts as a mistake'],
              ['restart', 'Back to phrase start'],
            ]}
            onChange={(v) => updateModeOptions('learn', { wrongNote: v })}
          />
        </Row>
        <Row label="Show the next notes" hint="Later steps light up faintly on the keys.">
          <Seg
            value={o.lookAhead}
            options={[
              [0, 'Just these'],
              [1, '+1'],
              [2, '+2'],
              [3, '+3'],
            ]}
            onChange={(v) => updateModeOptions('learn', { lookAhead: v })}
          />
        </Row>
        <Check label="Finger numbers on the keys" checked={o.fingersOnKeys} onChange={(v) => updateModeOptions('learn', { fingersOnKeys: v })} />
        <JudgingRow />
      </div>
    );
  }
  if (mode === 'practice') {
    const o = m.practice;
    return (
      <div className="mode-form">
        <Row label="Clean passes before speeding up" hint="With Loop and speed-up on.">
          <Seg
            value={o.cleanPasses}
            options={[1, 2, 3, 4, 5].map((n) => [n, String(n)] as [number, string])}
            onChange={(v) => updateModeOptions('practice', { cleanPasses: v })}
          />
        </Row>
        <Check
          label="Slow down after two bad passes"
          hint="The loop drops back a step when it isn't working."
          checked={o.slowDown}
          onChange={(v) => updateModeOptions('practice', { slowDown: v })}
        />
        <Check
          label="Rotate hands"
          hint="Each loop pass: right hand, then left, then both."
          checked={o.rotateHands}
          onChange={(v) => updateModeOptions('practice', { rotateHands: v })}
        />
        <Check
          label="Stop and fix"
          hint="Keep-going runs: a mistake loops that bar until it's clean, then the run carries on."
          checked={o.stopAndFix}
          onChange={(v) => updateModeOptions('practice', { stopAndFix: v })}
        />
        <MetronomeFadeRow />
        <JudgingRow />
      </div>
    );
  }
  if (mode === 'audition') {
    const o = m.audition;
    return (
      <div className="mode-form">
        <Row label="While performing, show">
          <Seg
            value={o.view}
            options={[
              ['full', 'Everything'],
              ['sheet', 'Sheet music only'],
              ['memory', 'Nothing (from memory)'],
            ]}
            onChange={(v) => updateModeOptions('audition', { view: v })}
          />
        </Row>
        <Check label="3-2-1 countdown" checked={o.countdown} onChange={(v) => updateModeOptions('audition', { countdown: v })} />
        <Row label="Restarts allowed" hint="0 = one take, like a real performance.">
          <Seg
            value={o.restarts}
            options={[
              [0, 'One take'],
              [1, '1'],
              [2, '2'],
              [-1, 'Any'],
            ]}
            onChange={(v) => updateModeOptions('audition', { restarts: v })}
          />
        </Row>
      </div>
    );
  }
  if (mode === 'roll') {
    const o = m.roll;
    return (
      <div className="mode-form">
        <Row label="Lives" hint="Game over after this many misses or wrong notes.">
          <Seg
            value={o.lives}
            options={[
              [0, 'Off'],
              [3, '3'],
              [5, '5'],
              [10, '10'],
            ]}
            onChange={(v) => updateModeOptions('roll', { lives: v })}
          />
        </Row>
        <Check label="Perfect only" hint="A Good counts as a miss." checked={o.perfectOnly} onChange={(v) => updateModeOptions('roll', { perfectOnly: v })} />
        <Check
          label="Combo multiplier"
          hint="Points ×2 from a 10-note combo, ×3 from 20, ×4 from 30."
          checked={o.multiplier}
          onChange={(v) => updateModeOptions('roll', { multiplier: v })}
        />
        <Row label="Read ahead" hint="Fade: notes disappear before the line. Late: they only appear near it.">
          <Seg
            value={o.reading}
            options={[
              ['off', 'Off'],
              ['fade', 'Fade out'],
              ['late', 'Appear late'],
            ]}
            onChange={(v) => updateModeOptions('roll', { reading: v })}
          />
        </Row>
        <JudgingRow />
      </div>
    );
  }
  return <p className="muted small">Listen has no extra options: choose the hands to hear on the toolbar.</p>;
}

/** The player's "Options" button for the current mode. */
export function ModeOptionsMenu({ mode, extra }: { mode: ModeKind; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (mode === 'listen') return null;
  return (
    <div className="add-list" ref={box}>
      <button className={`btn toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title={`${MODE_LABELS[mode]} options`}>
        ⚙ {MODE_LABELS[mode]} options
      </button>
      {open && (
        <div className="list-menu mode-menu" role="dialog" aria-label={`${MODE_LABELS[mode]} options`}>
          <div className="list-menu-title">{MODE_LABELS[mode]} options</div>
          <ModeOptionsForm mode={mode} />
          {extra}
        </div>
      )}
    </div>
  );
}
