import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { resumeAudio, setBusVolume } from './audio/audio';
import { piano } from './audio/piano';
import { inputHub } from './input/hub';
import { installComputerKeyboard } from './input/keyboard';
import { connectMidi } from './input/midi';
import { importSongFile } from './music/importers';
import { builtinSongs } from './music/library';
import type { Song } from './music/types';
import { addSongs, newCollection, withoutSong, type Collection } from './store/collections';
import {
  deleteCollection,
  deleteSong,
  listBests,
  listCollections,
  listSongs,
  saveCollection,
  saveSong,
  type Best,
} from './store/db';
import { useSettings } from './store/settings';
import { InputBar } from './ui/InputBar';
import { Library, type Queue } from './ui/Library';
import { Progress } from './ui/Progress';
import { SettingsPage } from './ui/SettingsPage';

// The practice screens carry the notation engine; load them when first opened.
const Player = lazy(() => import('./ui/Player').then((m) => ({ default: m.Player })));
const Recorder = lazy(() => import('./ui/Recorder').then((m) => ({ default: m.Recorder })));
const Transcriber = lazy(() => import('./ui/Transcriber').then((m) => ({ default: m.Transcriber })));
const loading = <div className="loading muted">Loading…</div>;

type View =
  | { name: 'library' | 'progress' | 'settings' | 'record' }
  | { name: 'transcribe'; file: File | null; collectionId: string | null }
  | { name: 'play'; song: Song; queue?: Queue };

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [mine, setMine] = useState<Song[]>([]);
  const [bests, setBests] = useState<Best[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const settings = useSettings();
  const builtin = useMemo(() => builtinSongs(), []);

  const refresh = useCallback(async () => {
    try {
      const [songs, b, cols] = await Promise.all([listSongs(), listBests(), listCollections()]);
      setMine(songs);
      setBests(b);
      setCollections(cols);
    } catch (err) {
      console.warn('Storage unavailable', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installComputerKeyboard(), []);

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

  const onCreateCollection = async (name: string, songIds: string[] = []) => {
    const c = addSongs(newCollection(name), songIds);
    await saveCollection(c);
    await refresh();
    return c;
  };

  if (view.name === 'play') {
    const { queue } = view;
    return (
      <Suspense fallback={loading}>
        <Player
          key={view.song.id}
          song={view.song}
          queue={queue}
          onNavigate={(song) => setView({ name: 'play', song, queue })}
          onExit={() => setView({ name: 'library' })}
          onSaved={refresh}
        />
      </Suspense>
    );
  }

  return (
    <div className="shell">
      <header className="app-head">
        <div className="brand" onClick={() => setView({ name: 'library' })}>
          <img src="/favicon.svg" alt="" width={28} height={28} />
          Pianist
        </div>
        <nav className="nav">
          {(['library', 'progress', 'settings'] as const).map((n) => (
            <button key={n} className={`tab ${view.name === n ? 'active' : ''}`} onClick={() => setView({ name: n })}>
              {n[0].toUpperCase() + n.slice(1)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <InputBar />
      </header>
      <main className="main">
        {view.name === 'library' && (
          <Library
            builtin={builtin}
            mine={mine}
            bests={bests}
            collections={collections}
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
