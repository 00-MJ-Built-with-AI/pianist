import { useEffect, useState } from 'react';
import { analyseAudio, decodeAudioFile, extractNotes } from '../ai/transcribeAudio';
import { arrangeSong, estimateBeat, phaseAt } from '../music/transcribe';
import type { Song } from '../music/types';
import type { Collection } from '../store/collections';
import type { TxSettings } from './transcriberPresets';

const TIME_SIGS: Record<string, [number, number]> = { '4/4': [4, 4], '3/4': [3, 4], '2/4': [2, 4] };

interface Item {
  file: File;
  state: 'waiting' | 'working' | 'done' | 'failed';
  progress: number;
  song?: Song;
  error?: string;
}

/** Several recordings at once, with one set of settings, saved together (optionally into a collection). */
export function TranscribeBatch({
  files,
  settings,
  collections,
  onSave,
  onCancel,
}: {
  files: File[];
  settings: TxSettings;
  collections: Collection[];
  onSave: (songs: Song[], collection: Collection | null, newCollection: string | null) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<Item[]>(() => files.map((file) => ({ file, state: 'waiting', progress: 0 })));
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const [target, setTarget] = useState<string>('new');
  const [newName, setNewName] = useState(`Transcriptions ${today}`);

  useEffect(() => {
    let cancelled = false;
    const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
    (async () => {
      for (let i = 0; i < files.length; i++) {
        if (cancelled) return;
        update(i, { state: 'working', progress: 0 });
        try {
          const { samples } = await decodeAudioFile(files[i]);
          const out = await analyseAudio(samples, (p) => !cancelled && update(i, { progress: p }));
          const heard = await extractNotes(out, settings.detail);
          if (!heard.length) throw new Error('No notes found');
          const beat = estimateBeat(heard);
          const bpm = Math.round(beat.bpm * settings.tempo * 10) / 10;
          const song = arrangeSong(heard, {
            title: files[i].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || `Transcription ${i + 1}`,
            bpm,
            phase: phaseAt(heard, beat, bpm),
            timeSig: TIME_SIGS[settings.time] ?? [4, 4],
            split: settings.split,
            grid: settings.grid,
            simplify: settings.simplify,
            maxPerHand: 4,
          });
          if (!song) throw new Error('No notes found');
          // Songs made in the same moment need their own ids.
          update(i, { state: 'done', progress: 1, song: { ...song, id: `${song.id}-${i}` } });
        } catch (err) {
          update(i, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, settings]);

  const done = items.filter((x) => x.state === 'done');
  const busy = items.some((x) => x.state === 'waiting' || x.state === 'working');
  return (
    <div className="batch">
      <h3>
        Transcribing {files.length} files {busy ? '…' : '✓'}
      </h3>
      <ul className="batch-list">
        {items.map((x, i) => (
          <li key={i} className={x.state}>
            <span className="batch-name">{x.file.name}</span>
            {x.state === 'waiting' && <span className="muted small">waiting</span>}
            {x.state === 'working' && (
              <span className="bar small-bar">
                <span style={{ width: `${Math.max(3, Math.round(x.progress * 100))}%` }} />
              </span>
            )}
            {x.state === 'done' && x.song && (
              <span className="muted small">
                ✓ {x.song.notes.length} notes · {x.song.measures.length} bars · {x.song.bpm} bpm
              </span>
            )}
            {x.state === 'failed' && <span className="small error">✕ {x.error}</span>}
          </li>
        ))}
      </ul>
      <div className="rec-controls">
        <label>
          Save to{' '}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">A new collection</option>
            <option value="">My songs only</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                + {c.name}
              </option>
            ))}
          </select>
        </label>
        {target === 'new' && <input className="name-field" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />}
        <span className="spacer" />
        <button className="btn" onClick={onCancel}>
          {busy ? 'Stop' : 'Cancel'}
        </button>
        <button
          className="btn primary"
          disabled={busy || !done.length}
          onClick={() =>
            onSave(
              done.map((x) => x.song!),
              collections.find((c) => c.id === target) ?? null,
              target === 'new' ? newName.trim() || `Transcriptions ${today}` : null,
            )
          }
        >
          Save {done.length} song{done.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}
