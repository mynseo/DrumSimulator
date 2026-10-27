import type * as THREE from 'three';
import type { DrummerPose } from '../motion/pose';

/**
 * 드러머 캐릭터가 지켜야 하는 약속. 새 캐릭터(예: glTF로 불러온 3D 모델)는
 * 이 인터페이스만 구현하면 모션 플래너·드럼 세트와 그대로 함께 동작한다.
 */
export interface DrummerRig {
  readonly root: THREE.Object3D;
  /** 매 프레임 모션 플래너의 자세를 받아 몸을 움직인다 */
  apply(pose: DrummerPose): void;
  dispose(): void;
}

export interface CharacterDef {
  id: string;
  name: string;
  create(): DrummerRig;
}
