import { useRef, useState } from 'react';
import { MODE_LABELS, type ModeKind } from '../engine/types';
import type { Song } from '../music/types';
import type { Best } from '../store/db';

interface Props {
  builtin: Song[];
  mine: Song[];
  bests: Best[];
  onOpen: (song: Song) => void;
  onImport: (file: File) => Promise<void>;
  onRecord: () => void;
  onDelete: (song: Song) => void;
}

const LEVELS = ['', 'First steps', 'Beginner', 'Elementary', 'Intermediate', 'Advanced'];
const BEST_MODES: ModeKind[] = ['learn', 'practice', 'audition', 'roll'];

function SongCard({ song, bests, onOpen, onDelete }: { song: Song; bests: Best[]; onOpen: () => void; onDelete?: () => void }) {
  const mine = bests.filter((b) => b.songId === song.id);
  return (
    <div className="card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="card-top">
        <span className={`level l${Math.min(5, song.level)}`}>{LEVELS[Math.min(5, song.level)] ?? `Level ${song.level}`}</span>
        {onDelete && (
          <button
            className="icon-btn"
            title="Delete this song"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ✕
          </button>
        )}
      </div>
      <h3>{song.title}</h3>
      <div className="muted">{song.composer}</div>
      <div className="card-meta muted small">
        {song.measures.filter((m) => m.number > 0).length} bars · {song.timeSig[0]}/{song.timeSig[1]} · {song.bpm} bpm
        {song.source !== 'builtin' ? ` · ${song.source === 'recording' ? 'recorded' : `from ${song.source.toUpperCase()}`}` : ''}
      </div>
      <div className="card-bests">
        {BEST_MODES.map((m) => {
          const b = mine.find((x) => x.mode === m);
          return (
            <span key={m} className={`best ${b ? '' : 'none'}`} title={b ? `${MODE_LABELS[m]}: best ${b.score}` : `${MODE_LABELS[m]}: not played yet`}>
              <span className="best-mode">{MODE_LABELS[m].split(' ')[0]}</span>
              <span className="best-stars">{b ? '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : '☆☆☆'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Library({ builtin, mine, bests, onOpen, onImport, onRecord, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await onImport(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`library ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void handleFile(f);
      }}
    >
      <section>
        <div className="section-head">
          <h2>My songs</h2>
          <div className="actions">
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? 'Importing…' : '＋ Import MIDI / MusicXML'}
            </button>
            <button className="btn" onClick={onRecord}>
              ● Record a song
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".mid,.midi,.xml,.musicxml,.mxl"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handleFile(f);
              }}
            />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {mine.length === 0 ? (
          <div className="empty muted">
            Drop a <b>.mid</b> or <b>.musicxml / .mxl</b> file here (MuseScore exports both), or record yourself playing.
          </div>
        ) : (
          <div className="grid">
            {mine.map((s) => (
              <SongCard key={s.id} song={s} bests={bests} onOpen={() => onOpen(s)} onDelete={() => onDelete(s)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Library</h2>
          <span className="muted small">Public-domain pieces, arranged for practice</span>
        </div>
        <div className="grid">
          {builtin.map((s) => (
            <SongCard key={s.id} song={s} bests={bests} onOpen={() => onOpen(s)} />
          ))}
        </div>
      </section>
    </div>
  );
}
