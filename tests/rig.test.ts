import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { buildTimeline } from '../src/core/timeline';
import { CHARACTERS } from '../src/drummer/characters';
import { MotionPlanner } from '../src/motion/MotionPlanner';
import { DrumKit } from '../src/scene/DrumKit';

describe('캐릭터', () => {
  for (const def of CHARACTERS) {
    it(`${def.name}: 연주 내내 몸이 유효한 위치에 있고 머리는 목이 돌 수 있는 범위 안에서만 돈다`, () => {
      const kit = new DrumKit();
      const planner = new MotionPlanner(kit);
      const rig = def.create();
      const tl = buildTimeline(PRESETS[1].score);
      // 정면 기준 머리 방향(몸통 좌표계)
      const head = (rig as unknown as { head: THREE.Group }).head;
      for (let t = 0; t < tl.duration; t += 0.07) {
        rig.apply(planner.compute(tl, t, true, true, t));
        expect(Math.abs(head.rotation.y - Math.PI)).toBeLessThanOrEqual(0.55 + 1e-6);
        expect(head.rotation.x).toBeLessThanOrEqual(0.6 + 0.12 + 1e-6);
      }
      rig.root.updateMatrixWorld(true);
      rig.root.traverse((o) => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      rig.dispose();
    });
  }
});
