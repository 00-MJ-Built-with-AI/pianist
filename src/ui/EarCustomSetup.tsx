import { CUSTOM_CHORDS, intervalName, type CustomEar, type CustomWhat, type IntervalDir } from '../music/ear';
import { TONICS } from '../music/exercises';
import { pitchName } from '../music/pitch';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const RANGE_PITCHES = Array.from({ length: 61 }, (_, i) => 36 + i).filter((p) => WHITE.includes(p % 12));

function Chips<T extends string | number>({ all, on, label, onChange }: { all: T[]; on: T[]; label: (v: T) => string; onChange: (v: T[]) => void }) {
  return (
    <div className="chip-row">
      {all.map((v) => {
        const active = on.includes(v);
        return (
          <button
            key={String(v)}
            className={`chip ${active ? 'on' : ''}`}
            onClick={() => {
              const next = active ? on.filter((x) => x !== v) : [...on, v];
              if (next.length) onChange(next);
            }}
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}

/** Put together your own ear-training drill. */
export function EarCustomSetup({ value, onChange }: { value: CustomEar; onChange: (c: CustomEar) => void }) {
  const c = value;
  const set = (patch: Partial<CustomEar>) => onChange({ ...c, ...patch });
  return (
    <div className="ear-setup">
      <div className="segmented">
        {(
          [
            ['intervals', 'Intervals'],
            ['chords', 'Chords'],
            ['notes', 'Notes'],
            ['melodies', 'Melodies'],
          ] as Array<[CustomWhat, string]>
        ).map(([w, label]) => (
          <button key={w} className={`seg ${c.what === w ? 'on r' : ''}`} onClick={() => set({ what: w, answer: w === 'melodies' ? 'play' : c.answer })}>
            {label}
          </button>
        ))}
      </div>

      {c.what === 'intervals' && (
        <>
          <div className="muted small">Intervals</div>
          <Chips all={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]} on={c.intervals} label={intervalName} onChange={(intervals) => set({ intervals })} />
          <div className="muted small">Played</div>
          <Chips<IntervalDir>
            all={['up', 'down', 'together']}
            on={c.directions}
            label={(d) => (d === 'up' ? 'Going up' : d === 'down' ? 'Going down' : 'Together')}
            onChange={(directions) => set({ directions })}
          />
        </>
      )}

      {c.what === 'chords' && (
        <>
          <div className="muted small">Chords</div>
          <Chips all={Object.keys(CUSTOM_CHORDS)} on={c.chords} label={(k) => CUSTOM_CHORDS[k].name} onChange={(chords) => set({ chords })} />
          <div className="muted small">Positions</div>
          <Chips
            all={[0, 1, 2, 3]}
            on={c.inversions}
            label={(i) => (i === 0 ? 'Root position' : i === 1 ? '1st inversion' : i === 2 ? '2nd inversion' : '3rd inversion (7ths)')}
            onChange={(inversions) => set({ inversions })}
          />
        </>
      )}

      <div className="form">
        {(c.what === 'notes' || c.what === 'melodies') && (
          <>
            <label>
              Key
              <select value={c.keyPc} onChange={(e) => set({ keyPc: Number(e.target.value) })}>
                {TONICS.map((t) => (
                  <option key={t.pc} value={t.pc}>
                    {c.minor ? t.minor : t.major}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={c.minor} onChange={(e) => set({ minor: e.target.checked })} />
              minor
            </label>
          </>
        )}
        {c.what === 'melodies' && (
          <label>
            Notes
            <select value={c.melodyLength} onChange={(e) => set({ melodyLength: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Lowest note
          <select value={c.low} onChange={(e) => set({ low: Math.min(Number(e.target.value), c.high - 12) })}>
            {RANGE_PITCHES.map((p) => (
              <option key={p} value={p}>
                {pitchName(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Highest note
          <select value={c.high} onChange={(e) => set({ high: Math.max(Number(e.target.value), c.low + 12) })}>
            {RANGE_PITCHES.map((p) => (
              <option key={p} value={p}>
                {pitchName(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Answer by
          <select value={c.answer} disabled={c.what === 'melodies'} onChange={(e) => set({ answer: e.target.value as CustomEar['answer'] })}>
            <option value="play">Playing it back</option>
            <option value="name">Choosing the name</option>
          </select>
        </label>
        <label>
          Round
          <select value={c.round} onChange={(e) => set({ round: Number(e.target.value) })}>
            <option value={10}>10 questions</option>
            <option value={15}>15 questions</option>
            <option value={20}>20 questions</option>
            <option value={0}>Endless</option>
          </select>
        </label>
      </div>
    </div>
  );
}
