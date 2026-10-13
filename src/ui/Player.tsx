import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioCtx, resumeAudio } from '../audio/audio';
import { metronomeClick, piano } from '../audio/piano';
import type { KeyKind } from '../engine/controllers';
import { Session, type Hud } from '../engine/session';
import { MODE_LABELS, NoteMark, type ModeKind, type Report, type SessionOptions } from '../engine/types';
import { buildFixPlan, ROUTINE_TEMPLATES, routineToSteps, stepDone, type CoachOptions, type CoachStep, type Routine } from '../engine/coach';
import { applyVariant, type Variant } from '../music/rhythm';
import { celebrate, say, sfx } from './feedback';
import { CoachDialog, myRoutines, routineForSong } from './CoachDialog';
import { micState } from '../input/mic/mic';
import { inputHub } from '../input/hub';
import type { Hand, Song } from '../music/types';
import { addPracticeTime, saveSession, updateBest } from '../store/db';
import { getSettings, loadPref, savePref, tuningOf, useSettings } from '../store/settings';
import { ExportMenu } from './ExportMenu';
import { InputBar } from './InputBar';
import type { Queue } from './Library';
import { ReportView } from './Report';
import { ScoreView, type ScoreHandle, type ScoreMark } from './ScoreView';
import { keyNames, transposeRange, transposeSong } from '../music/transpose';
import { Stage, type StageDisplay } from './stage';
import { DisplayMenu } from './DisplayMenu';
import { ModeOptionsMenu } from './ModeOptions';
import { ViewStrip } from './ViewStrip';
import { CompareTakes } from './CompareTakes';
import { addHighScore, highScores, type HighScore } from '../store/highScores';
import { updateSettings } from '../store/settings';
import { onKeyboardBase } from '../input/keyboard';

const MODES: ModeKind[] = ['learn', 'practice', 'audition', 'roll', 'listen'];

const KEEP_GOING_HELP =
  'The music keeps going at tempo, like a real performance. Play the notes as they reach the line; missed and wrong notes are marked.';

const MODE_HELP: Record<ModeKind, string> = {
  learn: 'The music waits for you. Play the highlighted keys to move on; chord notes can come in any order.',
  practice: 'Play at your own pace; the score follows you. Wrong notes are flagged and you get a bar-by-bar report.',
  audition: 'Perform it start to finish with no hints. Afterwards: accuracy, tempo, timing, dynamics and evenness.',
  roll: 'Notes fall in time. Strike them as they reach the line: Perfect, Good or Miss. Keep the combo going.',
  listen: 'Hear the piece at the chosen tempo while the score and notes scroll by.',
};

/** Settings a caller (the daily plan, exercises) can open the player with. */
export interface PlayerPreset {
  mode?: ModeKind;
  hands?: Hand[];
  rate?: number;
  loop?: { from: number; to: number } | null;
  transpose?: number;
}

type WaitMode = 'learn' | 'practice' | 'roll';
type OtherHand = 'app' | 'mute' | 'hide';

/** What each mode remembers (per piece) when "each mode remembers its setup" is on. */
interface ModeSetup {
  hands: Record<Hand, boolean>;
  otherHand: OtherHand;
  rate: number;
  metronome: boolean;
  loopOn: boolean;
  loop: { from: number; to: number };
  autoSpeed: boolean;
}

const HAND_ORDER: Hand[][] = [['R'], ['L'], ['R', 'L']];

interface Props {
  song: Song;
  queue?: Queue; // the collection being practised, in order
  preset?: PlayerPreset;
  /** An extra "next" button, e.g. a new sight-reading exercise. */
  nextAction?: { label: string; run: () => void };
  onNavigate?: (song: Song) => void;
  onEdit?: () => void;
  onExit: () => void;
  onSaved?: () => void;
  /** Every finished run's report (the mock exam collects them). */
  onReport?: (r: Report) => void;
}

export function Player({ song: baseSong, queue, preset, nextAction, onNavigate, onEdit, onExit, onSaved, onReport }: Props) {
  const settings = useSettings();
  const id = baseSong.id;
  const [transpose, setTranspose] = useState<number>(() => preset?.transpose ?? loadPref(`transpose.${id}`, 0));
  // Everything below works on the (possibly transposed) song.
  // A coach step can practise the passage in a rhythm variation (dotted, reverse dotted).
  const [variant, setVariant] = useState<Variant | null>(null);
  const variantRef = useRef<Variant | null>(null);
  const pendingLaunch = useRef<SessionOptions | null>(null);
  const song = useMemo(() => applyVariant(transposeSong(baseSong, transpose), variant), [baseSong, transpose, variant]);
  const [tMin, tMax] = useMemo(() => transposeRange(baseSong), [baseSong]);
  const [mode, setMode] = useState<ModeKind>(() => preset?.mode ?? loadPref<ModeKind>('mode', 'learn'));
  const setupKey = (m: ModeKind) => `setup.${id}.${m}`;
  const [initialSetup] = useState<ModeSetup | null>(() =>
    !preset && getSettings().rememberPerMode ? loadPref<ModeSetup | null>(setupKey(loadPref<ModeKind>('mode', 'learn')), null) : null,
  );
  const [hands, setHands] = useState<Record<Hand, boolean>>(() =>
    preset?.hands
      ? { R: preset.hands.includes('R'), L: preset.hands.includes('L') }
      : (initialSetup?.hands ?? loadPref(`hands.${id}`, { R: true, L: true })),
  );
  const [otherHand, setOtherHand] = useState<OtherHand>(() => initialSetup?.otherHand ?? loadPref<OtherHand>('otherHand', 'app'));
  const [rate, setRate] = useState<number>(() => preset?.rate ?? initialSetup?.rate ?? loadPref(`rate.${id}`, 1));
  const [metronome, setMetronome] = useState(() => initialSetup?.metronome ?? false);
  const firstBar = song.measures[0].number === 0 && song.measures.length > 1 ? 1 : 0;
  const validLoop = (l: { from: number; to: number } | undefined | null) =>
    l && l.from >= 0 && l.to < song.measures.length && l.from <= l.to ? l : null;
  const [loopOn, setLoopOn] = useState(() => !!preset?.loop || (!!initialSetup?.loopOn && !!validLoop(initialSetup.loop)));
  const [loop, setLoop] = useState(
    () => preset?.loop ?? validLoop(initialSetup?.loop) ?? { from: firstBar, to: Math.min(song.measures.length - 1, firstBar + 3) },
  );
  const [autoSpeed, setAutoSpeed] = useState(() => initialSetup?.autoSpeed ?? true);
  // Stop and fix: the bar being fixed, and the run to carry on with afterwards.
  const fixRef = useRef<{ bar: number; resume: SessionOptions } | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);
  const lastOpts = useRef<SessionOptions | null>(null);
  const rotateRef = useRef<(next: Hand[], rate: number) => void>(() => {});
  // Passes across a hands rotation, so "clean passes before speeding up" counts every hand.
  const rotationPasses = useRef<Array<{ clean: boolean; rate: number }>>([]);
  // Audition: countdown, restarts used in this audition.
  const [countdown, setCountdown] = useState<number | null>(null);
  const [audition, setAudition] = useState<{ open: boolean; restarts: number }>({ open: false, restarts: 0 });
  const [game, setGame] = useState<{ rank: number | null; scores: HighScore[] } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [startMeasure, setStartMeasure] = useState(0);
  const coachRef = useRef<{ steps: CoachStep[]; index: number; from: number; to: number } | null>(null);
  const [coach, setCoach] = useState<{ steps: CoachStep[]; index: number } | null>(null);
  const [coachDialog, setCoachDialog] = useState(false);
  const runStepRef = useRef<(index: number) => void>(() => {});
  const [waitBy, setWaitBy] = useState<Record<WaitMode, boolean>>(() => loadPref('waitBy', { learn: true, practice: true, roll: false }));
  const canWait = mode === 'learn' || mode === 'practice' || mode === 'roll';
  const wait = canWait ? waitBy[mode as WaitMode] : true;
  const [scoreOn, setScoreOn] = useState<Record<ModeKind, boolean>>(() =>
    loadPref('scoreOn', { learn: true, practice: true, audition: true, roll: false, listen: true }),
  );
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [heat, setHeat] = useState<Report['measures'] | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pianoState, setPianoState] = useState<'idle' | 'loading' | 'ready'>(piano.loaded ? 'ready' : 'idle');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const scoreRef = useRef<ScoreHandle>(null);
  const sessionRef = useRef<Session | null>(null);
  // On-screen keys: one pitch per finger / pointer, so chords work on touch screens.
  const pointerPitch = useRef(new Map<number, number>());

  const queueIndex = queue ? queue.songs.findIndex((s) => s.id === song.id) : -1;
  const prevSong = queue && queueIndex > 0 ? queue.songs[queueIndex - 1] : null;
  const nextSong = queue && queueIndex >= 0 && queueIndex < queue.songs.length - 1 ? queue.songs[queueIndex + 1] : null;
  const userHands = useMemo<Hand[]>(() => (['R', 'L'] as Hand[]).filter((h) => hands[h]), [hands]);
  const bothHands = userHands.length === 2;
  const hiddenHands = useMemo<Hand[]>(() => (!bothHands && otherHand === 'hide' ? (['R', 'L'] as Hand[]).filter((h) => !hands[h]) : []), [bothHands, otherHand, hands]);
  const auditionView = settings.modes.audition.view;
  // While performing an audition, the stage (and the sheet, from memory) can be hidden.
  const coachView = coach && running ? coach.steps[coach.index]?.view : undefined;
  const fromMemory = (mode === 'audition' && auditionView === 'memory') || coachView === 'memory';
  const concealStage = (mode === 'audition' && running && auditionView !== 'full') || coachView === 'memory';
  const concealScore = (mode === 'audition' && running && auditionView === 'memory') || coachView === 'memory';
  const showScore = (scoreOn[mode] || (!!coach && coach.steps[coach.index]?.view === 'sheet')) && !!song.scoreXml;
  const loopBeats = loopOn
    ? { start: song.measures[loop.from].start, end: song.measures[loop.to].start + song.measures[loop.to].length }
    : null;

  // Values the animation loop reads every frame.
  const ui = useRef({
    userHands,
    showFalling: true,
    hideCues: false,
    rate,
    loopBeats,
    idleBeat: -0.5,
    display: settings as StageDisplay,
    preferFlats: false,
    hiddenHands: [] as Hand[],
    lookAhead: 0,
    fingersOnKeys: false,
    reading: 'off' as 'off' | 'fade' | 'late',
  });
  ui.current = {
    userHands,
    showFalling: (mode !== 'audition' || auditionView === 'full') && settings.showFalling && coachView !== 'sheet',
    hideCues: mode === 'audition',
    rate,
    loopBeats,
    idleBeat: (loopBeats?.start ?? song.measures[Math.min(startMeasure, song.measures.length - 1)].start) - 0.5,
    display: coachView === 'sheet' ? { ...settings, showTargets: false } : settings,
    preferFlats: song.keyFifths < 0,
    hiddenHands,
    lookAhead: mode === 'learn' ? settings.modes.learn.lookAhead : 0,
    fingersOnKeys: mode === 'learn' && settings.modes.learn.fingersOnKeys,
    reading: mode === 'roll' ? settings.modes.roll.reading : 'off',
  };

  useEffect(() => savePref('mode', mode), [mode]);
  useEffect(() => savePref(`hands.${song.id}`, hands), [hands, song.id]);
  useEffect(() => savePref(`rate.${song.id}`, rate), [rate, song.id]);
  // Each mode remembers its own setup for this piece (not while the coach or a fix loop drives the toolbar).
  useEffect(() => {
    if (!settings.rememberPerMode || coachRef.current || fixRef.current) return;
    const setup: ModeSetup = { hands, otherHand, rate, metronome, loopOn, loop, autoSpeed };
    savePref(setupKey(mode), setup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hands, otherHand, rate, metronome, loopOn, loop, autoSpeed, mode, settings.rememberPerMode]);
  const switchMode = (m: ModeKind) => {
    if (m === mode) return;
    setMode(m);
    setAudition({ open: false, restarts: 0 });
    if (!getSettings().rememberPerMode) return;
    const next = loadPref<ModeSetup | null>(setupKey(m), null);
    if (!next) return;
    setHands(next.hands);
    setOtherHand(next.otherHand);
    setRate(next.rate);
    setMetronome(next.metronome);
    const l = validLoop(next.loop);
    if (l) setLoop(l);
    setLoopOn(next.loopOn && !!l);
    setAutoSpeed(next.autoSpeed);
  };
  useEffect(() => savePref('otherHand', otherHand), [otherHand]);
  useEffect(() => savePref('scoreOn', scoreOn), [scoreOn]);
  useEffect(() => savePref('waitBy', waitBy), [waitBy]);
  useEffect(() => savePref(`transpose.${id}`, transpose), [transpose, id]);

  const finished = useCallback(
    async (s: Session) => {
      setRunning(false);
      setRate(Math.round(s.rate * 100) / 100);
      const r = s.report;
      if (!r) return;
      setReport(r);
      setHeat(r.measures);
      setGame(null);
      onReport?.(r);
      if (r.mode === 'audition' && r.completed) setAudition({ open: false, restarts: 0 });
      // Piano Roll game: the high-score table.
      if (r.mode === 'roll' && r.judgments?.points !== undefined && s.timed) {
        const rank = addHighScore(r.songId, { points: r.judgments.points, date: r.date, rate: r.rate, hands: r.hands, maxCombo: r.judgments.maxCombo });
        setGame({ rank, scores: highScores(r.songId) });
        if (rank === 0) {
          setToast(`New high score: ${r.judgments.points.toLocaleString()}!`);
          celebrate();
          sfx('levelup');
        }
      }
      say(`Score ${r.score}. ${r.tips[0] ?? ''}`);
      try {
        await saveSession(r);
        const best = await updateBest(r);
        // Three stars or a new personal best deserve a celebration.
        if (r.stars === 3 || (best && best.date === r.date && r.completed)) {
          celebrate();
          sfx('success');
        }
        await addPracticeTime(r.durationSec);
        onSaved?.();
      } catch (err) {
        console.warn('Could not save the session', err);
      }
    },
    [onSaved, onReport],
  );

  const launch = useCallback(
    async (opts: SessionOptions) => {
      await resumeAudio();
      if (!piano.loaded) {
        setPianoState('loading');
        piano.load().then(() => setPianoState('ready'));
      }
      sessionRef.current?.dispose();
      setReport(null);
      setHeat(null);
      // Strictness, count-in, metronome and guide settings apply to every run.
      const st = getSettings();
      lastOpts.current = opts;
      const s = new Session(
        song,
        {
          tuning: tuningOf(st),
          countInBars: st.countInBars,
          clicks: {
            subdivision: st.clickSubdivision,
            accent: st.clickAccent,
            sound: st.clickSound,
            fade: st.metronomeFade,
            fadeAfter: st.fadeAfterBars,
          },
          // Through speakers the microphone would hear the guide notes as the player's own.
          guide: st.guideNotes && (micState().state !== 'on' || st.headphones),
          weights: st.scoreWeights,
          judging: st.judging,
          learn: st.modes.learn,
          practice: { cleanPasses: st.modes.practice.cleanPasses, slowDown: st.modes.practice.slowDown },
          roll: st.modes.roll,
          ...opts,
        },
        performance.now(),
      );
      let seenPasses = 0;
      let seenRotation = 0;
      let seenFix = 0;
      // Stop and fix (keep-going Practice runs): a mistake loops its bar.
      s.onMistake((fl) => {
        if (s.opts.mode !== 'practice' || s.opts.wait || s.opts.loop || fixRef.current || coachRef.current) return;
        if (!getSettings().modes.practice.stopAndFix) return;
        const bar = s.currentMeasure(fl.time - 150);
        window.setTimeout(() => startFixRef.current(bar), 0);
      });
      let spoken = '';
      s.subscribe(() => {
        if (s.message) setToast(s.message);
        if (s.message && s.message !== spoken) {
          spoken = s.message;
          say(s.message);
        }
        setRate(Math.round(s.rate * 100) / 100);
        // Coach: a clean pass moves on to the next step.
        const c = coachRef.current;
        const listened = !!c && s.status === 'finished' && c.steps[c.index]?.mode === 'listen';
        if (c && ((s.status === 'running' && s.passList.length > seenPasses) || listened)) {
          seenPasses = s.passList.length;
          if (listened || stepDone(c.steps[c.index], s.passList)) {
            if (c.index >= c.steps.length - 1) {
              coachRef.current = null;
              setCoach(null);
              variantRef.current = null;
              setVariant(null);
              s.stop(performance.now());
              setToast('Passage learned! 🎉 Every step done.');
              celebrate();
              sfx('levelup');
              say('Well done. Every step is done.');
            } else {
              const next = c.index + 1;
              window.setTimeout(() => runStepRef.current(next), 0);
            }
            return;
          }
        }
        // Stop and fix: a clean pass of the bar carries on with the run from there.
        const fx = fixRef.current;
        if (fx && s.status === 'running' && s.passList.length > seenFix) {
          seenFix = s.passList.length;
          if (s.passList[seenFix - 1].clean) {
            fixRef.current = null;
            setFixing(null);
            setToast(`Bar ${song.measures[fx.bar].number} fixed. Carrying on.`);
            window.setTimeout(() => void launch({ ...fx.resume, startMeasure: fx.bar, loop: null }), 0);
            return;
          }
        }
        // Rotate hands: each loop pass moves on to the next hand.
        const rotate = getSettings().modes.practice.rotateHands;
        if (!c && !fx && rotate && s.opts.mode === 'practice' && s.opts.loop && s.status === 'running' && s.passList.length > seenRotation) {
          seenRotation = s.passList.length;
          const playable = HAND_ORDER.filter((hs) => hs.every((h) => s.allNotes.some((n) => n.hand === h)));
          const at = playable.findIndex((hs) => hs.length === s.hands.length && hs.every((h) => s.hands.includes(h)));
          const next = playable[(at + 1) % playable.length];
          if (next && playable.length > 1) {
            const last = s.passList[s.passList.length - 1];
            const hist = rotationPasses.current;
            hist.push({ clean: last.clean, rate: last.rate });
            let r = s.rate;
            const need = getSettings().modes.practice.cleanPasses;
            const recent = hist.slice(-need);
            if (need > 1 && s.opts.autoSpeedUp && Math.abs(r - last.rate) < 1e-6 && recent.length === need && recent.every((x) => x.clean && Math.abs(x.rate - r) < 1e-6)) {
              r = Math.round(Math.min(s.tuning.maxRate, r + s.tuning.speedStep) * 100) / 100;
            }
            window.setTimeout(() => rotateRef.current(next, r), 0);
            return;
          }
        }
        if (s.status === 'finished') void finished(s);
      });
      sessionRef.current = s;
      if (import.meta.env.DEV) (window as unknown as { __pianistSession?: Session }).__pianistSession = s;
      setHud(s.hud(performance.now()));
      setRunning(true);
    },
    [song, finished],
  );

  const start = useCallback(() => {
    setToast(null);
    setGame(null);
    rotationPasses.current = [];
    fixRef.current = null;
    setFixing(null);
    return launch({
      mode,
      hands: userHands,
      // Listen never plays the hand that's switched off.
      otherHand: bothHands ? 'mute' : mode === 'listen' && otherHand === 'app' ? 'mute' : otherHand,
      rate,
      metronome,
      loop: loopOn ? loop : null,
      startMeasure: loopOn ? undefined : startMeasure,
      autoSpeedUp: autoSpeed,
      wait,
    });
  }, [launch, mode, userHands, bothHands, otherHand, rate, metronome, loopOn, loop, autoSpeed, wait, startMeasure]);

  rotateRef.current = (next: Hand[], r: number) => {
    const o = lastOpts.current;
    if (!o) return;
    const prev = sessionRef.current;
    if (prev?.status === 'running') void addPracticeTime(prev.elapsedSec(performance.now())).catch(() => {});
    setHands({ R: next.includes('R'), L: next.includes('L') });
    setRate(r);
    setToast(`Now: ${next.length === 2 ? 'both hands' : next[0] === 'R' ? 'right hand' : 'left hand'}`);
    void launch({ ...o, hands: next, rate: r, otherHand: next.length === 2 ? 'mute' : o.otherHand === 'mute' && otherHand !== 'mute' ? otherHand : o.otherHand });
  };

  /** Stop and fix: loop the bar with the mistake until it's clean. */
  const startFixBar = (bar: number) => {
    const s = sessionRef.current;
    const o = lastOpts.current;
    if (!s || !o || fixRef.current) return;
    void addPracticeTime(s.elapsedSec(performance.now())).catch(() => {});
    fixRef.current = { bar, resume: { ...o, rate: s.rate } };
    setFixing(bar);
    setToast(`Fix bar ${song.measures[bar].number}: play it cleanly to carry on`);
    say(`Let's fix bar ${song.measures[bar].number}.`);
    void launch({ ...o, rate: s.rate, loop: { from: bar, to: bar }, startMeasure: undefined, autoSpeedUp: false });
  };

  // Starts one step of the coach: the toolbar shows the step's settings.
  runStepRef.current = (index: number) => {
    const c = coachRef.current;
    if (!c) return;
    c.index = index;
    const step = c.steps[index];
    // The finished step's practice time still counts towards the day.
    const prev = sessionRef.current;
    if (prev?.status === 'running') void addPracticeTime(prev.elapsedSec(performance.now())).catch(() => {});
    setCoach({ steps: c.steps, index });
    setMode(step.mode);
    setHands({ R: step.hands.includes('R'), L: step.hands.includes('L') });
    setRate(step.rate);
    if (step.mode === 'learn' || step.mode === 'practice') setWaitBy((w) => ({ ...w, [step.mode]: step.wait }));
    const region = step.region ?? { from: c.from, to: c.to };
    setLoopOn(true);
    setLoop(region);
    setToast(`Step ${index + 1} of ${c.steps.length}: ${step.title}`);
    say(`Step ${index + 1}. ${step.title}. ${step.hint}`);
    const opts: SessionOptions = {
      mode: step.mode,
      hands: step.hands,
      otherHand: step.hands.length === 2 ? 'mute' : otherHand === 'app' && step.mode === 'listen' ? 'mute' : otherHand,
      rate: step.rate,
      metronome,
      // Listen plays the passage once (a loop region ends Listen instead of repeating it).
      loop: region,
      autoSpeedUp: step.autoSpeedUp,
      wait: step.wait,
    };
    const v = step.variant ?? null;
    if (v !== variantRef.current) {
      // The piece is rewritten in the new rhythm first; the step starts once it is on screen.
      variantRef.current = v;
      setVariant(v);
      pendingLaunch.current = opts;
      return;
    }
    void launch(opts);
  };

  const startCoach = (o: CoachOptions, routine: Routine) => {
    setCoachDialog(false);
    const steps = routineToSteps(song, routine, { ...o, cleanPass: tuningOf(getSettings()).cleanPass });
    if (!steps.length) return;
    coachRef.current = { steps, index: 0, from: o.from, to: o.to };
    runStepRef.current(0);
  };
  const coachPassage = () =>
    loopOn ? loop : heat && report?.weakRange ? report.weakRange : { from: firstBar, to: Math.min(song.measures.length - 1, firstBar + 3) };
  const attachedRoutine = useMemo(() => {
    const id = routineForSong(baseSong.id);
    return id ? ([...ROUTINE_TEMPLATES, ...myRoutines()].find((r) => r.id === id) ?? null) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSong.id, coachDialog]);

  const startFix = (r: Report) => {
    const steps = buildFixPlan(r, tuningOf(getSettings()).cleanPass);
    if (!steps.length) return;
    setReport(null);
    coachRef.current = { steps, index: 0, from: steps[0].region!.from, to: steps[0].region!.to };
    runStepRef.current(0);
  };

  const endCoach = useCallback(() => {
    coachRef.current = null;
    setCoach(null);
    pendingLaunch.current = null;
    if (variantRef.current) {
      variantRef.current = null;
      setVariant(null);
    }
  }, []);

  const stop = useCallback(() => {
    endCoach();
    fixRef.current = null;
    setFixing(null);
    setCountdown(null);
    const s = sessionRef.current;
    if (s && s.status === 'running') s.stop(performance.now());
    setRunning(false);
  }, [endCoach]);

  // A finished run keeps its colours on screen until a setting changes.
  const resetView = useCallback(() => {
    if (sessionRef.current?.status === 'finished') {
      sessionRef.current.dispose();
      sessionRef.current = null;
    }
  }, []);

  useEffect(() => {
    resetView();
  }, [mode, hands, loopOn, loop, wait, otherHand, song, resetView]);

  // Live tweaks during a run
  useEffect(() => {
    const s = sessionRef.current;
    if (s?.status === 'running' && Math.abs(s.rate - rate) > 1e-6) s.setRate(rate);
  }, [rate]);
  useEffect(() => {
    sessionRef.current?.setMetronome(metronome);
  }, [metronome]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = new Stage(canvas);
    stageRef.current = stage;
    stage.setSong(song, settings.fullKeyboard);
    stage.resize();
    // Redraw only when something changed: an idle player costs nothing (tablets keep their battery).
    let drawn = { ui: null as unknown, held: '', beat: NaN, w: 0, h: 0 };
    const ro = new ResizeObserver(() => {
      stage.resize(); // clears the canvas
      drawn.w = -1;
    });
    ro.observe(canvas);
    // The computer-key labels move with the octave (Z / X).
    const offBase = onKeyboardBase(() => (drawn.w = -1));
    let raf = 0;
    let lastHud = 0;
    let lastMarks = 0;
    let lastFlash = 0;
    let lastCombo = 0;
    let lastHudSig = '';
    const tick = () => {
      const now = performance.now();
      const s = sessionRef.current;
      const u = ui.current;
      s?.frame(now);
      const beat = s ? s.playhead(now) : u.idleBeat;
      const held = new Map<number, KeyKind>();
      for (const p of inputHub.held.keys()) held.set(p, s?.status === 'running' ? (s.keyKinds.get(p) ?? 'neutral') : 'neutral');
      const heldSig = [...held].join();
      const busy = s?.status === 'running' || (s?.flashes.some((fl) => now - fl.time < 1000) ?? false);
      if (busy || drawn.ui !== u || drawn.held !== heldSig || drawn.beat !== beat || drawn.w !== canvas.width || drawn.h !== canvas.height) {
        drawn = { ui: u, held: heldSig, beat, w: canvas.width, h: canvas.height };
        stage.draw({
        beat,
        now,
        bps: (song.bpm * u.rate) / 60,
        marks: s?.marks ?? null,
        userHands: s ? s.hands : u.userHands,
        showFalling: u.showFalling,
        targets: s ? s.targets(now) : [],
        held,
        flashes: s?.flashes ?? [],
        waiting: s ? s.waiting(now) : false,
        loop: u.loopBeats,
        hideCues: u.hideCues,
        display: u.display,
        preferFlats: u.preferFlats,
        hiddenHands: u.hiddenHands,
        upcoming: s ? s.upcoming(u.lookAhead) : [],
        fingersOnKeys: u.fingersOnKeys,
        reading: u.reading,
        });
      }
      scoreRef.current?.setBeat(beat);
      if (s && s.status === 'running' && s.flashes.length) {
        const latest = s.flashes[s.flashes.length - 1];
        if (latest.time > lastFlash) {
          lastFlash = latest.time;
          if (latest.kind === 'miss' || latest.kind === 'wrong') sfx('miss');
        }
      }
      // Mistakes on the sheet music (hidden while performing in Audition).
      if (now - lastMarks > 250) {
        lastMarks = now;
        const marks: ScoreMark[] = [];
        if (s && !(u.hideCues && s.status === 'running')) {
          for (const n of song.notes) {
            const m = s.marks[n.id];
            if (m === NoteMark.Missed) marks.push({ beat: n.start, pitch: n.pitch, kind: 'missed' });
            else if (m === NoteMark.Early || m === NoteMark.Late) marks.push({ beat: n.start, pitch: n.pitch, kind: 'off' });
          }
          for (const e of s.extrasList()) marks.push({ beat: e.beat, pitch: e.pitch, kind: 'wrong' });
        }
        scoreRef.current?.setMarks(marks);
      }
      if (s && s.status === 'running' && now - lastHud > 150) {
        lastHud = now;
        const h = s.hud(now);
        if (h.combo >= 25 && h.combo % 25 === 0 && h.combo !== lastCombo) {
          lastCombo = h.combo;
          sfx('combo');
          setToast(`${h.combo} in a row!`);
        }
        const sig = `${h.accuracy}|${h.combo}|${h.perfect}|${h.good}|${h.miss}|${h.wrong}|${h.pass}|${h.rate}|${h.message}|${h.waiting}`;
        if (sig !== lastHudSig) {
          lastHudSig = sig;
          setHud(h);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offBase();
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [song, settings.fullKeyboard]);

  const beginRef = useRef<() => void>(() => {});
  // A coach step waiting for its rhythm variation to be on screen.
  useEffect(() => {
    const opts = pendingLaunch.current;
    if (!opts) return;
    pendingLaunch.current = null;
    void launch(opts);
  }, [launch]);

  const startFixRef = useRef(startFixBar);
  startFixRef.current = startFixBar;

  // Hands-free control from the piano.
  useEffect(
    () =>
      inputHub.onAction((a) => {
        const s = sessionRef.current;
        const now = performance.now();
        const live = s?.status === 'running';
        if (a === 'startStop') {
          if (live) stop();
          else {
            setReport(null);
            beginRef.current();
          }
        } else if (a === 'restart') {
          setReport(null);
          beginRef.current();
        } else if (live && a === 'nextBar') s.nextBar(now);
        else if (live && a === 'prevBar') s.previousBar(now);
        else if (live && a === 'skip' && s.canSkip) s.skip(now);
      }),
    [stop],
  );

  const auditionOpts = settings.modes.audition;
  const restartsLeft = auditionOpts.restarts < 0 ? Infinity : auditionOpts.restarts - audition.restarts;
  const auditionBlocked = mode === 'audition' && audition.open && restartsLeft <= 0 && !running;
  /** Start, with the audition countdown and restart rules. */
  const begin = useCallback(() => {
    if (mode === 'audition') {
      if (audition.open && restartsLeft <= 0) return;
      setAudition((a) => (a.open ? { open: true, restarts: a.restarts + 1 } : { open: true, restarts: 0 }));
      if (auditionOpts.countdown) {
        setReport(null);
        setCountdown(3);
        return;
      }
    }
    void start();
  }, [mode, audition.open, restartsLeft, auditionOpts.countdown, start]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void start();
      return;
    }
    // A click for each count (the metronome sound, whatever the sound-effects setting).
    void resumeAudio().then(() => metronomeClick(audioCtx().currentTime + 0.01, countdown === 1 ? 'accent' : 'beat', getSettings().clickSound));
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 900);
    return () => window.clearTimeout(t);
  }, [countdown, start]);

  beginRef.current = begin;

  // Space starts / stops, Escape stops or closes the report.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      const s = sessionRef.current;
      if (e.code === 'Space') {
        e.preventDefault();
        if (running || countdown !== null) stop();
        else if (!report) begin();
      } else if (e.code === 'Escape') {
        if (running || countdown !== null) stop();
        else if (report) setReport(null);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const forward = e.code === 'ArrowRight';
        if (running && s) {
          if (forward) s.nextBar(performance.now());
          else s.previousBar(performance.now());
        } else if (!report && !loopOn) {
          setStartMeasure((m) => Math.max(0, Math.min(song.measures.length - 1, m + (forward ? 1 : -1))));
        }
      } else if (e.code === 'Enter' && running && s?.canSkip) {
        e.preventDefault();
        s.skip(performance.now());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, report, begin, stop, loopOn, song, countdown]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onMeasureClick = useCallback(
    (index: number, shift: boolean) => {
      if (running) {
        sessionRef.current?.seekMeasure(index, performance.now());
        return;
      }
      if (!loopOn && !shift) {
        setStartMeasure(index);
        return;
      }
      setLoopOn(true);
      setLoop((l) => (shift && loopOn ? { from: Math.min(l.from, index), to: Math.max(l.from, index) } : { from: index, to: index }));
    },
    [running, loopOn],
  );

  const practiceBars = (from: number, to: number) => {
    setReport(null);
    setLoopOn(true);
    setLoop({ from, to });
    if (mode === 'audition' || mode === 'listen') setMode('practice');
  };

  const pitchUnder = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const r = e.currentTarget.getBoundingClientRect();
    return stage.pitchAt(e.clientX - r.left, e.clientY - r.top);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pitchUnder(e);
    if (p === null) return;
    void resumeAudio();
    void piano.load();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not capturable; the key still sounds
    }
    pointerPitch.current.set(e.pointerId, p);
    inputHub.noteOn({ pitch: p, velocity: 80, time: e.timeStamp, source: 'screen' });
  };
  // Sliding a finger along the keys plays each key it reaches.
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const prev = pointerPitch.current.get(e.pointerId);
    if (prev === undefined) return;
    const p = pitchUnder(e);
    if (p === null || p === prev) return;
    inputHub.noteOff(prev, e.timeStamp, 'screen');
    pointerPitch.current.set(e.pointerId, p);
    inputHub.noteOn({ pitch: p, velocity: 80, time: e.timeStamp, source: 'screen' });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointerPitch.current.get(e.pointerId);
    if (p === undefined) return;
    pointerPitch.current.delete(e.pointerId);
    if (![...pointerPitch.current.values()].includes(p)) inputHub.noteOff(p, e.timeStamp, 'screen');
  };

  const barOptions = useMemo(
    () =>
      song.measures.map((m) => (
        <option key={m.index} value={m.index}>
          {m.number === 0 ? 'pickup' : m.number}
        </option>
      )),
    [song],
  );

  const scoreLoop = loopOn ? loop : null;
  const heatData = !running && heat ? heat.map((m) => ({ index: m.index, score: m.score })) : null;

  return (
    <div className="player">
      <header className="player-head">
        <button className="btn ghost" onClick={onExit} title="Back to the library">
          ← Library
        </button>
        <div className="song-title">
          <h1>{song.title}</h1>
          <span className="muted">
            {[song.composer, `${song.timeSig[0]}/${song.timeSig[1]}`, `${song.bpm} bpm`].filter(Boolean).join(' · ')}
          </span>
        </div>
        {queue && queueIndex >= 0 && (
          <div className="queue-nav" title={`Collection: ${queue.name}`}>
            <button className="icon-btn" disabled={!prevSong} onClick={() => prevSong && onNavigate?.(prevSong)} aria-label="Previous piece">
              ‹
            </button>
            <span className="small">
              <span className="muted">{queue.name}</span> {queueIndex + 1}/{queue.songs.length}
            </span>
            <button className="icon-btn" disabled={!nextSong} onClick={() => nextSong && onNavigate?.(nextSong)} aria-label="Next piece">
              ›
            </button>
          </div>
        )}
        {nextAction && (
          <button className="btn" disabled={running} onClick={nextAction.run}>
            {nextAction.label}
          </button>
        )}
        {onEdit && (
          <button className="btn" disabled={running} onClick={onEdit} title="Fix or change notes">
            ✎ Edit
          </button>
        )}
        <ExportMenu song={song} disabled={running} />
        <nav className="mode-tabs" aria-label="Practice mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={`tab ${mode === m ? 'active' : ''}`}
              disabled={running}
              onClick={() => switchMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </nav>
        <InputBar />
      </header>

      <div className="toolbar">
        <button
          className={`btn start ${running || countdown !== null ? 'stop' : 'primary'}`}
          disabled={auditionBlocked}
          onClick={running || countdown !== null ? stop : begin}
          title={auditionBlocked ? 'No restarts left in this audition' : undefined}
        >
          {running || countdown !== null ? '■ Stop' : mode === 'listen' ? '▶ Listen' : mode === 'audition' && audition.open ? '↺ Restart' : '▶ Start'}
        </button>
        {mode === 'audition' && audition.open && auditionOpts.restarts >= 0 && (
          <span className="muted small" title="Restarts allowed in Audition options">
            {restartsLeft > 0 ? `${restartsLeft} restart${restartsLeft > 1 ? 's' : ''} left` : 'No restarts left'}
            {!running && (
              <button className="btn ghost small-btn" onClick={() => setAudition({ open: false, restarts: 0 })}>
                New audition
              </button>
            )}
          </span>
        )}
        {running ? (
          <div className="group transport" title="Move while playing (← → keys)">
            <button className="seg" onClick={() => sessionRef.current?.previousBar(performance.now())} aria-label="Previous bar">
              ⏮
            </button>
            <button className="seg" onClick={() => sessionRef.current?.nextBar(performance.now())} aria-label="Next bar">
              ⏭
            </button>
            {sessionRef.current?.canSkip && (
              <button className="seg" onClick={() => sessionRef.current?.skip(performance.now())} title="Skip the notes you're stuck on (Enter)">
                Skip note
              </button>
            )}
          </div>
        ) : (
          !loopOn && (
            <div className="group transport" title="Where to start (← → keys, or click a bar in the score)">
              <span className="label">From bar</span>
              <button className="seg" disabled={startMeasure <= 0} onClick={() => setStartMeasure(startMeasure - 1)} aria-label="Start one bar earlier">
                ◀
              </button>
              <span className="value bar-value">{song.measures[Math.min(startMeasure, song.measures.length - 1)].number || 'pickup'}</span>
              <button
                className="seg"
                disabled={startMeasure >= song.measures.length - 1}
                onClick={() => setStartMeasure(startMeasure + 1)}
                aria-label="Start one bar later"
              >
                ▶
              </button>
            </div>
          )
        )}

        <div className="group" title={mode === 'listen' ? 'Which hands you hear' : 'Which hands you play'}>
          <span className="label">{mode === 'listen' ? 'Hear' : 'You play'}</span>
          <button className={`seg ${hands.L && !hands.R ? 'on l' : ''}`} disabled={running} onClick={() => setHands({ L: true, R: false })}>
            Left
          </button>
          <button className={`seg ${bothHands ? 'on r' : ''}`} disabled={running} onClick={() => setHands({ L: true, R: true })}>
            Both
          </button>
          <button className={`seg ${hands.R && !hands.L ? 'on r' : ''}`} disabled={running} onClick={() => setHands({ L: false, R: true })}>
            Right
          </button>
        </div>
        {!bothHands && (
          <div className="group" title="The other hand's part">
            <span className="label">Other hand</span>
            {mode !== 'listen' && (
              <button className={`seg ${otherHand === 'app' ? 'on r' : ''}`} disabled={running} onClick={() => setOtherHand('app')}>
                Pianist plays
              </button>
            )}
            <button
              className={`seg ${otherHand === 'mute' || (mode === 'listen' && otherHand === 'app') ? 'on r' : ''}`}
              disabled={running}
              onClick={() => setOtherHand('mute')}
            >
              {mode === 'listen' ? 'Shown' : 'Silent'}
            </button>
            <button className={`seg ${otherHand === 'hide' ? 'on r' : ''}`} disabled={running} onClick={() => setOtherHand('hide')}>
              Hidden
            </button>
          </div>
        )}
        {((!bothHands && otherHand === 'app' && mode !== 'listen') || mode === 'listen') && (
          <div className="group" title={mode === 'listen' ? 'Volume' : "Volume of the hand Pianist plays"}>
            <span className="label">{mode === 'listen' ? 'Volume' : 'Its volume'}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.accompVolume}
              onChange={(e) => updateSettings({ accompVolume: Number(e.target.value) })}
            />
          </div>
        )}

        <div className="group tempo" title="Tempo">
          <span className="label">Tempo</span>
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
          />
          <span className="value">
            {Math.round(rate * 100)}% <span className="muted">· {Math.round(song.bpm * rate)} bpm</span>
          </span>
        </div>

        <button className={`btn toggle ${metronome ? 'on' : ''}`} onClick={() => setMetronome(!metronome)} title="Metronome">
          ♩ Metronome
        </button>

        {!running && mode !== 'listen' && (
          <span className="coach-btns">
            <button
              className="btn"
              onClick={() => (attachedRoutine ? startCoach({ ...coachPassage(), startRate: 0.6, targetRate: 1 }, attachedRoutine) : setCoachDialog(true))}
              title={attachedRoutine ? `Start "${attachedRoutine.name}" on the loop (or the first bars)` : 'A guided routine for a hard passage'}
            >
              🎓 {attachedRoutine ? `Coach: ${attachedRoutine.name}` : 'Coach'}
            </button>
            {attachedRoutine && (
              <button className="btn" onClick={() => setCoachDialog(true)} title="Choose another routine or passage" aria-label="Coach options">
                ⋯
              </button>
            )}
          </span>
        )}
        <div className="group" title="Repeat a range of bars">
            <button className={`btn toggle ${loopOn ? 'on' : ''}`} disabled={running} onClick={() => setLoopOn(!loopOn)}>
              ⟲ Loop
            </button>
            {loopOn && (
              <>
                <select
                  value={loop.from}
                  disabled={running}
                  onChange={(e) => {
                    const from = Number(e.target.value);
                    setLoop((l) => ({ from, to: Math.max(from, l.to) }));
                  }}
                >
                  {barOptions}
                </select>
                <span className="muted">to</span>
                <select
                  value={loop.to}
                  disabled={running}
                  onChange={(e) => {
                    const to = Number(e.target.value);
                    setLoop((l) => ({ from: Math.min(l.from, to), to }));
                  }}
                >
                  {barOptions}
                </select>
                {mode !== 'listen' && (
                  <label className="check" title="After a clean pass (90%+), go 5% faster, up to 100%">
                    <input type="checkbox" checked={autoSpeed} onChange={(e) => setAutoSpeed(e.target.checked)} />
                    speed up
                  </label>
                )}
              </>
            )}
        </div>

        {canWait && (
          <button
            className={`btn toggle ${wait ? 'on' : ''}`}
            disabled={running}
            onClick={() => setWaitBy({ ...waitBy, [mode]: !wait })}
            title={
              wait
                ? 'On: the music waits for the right notes. Click to keep going at tempo instead.'
                : 'Off: the music keeps going at tempo and missed notes are marked. Click to wait for you.'
            }
          >
            {wait ? '⏸ Wait for me' : '▶ Keep going'}
          </button>
        )}

        <div className="group" title="Transpose the whole piece. One step is a half step (C to C sharp); two steps take C to D.">
          <span className="label">Key</span>
          <button className="seg" disabled={running || transpose <= tMin} onClick={() => setTranspose(transpose - 1)} aria-label="Transpose down">
            −
          </button>
          <span className="value transpose-value">
            {keyNames(song.keyFifths)}
            {transpose !== 0 && <span className="muted"> ({transpose > 0 ? `+${transpose}` : transpose})</span>}
          </span>
          <button className="seg" disabled={running || transpose >= tMax} onClick={() => setTranspose(transpose + 1)} aria-label="Transpose up">
            +
          </button>
          {transpose !== 0 && (
            <button className="icon-btn" disabled={running} onClick={() => setTranspose(0)} title="Back to the original key">
              ↺
            </button>
          )}
        </div>

        <span className="spacer" />
        <ModeOptionsMenu
          mode={mode}
          extra={
            mode === 'roll' ? (
              <div className="mode-opt column">
                <b>High scores</b>
                <HighScoreList scores={highScores(song.id)} />
              </div>
            ) : null
          }
        />
        <DisplayMenu />
        {song.scoreXml && (
          <button
            className={`btn toggle ${scoreOn[mode] ? 'on' : ''}`}
            onClick={() => setScoreOn({ ...scoreOn, [mode]: !scoreOn[mode] })}
            title="Show or hide the sheet music"
          >
            𝄞 Score
          </button>
        )}
      </div>

      <ViewStrip hasScore={!!song.scoreXml} />

      {showScore && !concealScore && (
        <ScoreView
          ref={scoreRef}
          song={song}
          heat={heatData}
          loop={scoreLoop}
          onMeasureClick={onMeasureClick}
          showPlayhead={mode !== 'audition' || !running}
          fingering={settings.fingering}
        />
      )}

      <div className="stage-wrap">
        <canvas
          ref={canvasRef}
          className={`stage ${concealStage ? 'concealed' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {concealStage && (
          <div className="concealed-note">
            {fromMemory ? '🎭 Playing from memory' : '🎼 Reading from the sheet music'}
            <div className="muted small">{coachView ? 'Pianist is listening.' : 'Your report comes at the end.'}</div>
          </div>
        )}
        {countdown !== null && countdown > 0 && (
          <div className="countdown" key={countdown}>
            {countdown}
          </div>
        )}
        <div className="hud">
          {running && hud && <HudView mode={mode} hud={hud} best={mode === 'roll' ? (highScores(song.id)[0]?.points ?? 0) : 0} />}
          {!running && !report && (
            <div className="hint">
              <b>{MODE_LABELS[mode]}.</b> {canWait && !wait ? KEEP_GOING_HELP : MODE_HELP[mode]}
              <div className="muted small">
                Press <kbd>Space</kbd> or Start. {showScore ? 'Click a bar in the score to start there (or to loop it when Loop is on). ' : ''}
                <kbd>←</kbd>/<kbd>→</kbd> move by a bar while playing.
                {pianoState === 'loading' ? ' Loading piano sound…' : ''}
              </div>
            </div>
          )}
        </div>
        {toast && <div className="toast">{toast}</div>}
        {fixing !== null && (
          <div className="coach-banner">
            <div className="coach-text">
              <b>🔧 Fixing bar {song.measures[fixing].number}</b>
              <span className="muted small">Play it cleanly once and the run carries on from here.</span>
            </div>
            <button
              className="btn"
              onClick={() => {
                const fx = fixRef.current;
                if (!fx) return;
                fixRef.current = null;
                setFixing(null);
                void launch({ ...fx.resume, startMeasure: fx.bar, loop: null });
              }}
            >
              Carry on
            </button>
            <button className="btn ghost" onClick={stop}>
              Stop
            </button>
          </div>
        )}
        {coach && (
          <div className="coach-banner">
            <div className="coach-dots">
              {coach.steps.map((st, i) => (
                <span key={st.id} className={i < coach.index ? 'done' : i === coach.index ? 'now' : ''} title={st.title} />
              ))}
            </div>
            <div className="coach-text">
              <b>
                🎓 Step {coach.index + 1}/{coach.steps.length}: {coach.steps[coach.index].title}
              </b>
              <span className="muted small">{coach.steps[coach.index].hint}</span>
            </div>
            <button
              className="btn"
              onClick={() => {
                const c = coachRef.current;
                if (!c) return;
                if (c.index >= c.steps.length - 1) stop();
                else runStepRef.current(c.index + 1);
              }}
            >
              Skip step
            </button>
            <button className="btn ghost" onClick={stop}>
              End coach
            </button>
          </div>
        )}
      </div>

      {coachDialog && (
        <CoachDialog
          song={song}
          initial={coachPassage()}
          onStart={startCoach}
          onClose={() => setCoachDialog(false)}
        />
      )}
      {comparing && report && <CompareTakes report={report} onClose={() => setComparing(false)} />}
      {report && (
        <ReportView
          report={report}
          song={song}
          onClose={() => setReport(null)}
          onPracticeBars={practiceBars}
          onAgain={() => {
            setReport(null);
            begin();
          }}
          onCompare={report.mode === 'audition' ? () => setComparing(true) : undefined}
          game={game}
          onFix={() => startFix(report)}
          onNext={nextSong ? () => onNavigate?.(nextSong) : nextAction?.run}
          nextTitle={nextSong?.title ?? nextAction?.label}
        />
      )}
    </div>
  );
}

function HighScoreList({ scores }: { scores: HighScore[] }) {
  if (!scores.length) return <span className="muted small">No games yet. Play Piano Roll at tempo (Keep going).</span>;
  return (
    <ol className="high-scores">
      {scores.map((h, i) => (
        <li key={h.date + i}>
          <b>{h.points.toLocaleString()}</b>{' '}
          <span className="muted small">
            {new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {Math.round(h.rate * 100)}% · combo {h.maxCombo}
          </span>
        </li>
      ))}
    </ol>
  );
}

function HudView({ mode, hud, best }: { mode: ModeKind; hud: Hud; best: number }) {
  const pct = hud.accuracy === null ? '—' : `${Math.round(hud.accuracy * 100)}%`;
  if (hud.demo) return <div className="hud-line">👂 Listen… then it's your turn</div>;
  if (mode === 'listen') return <div className="hud-line">Listening at {Math.round(hud.rate * 100)}%</div>;
  if (mode === 'audition') return <div className="hud-line rec">● Performing. Feedback comes at the end.</div>;
  if (hud.timed && mode === 'roll') {
    return (
      <div className="hud-line">
        <b className="points">{hud.points.toLocaleString()}</b> pts
        {hud.multiplier > 1 && <span className="combo"> ×{hud.multiplier}</span>}
        {hud.lives !== null && <span className="lives"> · {'♥'.repeat(hud.lives)}</span>} · <span className="combo">{hud.combo}</span> combo ·{' '}
        <b>{hud.perfect}</b> perfect · <b>{hud.good}</b> good · <b>{hud.miss}</b> miss
        {best > 0 && <span className="muted"> · best {best.toLocaleString()}</span>}
      </div>
    );
  }
  if (hud.timed) {
    return (
      <div className="hud-line">
        <span className="combo">{hud.combo}×</span> combo · <b>{hud.perfect}</b> perfect · <b>{hud.good}</b> good ·{' '}
        <b>{hud.miss}</b> miss · {pct}
      </div>
    );
  }
  return (
    <div className="hud-line">
      Accuracy <b>{pct}</b> · wrong notes <b>{hud.wrong}</b>
      {hud.pass > 1 ? ` · pass ${hud.pass}` : ''} · {Math.round(hud.rate * 100)}%
      {hud.waiting && <span className="waiting"> · waiting for you…</span>}
    </div>
  );
}
