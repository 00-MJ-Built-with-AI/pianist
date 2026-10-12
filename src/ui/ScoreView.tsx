import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { suggestFingering } from '../music/fingering';
import { songToMusicXml } from '../music/musicxml';
import { pitchName } from '../music/pitch';
import type { Song } from '../music/types';

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

const noteKey = (beat: number, pitch: number) => `${Math.round(beat * 48)}|${pitch}`;

interface Box {
  x: number;
  w: number;
}

const ANCHOR = 0.28; // playhead position as a fraction of the strip width
const UNIT_PX = 10; // OSMD units → pixels at zoom 1
const ZOOM = 0.85;

function heatColor(score: number): string {
  if (score >= 0.9) return '56,201,138';
  if (score >= 0.7) return '255,184,77';
  return '255,93,108';
}

/** One long line of real notation that scrolls under a fixed playhead. */
export const ScoreView = forwardRef<ScoreHandle, Props>(function ScoreView(
  { song, heat, loop, onMeasureClick, showPlayhead, fingering = false },
  ref,
) {
  // Imported MusicXML keeps its engraving (and its own fingering); generated scores get suggestions.
  const xml = useMemo(
    () => (fingering && song.source !== 'musicxml' ? songToMusicXml(song, { fingering: suggestFingering(song) }) : song.scoreXml),
    [song, fingering],
  );
  const notePos = useRef(new Map<string, { x: number; y: number }>());
  const [marks, setMarksState] = useState<ScoreMark[]>([]);
  const marksSig = useRef('');
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ beats: number[]; xs: number[] }>({ beats: [0], xs: [0] });
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [band, setBand] = useState<{ top: number; height: number }>({ top: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const lastX = useRef(NaN);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !xml) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    el.innerHTML = '';
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
      renderSingleHorizontalStaffline: true,
      autoBeam: true,
      defaultColorMusic: '#e8e4da',
      followCursor: false,
      drawFingerings: fingering,
    });
    (async () => {
      try {
        await osmd.load(xml);
        if (cancelled) return;
        osmd.zoom = ZOOM;
        osmd.render();
        const scale = UNIT_PX * ZOOM;

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

        // Measure boxes (index = bar index of the song)
        const list = osmd.GraphicSheet.MeasureList;
        const bx: Box[] = [];
        let top = Infinity;
        let bottom = -Infinity;
        for (const staves of list) {
          const gm = staves.find((m) => m);
          if (!gm) {
            bx.push({ x: 0, w: 0 });
            continue;
          }
          const ps = gm.PositionAndShape;
          bx.push({ x: ps.AbsolutePosition.x * scale, w: ps.Size.width * scale });
          for (const m of staves) {
            if (!m) continue;
            top = Math.min(top, m.PositionAndShape.AbsolutePosition.y * scale);
            bottom = Math.max(bottom, (m.PositionAndShape.AbsolutePosition.y + 4) * scale);
          }
        }

        // Beat → x from the cursor positions
        const beats: number[] = [];
        const xs: number[] = [];
        const cursor = osmd.cursor;
        cursor.show();
        cursor.reset();
        let guard = 0;
        while (!cursor.Iterator.EndReached && guard++ < 20000) {
          const beat = cursor.Iterator.currentTimeStamp.RealValue * 4;
          const x = parseFloat(cursor.cursorElement.style.left);
          if (Number.isFinite(x) && (!beats.length || beat > beats[beats.length - 1] + 1e-6)) {
            beats.push(beat);
            xs.push(x + 6);
          } else if (beats.length && beat < beats[beats.length - 1]) {
            break; // a repeat jumped back; follow the score only once
          }
          cursor.next();
        }
        cursor.hide();
        const lastBox = bx[bx.length - 1];
        if (lastBox) {
          beats.push(song.totalBeats);
          xs.push(lastBox.x + lastBox.w);
        }
        if (!beats.length) {
          beats.push(0);
          xs.push(0);
        }
        mapRef.current = { beats, xs };
        lastX.current = NaN;
        const svg = el.querySelector('svg');
        if (svg && hostRef.current) {
          const h = svg.getBoundingClientRect().height;
          hostRef.current.style.height = `${Math.min(260, Math.max(150, Math.ceil(h) + 10))}px`;
        }
        setBoxes(bx);
        setBand(Number.isFinite(top) ? { top: top - 18, height: bottom - top + 36 } : { top: 0, height: 0 });
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
  }, [xml, song.totalBeats, fingering]);

  useImperativeHandle(
    ref,
    () => ({
      setBeat(beat: number) {
        const inner = innerRef.current;
        const host = hostRef.current;
        if (!inner || !host) return;
        const { beats, xs } = mapRef.current;
        let x: number;
        if (beat <= beats[0]) x = xs[0] - (beats[0] - beat) * 30;
        else if (beat >= beats[beats.length - 1]) x = xs[xs.length - 1];
        else {
          let lo = 0;
          let hi = beats.length - 1;
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (beats[mid] <= beat) lo = mid;
            else hi = mid;
          }
          const k = (beat - beats[lo]) / (beats[hi] - beats[lo]);
          x = xs[lo] + (xs[hi] - xs[lo]) * k;
        }
        if (Math.abs(x - lastX.current) < 0.25) return;
        lastX.current = x;
        inner.style.transform = `translateX(${Math.round(host.clientWidth * ANCHOR - x)}px)`;
      },
      setMarks(next: ScoreMark[]) {
        const sig = next.map((m) => `${m.kind}${m.beat}:${m.pitch}`).join(',');
        if (sig === marksSig.current) return;
        marksSig.current = sig;
        setMarksState(next);
      },
    }),
    [],
  );

  // x of a beat on the strip (for wrong notes, which have no notehead of their own).
  const xOfBeat = (beat: number) => {
    const { beats, xs } = mapRef.current;
    let i = 0;
    while (i < beats.length - 1 && beats[i + 1] <= beat) i++;
    return xs[i] - 6;
  };

  const onClick = (e: React.MouseEvent) => {
    if (!onMeasureClick || !innerRef.current) return;
    const x = e.clientX - innerRef.current.getBoundingClientRect().left;
    const i = boxes.findIndex((b) => x >= b.x && x < b.x + b.w);
    if (i >= 0) onMeasureClick(i, e.shiftKey);
  };

  return (
    <div className="score" ref={hostRef}>
      {error && <div className="score-msg">Couldn't draw this score: {error}</div>}
      {!ready && !error && <div className="score-msg">Engraving…</div>}
      <div className="score-inner" ref={innerRef} onClick={onClick}>
        <div ref={sheetRef} className="score-sheet" />
        {ready && loop && boxes[loop.from] && boxes[loop.to] && (
          <div
            className="score-loop"
            style={{
              left: boxes[loop.from].x,
              width: boxes[loop.to].x + boxes[loop.to].w - boxes[loop.from].x,
              top: band.top,
              height: band.height,
            }}
          />
        )}
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
                  top: band.top,
                  height: band.height,
                  background: `rgba(${heatColor(h.score)},0.16)`,
                  borderBottom: `4px solid rgba(${heatColor(h.score)},0.9)`,
                }}
              />
            ),
          )}
        {ready &&
          marks.map((m, i) => {
            if (m.kind === 'wrong') {
              return (
                <div key={`w${i}`} className="score-mark wrong" style={{ left: xOfBeat(m.beat), top: band.top - 2 }} title={`Wrong note: ${pitchName(m.pitch)}`}>
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
      </div>
      {showPlayhead && <div className="score-playhead" style={{ left: `${ANCHOR * 100}%` }} />}
    </div>
  );
});
