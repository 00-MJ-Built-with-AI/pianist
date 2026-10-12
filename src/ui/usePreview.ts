import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { perfToAudio, resumeAudio } from '../audio/audio';
import { piano } from '../audio/piano';
import type { Song } from '../music/types';
import type { ScoreHandle } from './ScoreView';

/** Plays a song with the piano sound while its score scrolls along. */
export function useSongPreview(scoreRef: RefObject<ScoreHandle | null>) {
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => stopRef.current?.(), []);

  const toggle = useCallback(
    async (song: Song) => {
      if (stopRef.current) {
        stopRef.current();
        return;
      }
      await resumeAudio();
      await piano.load();
      const startPerf = performance.now() + 150;
      const bps = song.bpm / 60;
      for (const n of song.notes) {
        piano.noteOn(n.pitch, n.velocity, { when: perfToAudio(startPerf + (n.start / bps) * 1000), duration: n.dur / bps, bus: 'accomp' });
      }
      setPlaying(true);
      let raf = 0;
      const tick = () => {
        const beat = ((performance.now() - startPerf) / 1000) * bps;
        scoreRef.current?.setBeat(beat);
        if (beat > song.totalBeats) stopRef.current?.();
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        piano.stopAll('accomp');
        setPlaying(false);
        stopRef.current = null;
      };
    },
    [scoreRef],
  );

  useEffect(() => () => stopRef.current?.(), []);
  return { playing, toggle, stop };
}
