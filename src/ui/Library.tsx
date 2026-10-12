import { useEffect, useRef, useState } from 'react';
import { MODE_LABELS, type ModeKind } from '../engine/types';
import type { Song } from '../music/types';
import { hasSong, moveSong, toggleSong, type Collection } from '../store/collections';
import type { Best } from '../store/db';
import { isAudioFile } from '../music/audioFiles';
import { loadPref, savePref } from '../store/settings';
import type { PlanItem } from '../store/plan';
import { TodayPlan } from './TodayPlan';

export interface Queue {
  name: string;
  songs: Song[];
}

interface Props {
  builtin: Song[];
  mine: Song[];
  bests: Best[];
  collections: Collection[];
  plan: PlanItem[];
  todaySeconds: number;
  onOpenPlan: (item: PlanItem) => void;
  onOpen: (song: Song, queue?: Queue) => void;
  onImport: (files: File[], collection: Collection | null) => Promise<{ imported: Song[]; errors: string[] }>;
  onRecord: () => void;
  onTranscribe: (file: File | null, collection: Collection | null) => void;
  onDelete: (song: Song) => void;
  onCreateCollection: (name: string, songIds?: string[]) => Promise<Collection>;
  onSaveCollection: (c: Collection) => Promise<void>;
  onDeleteCollection: (c: Collection) => Promise<void>;
}

const LEVELS = ['', 'First steps', 'Beginner', 'Elementary', 'Intermediate', 'Advanced'];
const BEST_MODES: ModeKind[] = ['learn', 'practice', 'audition', 'roll'];
const ACCEPT = '.mid,.midi,.xml,.musicxml,.mxl';
const SOURCE_LABEL: Record<Song['source'], string> = {
  builtin: '',
  midi: 'from MIDI',
  musicxml: 'from MUSICXML',
  recording: 'recorded',
  audio: 'from audio',
};

/** Inline text field that commits on Enter and cancels on Escape or blur. */
function NameField({ initial, placeholder, onDone }: { initial?: string; placeholder: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial ?? '');
  return (
    <input
      className="name-field"
      autoFocus
      value={value}
      placeholder={placeholder}
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(value.trim() || null);
        if (e.key === 'Escape') onDone(null);
      }}
      onBlur={() => onDone(value.trim() || null)}
    />
  );
}

function AddToCollection({
  song,
  collections,
  onToggle,
  onCreate,
}: {
  song: Song;
  collections: Collection[];
  onToggle: (c: Collection) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inAny = collections.some((c) => hasSong(c, song.id));

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="add-list" ref={box} onClick={(e) => e.stopPropagation()}>
      <button
        className={`icon-btn ${inAny ? 'in-list' : ''}`}
        title="Add to a collection"
        aria-label="Add to a collection"
        onClick={() => setOpen(!open)}
      >
        {inAny ? '✓' : '＋'}
      </button>
      {open && (
        <div className="list-menu" role="menu">
          <div className="list-menu-title">Add to collection</div>
          {collections.map((c) => (
            <label key={c.id} className="list-menu-item">
              <input type="checkbox" checked={hasSong(c, song.id)} onChange={() => onToggle(c)} />
              <span>{c.name}</span>
              <span className="muted small">{c.songIds.length}</span>
            </label>
          ))}
          {naming ? (
            <NameField
              placeholder="Collection name"
              onDone={(name) => {
                setNaming(false);
                if (name) onCreate(name);
              }}
            />
          ) : (
            <button className="list-menu-new" onClick={() => setNaming(true)}>
              ＋ New collection…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  song: Song;
  bests: Best[];
  collections: Collection[];
  onOpen: () => void;
  onDelete?: () => void;
  onToggle: (c: Collection) => void;
  onCreate: (name: string) => void;
  order?: { index: number; count: number; onMove: (delta: number) => void; onRemove: () => void };
}

function SongCard({ song, bests, collections, onOpen, onDelete, onToggle, onCreate, order }: CardProps) {
  const mine = bests.filter((b) => b.songId === song.id);
  const bars = song.measures.filter((m) => m.number > 0).length;
  return (
    <div className="card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="card-top">
        {order ? (
          <span className="order-no">{order.index + 1}</span>
        ) : (
          <span className={`level l${Math.min(5, song.level)}`}>{LEVELS[Math.min(5, song.level)] ?? `Level ${song.level}`}</span>
        )}
        <div className="card-actions">
          {order ? (
            <>
              <button
                className="icon-btn"
                title="Move up"
                disabled={order.index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  order.onMove(-1);
                }}
              >
                ↑
              </button>
              <button
                className="icon-btn"
                title="Move down"
                disabled={order.index === order.count - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  order.onMove(1);
                }}
              >
                ↓
              </button>
              <button
                className="icon-btn"
                title="Remove from this collection"
                onClick={(e) => {
                  e.stopPropagation();
                  order.onRemove();
                }}
              >
                ✕
              </button>
            </>
          ) : (
            <>
              <AddToCollection song={song} collections={collections} onToggle={onToggle} onCreate={onCreate} />
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
            </>
          )}
        </div>
      </div>
      <h3>{song.title}</h3>
      <div className="muted">{song.composer || ' '}</div>
      <div className="card-meta muted small">
        {bars} bar{bars === 1 ? '' : 's'} · {song.timeSig[0]}/{song.timeSig[1]} · {song.bpm} bpm
        {song.source !== 'builtin' ? ` · ${SOURCE_LABEL[song.source]}` : ''}
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

export function Library(props: Props) {
  const { builtin, mine, bests, collections, onOpen, onImport, onRecord, onDelete } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<string>(() => loadPref('shelf', 'all'));
  useEffect(() => savePref('shelf', active), [active]);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; errors: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);

  // An id that no longer matches (still loading, or deleted) simply shows all songs.
  const current = collections.find((c) => c.id === active) ?? null;

  const byId = new Map([...mine, ...builtin].map((s) => [s.id, s]));
  const listSongs = current ? current.songIds.map((id) => byId.get(id)).filter((s): s is Song => !!s) : [];

  const handleFiles = async (all: File[]) => {
    // Audio recordings go to the transcriber; score files are imported directly.
    const audio = all.find(isAudioFile);
    if (audio) props.onTranscribe(audio, current);
    const files = all.filter((f) => !isAudioFile(f));
    if (!files.length) return;
    setBusy(true);
    setNotice(null);
    try {
      const { imported, errors } = await onImport(files, current);
      const where = current ? ` into “${current.name}”` : '';
      setNotice({
        text: imported.length ? `Imported ${imported.length} song${imported.length > 1 ? 's' : ''}${where}.` : 'Nothing was imported.',
        errors,
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (song: Song) => (c: Collection) => void props.onSaveCollection(toggleSong(c, song.id));
  const createWith = (song: Song) => (name: string) => void props.onCreateCollection(name, [song.id]);

  const card = (s: Song, extra: Partial<CardProps> = {}) => (
    <SongCard
      key={s.id}
      song={s}
      bests={bests}
      collections={collections}
      onOpen={() => onOpen(s)}
      onToggle={toggle(s)}
      onCreate={createWith(s)}
      {...extra}
    />
  );

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
        void handleFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void handleFiles(files);
        }}
      />

      <nav className="shelf" aria-label="Collections">
        <button className={`shelf-chip ${!current ? 'active' : ''}`} onClick={() => setActive('all')}>
          All songs
        </button>
        {collections.map((c) => (
          <button key={c.id} className={`shelf-chip ${active === c.id ? 'active' : ''}`} onClick={() => setActive(c.id)}>
            {c.name} <span className="count">{c.songIds.length}</span>
          </button>
        ))}
        {creating ? (
          <NameField
            placeholder="New collection name"
            onDone={async (name) => {
              setCreating(false);
              if (name) setActive((await props.onCreateCollection(name)).id);
            }}
          />
        ) : (
          <button className="shelf-chip new" onClick={() => setCreating(true)}>
            ＋ New collection
          </button>
        )}
      </nav>

      {notice && (
        <div className={notice.errors.length ? 'error' : 'notice'}>
          {notice.text}
          {notice.errors.map((err, i) => (
            <div key={i} className="small">
              {err}
            </div>
          ))}
        </div>
      )}

      {current ? (
        <section>
          <div className="section-head">
            {renaming ? (
              <NameField
                initial={current.name}
                placeholder="Collection name"
                onDone={(name) => {
                  setRenaming(false);
                  if (name && name !== current.name) void props.onSaveCollection({ ...current, name });
                }}
              />
            ) : (
              <h2 title="Click to rename" className="renamable" onClick={() => setRenaming(true)}>
                {current.name}
              </h2>
            )}
            <span className="muted small">
              {listSongs.length} piece{listSongs.length === 1 ? '' : 's'}
            </span>
            <div className="actions">
              {listSongs.length > 0 && (
                <button className="btn primary" onClick={() => onOpen(listSongs[0], { name: current.name, songs: listSongs })}>
                  ▶ Practise in order
                </button>
              )}
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? 'Importing…' : '＋ Import files into this list'}
              </button>
              <button className="btn" onClick={() => props.onTranscribe(null, current)}>
                ♫ Transcribe audio
              </button>
              <button className="btn ghost" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                className="btn ghost danger"
                onClick={() => {
                  if (window.confirm(`Delete the collection “${current.name}”? The songs themselves stay in your library.`)) {
                    void props.onDeleteCollection(current);
                  }
                }}
              >
                Delete list
              </button>
            </div>
          </div>
          {listSongs.length === 0 ? (
            <div className="empty muted">
              This collection is empty. Use the <b>＋</b> button on any song to add it here, or drop your own <b>.mid</b> /{' '}
              <b>.musicxml</b> / <b>.mxl</b> files on this page to import them straight into it.
            </div>
          ) : (
            <div className="grid">
              {listSongs.map((s, i) =>
                card(s, {
                  onOpen: () => onOpen(s, { name: current.name, songs: listSongs }),
                  order: {
                    index: i,
                    count: listSongs.length,
                    onMove: (delta) => void props.onSaveCollection(moveSong(current, s.id, delta)),
                    onRemove: () => void props.onSaveCollection(toggleSong(current, s.id)),
                  },
                }),
              )}
            </div>
          )}
        </section>
      ) : (
        <>
          <TodayPlan items={props.plan} todaySeconds={props.todaySeconds} onOpen={props.onOpenPlan} />
          <section>
            <div className="section-head">
              <h2>My songs</h2>
              <div className="actions">
                <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {busy ? 'Importing…' : '＋ Import MIDI / MusicXML'}
                </button>
                <button className="btn" onClick={() => props.onTranscribe(null, null)}>
                  ♫ Transcribe audio (MP3)
                </button>
                <button className="btn" onClick={onRecord}>
                  ● Record a song
                </button>
              </div>
            </div>
            {mine.length === 0 ? (
              <div className="empty muted">
                Drop <b>.mid</b> or <b>.musicxml / .mxl</b> files here (several at once is fine; MuseScore exports both), or record
                yourself playing. Your songs stay in this browser.
              </div>
            ) : (
              <div className="grid">{mine.map((s) => card(s, { onDelete: () => onDelete(s) }))}</div>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2>Library</h2>
              <span className="muted small">Public-domain pieces, arranged for practice</span>
            </div>
            <div className="grid">{builtin.map((s) => card(s))}</div>
          </section>
        </>
      )}
    </div>
  );
}
