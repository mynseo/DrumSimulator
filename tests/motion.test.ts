import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { MIN_SAME_HAND_GAP } from '../src/core/sticking';
import type { Score } from '../src/core/types';
import { buildTimeline } from '../src/core/timeline';
import { LiveMotion } from '../src/motion/LiveMotion';
import { MotionPlanner } from '../src/motion/MotionPlanner';
import type { DrummerPose } from '../src/motion/pose';
import { DrumKit } from '../src/scene/DrumKit';

const finite = (v: THREE.Vector3) => [v.x, v.y, v.z].every(Number.isFinite);
const poseFinite = (p: DrummerPose) => finite(p.RH.tip) && finite(p.LH.tip) && finite(p.lookAt) && Number.isFinite(p.RF.angle) && Number.isFinite(p.LF.angle);

describe('드러머 자세', () => {
  it('모든 예제(빈 악보 포함)에서 드럼 피드백을 거쳐도 자세가 유효한 숫자다', () => {
    for (const preset of PRESETS) {
      const kit = new DrumKit();
      const planner = new MotionPlanner(kit);
      const tl = buildTimeline(preset.score);
      for (let t = 0; t < tl.duration; t += 0.05) {
        const pose = planner.compute(tl, t, true);
        kit.update(tl, t, true, planner.kickPressValue, planner.hatClosedValue);
        expect(poseFinite(pose), `${preset.name} t=${t.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('타격 순간 스틱 끝이 해당 드럼의 타격 지점에 닿는다', () => {
    const kit = new DrumKit();
    const planner = new MotionPlanner(kit);
    const tl = buildTimeline(PRESETS[1].score);
    for (const h of tl.byLimb.RH.slice(0, 20)) {
      const pose = planner.compute(tl, h.time, true);
      expect(pose.RH.lift).toBeCloseTo(0, 5);
      expect(pose.RH.tip.distanceTo(kit.strikePoint(h.piece))).toBeLessThan(1e-6);
    }
  });

  it('셋잇단·16분·32분음표도 모든 음을 손을 번갈아 가며 실제로 내려친다', () => {
    const kit = new DrumKit();
    const planner = new MotionPlanner(kit);
    const cases: [number, number][] = [[3, 120], [4, 140], [6, 110], [8, 100], [12, 90]];
    for (const [spb, bpm] of cases) {
      const steps = spb * 4;
      const score: Score = {
        version: 1, title: 'roll', bpm, beatsPerBar: 4, stepsPerBeat: spb, bars: 1,
        notes: Array.from({ length: steps }, (_, step) => ({ step, instrument: step % spb === 0 ? 'tom1' : 'snare', velocity: 0.8 })),
      };
      const tl = buildTimeline(score);
      const handHits = [...tl.byLimb.RH, ...tl.byLimb.LH];
      expect(handHits.length, `${spb}칸`).toBe(steps);
      for (const limb of ['RH', 'LH'] as const) {
        const hits = tl.byLimb[limb];
        for (let i = 0; i < hits.length; i++) {
          if (i > 0) expect(hits[i].time - hits[i - 1].time, `${spb}칸 ${limb} 연타 간격`).toBeGreaterThanOrEqual(MIN_SAME_HAND_GAP - 1e-9);
          const pose = planner.compute(tl, hits[i].time, true);
          expect(pose[limb].lift, `${spb}칸 ${limb} ${i}`).toBeCloseTo(0, 5);
          // 다음 타격 전에는 스틱을 다시 들어 올린다
          if (i + 1 < hits.length) {
            const mid = planner.compute(tl, (hits[i].time + hits[i + 1].time) / 2, true);
            expect(mid[limb].lift, `${spb}칸 ${limb} ${i} 사이`).toBeGreaterThan(0.01);
          }
        }
      }
    }
  });

  it('오른쪽 크래시도 스틱 끝이 정확히 닿고, 악센트는 고스트보다 훨씬 높이 든다', () => {
    const kit = new DrumKit();
    const planner = new MotionPlanner(kit);
    const sc: Score = {
      version: 1, title: 'c2', bpm: 90, beatsPerBar: 4, stepsPerBeat: 4, bars: 1,
      notes: [
        { step: 0, instrument: 'crash2', velocity: 1 },
        { step: 0, instrument: 'kick', velocity: 1 },
        { step: 8, instrument: 'snare', velocity: 1 },
        { step: 12, instrument: 'snare', velocity: 0.35 },
      ],
    };
    const tl = buildTimeline(sc);
    const c2 = tl.byPiece.crash2[0];
    expect(c2.limb).toBe('RH');
    const pose = planner.compute(tl, c2.time, true);
    expect(pose.RH.tip.distanceTo(kit.strikePoint('crash2'))).toBeLessThan(1e-6);
    // 같은 간격(4칸) 앞의 가장 높은 지점: 악센트 스네어(8) vs 고스트 스네어(12)
    const peak = (hit: number) => {
      const h = tl.hits[hit];
      const limb = h.limb as 'RH' | 'LH';
      let max = 0;
      for (let t = h.time - 0.3; t < h.time; t += 0.005) max = Math.max(max, planner.compute(tl, t, false)[limb].lift);
      return max;
    };
    const snares = tl.hits.map((h, i) => [h, i] as const).filter(([h]) => h.instrument === 'snare').map(([, i]) => i);
    expect(peak(snares[0])).toBeGreaterThan(peak(snares[1]) * 2);
  });

  it('직접 연주: 친 직후 스틱이 그 드럼에 닿고, 잠시 뒤 원래 자세로 돌아간다', () => {
    const kit = new DrumKit();
    const planner = new MotionPlanner(kit);
    const live = new LiveMotion(kit);
    const tl = buildTimeline(PRESETS.find((p) => p.name === '빈 악보')!.score);
    live.apply(planner.compute(tl, 0, true), 0.9, 0, 1, false);
    live.hit('RH', 'floorTom', 1, 0.8);
    const atHit = live.apply(planner.compute(tl, 0, true), 1.05, 0, 1, false);
    expect(atHit.RH.strike.distanceTo(kit.strikePoint('floorTom'))).toBeLessThan(1e-6);
    const later = live.apply(planner.compute(tl, 0, true), 2, 0, 1, false);
    expect(later.RH.strike.distanceTo(kit.strikePoint('floorTom'))).toBeGreaterThan(0.1);
    expect(poseFinite(later)).toBe(true);
  });
});
