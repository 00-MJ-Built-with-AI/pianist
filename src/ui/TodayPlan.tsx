import { useState } from 'react';
import { DAILY_GOAL_MIN, type PlanItem } from '../store/plan';
import { loadPref, savePref } from '../store/settings';

const ICONS: Record<PlanItem['kind'], string> = {
  warmup: '♨',
  fix: '⟲',
  review: '↺',
  new: '★',
  sight: '👁',
};

export function TodayPlan({ items, todaySeconds, onOpen }: { items: PlanItem[]; todaySeconds: number; onOpen: (item: PlanItem) => void }) {
  const [open, setOpen] = useState(() => loadPref('todayOpen', true));
  const toggle = () => {
    savePref('todayOpen', !open);
    setOpen(!open);
  };
  const done = items.filter((i) => i.done).length;
  const minutes = Math.floor(todaySeconds / 60);
  const pct = Math.min(100, (todaySeconds / 60 / DAILY_GOAL_MIN) * 100);

  return (
    <section className="today">
      <div className="today-head">
        <h2>Today's practice</h2>
        <span className="muted small">
          {done}/{items.length} done
        </span>
        <div className="goal" title={`Daily goal: ${DAILY_GOAL_MIN} minutes`}>
          <div className="goal-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="small">
            {minutes} / {DAILY_GOAL_MIN} min
          </span>
        </div>
        <button className="icon-btn" onClick={toggle} aria-label={open ? 'Hide plan' : 'Show plan'}>
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <ol className="today-list">
          {items.map((item) => (
            <li key={item.key}>
              <button className={`today-item ${item.done ? 'done' : ''}`} onClick={() => onOpen(item)}>
                <span className="tick" aria-hidden>
                  {item.done ? '✓' : ICONS[item.kind]}
                </span>
                <span className="today-text">
                  <b>{item.title}</b>
                  <span className="muted small">{item.detail}</span>
                </span>
                <span className="muted small">{item.minutes} min</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
