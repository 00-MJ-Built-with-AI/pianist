import { useEffect, useMemo, useRef, useState } from 'react';
import { analyseAudio, decodeAudioFile, extractNotes, type ModelOutput } from '../ai/transcribeAudio';
import { isAudioFile } from '../music/audioFiles';
import { pitchName } from '../music/pitch';
import { arrangeSong, estimateBeat, phaseAt, type BeatGrid, type HeardNote, type Simplify } from '../music/transcribe';
import {
  BUILTIN_TX_PRESETS,
  lastTxSettings,
  myTxPresets,
  rememberTxSettings,
  saveMyTxPresets,
  sameTx,
  type TxPreset,
  type TxSettings,
} from './transcriberPresets';
import { TranscribeBatch } from './TranscribeBatch';
import type { Song } from '../music/types';
import type { Collection } from '../store/collections';
import { ScoreView, type ScoreHandle } from './ScoreView';
import { useSongPreview } from './usePreview';

interface Props {
  initialFile?: File | null;
  defaultCollectionId?: string | null;
  collections: Collection[];
  onCancel: () => void;
  onSaved: (song: Song, collection: Collection | null) => void;
  /** Several files transcribed at once. */
  onSavedMany: (songs: Song[], collection: Collection | null, newCollection: string | null) => void;
}

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.webm';
const TIMES: Array<[string, [number, number]]> = [
  ['4/4', [4, 4]],
  ['3/4', [3, 4]],
  ['2/4', [2, 4]],
];


type Stage = 'idle' | 'decoding' | 'loading-model' | 'analysing' | 'ready' | 'error';

export function Transcriber({ initialFile, defaultCollectionId, collections, onCancel, onSaved, onSavedMany }: Props) {
  // New files start with the settings used last time.
  const [initial] = useState(lastTxSettings);
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ModelOutput | null>(null);
  const [detail, setDetail] = useState(initial.detail);
  const [heard, setHeard] = useState<HeardNote[]>([]);
  const [beat, setBeat] = useState<BeatGrid | null>(null);
  const [bpm, setBpm] = useState(100);
  const [time, setTime] = useState(initial.time);
  const [split, setSplit] = useState(initial.split);
  const [grid, setGrid] = useState(initial.grid);
  const [simplify, setSimplify] = useState<Simplify>(initial.simplify);
  const [tempo, setTempo] = useState<TxSettings['tempo']>(initial.tempo);
  const [presets, setPresets] = useState<TxPreset[]>(myTxPresets);
  const [presetName, setPresetName] = useState('');
  const [batch, setBatch] = useState<File[] | null>(null);
  const current: TxSettings = { detail, time, split, grid, simplify, tempo };
  useEffect(() => rememberTxSettings({ detail, time, split, grid, simplify, tempo }), [detail, time, split, grid, simplify, tempo]);
  const applyPreset = (s: TxSettings) => {
    setDetail(s.detail);
    setTime(s.time);
    setSplit(s.split);
    setGrid(s.grid);
    setSimplify(s.simplify);
    if (beat && s.tempo !== tempo) setBpm(Math.round(beat.bpm * s.tempo * 10) / 10);
    setTempo(s.tempo);
  };
  const activePreset = [...BUILTIN_TX_PRESETS, ...presets].find((p) => sameTx(p.settings, current))?.name ?? '';
  const startMany = (list: FileList | File[]) => {
    const files = [...list].filter(isAudioFile);
    if (files.length > 1) {
      stopPreview();
      setBatch(files);
    } else if (files[0]) void start(files[0]);
    else if (list.length) void start([...list][0]);
  };
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<string>(defaultCollectionId ?? '');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scoreRef = useRef<ScoreHandle>(null);
  const { playing, toggle: togglePreview, stop: stopPreview } = useSongPreview(scoreRef);
  const runId = useRef(0);

  const start = async (f: File) => {
    if (!isAudioFile(f)) {
      setError('Choose an audio file (MP3, WAV, M4A, OGG or FLAC).');
      setStage('error');
      return;
    }
    const id = ++runId.current;
    stopPreview();
    setFile(f);
    setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
    setAudioUrl(URL.createObjectURL(f));
    setOutput(null);
    setHeard([]);
    setError(null);
    setProgress(0);
    try {
      setStage('decoding');
      const { samples } = await decodeAudioFile(f);
      if (id !== runId.current) return;
      setStage('loading-model');
      const out = await analyseAudio(samples, (p) => {
        if (id !== runId.current) return;
        setStage('analysing');
        setProgress(p);
      });
      if (id !== runId.current) return;
      setOutput(out);
      setStage('ready');
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  useEffect(() => {
    if (initialFile) void start(initialFile);
  }, [initialFile]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  // Notes from the model output, re-extracted when the detail level changes. The beat is found once per file.
  const beatFor = useRef<ModelOutput | null>(null);
  useEffect(() => {
    if (!output) return;
    let cancelled = false;
    void extractNotes(output, detail).then((notes) => {
      if (cancelled) return;
      setHeard(notes);
      if (beatFor.current !== output) {
        beatFor.current = output;
        const g = estimateBeat(notes);
        setBeat(g);
        setBpm(Math.round(g.bpm * tempo * 10) / 10);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [output, detail]);

  // The phase must follow tempo edits: realign the beat comb to the chosen bpm.
  const phase = useMemo(() => (beat && heard.length ? phaseAt(heard, beat, bpm) : 0), [beat, bpm, heard]);

  const song = useMemo(() => {
    if (!heard.length || !beat) return null;
    return arrangeSong(heard, {
      title: title || 'Transcription',
      bpm,
      phase,
      timeSig: TIMES.find(([k]) => k === time)![1],
      split,
      grid,
      simplify,
      maxPerHand: 4,
    });
  }, [heard, beat, bpm, phase, time, split, grid, simplify, title]);

  useEffect(() => stopPreview(), [song, stopPreview]);
  if (import.meta.env.DEV) Object.assign(window, { __pianistTranscription: { song, heard, beat, output } });

  const busy = stage === 'decoding' || stage === 'loading-model' || stage === 'analysing';
  const stageText =
    stage === 'decoding'
      ? 'Reading the audio…'
      : stage === 'loading-model'
        ? 'Loading the note detector (first time only)…'
        : stage === 'analysing'
          ? `Listening for notes… ${Math.round(progress * 100)}%`
          : '';

  return (
    <div
      className={`transcriber ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        startMany(e.dataTransfer.files);
      }}
    >
      <div className="section-head">
        <h2>Transcribe audio</h2>
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted">
        Turn a recording into sheet music. An AI note detector (Spotify's Basic Pitch) listens to the file on this computer; nothing is
        uploaded. Solo piano comes out best. Songs with singing, drums or a band come out rough; use <b>Melody + bass</b> for those.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = '';
          startMany(files);
        }}
      />

      <div className="tx-presets">
        <label>
          Preset{' '}
          <select
            value={activePreset}
            onChange={(e) => {
              const p = [...BUILTIN_TX_PRESETS, ...presets].find((x) => x.name === e.target.value);
              if (p) applyPreset(p.settings);
            }}
          >
            <option value="">{activePreset ? '' : 'Your own settings'}</option>
            <optgroup label="Ready-made">
              {BUILTIN_TX_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {presets.length > 0 && (
              <optgroup label="Mine">
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {presets.some((p) => p.name === activePreset) && (
          <button
            className="btn ghost"
            onClick={() => {
              const next = presets.filter((p) => p.name !== activePreset);
              setPresets(next);
              saveMyTxPresets(next);
            }}
          >
            Delete preset
          </button>
        )}
        <span className="spacer" />
        <input className="name-field" placeholder="Save these settings as…" value={presetName} onChange={(e) => setPresetName(e.target.value)} maxLength={40} />
        <button
          className="btn"
          disabled={!presetName.trim()}
          onClick={() => {
            const name = presetName.trim();
            const next = [...presets.filter((p) => p.name !== name), { name, settings: current }];
            setPresets(next);
            saveMyTxPresets(next);
            setPresetName('');
          }}
        >
          Save preset
        </button>
      </div>

      {batch ? (
        <TranscribeBatch
          files={batch}
          settings={current}
          collections={collections}
          onSave={onSavedMany}
          onCancel={() => setBatch(null)}
        />
      ) : !file ? (
        <button className="dropzone" onClick={() => fileRef.current?.click()}>
          <span className="big">♫</span>
          <b>Choose audio files</b>
          <span className="muted small">or drop them here · MP3, WAV, M4A, OGG, FLAC · up to 10 minutes each · several at once go into a collection</span>
        </button>
      ) : (
        <div className="audio-row">
          <div className="audio-name">
            <b>{file.name}</b>
            <button className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              Choose another
            </button>
          </div>
          {audioUrl && <audio controls src={audioUrl} className="audio-el" />}
        </div>
      )}

      {busy && (
        <div className="progress-box">
          <div>{stageText}</div>
          <div className="bar">
            <span style={{ width: `${stage === 'analysing' ? Math.round(progress * 100) : 3}%` }} />
          </div>
        </div>
      )}
      {stage === 'error' && error && <div className="error">{error}</div>}

      {!batch && stage === 'ready' && (
        <>
          <div className="form">
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label title={beat ? `Detected ${beat.bpm} bpm (beat match ${Math.round(beat.confidence * 100)}%)` : ''}>
              Tempo (bpm)
              <span className="tempo-edit">
                <input type="number" min={30} max={260} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || bpm)} />
                <button
                  className="btn"
                  onClick={() => {
                    setBpm(Math.round((bpm / 2) * 10) / 10);
                    setTempo((t) => (t === 2 ? 1 : 0.5));
                  }}
                  title="Half as fast"
                >
                  ÷2
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setBpm(Math.round(bpm * 2 * 10) / 10);
                    setTempo((t) => (t === 0.5 ? 1 : 2));
                  }}
                  title="Twice as fast"
                >
                  ×2
                </button>
              </span>
            </label>
            <label>
              Time
              <select value={time} onChange={(e) => setTime(e.target.value)}>
                {TIMES.map(([k]) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Keep
              <select value={simplify} onChange={(e) => setSimplify(e.target.value as Simplify)}>
                <option value="all">Everything</option>
                <option value="melody-bass">Melody + bass</option>
                <option value="melody">Melody only</option>
              </select>
            </label>
            <label>
              Rhythm grid
              <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
                <option value={2}>Eighth notes</option>
                <option value={4}>Sixteenth notes</option>
                <option value={12}>Sixteenths + triplets</option>
              </select>
            </label>
            <label>
              Hand split
              <select value={split} onChange={(e) => setSplit(Number(e.target.value))}>
                {[48, 53, 55, 57, 60, 62, 64].map((p) => (
                  <option key={p} value={p}>
                    {pitchName(p)}
                  </option>
                ))}
              </select>
            </label>
            <label title="Higher keeps quieter and shorter notes">
              Detail
              <input type="range" min={0} max={1} step={0.05} value={detail} onChange={(e) => setDetail(Number(e.target.value))} />
            </label>
          </div>

          {song ? (
            <div className="review">
              <ScoreView ref={scoreRef} song={song} heat={null} loop={null} showPlayhead={playing} />
              <div className="rec-controls">
                <button className="btn" onClick={() => void togglePreview(song)}>
                  {playing ? '■ Stop' : '▶ Play the transcription'}
                </button>
                <span className="muted">
                  {song.notes.length} notes · {song.measures.length} bars · {song.notes.filter((n) => n.hand === 'R').length} right /{' '}
                  {song.notes.filter((n) => n.hand === 'L').length} left
                </span>
                <span className="spacer" />
                <select value={target} onChange={(e) => setTarget(e.target.value)} title="Also add it to a collection">
                  <option value="">My songs only</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      + {c.name}
                    </option>
                  ))}
                </select>
                <button className="btn primary" onClick={() => onSaved(song, collections.find((c) => c.id === target) ?? null)}>
                  Save and practise
                </button>
              </div>
              <p className="muted small">
                Tip: if the notes look twice as fast or slow as they should, use ÷2 or ×2. If the bar lines feel shifted, try another
                time signature.
              </p>
            </div>
          ) : (
            <div className="empty muted">No notes were found. Raise “Detail”, or try a clearer recording.</div>
          )}
        </>
      )}
    </div>
  );
}
