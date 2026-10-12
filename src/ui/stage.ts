import type { Flash, KeyKind } from '../engine/controllers';
import { NoteMark } from '../engine/types';
import { isBlackKey, noteLabel, type NameStyle } from '../music/pitch';
import { suggestFingering } from '../music/fingering';
import type { Hand, Song } from '../music/types';

export interface StageFrame {
  beat: number;
  now: number;
  bps: number;
  marks: Uint8Array | null;
  userHands: Hand[];
  showFalling: boolean;
  targets: number[];
  held: Map<number, KeyKind>;
  flashes: Flash[];
  waiting: boolean;
  loop: { start: number; end: number } | null;
  hideCues: boolean;
  display: StageDisplay;
  preferFlats: boolean;
}

/** How the keyboard and falling notes look. */
export interface StageDisplay {
  keyLabels: 'none' | 'c' | 'white' | 'all';
  nameStyle: NameStyle;
  noteLabels: boolean;
  showTargets: boolean;
  keyboardSize: 'small' | 'medium' | 'large';
  fallSeconds: number;
  noteColors: 'hand' | 'pitch' | 'finger';
  noteGlow: boolean;
  theme: 'dark' | 'light' | 'contrast';
  handColors: { R: string; L: string };
}

export const DEFAULT_DISPLAY: StageDisplay = {
  keyLabels: 'c',
  nameStyle: 'octave',
  noteLabels: true,
  showTargets: true,
  keyboardSize: 'medium',
  fallSeconds: 3.2,
  noteColors: 'hand',
  noteGlow: true,
  theme: 'dark',
  handColors: { R: '#4c9dff', L: '#38c98a' },
};

const KEYBOARD_SIZES = {
  small: { k: 0.17, min: 55, max: 100 },
  medium: { k: 0.24, min: 70, max: 140 },
  large: { k: 0.33, min: 90, max: 210 },
};

const DARK = {
  bg: '#0d0f14',
  lane: '#11141b',
  laneDark: '#0b0d12',
  octaveLine: '#1c212c',
  barLine: '#252b38',
  barText: '#5b6476',
  R: '#4c9dff',
  L: '#38c98a',
  Rhit: '#a8d4ff',
  Lhit: '#9ef3cb',
  auto: '#353c4b',
  missed: '#ff5d6c',
  off: '#ffb84d',
  white: '#f2efe8',
  whiteShade: '#d9d5cc',
  black: '#1a1d24',
  good: '#38c98a',
  wrong: '#ff5d6c',
  neutral: '#a3a9ff',
  hitLine: '#ffffff',
  keyOutline: '',
  labelInk: '#7a7466',
};

type Palette = typeof DARK;

const THEMES: Record<StageDisplay['theme'], Palette> = {
  dark: DARK,
  light: {
    ...DARK,
    bg: '#f3f1ec',
    lane: '#ebe8e1',
    laneDark: '#e1ded6',
    octaveLine: '#d3cfc6',
    barLine: '#cbc6bb',
    barText: '#8a8f99',
    auto: '#c9c5bc',
    white: '#ffffff',
    whiteShade: '#e7e3da',
    black: '#23262d',
    neutral: '#6f78ff',
    hitLine: '#000000',
  },
  contrast: {
    ...DARK,
    bg: '#000000',
    lane: '#000000',
    laneDark: '#0c0c0c',
    octaveLine: '#3d3d3d',
    barLine: '#5a5a5a',
    barText: '#bbbbbb',
    auto: '#4a4a4a',
    white: '#ffffff',
    black: '#000000',
    keyOutline: '#ffffff',
    labelInk: '#000000',
  },
};

/** A lighter version of a colour, for notes already played. */
function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

const FINGER_COLORS = ['', '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7'];
const pitchColor = (pitch: number, light: number) => `hsl(${(pitch % 12) * 30}, 75%, ${light}%)`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draws the falling notes and the keyboard on one canvas. */
export class Stage {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private lo = 48;
  private hi = 84;
  private keyX = new Float32Array(128);
  private keyW = new Float32Array(128);
  private song: Song | null = null;
  private kbSize: StageDisplay['keyboardSize'] = 'medium';
  private C: Palette = DARK;
  private fingers = new Map<number, number>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setSong(song: Song | null, fullKeyboard: boolean): void {
    this.song = song;
    this.fingers = song ? suggestFingering(song) : new Map();
    if (!song || fullKeyboard || song.notes.length === 0) {
      this.setRange(21, 108);
      return;
    }
    let min = 127;
    let max = 0;
    for (const n of song.notes) {
      min = Math.min(min, n.pitch);
      max = Math.max(max, n.pitch);
    }
    // Whole octaves around the music, at least two and a half octaves wide.
    let lo = Math.floor((min - 2) / 12) * 12;
    let hi = Math.ceil((max + 3) / 12) * 12 - 1;
    while (hi - lo < 30) {
      if (lo > 36) lo -= 12;
      else hi += 12;
    }
    this.setRange(Math.max(21, lo), Math.min(108, hi));
  }

  setRange(lo: number, hi: number): void {
    // The ends must be white keys.
    while (isBlackKey(lo)) lo--;
    while (isBlackKey(hi)) hi++;
    this.lo = lo;
    this.hi = hi;
    this.layout();
  }

  get range(): [number, number] {
    return [this.lo, this.hi];
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.layout();
  }

  private layout() {
    let whites = 0;
    for (let p = this.lo; p <= this.hi; p++) if (!isBlackKey(p)) whites++;
    const ww = this.w / whites;
    const bw = ww * 0.6;
    let i = 0;
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) {
        this.keyX[p] = i * ww - bw / 2;
        this.keyW[p] = bw;
      } else {
        this.keyX[p] = i * ww;
        this.keyW[p] = ww;
        i++;
      }
    }
  }

  /** Which key is under an x coordinate of the keyboard (for mouse / touch playing). */
  pitchAt(x: number, y: number): number | null {
    const kbTop = this.h - this.keyboardHeight();
    if (y < kbTop) return null;
    const blackH = this.keyboardHeight() * 0.62;
    if (y < kbTop + blackH) {
      for (let p = this.lo; p <= this.hi; p++) {
        if (isBlackKey(p) && x >= this.keyX[p] && x <= this.keyX[p] + this.keyW[p]) return p;
      }
    }
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlackKey(p) && x >= this.keyX[p] && x < this.keyX[p] + this.keyW[p]) return p;
    }
    return null;
  }

  private keyboardHeight(): number {
    const s = KEYBOARD_SIZES[this.kbSize];
    return Math.max(s.min, Math.min(s.max, this.h * s.k));
  }

  draw(f: StageFrame): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.kbSize = f.display.keyboardSize;
    this.C = { ...THEMES[f.display.theme ?? 'dark'], R: f.display.handColors.R, L: f.display.handColors.L };
    this.C.Rhit = lighten(this.C.R, 0.55);
    this.C.Lhit = lighten(this.C.L, 0.55);
    const kbH = this.keyboardHeight();
    const fallH = this.h - kbH;
    ctx.fillStyle = this.C.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // Lanes
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) {
        ctx.fillStyle = this.C.laneDark;
        ctx.fillRect(this.keyX[p], 0, this.keyW[p], fallH);
      } else if (p % 12 === 0) {
        ctx.fillStyle = this.C.octaveLine;
        ctx.fillRect(this.keyX[p], 0, 1, fallH);
      }
    }

    const song = this.song;
    const visibleBeats = Math.max(2, (f.display.fallSeconds || 3.2) * f.bps);
    const ppb = fallH / visibleBeats;
    const yOf = (beat: number) => fallH - (beat - f.beat) * ppb;

    if (song) {
      // Loop region: dim everything outside it.
      if (f.loop) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const yStart = yOf(f.loop.start);
        const yEnd = yOf(f.loop.end);
        if (yStart < fallH) ctx.fillRect(0, Math.max(0, yStart), this.w, fallH - Math.max(0, yStart));
        if (yEnd > 0) ctx.fillRect(0, 0, this.w, Math.min(fallH, yEnd));
      }
      // Bar lines
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      for (const m of song.measures) {
        const y = yOf(m.start);
        if (y < -2 || y > fallH) continue;
        ctx.fillStyle = this.C.barLine;
        ctx.fillRect(0, Math.round(y), this.w, 1);
        if (m.number > 0) {
          ctx.fillStyle = this.C.barText;
          ctx.fillText(String(m.number), 6, y - 3);
        }
      }

      if (f.showFalling) this.drawNotes(f, song, fallH, yOf, ppb);
    }

    // Hit line
    const grad = ctx.createLinearGradient(0, fallH - 6, 0, fallH);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, f.waiting ? 'rgba(255,209,102,0.35)' : 'rgba(255,255,255,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, fallH - 6, this.w, 6);

    this.drawKeyboard(f, fallH, kbH);
    this.drawFlashes(f, fallH);
  }

  private drawNotes(f: StageFrame, song: Song, fallH: number, yOf: (b: number) => number, ppb: number) {
    const { ctx } = this;
    const top = f.beat + fallH / ppb;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, fallH);
    ctx.clip();
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const n of song.notes) {
      if (n.start > top) break;
      if (n.start + n.dur < f.beat - 0.01) continue;
      if (n.pitch < this.lo || n.pitch > this.hi) continue;
      const yBottom = yOf(n.start);
      const yTop = yOf(n.start + n.dur);
      const x = this.keyX[n.pitch] + 1.5;
      const w = this.keyW[n.pitch] - 3;
      const h = Math.max(4, yBottom - yTop - 2);
      const mark = f.marks ? f.marks[n.id] : NoteMark.Pending;
      const user = mark !== NoteMark.Auto && f.userHands.includes(n.hand);
      const C = this.C;
      const mode = f.display.noteColors;
      const finger = this.fingers.get(n.id) ?? 0;
      const base =
        mode === 'pitch' ? pitchColor(n.pitch, 62) : mode === 'finger' && finger ? FINGER_COLORS[finger] : n.hand === 'R' ? C.R : C.L;
      const played =
        mode === 'pitch' ? pitchColor(n.pitch, 82) : mode === 'finger' && finger ? lighten(FINGER_COLORS[finger], 0.5) : n.hand === 'R' ? C.Rhit : C.Lhit;
      let fill: string;
      if (!user) fill = C.auto;
      else if (f.hideCues) fill = base;
      else if (mark === NoteMark.Hit) fill = played;
      else if (mark === NoteMark.Missed) fill = C.missed;
      else if (mark === NoteMark.Early || mark === NoteMark.Late) fill = C.off;
      else fill = base;
      ctx.globalAlpha = mark === NoteMark.Missed ? 0.55 : 1;
      roundRect(ctx, x, yTop + 1, w, h, 5);
      ctx.fillStyle = fill;
      const glowing = f.display.noteGlow && user && n.start <= f.beat + 0.05 && n.start + n.dur > f.beat;
      if (glowing) {
        ctx.shadowColor = fill;
        ctx.shadowBlur = 14;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (!user) {
        ctx.fillStyle = n.hand === 'R' ? C.R : C.L;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, yTop + 3, 2, Math.max(2, h - 4));
      } else if (mark === NoteMark.Pending && n.start <= f.beat + 0.02 && n.start + n.dur > f.beat) {
        // Sounding now: outline it
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (f.display.noteLabels && h >= 18 && w >= 14 && user) {
        const style = f.display.nameStyle === 'octave' && w < 24 ? 'letter' : f.display.nameStyle;
        const label = mode === 'finger' && finger ? String(finger) : noteLabel(n.pitch, style, f.preferFlats);
        ctx.font = `600 ${label.length > 3 && w < 26 ? 8 : 10}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(8,10,14,0.75)';
        ctx.fillText(label, x + w / 2, yTop + 1 + h - 3);
      }
    }
    ctx.restore();
  }

  private handOfTarget(f: StageFrame, pitch: number): Hand {
    const song = this.song;
    if (!song) return 'R';
    let best: Hand = pitch >= 60 ? 'R' : 'L';
    let bestD = Infinity;
    for (const n of song.notes) {
      if (n.pitch !== pitch) continue;
      const d = Math.abs(n.start - f.beat);
      if (d < bestD) {
        bestD = d;
        best = n.hand;
      }
      if (n.start > f.beat + 4) break;
    }
    return best;
  }

  private drawKeyboard(f: StageFrame, y0: number, kbH: number) {
    const { ctx } = this;
    const targets = new Set(f.display.showTargets ? f.targets : []);
    const pulse = 0.5 + 0.5 * Math.sin(f.now / 160);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const keyFill = (p: number, base: string): string => {
      const kind = f.held.get(p);
      if (kind !== undefined) {
        if (f.hideCues) return this.C.neutral;
        return kind === 'good' ? this.C.good : kind === 'wrong' ? this.C.wrong : this.C.neutral;
      }
      return base;
    };

    // White keys
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) continue;
      const x = this.keyX[p];
      const w = this.keyW[p];
      ctx.fillStyle = keyFill(p, this.C.white);
      ctx.fillRect(x + 0.5, y0, w - 1, kbH - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + 0.5, y0 + kbH - 8, w - 1, 6);
      if (targets.has(p) && !f.held.has(p)) {
        const hand = this.handOfTarget(f, p);
        ctx.fillStyle = hand === 'R' ? this.C.R : this.C.L;
        ctx.globalAlpha = f.waiting ? 0.55 + 0.45 * pulse : 0.9;
        ctx.fillRect(x + 3, y0 + kbH - 26, w - 6, 16);
        ctx.globalAlpha = 1;
      }
      const labels = f.display.keyLabels;
      const showName = labels === 'white' || labels === 'all' || (labels === 'c' && p % 12 === 0);
      if (showName && w > 10) {
        const label = noteLabel(p, f.display.nameStyle, f.preferFlats);
        const size = Math.min(11, Math.max(7, w * 0.5));
        ctx.font = `${f.held.has(p) ? '700 ' : ''}${size}px system-ui, sans-serif`;
        ctx.fillStyle = f.held.has(p) ? '#0d0f14' : this.C.labelInk;
        ctx.fillText(label, x + w / 2, y0 + kbH - 30, w - 2);
      }
    }
    // Black keys
    const bh = kbH * 0.62;
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlackKey(p)) continue;
      const x = this.keyX[p];
      const w = this.keyW[p];
      ctx.fillStyle = keyFill(p, this.C.black);
      roundRect(ctx, x, y0 - 1, w, bh, 3);
      ctx.fill();
      if (this.C.keyOutline) {
        ctx.strokeStyle = this.C.keyOutline;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (targets.has(p) && !f.held.has(p)) {
        const hand = this.handOfTarget(f, p);
        ctx.fillStyle = hand === 'R' ? this.C.R : this.C.L;
        ctx.globalAlpha = f.waiting ? 0.55 + 0.45 * pulse : 0.95;
        ctx.fillRect(x + 2, y0 + bh - 16, w - 4, 12);
        ctx.globalAlpha = 1;
      }
      if (f.display.keyLabels === 'all') {
        // Black keys are narrow: the accidental goes above the letter.
        const label = noteLabel(p, f.display.nameStyle === 'octave' ? 'letter' : f.display.nameStyle, f.preferFlats);
        const size = Math.min(10, Math.max(7, w * 0.62));
        ctx.font = `${size}px system-ui, sans-serif`;
        ctx.fillStyle = f.held.has(p) ? '#0d0f14' : '#b9b3a6';
        const [letter, acc] = [label.replace(/[♯♭]/g, ''), label.match(/[♯♭]/)?.[0] ?? ''];
        ctx.fillText(acc, x + w / 2, y0 + bh - 20 - size, w);
        ctx.fillText(letter, x + w / 2, y0 + bh - 20, w);
      }
    }
    // Waiting: glow over the keys to press
    if (f.waiting && targets.size) {
      for (const p of targets) {
        if (p < this.lo || p > this.hi) continue;
        const cx = this.keyX[p] + this.keyW[p] / 2;
        const g = ctx.createRadialGradient(cx, y0, 0, cx, y0, 26);
        g.addColorStop(0, `rgba(255,209,102,${0.35 + 0.3 * pulse})`);
        g.addColorStop(1, 'rgba(255,209,102,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 26, y0 - 26, 52, 52);
      }
    }
  }

  private drawFlashes(f: StageFrame, y0: number) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const fl of f.flashes) {
      if (fl.pitch < this.lo || fl.pitch > this.hi) continue;
      const age = f.now - fl.time;
      if (age < 0 || age > 900) continue;
      const cx = this.keyX[fl.pitch] + this.keyW[fl.pitch] / 2;
      const bad = fl.kind === 'wrong' || fl.kind === 'miss';
      if (age < 350) {
        const k = age / 350;
        const r = 10 + 26 * k;
        const g = ctx.createRadialGradient(cx, y0, 0, cx, y0, r);
        const rgb = bad ? '255,93,108' : fl.kind === 'perfect' ? '255,209,102' : '160,220,255';
        g.addColorStop(0, `rgba(${rgb},${0.7 * (1 - k)})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, y0 - r, r * 2, r * 2);
      }
      if (fl.label) {
        const k = age / 900;
        ctx.globalAlpha = 1 - k;
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.fillStyle = bad ? this.C.wrong : fl.kind === 'perfect' ? '#ffd166' : '#cfe6ff';
        ctx.fillText(fl.label, cx, y0 - 22 - 30 * k);
        ctx.globalAlpha = 1;
      }
    }
  }
}
