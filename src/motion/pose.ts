import * as THREE from 'three';

/**
 * 모션 플래너가 계산하고 캐릭터 리그가 따라 하는 "드러머 자세".
 * 캐릭터마다 몸 크기가 달라도 같은 자세를 쓸 수 있도록, 관절 각도가 아니라
 * 스틱 끝·발의 목표 위치(월드 좌표)로 표현한다. 각 리그가 IK로 나머지를 푼다.
 */
export interface StickPose {
  /** 스틱 끝의 목표 위치 */
  tip: THREE.Vector3;
  /** 타격면 위로 들어 올린 높이(m). 리그는 이 값으로 손목을 꺾는 정도를 정한다 */
  lift: number;
  /** 스틱이 향하던 타격 지점(들어 올리기 전) */
  strike: THREE.Vector3;
}

export interface FootPose {
  heel: THREE.Vector3;
  /** 발판 각도(라디안, +면 발끝이 들림) */
  angle: number;
}

export interface DrummerPose {
  RH: StickPose;
  LH: StickPose;
  RF: FootPose;
  LF: FootPose;
  /** 시선 */
  lookAt: THREE.Vector3;
  /** 재생 중이면 박 안에서의 위치(0 = 박이 시작되는 순간 … 1), 멈춰 있으면 -1. 고개 끄덕임 등에 쓴다 */
  beat: number;
  /** 흐르는 시간(초). 눈 깜빡임·꼬리 흔들기처럼 박자와 상관없는 움직임용 */
  time: number;
}

export function createPose(): DrummerPose {
  const stick = (): StickPose => ({ tip: new THREE.Vector3(), lift: 0, strike: new THREE.Vector3() });
  const foot = (): FootPose => ({ heel: new THREE.Vector3(), angle: 0 });
  return { RH: stick(), LH: stick(), RF: foot(), LF: foot(), lookAt: new THREE.Vector3(), beat: -1, time: 0 };
}

/**
 * 세기 → 스틱을 들어 올리는 높이 배율. 실제 연주처럼 고스트는 헤드 바로 위에서 톡,
 * 악센트는 높이 들었다가 내려친다: 고스트 ≈ 0.4, 보통 ≈ 0.85, 악센트 = 1.25
 */
export const strokeHeight = (velocity: number) => 0.2 + 1.05 * velocity ** 1.5;
