import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/core/presets';
import { buildTimeline } from '../src/core/timeline';
import { CHARACTERS } from '../src/drummer/characters';
import { MotionPlanner } from '../src/motion/MotionPlanner';
import { DrumKit } from '../src/scene/DrumKit';

describe('캐릭터', () => {
  // 모델 파일을 불러오는 캐릭터(glTF)는 브라우저에서만 동작하므로 아래 별도 테스트에서 파일을 검사한다
  for (const def of CHARACTERS.filter((c) => !c.model)) {
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

describe('기사 모델 파일', () => {
  it('앉은 자세와 IK에 필요한 뼈가 모두 들어 있다', async () => {
    const { NodeIO } = await import('@gltf-transform/core');
    const doc = await new NodeIO().read('public/models/knight.glb');
    const names = new Set(doc.getRoot().listNodes().map((n) => n.getName()));
    for (const bone of ['hips', 'spine', 'head', 'upperarm.l', 'lowerarm.l', 'wrist.l', 'upperarm.r', 'lowerarm.r', 'wrist.r',
      'upperleg.l', 'lowerleg.l', 'foot.l', 'toes.l', 'upperleg.r', 'lowerleg.r', 'foot.r', 'toes.r']) {
      expect(names.has(bone), bone).toBe(true);
    }
    const anims = doc.getRoot().listAnimations();
    expect(anims.map((a) => a.getName())).toEqual(['Sit_Chair_Pose']);
    expect(anims[0].listSamplers().every((s) => s.getOutput()!.getCount() > 0)).toBe(true);
  });
});
