import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { perfToAudio, resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import {
  deleteNotes,
  docFromSong,
  moveNotes,
  nextUid,
  notesInBox,
  resizeNotes,
  snap,
  songFromDoc,
  toggleHands,
  type EditDoc,
  type EditNote,
} from '../music/editing';
import { isBlackKey, pitchName } from '../music/pitch';
import { buildMeasures, measureLength } from '../music/song';
import { keyNames } from '../music/transpose';
import type { Hand, Song } from '../music/types';
import { useSettings } from '../store/settings';
import { ExportMenu } from './ExportMenu';
import { ScoreView, type ScoreHandle } from './ScoreView';

interface Props {
  song: Song;
  onCancel: () => void;
  onSave: (song: Song) => void;
}

const ROW_H = 14;
const KEY_W = 48;
const HEAD_H = 22;
const TOP = 108;
const BOTTOM = 21;
const ROWS = TOP - BOTTOM + 1;
const EDGE_PX = 6;

const TIME_SIGS: Array<[number, number]> = [
  [4, 4],
  [3, 4],
  [2, 4],
  [6, 8],
  [3, 8],
  [12, 8],
];

type Drag =
  | { kind: 'move' | 'resize'; x0: number; y0: number; uids: Set<number>; base: EditNote[]; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean };

export function Editor({ song, onCancel, onSave }: Props) {
  const settings = useSettings();
  const isBuiltin = song.source === 'builtin';
  const [doc, setDoc] = useState<EditDoc>(() => docFromSong(song));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [grid, setGrid] = useState(0.25);
  const [newLen, setNewLen] = useState(1);
  const [newHand, setNewHand] = useState<Hand>('R');
  const [ppb, setPpb] = useState(64);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Song>(song);
  const [playing, setPlaying] = useState(false);
  const [, setTick] = useState(0);
  const history = useRef<{ past: EditDoc[]; future: EditDoc[] }>({ past: [], future: [] });
  const dragRef = useRef<Drag | null>(null);
  const dragNotes = useRef<EditNote[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreRef = useRef<ScoreHandle>(null);
  const playRef = useRef<{ stop: () => void; beat: () => number } | null>(null);

  const barLen = measureLength(doc.timeSig);
  const lastEnd = doc.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const totalBeats = Math.max(lastEnd, song.totalBeats) + barLen * 4;
  const measures = useMemo(() => buildMeasures(totalBeats, doc.timeSig, doc.pickup), [totalBeats, doc.timeSig, doc.pickup]);
  const fullW = KEY_W + totalBeats * ppb;
  const fullH = HEAD_H + ROWS * ROW_H;

  const base = useMemo(
    () =>
      isBuiltin
        ? { id: `edit-${Date.now().toString(36)}`, source: 'recording' as const, level: song.level, createdAt: Date.now() }
        : { id: song.id, source: song.source, level: song.level, createdAt: song.createdAt },
    [isBuiltin, song],
  );

  // Re-engrave the preview score shortly after edits stop.
  useEffect(() => {
    const t = window.setTimeout(() => setPreview(songFromDoc(doc, base)), 350);
    return () => window.clearTimeout(t);
  }, [doc, base]);

  const commit = useCallback(
    (next: EditDoc) => {
      history.current.past.push(doc);
      if (history.current.past.length > 200) history.current.past.shift();
      history.current.future = [];
      setDoc(next);
      setDirty(true);
    },
    [doc],
  );
  const setNotes = (notes: EditNote[]) => commit({ ...doc, notes });

  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(doc);
    setDoc(prev);
    setDirty(true);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(doc);
    setDoc(next);
    setDirty(true);
  };

  const audition = (pitch: number) => {
    void resumeAudio();
    void piano.load();
    piano.noteOn(pitch, 80, { duration: 0.35, bus: 'echo' });
  };

  /* ---------------------------------------------------------------- drawing */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = wrap.scrollLeft;
    const sy = wrap.scrollTop;
    const xOf = (beat: number) => KEY_W + beat * ppb - sx;
    const yOf = (pitch: number) => HEAD_H + (TOP - pitch) * ROW_H - sy;

    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, vw, vh);
    // Rows
    for (let p = TOP; p >= BOTTOM; p--) {
      const y = yOf(p);
      if (y < HEAD_H - ROW_H || y > vh) continue;
      ctx.fillStyle = isBlackKey(p) ? '#0c0e13' : '#141821';
      ctx.fillRect(KEY_W, y, vw, ROW_H);
      if (p % 12 === 0) {
        ctx.fillStyle = '#2a3142';
        ctx.fillRect(KEY_W, y + ROW_H - 1, vw, 1);
      }
    }
    // Grid and bar lines
    const firstBeat = Math.max(0, Math.floor((sx - KEY_W) / ppb / grid) * grid);
    for (let b = firstBeat; KEY_W + b * ppb - sx < vw; b += grid) {
      const x = xOf(b);
      const onBeat = Math.abs(b - Math.round(b)) < 1e-6;
      ctx.fillStyle = onBeat ? '#1f2532' : '#171b25';
      ctx.fillRect(Math.round(x), HEAD_H, 1, vh);
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const m of measures) {
      const x = xOf(m.start);
      if (x < KEY_W - 2 || x > vw) continue;
      ctx.fillStyle = '#3a4560';
      ctx.fillRect(Math.round(x), HEAD_H, 1, vh);
    }

    // Notes
    const notes = dragNotes.current ?? doc.notes;
    for (const n of notes) {
      const x = xOf(n.start);
      const w = Math.max(3, n.dur * ppb - 1);
      const y = yOf(n.pitch);
      if (x > vw || x + w < KEY_W || y > vh || y < HEAD_H - ROW_H) continue;
      const sel = selected.has(n.uid);
      ctx.fillStyle = n.hand === 'R' ? (sel ? '#a8d4ff' : '#4c9dff') : sel ? '#9ef3cb' : '#38c98a';
      ctx.fillRect(x, y + 1, w, ROW_H - 2);
      if (sel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 1.5, w - 1, ROW_H - 3);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + w - 3, y + 2, 2, ROW_H - 4);
      if (w > 28) {
        ctx.fillStyle = '#0a0d12';
        ctx.fillText(pitchName(n.pitch, doc.keyFifths < 0), x + 4, y + ROW_H / 2);
      }
    }

    // Box selection
    const d = dragRef.current;
    if (d?.kind === 'box') {
      ctx.fillStyle = 'rgba(255,209,102,0.12)';
      ctx.strokeStyle = '#ffd166';
      const x = Math.min(d.x0, d.x1) - sx;
      const y = Math.min(d.y0, d.y1) - sy;
      ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }

    // Playhead
    const pb = playRef.current?.beat();
    if (pb !== undefined) {
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(Math.round(xOf(pb)), HEAD_H, 2, vh);
    }

    // Header with bar numbers (fixed at the top)
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, vw, HEAD_H);
    ctx.fillStyle = '#8b93a6';
    for (const m of measures) {
      const x = xOf(m.start);
      if (x < KEY_W - 20 || x > vw) continue;
      ctx.fillText(m.number === 0 ? '·' : String(m.number), x + 4, HEAD_H / 2);
    }
    // Keyboard column (fixed at the left)
    for (let p = TOP; p >= BOTTOM; p--) {
      const y = yOf(p);
      if (y < HEAD_H - ROW_H || y > vh) continue;
      ctx.fillStyle = isBlackKey(p) ? '#1a1d24' : '#e9e6df';
      ctx.fillRect(0, y, KEY_W - 2, ROW_H - 1);
      if (p % 12 === 0) {
        ctx.fillStyle = '#5b5446';
        ctx.fillText(pitchName(p), 4, y + ROW_H / 2);
      }
    }
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, KEY_W, HEAD_H);
  }, [doc, selected, ppb, grid, measures]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // Start scrolled to the music.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !doc.notes.length) return;
    const pitches = doc.notes.map((n) => n.pitch).sort((a, b) => a - b);
    const mid = pitches[Math.floor(pitches.length / 2)];
    wrap.scrollTop = Math.max(0, HEAD_H + (TOP - mid) * ROW_H - wrap.clientHeight / 2);
    wrap.focus();
  }, []);

  /* ---------------------------------------------------------------- mouse */

  const contentPos = (e: React.PointerEvent | PointerEvent) => {
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left + wrap.scrollLeft, y: e.clientY - r.top + wrap.scrollTop, vx: e.clientX - r.left, vy: e.clientY - r.top };
  };
  const beatAt = (x: number) => (x - KEY_W) / ppb;
  const pitchAt = (y: number) => TOP - Math.floor((y - HEAD_H) / ROW_H);

  const hit = (x: number, y: number): { note: EditNote; edge: boolean } | null => {
    const pitch = pitchAt(y);
    const beat = beatAt(x);
    for (let i = doc.notes.length - 1; i >= 0; i--) {
      const n = doc.notes[i];
      if (n.pitch !== pitch || beat < n.start || beat > n.start + n.dur) continue;
      const right = KEY_W + (n.start + n.dur) * ppb;
      return { note: n, edge: right - x <= EDGE_PX };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y, vx, vy } = contentPos(e);
    if (vy < HEAD_H) return;
    if (vx < KEY_W) {
      audition(pitchAt(y));
      return;
    }
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // Some pointers can't be captured; dragging still works inside the grid.
    }
    const h = hit(x, y);
    if (h) {
      let sel = selected;
      if (e.shiftKey) {
        sel = new Set(selected);
        if (sel.has(h.note.uid)) sel.delete(h.note.uid);
        else sel.add(h.note.uid);
      } else if (!selected.has(h.note.uid)) {
        sel = new Set([h.note.uid]);
      }
      setSelected(sel);
      dragRef.current = { kind: h.edge ? 'resize' : 'move', x0: x, y0: y, uids: new Set(sel), base: doc.notes, moved: false };
    } else {
      dragRef.current = { kind: 'box', x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = contentPos(e);
    const d = dragRef.current;
    const wrap = wrapRef.current!;
    if (!d) {
      const h = x - wrap.scrollLeft >= KEY_W ? hit(x, y) : null;
      wrap.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'crosshair';
      return;
    }
    if (d.kind === 'box') {
      d.x1 = x;
      d.y1 = y;
    } else {
      const dBeat = snap((x - d.x0) / ppb, grid);
      const dPitch = Math.round((d.y0 - y) / ROW_H);
      if (dBeat !== 0 || dPitch !== 0) d.moved = true;
      dragNotes.current = d.kind === 'move' ? moveNotes(d.base, d.uids, dBeat, dPitch) : resizeNotes(d.base, d.uids, dBeat, grid);
    }
    draw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const { x, y } = contentPos(e);
    if (d.kind === 'box') {
      const small = Math.abs(x - d.x0) < 4 && Math.abs(y - d.y0) < 4;
      if (small) {
        // Click on empty space: add a note there.
        const start = Math.max(0, Math.floor(beatAt(x) / grid) * grid);
        const pitch = Math.max(BOTTOM, Math.min(TOP, pitchAt(y)));
        const uid = nextUid(doc.notes);
        setNotes([...doc.notes, { uid, pitch, start, dur: newLen, hand: newHand, velocity: 78 }]);
        setSelected(new Set([uid]));
        audition(pitch);
      } else {
        const uids = notesInBox(doc.notes, beatAt(d.x0), beatAt(x), pitchAt(d.y0), pitchAt(y));
        setSelected(new Set([...(d.additive ? selected : []), ...uids]));
      }
    } else if (d.moved && dragNotes.current) {
      setNotes(dragNotes.current);
      if (d.uids.size === 1) {
        const n = dragNotes.current.find((m) => d.uids.has(m.uid));
        if (n && d.kind === 'move') audition(n.pitch);
      }
    }
    dragNotes.current = null;
    draw();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const wrap = wrapRef.current!;
    const r = wrap.getBoundingClientRect();
    const h = hit(e.clientX - r.left + wrap.scrollLeft, e.clientY - r.top + wrap.scrollTop);
    if (h) {
      setNotes(deleteNotes(doc.notes, new Set([h.note.uid])));
      setSelected(new Set());
    }
  };

  /* ---------------------------------------------------------------- keyboard */

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(doc.notes.map((n) => n.uid)));
      return;
    }
    if (e.key === 'Escape') {
      setSelected(new Set());
      return;
    }
    if (!selected.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setNotes(deleteNotes(doc.notes, selected));
      setSelected(new Set());
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (e.shiftKey ? 12 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      setNotes(moveNotes(doc.notes, selected, 0, step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setNotes(moveNotes(doc.notes, selected, e.key === 'ArrowRight' ? grid : -grid, 0));
    } else if (e.key.toLowerCase() === 'h') {
      setNotes(toggleHands(doc.notes, selected));
    }
  };

  /* ---------------------------------------------------------------- playback */

  const stopPlay = useCallback(() => playRef.current?.stop(), []);
  const play = async () => {
    if (playRef.current) {
      stopPlay();
      return;
    }
    await resumeAudio();
    await piano.load();
    const fromBeat = selected.size ? Math.min(...doc.notes.filter((n) => selected.has(n.uid)).map((n) => n.start)) : 0;
    const bps = doc.bpm / 60;
    const t0 = performance.now() + 120;
    for (const n of doc.notes) {
      if (n.start < fromBeat - 1e-6) continue;
      piano.noteOn(n.pitch, n.velocity, { when: perfToAudio(t0 + ((n.start - fromBeat) / bps) * 1000), duration: n.dur / bps, bus: 'accomp' });
    }
    const end = lastEnd;
    let raf = 0;
    const beat = () => fromBeat + ((performance.now() - t0) / 1000) * bps;
    const tick = () => {
      const b = beat();
      scoreRef.current?.setBeat(b);
      const wrap = wrapRef.current;
      if (wrap) {
        const x = KEY_W + b * ppb;
        if (x > wrap.scrollLeft + wrap.clientWidth * 0.8) wrap.scrollLeft = x - wrap.clientWidth * 0.3;
      }
      draw();
      if (b > end + 0.5) playRef.current?.stop();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    playRef.current = {
      beat,
      stop: () => {
        cancelAnimationFrame(raf);
        piano.stopAll('accomp');
        playRef.current = null;
        setPlaying(false);
        setTick((t) => t + 1);
      },
    };
    setPlaying(true);
  };
  useEffect(() => () => playRef.current?.stop(), []);

  const save = () => {
    stopPlay();
    const title = isBuiltin && doc.title === song.title ? `${doc.title} (my version)` : doc.title;
    onSave(songFromDoc({ ...doc, title }, base));
    setDirty(false);
  };

  const cancel = () => {
    if (dirty && !window.confirm('Discard your changes?')) return;
    stopPlay();
    onCancel();
  };

  const sel = selected.size;
  return (
    <div className="editor">
      <div className="editor-head">
        <button className="btn ghost" onClick={cancel}>
          ← Back
        </button>
        <input
          className="title-field"
          value={doc.title}
          onChange={(e) => {
            setDoc({ ...doc, title: e.target.value });
            setDirty(true);
          }}
          aria-label="Title"
        />
        <span className="spacer" />
        <ExportMenu song={preview} />
        <button className="btn primary" onClick={save} disabled={!dirty && !isBuiltin}>
          {isBuiltin ? 'Save as my version' : 'Save'}
        </button>
      </div>

      <div className="toolbar editor-tools">
        <button className="btn" onClick={() => void play()}>
          {playing ? '■ Stop' : sel ? '▶ Play from selection' : '▶ Play'}
        </button>
        <button className="btn" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="btn" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Y)">
          ↷
        </button>
        <div className="group">
          <span className="label">New notes</span>
          <select value={newLen} onChange={(e) => setNewLen(Number(e.target.value))} title="Length of new notes">
            <option value={4}>whole</option>
            <option value={2}>half</option>
            <option value={1}>quarter</option>
            <option value={0.5}>eighth</option>
            <option value={0.25}>16th</option>
          </select>
          <button className={`seg ${newHand === 'L' ? 'on l' : ''}`} onClick={() => setNewHand('L')}>
            Left
          </button>
          <button className={`seg ${newHand === 'R' ? 'on r' : ''}`} onClick={() => setNewHand('R')}>
            Right
          </button>
        </div>
        <div className="group">
          <span className="label">Snap</span>
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
            <option value={1}>beat</option>
            <option value={0.5}>1/8</option>
            <option value={0.25}>1/16</option>
            <option value={1 / 3}>triplet</option>
          </select>
        </div>
        <div className="group">
          <span className="label">Zoom</span>
          <input type="range" min={24} max={160} value={ppb} onChange={(e) => setPpb(Number(e.target.value))} />
        </div>
        <div className="group">
          <span className="label">Tempo</span>
          <input
            type="number"
            className="num"
            min={20}
            max={300}
            value={doc.bpm}
            onChange={(e) => commit({ ...doc, bpm: Number(e.target.value) || doc.bpm })}
          />
        </div>
        <div className="group">
          <span className="label">Time</span>
          <select
            value={doc.timeSig.join('/')}
            onChange={(e) => commit({ ...doc, timeSig: e.target.value.split('/').map(Number) as [number, number] })}
          >
            {TIME_SIGS.map((t) => (
              <option key={t.join('/')}>{t.join('/')}</option>
            ))}
          </select>
        </div>
        <div className="group">
          <span className="label">Key</span>
          <select value={doc.keyFifths} onChange={(e) => commit({ ...doc, keyFifths: Number(e.target.value) })}>
            {Array.from({ length: 13 }, (_, i) => i - 6).map((f) => (
              <option key={f} value={f}>
                {keyNames(f)}
              </option>
            ))}
          </select>
        </div>
        {sel > 0 && (
          <>
            <span className="muted small">{sel} selected</span>
            <button className="btn" onClick={() => setNotes(toggleHands(doc.notes, selected))} title="Switch hand (H)">
              ⇄ Hand
            </button>
            <button
              className="btn"
              onClick={() => {
                setNotes(deleteNotes(doc.notes, selected));
                setSelected(new Set());
              }}
              title="Delete (Del)"
            >
              ✕ Delete
            </button>
          </>
        )}
      </div>

      <ScoreView ref={scoreRef} song={preview} heat={null} loop={null} showPlayhead={playing} fingering={settings.fingering} />

      <div
        className="roll-wrap"
        ref={wrapRef}
        tabIndex={0}
        onScroll={draw}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <div style={{ width: fullW, height: fullH, position: 'relative' }}>
          <canvas ref={canvasRef} className="roll-canvas" />
        </div>
      </div>
      <p className="muted small editor-help">
        Click empty space to add a note · drag a note to move it, its right edge to change its length · drag across empty space to
        select several · Del deletes · ↑↓ move a half step (Shift: octave) · ←→ move in time · H switches hand · Ctrl+Z / Ctrl+Y undo
        and redo · click the keyboard to hear a pitch.
      </p>
    </div>
  );
}
