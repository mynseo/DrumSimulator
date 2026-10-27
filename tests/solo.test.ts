import { describe, expect, it } from 'vitest';
import { featuredSolo, randomSolo } from '../src/core/solo';
import { MIN_SAME_HAND_GAP } from '../src/core/sticking';
import { buildTimeline } from '../src/core/timeline';
import type { Score } from '../src/core/types';

/** 사람이 칠 수 있는 솔로인지: 손이 셋 필요한 순간이 없고, 같은 손이 너무 빨리 연타하지 않는다 */
function expectPlayable(score: Score) {
  const tl = buildTimeline(score);
  expect(tl.hits.filter((h) => h.limb === null)).toHaveLength(0);
  for (const limb of ['RH', 'LH'] as const) {
    const hits = tl.byLimb[limb];
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].time - hits[i - 1].time).toBeGreaterThanOrEqual(MIN_SAME_HAND_GAP);
    }
  }
}

describe('드럼 솔로', () => {
  it('정해진 솔로: 8마디, 탐을 모두 쓰고, 칠 수 있다', () => {
    const s = featuredSolo();
    expect(s.bars).toBe(8);
    for (const inst of ['tom1', 'tom2', 'floorTom', 'crash', 'kick', 'snare'] as const) {
      expect(s.notes.some((n) => n.instrument === inst)).toBe(true);
    }
    expectPlayable(s);
  });

  it('랜덤 솔로: 같은 시드는 같은 솔로, 다른 시드는 다른 솔로', () => {
    expect(randomSolo(42)).toEqual(randomSolo(42));
    expect(randomSolo(42).notes).not.toEqual(randomSolo(43).notes);
  });

  it('랜덤 솔로 300개가 모두 칠 수 있고 크래시로 시작한다', () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = randomSolo(seed);
      expect(s.notes.some((n) => n.step === 0 && n.instrument === 'crash')).toBe(true);
      expectPlayable(s);
    }
  });
});
