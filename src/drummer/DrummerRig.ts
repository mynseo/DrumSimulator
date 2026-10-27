import type * as THREE from 'three';
import type { DrummerPose } from '../motion/pose';
import type { Seat } from '../scene/DrumKit';

/**
 * 드러머 캐릭터가 지켜야 하는 약속. 새 캐릭터(예: glTF로 불러온 3D 모델)는
 * 이 인터페이스만 구현하면 모션 플래너·드럼 세트와 그대로 함께 동작한다.
 */
export interface DrummerRig {
  readonly root: THREE.Object3D;
  /** 이 캐릭터 체형에 맞는 의자 위치. 없으면 기본 의자 */
  readonly seat?: Seat;
  /** 모델 파일을 불러오는 캐릭터: 다 불러오면 끝나고, 실패하면 오류로 끝난다 */
  readonly loaded?: Promise<void>;
  /** 매 프레임 모션 플래너의 자세를 받아 몸을 움직인다 */
  apply(pose: DrummerPose): void;
  dispose(): void;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** 3D 모델 파일을 쓰는 캐릭터면 그 경로 (페이지 기준) */
  model?: string;
  create(): DrummerRig;
}
