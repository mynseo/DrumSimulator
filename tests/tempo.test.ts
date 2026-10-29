import { describe, expect, it } from 'vitest';
import { bpmAtStep, buildTimeline, stepAtTime, timeAtStep } from '../src/core/timeline';
import type { Score } from '../src/core/types';

const score = (): Score => ({
  version: 1,
  title: 't',
  bpm: 120,
  beatsPerBar: 4,
  stepsPerBeat: 4,
  bars: 2,
  notes: [
    { step: 0, instrument: 'kick', velocity: 0.75 },
    { step: 16, instrument: 'kick', velocity: 0.75 },
    { step: 20, instrument: 'snare', velocity: 0.75 },
  ],
  // 둘째 마디부터 두 배 빠르게
  tempos: [{ step: 16, bpm: 240 }],
});

describe('곡 중간에 바뀌는 빠르기', () => {
  it('칸과 시각을 빠르기 구간마다 바꿔 센다', () => {
    const tl = buildTimeline(score());
    expect(timeAtStep(tl, 16)).toBeCloseTo(2);
    expect(timeAtStep(tl, 20)).toBeCloseTo(2.25);
    expect(stepAtTime(tl, 2.25)).toBeCloseTo(20);
    expect(stepAtTime(tl, 1)).toBeCloseTo(8);
    expect(tl.duration).toBeCloseTo(3);
    expect(bpmAtStep(tl, 15)).toBe(120);
    expect(bpmAtStep(tl, 16)).toBe(240);
    expect(tl.hits.map((h) => h.time)).toEqual([0, 2, 2.25]);
  });

  it('빠르기가 한 번도 안 바뀌면 예전과 같다', () => {
    const s = score();
    delete s.tempos;
    const tl = buildTimeline(s);
    expect(tl.tempo).toHaveLength(1);
    expect(tl.duration).toBeCloseTo(4);
  });
});
