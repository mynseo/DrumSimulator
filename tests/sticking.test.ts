import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { buildTimeline, FLAM_GAP } from '../src/core/timeline';
import type { Score, ScoreNote } from '../src/core/types';

const score = (notes: ScoreNote[], bpm = 100, bars = 1): Score => ({
  version: 1, title: 't', bpm, beatsPerBar: 4, stepsPerBeat: 4, bars, notes,
});
const n = (step: number, instrument: ScoreNote['instrument'], hand?: 'R' | 'L'): ScoreNote => ({ step, instrument, velocity: 0.75, hand });

describe('손발 배정', () => {
  it('기본 그루브: 하이햇은 오른손, 스네어는 왼손, 킥은 오른발', () => {
    const tl = buildTimeline(PRESETS[0].score);
    for (const h of tl.hits) {
      if (h.instrument === 'hihatClosed') expect(h.limb).toBe('RH');
      if (h.instrument === 'snare') expect(h.limb).toBe('LH');
      if (h.instrument === 'kick') expect(h.limb).toBe('RF');
    }
  });

  it('16분음표 스네어 필인은 손을 번갈아 친다', () => {
    const tl = buildTimeline(score([0, 1, 2, 3, 4, 5, 6, 7].map((s) => n(s, 'snare')), 120));
    const limbs = tl.hits.map((h) => h.limb);
    expect(limbs).toEqual(['RH', 'LH', 'RH', 'LH', 'RH', 'LH', 'RH', 'LH']);
  });

  it('그루브 뒤의 필인은 오른손으로 시작해 번갈아 친다', () => {
    const tl = buildTimeline(PRESETS[1].score);
    const fill = tl.hits.filter((h) => h.step >= 48 && h.instrument !== 'kick').map((h) => h.limb);
    expect(fill.slice(0, 4)).toEqual(['RH', 'LH', 'RH', 'LH']);
  });

  it('지정한 손을 따르고, 다른 손이 나머지를 맡는다', () => {
    const tl = buildTimeline(score([n(0, 'hihatClosed', 'L'), n(0, 'snare')]));
    expect(tl.hits.find((h) => h.instrument === 'hihatClosed')!.limb).toBe('LH');
    expect(tl.hits.find((h) => h.instrument === 'snare')!.limb).toBe('RH');
  });

  it('하이햇 사이의 고스트 스네어는 왼손 (오른손은 하이햇을 계속 친다)', () => {
    const tl = buildTimeline(score([n(0, 'hihatClosed'), n(2, 'hihatClosed'), n(3, 'snare'), n(4, 'hihatClosed')], 112));
    expect(tl.hits.find((h) => h.instrument === 'snare')!.limb).toBe('LH');
  });

  it('1박 크래시는 바로 뒤에 하이햇이 이어져도 오른손', () => {
    const tl = buildTimeline(score([n(0, 'crash'), n(0, 'kick'), n(2, 'hihatClosed'), n(4, 'hihatClosed')], 112));
    expect(tl.hits.find((h) => h.instrument === 'crash')!.limb).toBe('RH');
  });

  it('왼쪽 크래시와 오른쪽 플로어 탐을 같이 치면 팔을 엇갈리지 않는다', () => {
    const tl = buildTimeline(score([n(0, 'crash'), n(0, 'floorTom')]));
    expect(tl.hits.find((h) => h.instrument === 'crash')!.limb).toBe('LH');
    expect(tl.hits.find((h) => h.instrument === 'floorTom')!.limb).toBe('RH');
  });

  it('크래시와 스네어를 같이 치면 크래시는 오른손', () => {
    const tl = buildTimeline(score([n(0, 'crash'), n(0, 'snare')]));
    expect(tl.hits.find((h) => h.instrument === 'crash')!.limb).toBe('RH');
  });

  it('손으로 칠 음이 셋이면 하나는 칠 수 없다고 표시', () => {
    const tl = buildTimeline(score([n(0, 'crash'), n(0, 'snare'), n(0, 'tom1')]));
    expect(tl.hits.filter((h) => h.limb === null)).toHaveLength(1);
  });

  it('같은 손 연타가 너무 빠르면 손을 바꾼다', () => {
    // 200bpm 16분음표 = 0.075초 간격: 하이햇도 한 손으로는 무리
    const tl = buildTimeline(score([0, 1, 2, 3].map((s) => n(s, 'hihatClosed')), 200));
    const limbs = tl.hits.map((h) => h.limb);
    for (let i = 1; i < limbs.length; i++) expect(limbs[i]).not.toBe(limbs[i - 1]);
  });

  it('모든 예제가 손 세 개를 요구하지 않는다', () => {
    for (const p of PRESETS) {
      const tl = buildTimeline(p.score);
      expect(tl.hits.filter((h) => h.limb === null), p.name).toHaveLength(0);
    }
  });

  it('오른쪽 크래시: 혼자서도, 스네어·하이햇과 함께여도 오른손이 친다 (팔이 엇갈리지 않게)', () => {
    const limb = (notes: ScoreNote[], inst: string) => {
      const tl = buildTimeline(score(notes));
      return tl.hits.filter((h) => h.instrument === inst).map((h) => h.limb);
    };
    expect(limb([n(0, 'crash2'), n(0, 'kick')], 'crash2')).toEqual(['RH']);
    expect(limb([n(0, 'crash2'), n(0, 'snare')], 'crash2')).toEqual(['RH']);
    expect(limb([n(0, 'crash2'), n(0, 'hihatClosed')], 'hihatClosed')).toEqual(['LH']);
  });

  it('플램: 반대 손이 조금 먼저 약하게 치고, 그 손이 바쁘면 꾸밈음은 생략한다', () => {
    const tl = buildTimeline(score([{ ...n(4, 'snare'), velocity: 1, flam: true }, n(8, 'hihatClosed'), { ...n(8, 'snare'), flam: true }]));
    const at4 = tl.hits.filter((h) => h.step === 4);
    const main = at4.find((h) => !h.grace)!;
    const grace = at4.find((h) => h.grace)!;
    expect(grace.limb).not.toBe(main.limb);
    expect(main.time - grace.time).toBeCloseTo(FLAM_GAP, 6);
    expect(grace.velocity).toBeLessThan(0.5);
    // 하이햇(오른손)과 같이 친 스네어 플램: 오른손이 바빠서 꾸밈음이 없다
    expect(tl.hits.filter((h) => h.step === 8 && h.grace)).toHaveLength(0);
    // 타임라인은 시간 순서다
    expect(tl.hits.every((h, i) => i === 0 || tl.hits[i - 1].time <= h.time)).toBe(true);
  });
});
