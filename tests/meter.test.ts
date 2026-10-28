import { describe, expect, it } from 'vitest';
import { barOfStep, barStarts, buildTimeline } from '../src/core/timeline';
import type { Score } from '../src/core/types';

const score = (barBeats?: number[]): Score => ({
  version: 1,
  title: 't',
  bpm: 120,
  beatsPerBar: 4,
  stepsPerBeat: 4,
  bars: 3,
  notes: [
    { step: 0, instrument: 'kick', velocity: 0.75 },
    { step: 18, instrument: 'snare', velocity: 0.75 },
    { step: 40, instrument: 'snare', velocity: 0.75 },
  ],
  ...(barBeats ? { barBeats } : {}),
});

describe('마디마다 다른 박자', () => {
  it('박 수가 없으면 모든 마디가 같은 길이', () => {
    expect(barStarts(score())).toEqual([0, 16, 32, 48]);
  });

  it('3/4 마디가 끼면 그 뒤 마디들이 앞당겨진다', () => {
    const s = score([4, 3, 4]);
    expect(barStarts(s)).toEqual([0, 16, 28, 44]);
    const tl = buildTimeline(s);
    expect(tl.totalSteps).toBe(44);
    expect(tl.duration).toBeCloseTo(44 * (60 / 120 / 4));
    expect(barOfStep(tl.barStarts, 18)).toEqual({ bar: 1, offset: 2 });
    expect(barOfStep(tl.barStarts, 28)).toEqual({ bar: 2, offset: 0 });
    expect(barOfStep(tl.barStarts, 43)).toEqual({ bar: 2, offset: 15 });
  });
});
