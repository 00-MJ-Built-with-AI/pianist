import { useEffect, useRef, useState } from 'react';
import { MODE_LABELS, type ModeKind } from '../engine/types';
import type { Song } from '../music/types';
import { hasSong, moveSong, toggleSong, type Collection } from '../store/collections';
import type { Best } from '../store/db';
import { isAudioFile } from '../music/audioFiles';
import { loadPref, savePref } from '../store/settings';
import type { PlanItem } from '../store/plan';
import { TodayPlan } from './TodayPlan';
import { SongDetails } from './SongDetails';
import { allTags, getSongMeta, setSongMeta, useSongMetaStore } from '../store/songMeta';

type SortKey = 'default' | 'title' | 'level' | 'played' | 'stars' | 'added';

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
  lastPlayed: Map<string, number>;
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
  onDetails?: () => void;
}

function SongCard({ song, bests, collections, onOpen, onDelete, onToggle, onCreate, order, onDetails }: CardProps) {
  const mine = bests.filter((b) => b.songId === song.id);
  const bars = song.measures.filter((m) => m.number > 0).length;
  const meta = getSongMeta(song.id);
  const level = meta.level ?? song.level;
  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      style={meta.color ? { borderLeft: `5px solid ${meta.color}` } : undefined}
    >
      <div className="card-top">
        {order ? (
          <span className="order-no">{order.index + 1}</span>
        ) : (
          <span className={`level l${Math.min(5, level)}`}>{LEVELS[Math.min(5, level)] ?? `Level ${level}`}</span>
        )}
        <div className="card-actions">
          <button
            className={`icon-btn fav ${meta.favorite ? 'on' : ''}`}
            title={meta.favorite ? 'Unpin from favourites' : 'Pin to favourites'}
            onClick={(e) => {
              e.stopPropagation();
              setSongMeta(song.id, { favorite: !meta.favorite });
            }}
          >
            {meta.favorite ? '★' : '☆'}
          </button>
          {onDetails && (
            <button
              className="icon-btn"
              title="Name, emoji, colour, level, tags, notes"
              onClick={(e) => {
                e.stopPropagation();
                onDetails();
              }}
            >
              ⋯
            </button>
          )}
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
      <h3>
        {meta.emoji && <span className="card-emoji">{meta.emoji}</span>}
        {meta.title ?? song.title}
      </h3>
      <div className="muted">{song.composer || ' '}</div>
      {(meta.tags?.length || meta.notes) && (
        <div className="card-tags">
          {meta.tags?.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
          {meta.notes && (
            <span className="tag note" title={meta.notes}>
              📝
            </span>
          )}
        </div>
      )}
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
  const metaStore = useSongMetaStore();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => loadPref('librarySort', 'default'));
  const [levelFilter, setLevelFilter] = useState(0);
  const [tagFilter, setTagFilter] = useState('');
  const [details, setDetails] = useState<Song | null>(null);
  useEffect(() => savePref('librarySort', sort), [sort]);
  const tags = allTags();
  const starsOf = (id: string) => Math.max(0, ...bests.filter((b) => b.songId === id).map((b) => b.stars));
  const view = (songs: Song[]) => {
    const q = query.trim().toLowerCase();
    const list = songs.filter((s) => {
      const m = metaStore[s.id] ?? {};
      if (levelFilter && (m.level ?? s.level) !== levelFilter) return false;
      if (tagFilter && !(m.tags ?? []).includes(tagFilter)) return false;
      if (q && !`${m.title ?? s.title} ${s.composer} ${(m.tags ?? []).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const title = (s: Song) => metaStore[s.id]?.title ?? s.title;
    const cmp: Record<SortKey, (a: Song, b: Song) => number> = {
      default: () => 0,
      title: (a, b) => title(a).localeCompare(title(b)),
      level: (a, b) => (metaStore[a.id]?.level ?? a.level) - (metaStore[b.id]?.level ?? b.level),
      played: (a, b) => (props.lastPlayed.get(b.id) ?? 0) - (props.lastPlayed.get(a.id) ?? 0),
      stars: (a, b) => starsOf(b.id) - starsOf(a.id),
      added: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    };
    return sort === 'default' ? list : [...list].sort(cmp[sort]);
  };
  const filtering = !!(query.trim() || levelFilter || tagFilter);

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
      onDetails={() => setDetails(s)}
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
          <div className="lib-tools">
            <input
              className="search"
              type="search"
              placeholder="Search songs, composers, tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort">
              <option value="default">Sort: default</option>
              <option value="title">Sort: name</option>
              <option value="level">Sort: level</option>
              <option value="played">Sort: last played</option>
              <option value="stars">Sort: most stars</option>
              <option value="added">Sort: newest</option>
            </select>
            <select value={levelFilter} onChange={(e) => setLevelFilter(Number(e.target.value))} title="Level">
              <option value={0}>All levels</option>
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  {LEVELS[l]}
                </option>
              ))}
            </select>
            {tags.length > 0 && (
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} title="Tag">
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            )}
          </div>
          {(() => {
            const favs = view([...mine, ...builtin]).filter((s) => metaStore[s.id]?.favorite);
            return favs.length ? (
              <section>
                <div className="section-head">
                  <h2>★ Favourites</h2>
                </div>
                <div className="grid">{favs.map((s) => card(s, { onDelete: mine.includes(s) ? () => onDelete(s) : undefined }))}</div>
              </section>
            ) : null;
          })()}
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
              <div className="grid">{view(mine).map((s) => card(s, { onDelete: () => onDelete(s) }))}</div>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2>Library</h2>
              <span className="muted small">Public-domain pieces, arranged for practice</span>
            </div>
            <div className="grid">{view(builtin).map((s) => card(s))}</div>
            {filtering && !view([...mine, ...builtin]).length && <div className="empty muted">No songs match.</div>}
          </section>
        </>
      )}
      {details && <SongDetails song={details} onClose={() => setDetails(null)} />}
    </div>
  );
}
