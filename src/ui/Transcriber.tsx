import { useEffect, useMemo, useRef, useState } from 'react';
import { analyseAudio, decodeAudioFile, extractNotes, type ModelOutput } from '../ai/transcribeAudio';
import { isAudioFile } from '../music/audioFiles';
import { pitchName } from '../music/pitch';
import { arrangeSong, estimateBeat, type BeatGrid, type HeardNote, type Simplify } from '../music/transcribe';
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
}

const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.webm';
const TIMES: Array<[string, [number, number]]> = [
  ['4/4', [4, 4]],
  ['3/4', [3, 4]],
  ['2/4', [2, 4]],
];


type Stage = 'idle' | 'decoding' | 'loading-model' | 'analysing' | 'ready' | 'error';

export function Transcriber({ initialFile, defaultCollectionId, collections, onCancel, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ModelOutput | null>(null);
  const [detail, setDetail] = useState(0.5);
  const [heard, setHeard] = useState<HeardNote[]>([]);
  const [beat, setBeat] = useState<BeatGrid | null>(null);
  const [bpm, setBpm] = useState(100);
  const [time, setTime] = useState('4/4');
  const [split, setSplit] = useState(60);
  const [grid, setGrid] = useState(4);
  const [simplify, setSimplify] = useState<Simplify>('all');
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
        setBpm(g.bpm);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [output, detail]);

  // The phase must follow tempo edits: realign the beat comb to the chosen bpm.
  const phase = useMemo(() => {
    if (!beat || !heard.length) return 0;
    if (Math.abs(bpm - beat.bpm) < 0.01) return beat.phase;
    const period = 60 / bpm;
    let c = 0;
    let s = 0;
    for (const n of heard) {
      const a = (2 * Math.PI * n.start) / period;
      c += Math.sqrt(n.amplitude) * Math.cos(a);
      s += Math.sqrt(n.amplitude) * Math.sin(a);
    }
    const p = (Math.atan2(s, c) / (2 * Math.PI)) * period;
    return p < 0 ? p + period : p;
  }, [beat, bpm, heard]);

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
        const f = e.dataTransfer.files[0];
        if (f) void start(f);
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
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void start(f);
        }}
      />

      {!file ? (
        <button className="dropzone" onClick={() => fileRef.current?.click()}>
          <span className="big">♫</span>
          <b>Choose an audio file</b>
          <span className="muted small">or drop it here · MP3, WAV, M4A, OGG, FLAC · up to 10 minutes</span>
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

      {stage === 'ready' && (
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
                <button className="btn" onClick={() => setBpm(Math.round((bpm / 2) * 10) / 10)} title="Half as fast">
                  ÷2
                </button>
                <button className="btn" onClick={() => setBpm(Math.round(bpm * 2 * 10) / 10)} title="Twice as fast">
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
