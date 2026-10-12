import { Midi } from '@tonejs/midi';
import { songToMusicXml } from './musicxml';
import type { Song } from './types';

/** A standard MIDI file with one track per hand, the tempo and the time signature. */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi();
  midi.name = song.title;
  midi.header.setTempo(song.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [song.timeSig[0], song.timeSig[1]], measures: 0 });
  midi.header.update();
  const ppq = midi.header.ppq;
  for (const hand of ['R', 'L'] as const) {
    const notes = song.notes.filter((n) => n.hand === hand);
    if (!notes.length) continue;
    const track = midi.addTrack();
    track.name = hand === 'R' ? 'Right hand' : 'Left hand';
    track.channel = 0;
    for (const n of notes) {
      track.addNote({
        midi: n.pitch,
        ticks: Math.round(n.start * ppq),
        durationTicks: Math.max(1, Math.round(n.dur * ppq)),
        velocity: Math.max(1, Math.min(127, n.velocity)) / 127,
      });
    }
  }
  return midi.toArray();
}

/** The MusicXML to export: the imported original when there is one, otherwise the generated score. */
export function songToExportXml(song: Song): { data: string | Uint8Array; ext: 'musicxml' | 'mxl' } {
  const xml = song.scoreXml ?? songToMusicXml(song);
  if (xml.startsWith('PK')) {
    // Compressed MusicXML kept as a binary string.
    const bytes = new Uint8Array(xml.length);
    for (let i = 0; i < xml.length; i++) bytes[i] = xml.charCodeAt(i) & 0xff;
    return { data: bytes, ext: 'mxl' };
  }
  return { data: xml, ext: 'musicxml' };
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'song';
}

export function downloadFile(data: string | Uint8Array, fileName: string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Opens the sheet music as printable A4 pages (the browser's print dialog can save it as a PDF).
 * Must be called from a click so the new window isn't blocked.
 */
export function printScore(song: Song): void {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
  w.document.write(`<!doctype html><title>${escapeHtml(song.title)}</title><p style="font-family:sans-serif">Preparing the score…</p>`);
  void (async () => {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;width:1100px;background:#fff';
    document.body.appendChild(host);
    try {
      const osmd = new OpenSheetMusicDisplay(host, {
        autoResize: false,
        backend: 'svg',
        pageFormat: 'A4_P',
        pageBackgroundColor: '#FFFFFF',
        defaultColorMusic: '#000000',
        drawTitle: true,
        drawComposer: true,
        drawPartNames: false,
        autoBeam: true,
      });
      await osmd.load(song.scoreXml ?? songToMusicXml(song));
      osmd.render();
      const pages = [...host.querySelectorAll('svg')].map((s) => s.outerHTML).join('');
      w.document.open();
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(song.title)}</title>` +
          '<style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}svg{display:block;width:100%;height:auto;break-after:page}</style>' +
          `</head><body>${pages}</body></html>`,
      );
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 400);
    } catch (err) {
      w.document.body.textContent = `Couldn't prepare the score: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      host.remove();
    }
  })();
}
