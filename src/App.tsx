import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resumeAudio, setBusVolume, setSound } from './audio/audio';
import { piano } from './audio/piano';
import { inputHub } from './input/hub';
import { installComputerKeyboard } from './input/keyboard';
import { connectMidi } from './input/midi';
import { importSongFile } from './music/importers';
import { builtinSongs } from './music/library';
import type { Song } from './music/types';
import { addSongs, newCollection, withoutSong, type Collection } from './store/collections';
import {
  dayKey,
  deleteCollection,
  deleteSong,
  listBests,
  listCollections,
  listDays,
  listSessions,
  listSongs,
  saveCollection,
  saveSong,
  type Best,
  type Day,
} from './store/db';
import type { Report } from './engine/types';
import { scaleExercise, sightReading } from './music/exercises';
import { buildPlan, type PlanItem } from './store/plan';
import { useReminder } from './ui/reminder';
import { useSettings } from './store/settings';
import { InputBar } from './ui/InputBar';
import { InstallButton } from './ui/InstallButton';
import { ProfileMenu } from './ui/ProfileMenu';
import { Library, type Queue } from './ui/Library';
import type { PlayerPreset } from './ui/Player';
import type { EarKind } from './music/ear';
import { Progress } from './ui/Progress';
import { SettingsPage } from './ui/SettingsPage';

// The practice screens carry the notation engine; load them when first opened.
const Player = lazy(() => import('./ui/Player').then((m) => ({ default: m.Player })));
const Recorder = lazy(() => import('./ui/Recorder').then((m) => ({ default: m.Recorder })));
const Transcriber = lazy(() => import('./ui/Transcriber').then((m) => ({ default: m.Transcriber })));
const Exercises = lazy(() => import('./ui/Exercises').then((m) => ({ default: m.Exercises })));
const Editor = lazy(() => import('./ui/Editor').then((m) => ({ default: m.Editor })));
const EarTraining = lazy(() => import('./ui/EarTraining').then((m) => ({ default: m.EarTraining })));
const loading = <div className="loading muted">Loading…</div>;

type Tab = 'library' | 'exercises' | 'progress' | 'settings';

type View =
  | { name: Tab | 'record' }
  | { name: 'transcribe'; file: File | null; collectionId: string | null }
  | { name: 'play'; song: Song; queue?: Queue; preset?: PlayerPreset; next?: () => Song; returnTo?: Tab }
  | { name: 'edit'; song: Song; back: View }
  | { name: 'ear'; kind: EarKind };

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [mine, setMine] = useState<Song[]>([]);
  const [bests, setBests] = useState<Best[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [sessions, setSessions] = useState<Report[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const settings = useSettings();
  const builtin = useMemo(() => builtinSongs(), []);

  const refresh = useCallback(async () => {
    try {
      const [songs, b, cols, hist, d] = await Promise.all([listSongs(), listBests(), listCollections(), listSessions(300), listDays()]);
      setMine(songs);
      setBests(b);
      setCollections(cols);
      setSessions(hist);
      setDays(d);
    } catch (err) {
      console.warn('Storage unavailable', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installComputerKeyboard(), []);
  useReminder(days);
  const [reminderText, setReminderText] = useState<string | null>(null);
  // Sticky bars below the header need its height (it wraps onto two rows on narrow screens).
  const headRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = (e: Event) => setReminderText((e as CustomEvent<string>).detail);
    window.addEventListener('pianist-reminder', on);
    return () => window.removeEventListener('pianist-reminder', on);
  }, []);

  // Reconnect MIDI silently when the browser already allows it.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'midi' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') void connectMidi();
      })
      .catch(() => {});
  }, []);

  // Audio can only start after a user gesture; load the piano sound at the first one.
  useEffect(() => {
    const unlock = () => {
      void resumeAudio();
      void piano.load();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    inputHub.echoMidi = settings.echoMidi;
    inputHub.midiLatency = settings.midiLatency;
    setBusVolume('accomp', settings.accompVolume);
    setBusVolume('metronome', settings.metronomeVolume);
    setBusVolume('echo', settings.echoVolume);
    setBusVolume('guide', settings.guideVolume);
    setSound(settings.pianoSound, settings.reverb);
    inputHub.setControls(settings.handsFree ? settings.controls : {});
    piano.electric = settings.pianoSound === 'electric';
    // Theme and hand colours for the whole interface.
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty('--hand-r', settings.handColors.R);
    root.style.setProperty('--hand-l', settings.handColors.L);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'light' ? '#f6f4ef' : '#0d0f14');
  }, [settings]);

  const onImport = async (files: File[], into: Collection | null) => {
    const imported: Song[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const song = await importSongFile(file);
        await saveSong(song);
        imported.push(song);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (into && imported.length) await saveCollection(addSongs(into, imported.map((s) => s.id)));
    await refresh();
    // A single file opens straight away; a batch stays in the library to be organised.
    if (files.length === 1 && imported.length === 1 && !into) setView({ name: 'play', song: imported[0] });
    return { imported, errors };
  };

  const plan = useMemo(
    () =>
      buildPlan({
        today: new Date(),
        sessions,
        songs: [...builtin, ...mine],
        bests,
        options: { items: settings.planItems, maxFix: settings.maxFix },
      }),
    [sessions, builtin, mine, bests, settings.planItems, settings.maxFix],
  );
  const todaySeconds = days.find((d) => d.date === dayKey())?.seconds ?? 0;
  const lastPlayed = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of sessions) if ((m.get(r.songId) ?? 0) < r.date) m.set(r.songId, r.date);
    return m;
  }, [sessions]);

  const openPlanItem = (item: PlanItem) => {
    const l = item.launch;
    if (l.type === 'song') {
      const song = [...builtin, ...mine].find((s) => s.id === l.songId);
      if (song) setView({ name: 'play', song, preset: item.preset });
    } else if (l.type === 'scale') {
      setView({ name: 'play', song: scaleExercise({ ...l, beats: 1, bpm: 80 }), preset: item.preset });
    } else {
      setView({
        name: 'play',
        song: sightReading(l.level, l.bars, l.seed),
        preset: item.preset,
        next: () => sightReading(l.level, l.bars, Math.floor(Math.random() * 1e9)),
      });
    }
  };

  const onCreateCollection = async (name: string, songIds: string[] = []) => {
    const c = addSongs(newCollection(name), songIds);
    await saveCollection(c);
    await refresh();
    return c;
  };

  if (view.name === 'play') {
    const { queue, next } = view;
    return (
      <Suspense fallback={loading}>
        <Player
          key={view.song.id}
          song={view.song}
          queue={queue}
          preset={view.preset}
          nextAction={next ? { label: '↻ New piece', run: () => setView({ ...view, song: next() }) } : undefined}
          onNavigate={(song) => setView({ name: 'play', song, queue })}
          onEdit={() => setView({ name: 'edit', song: view.song, back: view })}
          onExit={() => setView({ name: view.returnTo ?? 'library' })}
          onSaved={refresh}
        />
      </Suspense>
    );
  }

  if (view.name === 'edit') {
    return (
      <Suspense fallback={loading}>
        <Editor
          song={view.song}
          onCancel={() => setView(view.back)}
          onSave={async (song) => {
            await saveSong(song);
            await refresh();
            setView({ name: 'play', song });
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="shell">
      <header className="app-head" ref={headRef}>
        <div className="brand" onClick={() => setView({ name: 'library' })}>
          <img src="/favicon.svg" alt="" width={28} height={28} />
          Pianist
        </div>
        <nav className="nav">
          {(['library', 'exercises', 'progress', 'settings'] as const).map((n) => (
            <button key={n} className={`tab ${view.name === n ? 'active' : ''}`} onClick={() => setView({ name: n })}>
              {n[0].toUpperCase() + n.slice(1)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <ProfileMenu />
        <InstallButton />
        <InputBar />
      </header>
      {reminderText && (
        <div className="reminder-banner">
          ⏰ {reminderText}
          <button className="icon-btn" onClick={() => setReminderText(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <main className="main">
        {view.name === 'library' && (
          <Library
            builtin={builtin}
            mine={mine}
            bests={bests}
            collections={collections}
            plan={plan}
            todaySeconds={todaySeconds}
            lastPlayed={lastPlayed}
            onOpenPlan={openPlanItem}
            onOpen={(song, queue) => setView({ name: 'play', song, queue })}
            onImport={onImport}
            onRecord={() => setView({ name: 'record' })}
            onTranscribe={(file, collection) => setView({ name: 'transcribe', file, collectionId: collection?.id ?? null })}
            onDelete={async (song) => {
              if (!window.confirm(`Delete "${song.title}" from your songs?`)) return;
              await deleteSong(song.id);
              await Promise.all(withoutSong(collections, song.id).map(saveCollection));
              await refresh();
            }}
            onCreateCollection={onCreateCollection}
            onSaveCollection={async (c) => {
              setCollections((cols) => cols.map((x) => (x.id === c.id ? c : x)));
              await saveCollection(c);
              await refresh();
            }}
            onDeleteCollection={async (c) => {
              await deleteCollection(c.id);
              await refresh();
            }}
          />
        )}
        {view.name === 'exercises' && (
          <Suspense fallback={loading}>
            <Exercises
              onStart={(l) => setView({ name: 'play', song: l.song, preset: l.preset, next: l.next, returnTo: 'exercises' })}
              onEar={(kind) => setView({ name: 'ear', kind })}
            />
          </Suspense>
        )}
        {view.name === 'ear' && (
          <Suspense fallback={loading}>
            <EarTraining initialKind={view.kind} onExit={() => setView({ name: 'exercises' })} />
          </Suspense>
        )}
        {view.name === 'progress' && <Progress songs={[...builtin, ...mine]} />}
        {view.name === 'settings' && <SettingsPage />}
        {view.name === 'transcribe' && (
          <Suspense fallback={loading}>
            <Transcriber
              initialFile={view.file}
              defaultCollectionId={view.collectionId}
              collections={collections}
              onCancel={() => setView({ name: 'library' })}
              onSaved={async (song, collection) => {
                await saveSong(song);
                if (collection) await saveCollection(addSongs(collection, [song.id]));
                await refresh();
                setView({ name: 'play', song });
              }}
            />
          </Suspense>
        )}
        {view.name === 'record' && (
          <Suspense fallback={loading}>
            <Recorder
              onCancel={() => setView({ name: 'library' })}
              onSaved={async (song) => {
                await saveSong(song);
                await refresh();
                setView({ name: 'play', song });
              }}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}
