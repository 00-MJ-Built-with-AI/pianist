import { spell } from './pitch';
import type { Hand, Song } from './types';

/** Divisions per quarter note. The generated score is quantized to a sixteenth-note grid. */
export const DIVISIONS = 4;

const NOTE_TYPES: Array<[units: number, type: string, dots: number]> = [
  [16, 'whole', 0],
  [12, 'half', 1],
  [8, 'half', 0],
  [6, 'quarter', 1],
  [4, 'quarter', 0],
  [3, 'eighth', 1],
  [2, 'eighth', 0],
  [1, '16th', 0],
];

function decompose(units: number): Array<[number, string, number]> {
  const parts: Array<[number, string, number]> = [];
  let left = units;
  while (left > 0) {
    const t = NOTE_TYPES.find(([u]) => u <= left)!;
    parts.push(t);
    left -= t[0];
  }
  return parts;
}

interface ChordEvent {
  start: number; // units
  end: number;
  pitches: number[];
}

interface Piece extends ChordEvent {
  tieFrom: boolean;
  tieTo: boolean;
}

/** Turns one hand's notes into a single-voice chord sequence (later onsets cut earlier chords short). */
function chordEvents(song: Song, hand: Hand): ChordEvent[] {
  const groups = new Map<number, { pitches: Set<number>; end: number }>();
  for (const n of song.notes) {
    if (n.hand !== hand) continue;
    const start = Math.round(n.start * DIVISIONS);
    const end = Math.max(start + 1, Math.round((n.start + n.dur) * DIVISIONS));
    const g = groups.get(start);
    if (g) {
      g.pitches.add(n.pitch);
      g.end = Math.max(g.end, end);
    } else {
      groups.set(start, { pitches: new Set([n.pitch]), end });
    }
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);
  return starts.map((start, i) => {
    const g = groups.get(start)!;
    const next = starts[i + 1] ?? Infinity;
    return { start, end: Math.min(g.end, next), pitches: [...g.pitches].sort((a, b) => a - b) };
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function songToMusicXml(song: Song): string {
  const bars = song.measures.map((m) => ({
    start: Math.round(m.start * DIVISIONS),
    end: Math.round((m.start + m.length) * DIVISIONS),
    number: m.number,
  }));

  const piecesByStaff = (['R', 'L'] as Hand[]).map((hand) => {
    const perBar: Piece[][] = bars.map(() => []);
    let bi = 0;
    for (const ev of chordEvents(song, hand)) {
      while (bi < bars.length - 1 && bars[bi].end <= ev.start) bi++;
      let s = ev.start;
      let b = bi;
      while (s < ev.end && b < bars.length) {
        const e = Math.min(ev.end, bars[b].end);
        perBar[b].push({ start: s, end: e, pitches: ev.pitches, tieFrom: s > ev.start, tieTo: e < ev.end });
        s = e;
        b++;
      }
    }
    return perBar;
  });

  const dynamicsByStaff = (['R', 'L'] as Hand[]).map((hand) =>
    song.dynamics
      .filter((d) => d.hand === hand)
      .map((d) => ({ unit: Math.round(d.beat * DIVISIONS), mark: d.mark })),
  );

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(song.title)}</work-title></work>`);
  out.push(`<identification><creator type="composer">${esc(song.composer)}</creator></identification>`);
  out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  out.push('<part id="P1">');

  bars.forEach((bar, bi) => {
    const implicit = bar.number === 0 ? ' implicit="yes"' : '';
    out.push(`<measure number="${bar.number}"${implicit}>`);
    if (bi === 0) {
      out.push(
        `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${song.keyFifths}</fifths></key>` +
          `<time><beats>${song.timeSig[0]}</beats><beat-type>${song.timeSig[1]}</beat-type></time>` +
          '<staves>2</staves>' +
          '<clef number="1"><sign>G</sign><line>2</line></clef>' +
          '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>',
      );
      out.push(
        '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>' +
          `<per-minute>${Math.round(song.bpm)}</per-minute></metronome></direction-type>` +
          `<sound tempo="${Math.round(song.bpm)}"/></direction>`,
      );
    }
    [0, 1].forEach((si) => {
      const staff = si + 1;
      const voice = si === 0 ? 1 : 5;
      if (si === 1) out.push(`<backup><duration>${bar.end - bar.start}</duration></backup>`);
      const pieces = piecesByStaff[si][bi];
      const marks = dynamicsByStaff[si].filter((d) => d.unit >= bar.start && d.unit < bar.end);
      const emitMarks = (upTo: number) => {
        while (marks.length && marks[0].unit <= upTo) {
          const d = marks.shift()!;
          out.push(
            `<direction placement="below"><direction-type><dynamics><${d.mark}/></dynamics></direction-type>` +
              `<staff>${staff}</staff></direction>`,
          );
        }
      };
      const rest = (units: number, measureRest: boolean) => {
        if (measureRest) {
          out.push(
            `<note><rest measure="yes"/><duration>${units}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`,
          );
          return;
        }
        for (const [u, type, dots] of decompose(units)) {
          out.push(
            `<note><rest/><duration>${u}</duration><voice>${voice}</voice><type>${type}</type>` +
              `${'<dot/>'.repeat(dots)}<staff>${staff}</staff></note>`,
          );
        }
      };
      if (pieces.length === 0) {
        emitMarks(bar.end);
        rest(bar.end - bar.start, true);
        return;
      }
      let cursor = bar.start;
      for (const p of pieces) {
        if (p.start > cursor) {
          emitMarks(cursor);
          rest(p.start - cursor, false);
          cursor = p.start;
        }
        emitMarks(p.start);
        const parts = decompose(p.end - p.start);
        parts.forEach(([u, type, dots], k) => {
          const tieStop = k > 0 || p.tieFrom;
          const tieStart = k < parts.length - 1 || p.tieTo;
          p.pitches.forEach((pitch, ci) => {
            const sp = spell(pitch, song.keyFifths);
            const alter = sp.alter ? `<alter>${sp.alter}</alter>` : '';
            const ties = (tieStop ? '<tie type="stop"/>' : '') + (tieStart ? '<tie type="start"/>' : '');
            const tied = (tieStop ? '<tied type="stop"/>' : '') + (tieStart ? '<tied type="start"/>' : '');
            out.push(
              `<note>${ci > 0 ? '<chord/>' : ''}<pitch><step>${sp.step}</step>${alter}<octave>${sp.octave}</octave></pitch>` +
                `<duration>${u}</duration>${ties}<voice>${voice}</voice><type>${type}</type>${'<dot/>'.repeat(dots)}` +
                `<staff>${staff}</staff>${tied ? `<notations>${tied}</notations>` : ''}</note>`,
            );
          });
        });
        cursor = p.end;
      }
      if (cursor < bar.end) {
        emitMarks(cursor);
        rest(bar.end - cursor, false);
      }
      emitMarks(bar.end);
    });
    if (bi === bars.length - 1) {
      out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    }
    out.push('</measure>');
  });

  out.push('</part>');
  out.push('</score-partwise>');
  return out.join('\n');
}
