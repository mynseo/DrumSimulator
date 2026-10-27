import * as THREE from 'three';

const dir = new THREE.Vector3();
const perp = new THREE.Vector3();

/**
 * 2관절 IK: root에서 target까지 길이 a, b인 두 마디(위팔·아래팔, 허벅지·정강이)를 놓는다.
 * 닿지 않으면 최대한 뻗는다. 가운데 관절(팔꿈치·무릎)은 pole 쪽으로 굽는다.
 * 결과는 outMid(가운데 관절), outEnd(끝: 손목·발목)에 쓴다.
 */
export function solveTwoBone(
  root: THREE.Vector3,
  target: THREE.Vector3,
  a: number,
  b: number,
  pole: THREE.Vector3,
  outMid: THREE.Vector3,
  outEnd: THREE.Vector3,
) {
  dir.copy(target).sub(root);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4);
  dir.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
  perp.normalize();
  outMid.copy(root).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  outEnd.copy(root).addScaledVector(dir, d);
}
