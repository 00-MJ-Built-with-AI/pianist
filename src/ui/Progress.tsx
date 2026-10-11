import { useEffect, useState } from 'react';
import { MODE_LABELS, type Report } from '../engine/types';
import type { Song } from '../music/types';
import { dayKey, deleteSession, listDays, listSessions, streak, type Day } from '../store/db';
import { ReportView } from './Report';

const WEEKS = 15;

function minutes(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function Progress({ songs }: { songs: Song[] }) {
  const [sessions, setSessions] = useState<Report[] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [open, setOpen] = useState<Report | null>(null);

  const load = () => {
    Promise.all([listSessions(), listDays()])
      .then(([s, d]) => {
        setSessions(s);
        setDays(d);
      })
      .catch(() => setSessions([]));
  };
  useEffect(load, []);

  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = byDate.get(dayKey())?.seconds ?? 0;
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  const week = days.filter((d) => d.date >= dayKey(weekAgo)).reduce((a, d) => a + d.seconds, 0);

  // Calendar: columns are weeks (oldest first), rows Monday–Sunday.
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const cells: Array<{ key: string; sec: number; future: boolean }> = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    cells.push({ key, sec: byDate.get(key)?.seconds ?? 0, future: d > end });
  }
  const level = (sec: number) => (sec <= 0 ? 0 : sec < 300 ? 1 : sec < 900 ? 2 : sec < 1800 ? 3 : 4);

  return (
    <div className="progress">
      <div className="tiles">
        <div className="tile">
          <b>{streak(days)}</b>
          <span>day streak</span>
        </div>
        <div className="tile">
          <b>{minutes(today)}</b>
          <span>today</span>
        </div>
        <div className="tile">
          <b>{minutes(week)}</b>
          <span>last 7 days</span>
        </div>
        <div className="tile">
          <b>{sessions?.length ?? '…'}</b>
          <span>sessions</span>
        </div>
      </div>

      <section>
        <h2>Practice calendar</h2>
        <div className="calendar" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
          {cells.map((c) => (
            <span
              key={c.key}
              className={`cal l${level(c.sec)} ${c.future ? 'future' : ''}`}
              title={`${c.key}: ${c.sec ? minutes(c.sec) : 'no practice'}`}
            />
          ))}
        </div>
        <div className="muted small">A day counts towards the streak after one minute of practice.</div>
      </section>

      <section>
        <h2>Session history</h2>
        {sessions === null ? (
          <div className="muted">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="empty muted">No sessions yet. Open a song and press Start.</div>
        ) : (
          <table className="history">
            <thead>
              <tr>
                <th>When</th>
                <th>Song</th>
                <th>Mode</th>
                <th>Tempo</th>
                <th>Score</th>
                <th>Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)}>
                  <td>{new Date(r.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{r.songTitle}</td>
                  <td>
                    {MODE_LABELS[r.mode]}
                    <span className="muted small"> · {r.hands.length === 2 ? 'both' : r.hands[0] === 'R' ? 'RH' : 'LH'}</span>
                  </td>
                  <td>{Math.round(r.rate * 100)}%</td>
                  <td>
                    <b>{r.score}</b> <span className="gold">{'★'.repeat(r.stars)}</span>
                    {!r.completed && <span className="muted small"> (partial)</span>}
                  </td>
                  <td>{minutes(r.durationSec)}</td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await deleteSession(r.id);
                        load();
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {open && <ReportView report={open} song={songs.find((s) => s.id === open.songId) ?? null} onClose={() => setOpen(null)} />}
    </div>
  );
}
