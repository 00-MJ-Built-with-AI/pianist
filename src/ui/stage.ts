import type { Flash, KeyKind } from '../engine/controllers';
import { NoteMark } from '../engine/types';
import { isBlackKey, pitchName } from '../music/pitch';
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
  noteNames: 'c-only' | 'all' | 'none';
}

const COLORS = {
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
};

const SECONDS_VISIBLE = 3.2;

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

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setSong(song: Song | null, fullKeyboard: boolean): void {
    this.song = song;
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
    return Math.max(70, Math.min(140, this.h * 0.24));
  }

  draw(f: StageFrame): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const kbH = this.keyboardHeight();
    const fallH = this.h - kbH;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // Lanes
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) {
        ctx.fillStyle = COLORS.laneDark;
        ctx.fillRect(this.keyX[p], 0, this.keyW[p], fallH);
      } else if (p % 12 === 0) {
        ctx.fillStyle = COLORS.octaveLine;
        ctx.fillRect(this.keyX[p], 0, 1, fallH);
      }
    }

    const song = this.song;
    const visibleBeats = Math.max(2, SECONDS_VISIBLE * f.bps);
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
        ctx.fillStyle = COLORS.barLine;
        ctx.fillRect(0, Math.round(y), this.w, 1);
        if (m.number > 0) {
          ctx.fillStyle = COLORS.barText;
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
      let fill: string;
      if (!user) fill = COLORS.auto;
      else if (f.hideCues) fill = n.hand === 'R' ? COLORS.R : COLORS.L;
      else if (mark === NoteMark.Hit) fill = n.hand === 'R' ? COLORS.Rhit : COLORS.Lhit;
      else if (mark === NoteMark.Missed) fill = COLORS.missed;
      else if (mark === NoteMark.Early || mark === NoteMark.Late) fill = COLORS.off;
      else fill = n.hand === 'R' ? COLORS.R : COLORS.L;
      ctx.globalAlpha = mark === NoteMark.Missed ? 0.55 : 1;
      roundRect(ctx, x, yTop + 1, w, h, 5);
      ctx.fillStyle = fill;
      ctx.fill();
      if (!user) {
        ctx.fillStyle = n.hand === 'R' ? COLORS.R : COLORS.L;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, yTop + 3, 2, Math.max(2, h - 4));
      } else if (mark === NoteMark.Pending && n.start <= f.beat + 0.02 && n.start + n.dur > f.beat) {
        // Sounding now: outline it
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (h >= 18 && w >= 14 && user) {
        ctx.fillStyle = 'rgba(8,10,14,0.75)';
        ctx.fillText(pitchName(n.pitch, song.keyFifths < 0).replace(/-?\d+$/, ''), x + w / 2, yTop + 1 + h - 3);
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
    const targets = new Set(f.targets);
    const pulse = 0.5 + 0.5 * Math.sin(f.now / 160);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const keyFill = (p: number, base: string): string => {
      const kind = f.held.get(p);
      if (kind !== undefined) {
        if (f.hideCues) return COLORS.neutral;
        return kind === 'good' ? COLORS.good : kind === 'wrong' ? COLORS.wrong : COLORS.neutral;
      }
      return base;
    };

    // White keys
    for (let p = this.lo; p <= this.hi; p++) {
      if (isBlackKey(p)) continue;
      const x = this.keyX[p];
      const w = this.keyW[p];
      ctx.fillStyle = keyFill(p, COLORS.white);
      ctx.fillRect(x + 0.5, y0, w - 1, kbH - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + 0.5, y0 + kbH - 8, w - 1, 6);
      if (targets.has(p) && !f.held.has(p)) {
        const hand = this.handOfTarget(f, p);
        ctx.fillStyle = hand === 'R' ? COLORS.R : COLORS.L;
        ctx.globalAlpha = f.waiting ? 0.55 + 0.45 * pulse : 0.9;
        ctx.fillRect(x + 3, y0 + kbH - 26, w - 6, 16);
        ctx.globalAlpha = 1;
      }
      const showName = f.noteNames === 'all' || (f.noteNames === 'c-only' && p % 12 === 0);
      if (showName && w > 12) {
        ctx.fillStyle = '#7a7466';
        ctx.fillText(f.noteNames === 'all' && p % 12 !== 0 ? pitchName(p)[0] : pitchName(p), x + w / 2, y0 + kbH - 30);
      }
    }
    // Black keys
    const bh = kbH * 0.62;
    for (let p = this.lo; p <= this.hi; p++) {
      if (!isBlackKey(p)) continue;
      const x = this.keyX[p];
      const w = this.keyW[p];
      ctx.fillStyle = keyFill(p, COLORS.black);
      roundRect(ctx, x, y0 - 1, w, bh, 3);
      ctx.fill();
      if (targets.has(p) && !f.held.has(p)) {
        const hand = this.handOfTarget(f, p);
        ctx.fillStyle = hand === 'R' ? COLORS.R : COLORS.L;
        ctx.globalAlpha = f.waiting ? 0.55 + 0.45 * pulse : 0.95;
        ctx.fillRect(x + 2, y0 + bh - 16, w - 4, 12);
        ctx.globalAlpha = 1;
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
        ctx.fillStyle = bad ? COLORS.wrong : fl.kind === 'perfect' ? '#ffd166' : '#cfe6ff';
        ctx.fillText(fl.label, cx, y0 - 22 - 30 * k);
        ctx.globalAlpha = 1;
      }
    }
  }
}
