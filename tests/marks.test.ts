import { describe, expect, it } from 'vitest';
import { applyMarkMap, describeMark, marksOf, posName } from '../src/core/marks';
import type { Score } from '../src/core/types';

const score = (): Score => ({
  version: 1,
  title: 't',
  bpm: 120,
  beatsPerBar: 4,
  stepsPerBeat: 4,
  bars: 1,
  notes: [
    { step: 0, instrument: 'hihatOpen', velocity: 0.75, mark: 'circleX:9' },
    { step: 0, instrument: 'crash', velocity: 1, mark: 'x:10' },
    { step: 2, instrument: 'hihatClosed', velocity: 0.75, mark: 'x:9' },
    { step: 4, instrument: 'hihatClosed', velocity: 0.75, mark: 'x:9' },
    { step: 4, instrument: 'snare', velocity: 0.75, mark: 'black:5' },
    { step: 6, instrument: 'hihatOpen', velocity: 0.75, mark: 'x:9:o' },
    { step: 8, instrument: 'kick', velocity: 0.75 },
  ],
});

describe('기호별 악기 지정', () => {
  it('악보에 쓰인 기호를 위쪽 자리부터 센다', () => {
    const marks = marksOf(score());
    expect(marks.map((m) => m.mark)).toEqual(['x:10', 'circleX:9', 'x:9', 'x:9:o', 'black:5']);
    expect(marks.find((m) => m.mark === 'x:9')).toMatchObject({ count: 2, instrument: 'hihatClosed', open: false });
    expect(describeMark(marks[3])).toBe('X · 윗줄 위 · o 표시');
  });

  it('오선 자리 이름', () => {
    expect(posName(0)).toBe('맨 아랫줄');
    expect(posName(5)).toBe('셋째 칸');
    expect(posName(10)).toBe('위 덧줄 1');
    expect(posName(11)).toBe('위 덧줄 1 위');
    expect(posName(-2)).toBe('아래 덧줄 1');
  });

  it('기호의 음을 모두 고른 악기로 바꾸고, 같은 칸에 겹치면 센 음 하나만 남긴다', () => {
    const s = score();
    expect(applyMarkMap(s, { 'circleX:9': 'crash' })).toBe(1);
    const at0 = s.notes.filter((n) => n.step === 0);
    expect(at0).toHaveLength(1);
    expect(at0[0]).toMatchObject({ instrument: 'crash', velocity: 1 });
    applyMarkMap(s, { 'x:9': 'ride' });
    expect(s.notes.filter((n) => n.instrument === 'ride').map((n) => n.step)).toEqual([2, 4]);
    // 기호가 없는 음(편집기에서 넣은 음)은 그대로
    expect(s.notes.find((n) => n.step === 8)?.instrument).toBe('kick');
  });
});
