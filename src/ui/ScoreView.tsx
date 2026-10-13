import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { suggestFingering } from '../music/fingering';
import { songToMusicXml } from '../music/musicxml';
import { noteLabel, pitchName } from '../music/pitch';
import { measureIndexAt } from '../music/song';
import type { Song } from '../music/types';
import { useSettings } from '../store/settings';

/** A mistake to show on the sheet music. */
export interface ScoreMark {
  beat: number;
  pitch: number;
  kind: 'missed' | 'off' | 'wrong'; // off = early or late
}

export interface ScoreHandle {
  setBeat(beat: number): void;
  setMarks(marks: ScoreMark[]): void;
}

interface Props {
  song: Song;
  heat: Array<{ index: number; score: number | null }> | null;
  loop: { from: number; to: number } | null;
  onMeasureClick?: (index: number, shift: boolean) => void;
  showPlayhead: boolean;
  /** Show finger numbers: suggested ones for generated scores, the file's own for imported MusicXML. */
  fingering?: boolean;
}

/** A bar's rectangle on the rendered sheet (pixels). */
interface Box {
  x: number;
  w: number;
  y: number;
  h: number;
}

/** Cursor positions: where each beat sits on the sheet. */
interface BeatMap {
  beats: number[];
  xs: number[];
  ys: number[]; // top of the system
  hs: number[]; // height of the system
}

const ANCHOR = 0.28; // line view: playhead position as a fraction of the strip width
const UNIT_PX = 10; // OSMD units → pixels at zoom 1
const INK: Record<string, string> = { dark: '#e8e4da', light: '#1d1f24', contrast: '#ffffff' };

const noteKey = (beat: number, pitch: number) => `${Math.round(beat * 48)}|${pitch}`;

function heatColor(score: number): string {
  if (score >= 0.9) return '56,201,138';
  if (score >= 0.7) return '255,184,77';
  return '255,93,108';
}

/**
 * Real notation that follows the playhead: either one long line scrolling sideways, or whole
 * pages that scroll down as the music moves to the next system.
 */
export const ScoreView = forwardRef<ScoreHandle, Props>(function ScoreView(
  { song, heat, loop, onMeasureClick, showPlayhead, fingering = false },
  ref,
) {
  const settings = useSettings();
  const zoom = settings.scoreZoom;
  const page = settings.scoreLayout === 'page';
  const ink = INK[settings.theme] ?? INK.dark;

  // Imported MusicXML keeps its engraving (and its own fingering); generated scores get suggestions.
  const xml = useMemo(
    () => (fingering && song.source !== 'musicxml' ? songToMusicXml(song, { fingering: suggestFingering(song) }) : song.scoreXml),
    [song, fingering],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<BeatMap>({ beats: [0], xs: [0], ys: [0], hs: [0] });
  const notePos = useRef(new Map<string, { x: number; y: number }>());
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [marks, setMarksState] = useState<ScoreMark[]>([]);
  // Every notehead, for note names on the sheet.
  const [heads, setHeads] = useState<Array<{ x: number; y: number; pitch: number }>>([]);
  const [width, setWidth] = useState(0);
  const marksSig = useRef('');
  const last = useRef({ x: NaN, y: NaN });

  // Page view re-flows when the strip gets noticeably wider or narrower.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !page) return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setWidth((w) => (Math.abs(w - host.clientWidth) > 40 ? host.clientWidth : w)), 250);
    });
    ro.observe(host);
    setWidth(host.clientWidth);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [page]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !xml || (page && !width)) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    el.innerHTML = '';
    el.style.width = page ? `${width - 4}px` : '';
    const osmd = new OpenSheetMusicDisplay(el, {
      autoResize: false,
      backend: 'svg',
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMetronomeMarks: false,
      renderSingleHorizontalStaffline: !page,
      autoBeam: true,
      defaultColorMusic: ink,
      followCursor: false,
      drawFingerings: fingering,
    });
    (async () => {
      try {
        await osmd.load(xml);
        if (cancelled) return;
        osmd.zoom = zoom;
        osmd.render();
        const scale = UNIT_PX * zoom;

        // Where every notehead is, so mistakes can be marked on it.
        const pos = new Map<string, { x: number; y: number }>();
        for (const staves of osmd.GraphicSheet.MeasureList) {
          for (const gm of staves) {
            if (!gm) continue;
            for (const se of gm.staffEntries) {
              for (const gve of se.graphicalVoiceEntries) {
                for (const gn of gve.notes) {
                  const n = gn.sourceNote;
                  if (!n || n.isRest() || (n.NoteTie && n.NoteTie.StartNote !== n)) continue;
                  const at = gn.PositionAndShape.AbsolutePosition;
                  pos.set(noteKey(n.getAbsoluteTimestamp().RealValue * 4, n.halfTone + 12), { x: at.x * scale, y: at.y * scale });
                }
              }
            }
          }
        }
        notePos.current = pos;
        setHeads([...pos].map(([key, at]) => ({ ...at, pitch: Number(key.split('|')[1]) })));

        // Bar boxes (index = bar index of the song), spanning all staves of the system.
        const bx: Box[] = [];
        for (const staves of osmd.GraphicSheet.MeasureList) {
          const present = staves.filter((m) => m);
          if (!present.length) {
            bx.push({ x: 0, w: 0, y: 0, h: 0 });
            continue;
          }
          const ps = present[0].PositionAndShape;
          const top = Math.min(...present.map((m) => m.PositionAndShape.AbsolutePosition.y)) * scale;
          const bottom = Math.max(...present.map((m) => m.PositionAndShape.AbsolutePosition.y + 4)) * scale;
          bx.push({ x: ps.AbsolutePosition.x * scale, w: ps.Size.width * scale, y: top - 18, h: bottom - top + 36 });
        }

        // Beat → position from the cursor.
        const map: BeatMap = { beats: [], xs: [], ys: [], hs: [] };
        const cursor = osmd.cursor;
        cursor.show();
        cursor.reset();
        let guard = 0;
        while (!cursor.Iterator.EndReached && guard++ < 20000) {
          const beat = cursor.Iterator.currentTimeStamp.RealValue * 4;
          const st = cursor.cursorElement.style;
          const x = parseFloat(st.left);
          if (Number.isFinite(x) && (!map.beats.length || beat > map.beats[map.beats.length - 1] + 1e-6)) {
            map.beats.push(beat);
            map.xs.push(x + 6);
            map.ys.push(parseFloat(st.top) || 0);
            map.hs.push(parseFloat(st.height) || 120);
          } else if (map.beats.length && beat < map.beats[map.beats.length - 1]) {
            break; // a repeat jumped back; follow the score only once
          }
          cursor.next();
        }
        cursor.hide();
        const lastBox = bx[bx.length - 1];
        if (lastBox && map.beats.length) {
          map.beats.push(song.totalBeats);
          map.xs.push(lastBox.x + lastBox.w);
          map.ys.push(map.ys[map.ys.length - 1]);
          map.hs.push(map.hs[map.hs.length - 1]);
        }
        if (!map.beats.length) Object.assign(map, { beats: [0], xs: [0], ys: [0], hs: [120] });
        mapRef.current = map;
        last.current = { x: NaN, y: NaN };
        const svg = el.querySelector('svg');
        if (svg && hostRef.current && !page) {
          const h = svg.getBoundingClientRect().height;
          hostRef.current.style.height = `${Math.min(320, Math.max(150, Math.ceil(h) + 10))}px`;
        } else if (hostRef.current && page) {
          hostRef.current.style.height = '';
          hostRef.current.scrollTop = 0;
        }
        if (innerRef.current) innerRef.current.style.transform = '';
        setBoxes(bx);
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      try {
        osmd.clear();
      } catch {
        // already cleared
      }
    };
  }, [xml, song.totalBeats, fingering, zoom, page, width, ink]);

  /** Position of a beat on the sheet. */
  const locate = (beat: number) => {
    const { beats, xs, ys, hs } = mapRef.current;
    if (beat <= beats[0]) return { x: xs[0] - (beats[0] - beat) * 30, y: ys[0], h: hs[0] };
    if (beat >= beats[beats.length - 1]) return { x: xs[xs.length - 1], y: ys[ys.length - 1], h: hs[hs.length - 1] };
    let lo = 0;
    let hi = beats.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= beat) lo = mid;
      else hi = mid;
    }
    // Glide within a system; at the end of a line, wait there until the next one starts.
    const sameLine = Math.abs(ys[hi] - ys[lo]) < 2;
    const k = (beat - beats[lo]) / (beats[hi] - beats[lo]);
    return { x: sameLine ? xs[lo] + (xs[hi] - xs[lo]) * k : xs[lo], y: ys[lo], h: hs[lo] };
  };

  useImperativeHandle(
    ref,
    () => ({
      setBeat(beat: number) {
        const inner = innerRef.current;
        const host = hostRef.current;
        if (!inner || !host) return;
        const p = locate(beat);
        if (Math.abs(p.x - last.current.x) < 0.25 && p.y === last.current.y) return;
        const newLine = p.y !== last.current.y;
        last.current = { x: p.x, y: p.y };
        if (!page) {
          inner.style.transform = `translateX(${Math.round(host.clientWidth * ANCHOR - p.x)}px)`;
          return;
        }
        const head = headRef.current;
        if (head) {
          head.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
          head.style.height = `${Math.round(p.h)}px`;
        }
        // Keep the current system in view, turning to the next one smoothly.
        if (newLine && (p.y < host.scrollTop + 10 || p.y + p.h > host.scrollTop + host.clientHeight - 10)) {
          host.scrollTo({ top: Math.max(0, p.y - 24), behavior: 'smooth' });
        }
      },
      setMarks(next: ScoreMark[]) {
        const sig = next.map((m) => `${m.kind}${m.beat}:${m.pitch}`).join(',');
        if (sig === marksSig.current) return;
        marksSig.current = sig;
        setMarksState(next);
      },
    }),
    [page],
  );

  const onClick = (e: React.MouseEvent) => {
    if (!onMeasureClick || !innerRef.current) return;
    const r = innerRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const i = boxes.findIndex((b) => x >= b.x && x < b.x + b.w && (!page || (y >= b.y && y < b.y + b.h)));
    if (i >= 0) onMeasureClick(i, e.shiftKey);
  };

  const loopBoxes = loop ? boxes.slice(loop.from, loop.to + 1).filter((b) => b.w > 0) : [];

  return (
    <div className={`score ${page ? 'page' : ''}`} ref={hostRef}>
      {error && <div className="score-msg">Couldn't draw this score: {error}</div>}
      {!ready && !error && <div className="score-msg">Engraving…</div>}
      <div className="score-inner" ref={innerRef} onClick={onClick}>
        <div ref={sheetRef} className="score-sheet" />
        {ready &&
          loopBoxes.map((b, i) => (
            // One outline per system the loop touches (a single one in line view).
            <div key={i} className="score-loop" style={{ left: b.x, width: b.w, top: b.y, height: b.h }} />
          ))}
        {ready &&
          heat?.map((h) =>
            h.score === null || !boxes[h.index] ? null : (
              <div
                key={h.index}
                className="score-heat"
                title={`Bar ${song.measures[h.index]?.number}: ${Math.round(h.score * 100)}%`}
                style={{
                  left: boxes[h.index].x,
                  width: boxes[h.index].w,
                  top: boxes[h.index].y,
                  height: boxes[h.index].h,
                  background: `rgba(${heatColor(h.score)},0.16)`,
                  borderBottom: `4px solid rgba(${heatColor(h.score)},0.9)`,
                }}
              />
            ),
          )}
        {ready &&
          marks.map((m, i) => {
            if (m.kind === 'wrong') {
              const p = locate(m.beat);
              const box = boxes[measureIndexAt(song.measures, m.beat)];
              return (
                <div
                  key={`w${i}`}
                  className="score-mark wrong"
                  style={{ left: p.x - 6, top: (box?.y ?? p.y) - 2 }}
                  title={`Wrong note: ${pitchName(m.pitch)}`}
                >
                  ✕
                </div>
              );
            }
            const p = notePos.current.get(noteKey(m.beat, m.pitch));
            if (!p) return null;
            return (
              <div
                key={`n${i}`}
                className={`score-mark ${m.kind}`}
                style={{ left: p.x, top: p.y + 4 }}
                title={m.kind === 'missed' ? `Missed ${pitchName(m.pitch)}` : `${pitchName(m.pitch)}: early or late`}
              />
            );
          })}
        {ready &&
          settings.sheetLetters &&
          heads.map((h, i) => (
            <span key={`l${i}`} className="score-letter" style={{ left: h.x + 7 * zoom, top: h.y + 4, fontSize: Math.round(10 * zoom + 1) }}>
              {noteLabel(h.pitch, settings.nameStyle === 'octave' ? 'letter' : settings.nameStyle, song.keyFifths < 0)}
            </span>
          ))}
        {page && showPlayhead && ready && <div className="score-playhead page-head" ref={headRef} />}
      </div>
      {!page && showPlayhead && <div className="score-playhead" style={{ left: `${ANCHOR * 100}%` }} />}
    </div>
  );
});
