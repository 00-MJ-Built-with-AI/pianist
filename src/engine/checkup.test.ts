import { describe, expect, it } from 'vitest';
import { chordGroups, evaluateCheckup, wavBase64, type StepLog } from './checkup';

const log = (id: string, kind: 'midi' | 'mic', patch: Partial<StepLog> = {}): StepLog => ({
  id,
  kind,
  skipped: false,
  notes: [],
  offs: [],
  pedals: [],
  ccs: [],
  levels: [],
  ...patch,
});
const note = (pitch: number, t: number, velocity = 64) => ({ pitch, t, velocity });
const current = { midiLatency: 10, micLatency: 40, micSensitivity: 0.5 };

describe('piano check-up', () => {
  it('groups notes struck together', () => {
    const g = chordGroups([note(60, 0), note(64, 30), note(67, 50), note(60, 900), note(64, 960)]);
    expect(g.map((x) => x.length)).toEqual([3, 2]);
  });

  it('spots a keyboard that sends a fixed loudness', () => {
    const r = evaluateCheckup([log('midi-touch', 'midi', { notes: [0, 1, 2, 3, 4, 5].map((i) => note(60, i * 500, 100)) })], current);
    expect(r.midi[0].level).toBe('bad');
  });

  it('reports a good loudness range', () => {
    const v = [20, 25, 22, 110, 115, 120];
    const r = evaluateCheckup([log('midi-touch', 'midi', { notes: v.map((x, i) => note(60, i * 500, x)) })], current);
    expect(r.midi[0]).toMatchObject({ level: 'good' });
    expect(r.midi[0].title).toContain('soft 22');
  });

  it('adds the measured delay to the latency corrections', () => {
    const timing = { offsets: [], median: 25, spread: 20 };
    const r = evaluateCheckup([log('midi-timing', 'midi', { timing }), log('mic-timing', 'mic', { timing: { ...timing, median: -10 } })], current);
    expect(r.changes).toEqual({ midiLatency: 35, micLatency: 30 });
    expect(r.changeText).toHaveLength(2);
  });

  it('raises the microphone sensitivity when soft notes go unheard in a quiet room', () => {
    const r = evaluateCheckup(
      [log('mic-quiet', 'mic', { levels: [0.001, 0.0012] }), log('mic-soft', 'mic', { notes: [note(67, 0)] })],
      current,
    );
    expect(r.changes.micSensitivity).toBe(0.65);
  });

  it('lowers it when the room plays notes by itself', () => {
    const r = evaluateCheckup([log('mic-quiet', 'mic', { levels: [0.02], notes: [note(40, 100)] })], current);
    expect(r.changes.micSensitivity).toBe(0.4);
    expect(r.mic.map((f) => f.level)).toEqual(['warn', 'warn']);
  });

  it('ignores skipped steps', () => {
    const r = evaluateCheckup([log('mic-soft', 'mic', { skipped: true })], current);
    expect(r.mic).toEqual([]);
    expect(r.changes).toEqual({});
  });

  it('writes a valid WAV header', () => {
    const b64 = wavBase64(new Float32Array([0, 0.5, -0.5, 1]), 22050);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(44 + 8);
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(22050);
  });
});
