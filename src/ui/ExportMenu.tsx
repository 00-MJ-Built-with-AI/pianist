import { useEffect, useRef, useState } from 'react';
import { downloadFile, printScore, safeFileName, songToExportXml, songToMidi } from '../music/export';
import type { Song } from '../music/types';

/** Download the song as MusicXML or MIDI, or print it (save as PDF from the print dialog). */
export function ExportMenu({ song, disabled }: { song: Song; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const name = safeFileName(song.title);
  const run = (fn: () => void) => {
    setError(null);
    try {
      fn();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="add-list" ref={box}>
      <button className="btn" disabled={disabled} onClick={() => setOpen(!open)} title="Download or print this piece">
        ⤓ Export
      </button>
      {open && (
        <div className="list-menu" role="menu">
          <div className="list-menu-title">Export “{song.title}”</div>
          <button
            className="list-menu-new"
            onClick={() =>
              run(() => {
                const { data, ext } = songToExportXml(song);
                downloadFile(data, `${name}.${ext}`, ext === 'mxl' ? 'application/vnd.recordare.musicxml' : 'application/vnd.recordare.musicxml+xml');
              })
            }
          >
            Sheet music (MusicXML)
          </button>
          <button className="list-menu-new" onClick={() => run(() => downloadFile(songToMidi(song), `${name}.mid`, 'audio/midi'))}>
            MIDI file
          </button>
          <button className="list-menu-new" onClick={() => run(() => printScore(song))}>
            Print / save as PDF
          </button>
          {error && <div className="small error">{error}</div>}
        </div>
      )}
    </div>
  );
}
