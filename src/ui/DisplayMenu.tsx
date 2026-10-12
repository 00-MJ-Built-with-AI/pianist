import { useEffect, useRef, useState } from 'react';
import { noteLabel } from '../music/pitch';
import { updateSettings, useSettings, type Settings } from '../store/settings';

/** The piano and sheet display options, shared by the player menu and the Settings page. */
export function DisplayOptionsForm() {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const example = [60, 61, 62].map((p) => noteLabel(p, s.nameStyle)).join(' ');
  return (
    <div className="display-form">
      <label className="opt">
        <span>Names on the keys</span>
        <select value={s.keyLabels} onChange={(e) => set({ keyLabels: e.target.value as Settings['keyLabels'] })}>
          <option value="all">All keys (white and black)</option>
          <option value="white">White keys</option>
          <option value="c">Only C</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="opt">
        <span>Note names as</span>
        <select value={s.nameStyle} onChange={(e) => set({ nameStyle: e.target.value as Settings['nameStyle'] })}>
          <option value="letter">Letters (C D E)</option>
          <option value="octave">Letters + octave (C4 D4)</option>
          <option value="solfege">Do Re Mi</option>
        </select>
      </label>
      <div className="opt muted small">Example: {example}</div>
      <label className="opt check">
        <input type="checkbox" checked={s.noteLabels} onChange={(e) => set({ noteLabels: e.target.checked })} />
        <span>Names on the falling notes</span>
      </label>
      <label className="opt check">
        <input type="checkbox" checked={s.showTargets} onChange={(e) => set({ showTargets: e.target.checked })} />
        <span>Light up the keys to play next</span>
      </label>
      <label className="opt check">
        <input type="checkbox" checked={s.showFalling} onChange={(e) => set({ showFalling: e.target.checked })} />
        <span>Falling notes</span>
      </label>
      <label className="opt check">
        <input type="checkbox" checked={s.fingering} onChange={(e) => set({ fingering: e.target.checked })} />
        <span>Suggested fingering on the sheet music</span>
      </label>
      <label className="opt check">
        <input type="checkbox" checked={s.fullKeyboard} onChange={(e) => set({ fullKeyboard: e.target.checked })} />
        <span>All 88 keys (otherwise fit to the piece)</span>
      </label>
      <label className="opt">
        <span>Keyboard size</span>
        <select value={s.keyboardSize} onChange={(e) => set({ keyboardSize: e.target.value as Settings['keyboardSize'] })}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
    </div>
  );
}

export function DisplayMenu() {
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
  return (
    <div className="add-list" ref={box}>
      <button className={`btn toggle ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Key names, labels, keyboard size">
        👁 Display
      </button>
      {open && (
        <div className="list-menu display-menu" role="dialog" aria-label="Display options">
          <div className="list-menu-title">Display</div>
          <DisplayOptionsForm />
        </div>
      )}
    </div>
  );
}
