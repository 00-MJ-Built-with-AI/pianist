import { useCallback, useEffect, useMemo, useState } from 'react';
import { resumeAudio, setBusVolume } from './audio/audio';
import { piano } from './audio/piano';
import { inputHub } from './input/hub';
import { installComputerKeyboard } from './input/keyboard';
import { connectMidi } from './input/midi';
import { importSongFile } from './music/importers';
import { builtinSongs } from './music/library';
import type { Song } from './music/types';
import { deleteSong, listBests, listSongs, saveSong, type Best } from './store/db';
import { useSettings } from './store/settings';
import { InputBar } from './ui/InputBar';
import { Library } from './ui/Library';
import { Player } from './ui/Player';
import { Progress } from './ui/Progress';
import { Recorder } from './ui/Recorder';
import { SettingsPage } from './ui/SettingsPage';

type View = { name: 'library' | 'progress' | 'settings' | 'record' } | { name: 'play'; song: Song };

export function App() {
  const [view, setView] = useState<View>({ name: 'library' });
  const [mine, setMine] = useState<Song[]>([]);
  const [bests, setBests] = useState<Best[]>([]);
  const settings = useSettings();
  const builtin = useMemo(() => builtinSongs(), []);

  const refresh = useCallback(async () => {
    try {
      const [songs, b] = await Promise.all([listSongs(), listBests()]);
      setMine(songs);
      setBests(b);
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

  const onImport = async (file: File) => {
    const song = await importSongFile(file);
    await saveSong(song);
    await refresh();
    setView({ name: 'play', song });
  };

  if (view.name === 'play') {
    return <Player key={view.song.id} song={view.song} onExit={() => setView({ name: 'library' })} onSaved={refresh} />;
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
            onOpen={(song) => setView({ name: 'play', song })}
            onImport={onImport}
            onRecord={() => setView({ name: 'record' })}
            onDelete={async (song) => {
              if (!window.confirm(`Delete "${song.title}" from your songs?`)) return;
              await deleteSong(song.id);
              await refresh();
            }}
          />
        )}
        {view.name === 'progress' && <Progress songs={[...builtin, ...mine]} />}
        {view.name === 'settings' && <SettingsPage />}
        {view.name === 'record' && (
          <Recorder
            onCancel={() => setView({ name: 'library' })}
            onSaved={async (song) => {
              await saveSong(song);
              await refresh();
              setView({ name: 'play', song });
            }}
          />
        )}
      </main>
    </div>
  );
}
