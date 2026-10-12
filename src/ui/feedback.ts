import { audioCtx, bus } from '../audio/audio';
import { getSettings } from '../store/settings';

/*
 * Optional extras: little sounds for misses and milestones, confetti for achievements, and a
 * spoken coach. Each one checks its own setting, so callers can use them freely.
 */

type Sfx = 'miss' | 'combo' | 'success' | 'levelup';

let lastSfx = 0;

export function sfx(kind: Sfx): void {
  if (!getSettings().sfx) return;
  const now = performance.now();
  if (kind === 'miss' && now - lastSfx < 150) return;
  lastSfx = now;
  const ctx = audioCtx();
  const t = ctx.currentTime + 0.01;
  const notes: Record<Sfx, Array<[number, number]>> = {
    miss: [[180, 0]],
    combo: [
      [880, 0],
      [1320, 0.07],
    ],
    success: [
      [660, 0],
      [880, 0.09],
      [1320, 0.18],
    ],
    levelup: [
      [523, 0],
      [659, 0.08],
      [784, 0.16],
      [1047, 0.26],
    ],
  };
  for (const [f, dt] of notes[kind]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === 'miss' ? 'triangle' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + dt);
    g.gain.linearRampToValueAtTime(kind === 'miss' ? 0.25 : 0.18, t + dt + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + (kind === 'miss' ? 0.18 : 0.3));
    o.connect(g).connect(bus('metronome'));
    o.start(t + dt);
    o.stop(t + dt + 0.35);
  }
}

/** A burst of confetti over the whole window. */
export function celebrate(): void {
  if (!getSettings().celebrations || typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const colors = ['#ffd166', '#4c9dff', '#38c98a', '#ff5d6c', '#a78bfa', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
    w: 6 + Math.random() * 6,
  }));
  const start = performance.now();
  const tick = () => {
    const age = performance.now() - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - age / 1800);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
      ctx.restore();
    }
    if (age < 1800) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

/** Reads text aloud when the spoken coach is on. */
export function say(text: string): void {
  const s = getSettings();
  if (!s.voice || typeof speechSynthesis === 'undefined' || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[–—]/g, ' to ').replace(/[^\p{L}\p{N}\s.,:%!?'-]/gu, ''));
  u.rate = s.voiceRate;
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}
