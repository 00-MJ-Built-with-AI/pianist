import { loadPref, savePref, updateSettings, useSettings, type Settings } from '../store/settings';

function Chip({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button className={`chip ${on ? 'on' : ''}`} onClick={onClick} title={title} aria-pressed={on}>
      {label}
    </button>
  );
}

/** One-tap show / hide switches for the keyboard, falling notes, sheet music and their labels. */
export function ViewStrip({ hasScore }: { hasScore: boolean }) {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const keyLetters = s.keyLabels !== 'none';
  return (
    <div className="view-strip" aria-label="Show or hide">
      <span className="label">Show</span>
      <Chip
        on={s.showKeyboard}
        label="🎹 Piano"
        title="The on-screen piano keyboard"
        onClick={() => set({ showKeyboard: !s.showKeyboard })}
      />
      <Chip on={s.showFalling} label="▼ Falling notes" title="The falling notes" onClick={() => set({ showFalling: !s.showFalling })} />
      <Chip
        on={s.showTargets}
        label="✦ Key lights"
        title="Light up the keys to play next"
        onClick={() => set({ showTargets: !s.showTargets })}
      />
      <span className="divider" />
      <Chip
        on={keyLetters}
        label="Aa on keys"
        title="Note names on the piano keys"
        onClick={() => {
          if (keyLetters) {
            savePref('lastKeyLabels', s.keyLabels);
            set({ keyLabels: 'none' });
          } else set({ keyLabels: loadPref<Settings['keyLabels']>('lastKeyLabels', 'white') });
        }}
      />
      <Chip on={s.noteLabels} label="Aa on notes" title="Note names on the falling notes" onClick={() => set({ noteLabels: !s.noteLabels })} />
      {hasScore && (
        <Chip on={s.sheetLetters} label="Aa on sheet" title="Note names next to the notes on the sheet music" onClick={() => set({ sheetLetters: !s.sheetLetters })} />
      )}
      <label className="chip-select" title="What the key labels show when you play with the computer keyboard">
        ⌨
        <select value={s.keyLabelSource} onChange={(e) => set({ keyLabelSource: e.target.value as Settings['keyLabelSource'] })}>
          <option value="note">Note names</option>
          <option value="pc">Computer keys</option>
          <option value="both">Both</option>
        </select>
      </label>
    </div>
  );
}
