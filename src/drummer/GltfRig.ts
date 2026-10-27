import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DrummerPose, StickPose } from '../motion/pose';
import type { Seat } from '../scene/DrumKit';
import type { DrummerRig } from './DrummerRig';
import { solveTwoBone } from './ik';

export interface GltfRigOptions {
  /** 페이지 기준 상대 경로 (예: models/knight.glb) */
  url: string;
  scale: number;
  /** 이 체형에 맞춘 의자 */
  seat: Seat;
  /** 앉는 면에서 hips 뼈까지의 높이 */
  hipsAboveSeat: number;
  /** 의자 중심에서 hips 뼈까지 앞(-)·뒤(+) 거리 */
  hipsBack?: number;
  /**
   * 팔·다리 길이 배율. 2등신 캐릭터는 팔다리가 짧아 드럼과 페달에 닿지 않으므로
   * 관절 사이 거리만 늘린다(굵기는 그대로).
   */
  limbStretch?: { arm: number; leg: number };
  /** 기본 자세로 쓸 애니메이션 (앉은 자세) */
  basePose: string;
  stick: number;
}

/** KayKit 등 흔한 뼈 이름. 왼쪽/오른쪽은 캐릭터 기준 */
const BONES = {
  spine: 'spine',
  head: 'head',
  upperarmL: 'upperarm.l',
  lowerarmL: 'lowerarm.l',
  wristL: 'wrist.l',
  upperarmR: 'upperarm.r',
  lowerarmR: 'lowerarm.r',
  wristR: 'wrist.r',
  upperlegL: 'upperleg.l',
  lowerlegL: 'lowerleg.l',
  footL: 'foot.l',
  toesL: 'toes.l',
  upperlegR: 'upperleg.r',
  lowerlegR: 'lowerleg.r',
  footR: 'foot.r',
  toesR: 'toes.r',
  hips: 'hips',
} as const;
type BoneKey = keyof typeof BONES;

const UP = new THREE.Vector3(0, 1, 0);
const STICK_LEN = 0.41;
const GRIP_TO_TIP = 0.36;
const MAX_HEAD_TURN = 0.45;

/**
 * 뼈대가 있는 glTF 캐릭터. 모델의 앉은 자세를 기본으로 두고, 매 프레임
 * 모션 플래너의 목표(스틱 끝·발)를 팔다리 뼈에 2관절 IK로, 시선을 머리 뼈에 적용한다.
 * 모델은 비동기로 불러오며, 불러오기 전에는 아무것도 그리지 않는다.
 */
export class GltfRig implements DrummerRig {
  readonly root = new THREE.Group();
  readonly seat: Seat;
  readonly loaded: Promise<void>;
  private bones: Record<BoneKey, THREE.Object3D> | null = null;
  private basePose = new Map<THREE.Object3D, THREE.Quaternion>();
  private headForward = new THREE.Vector3();
  private arm = { a: 0, b: 0 };
  private leg = { a: 0, b: 0, foot: 0 };
  private sticks: Record<'RH' | 'LH', THREE.Mesh>;
  private disposed = false;
  private lean = -0.1;
  private twist = 0;

  // 계산용
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private mid = new THREE.Vector3();
  private end = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private q3 = new THREE.Quaternion();

  constructor(private opts: GltfRigOptions) {
    this.seat = opts.seat;
    const stickGeo = new THREE.CylinderGeometry(0.0075, 0.0055, STICK_LEN, 8);
    stickGeo.translate(0, STICK_LEN / 2, 0);
    const stickMat = new THREE.MeshStandardMaterial({ color: opts.stick, roughness: 0.5 });
    this.sticks = { RH: new THREE.Mesh(stickGeo, stickMat), LH: new THREE.Mesh(stickGeo, stickMat) };
    for (const s of Object.values(this.sticks)) {
      s.castShadow = true;
      s.visible = false;
      this.root.add(s);
    }
    this.loaded = this.load();
  }

  get ready() {
    return this.bones !== null;
  }

  private async load() {
    const gltf = await new GLTFLoader().loadAsync(this.opts.url);
    if (this.disposed) return;
    const model = gltf.scene;
    model.scale.setScalar(this.opts.scale);
    model.rotation.y = Math.PI; // glTF 캐릭터는 +Z를 보고, 드러머는 -Z를 본다
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        // 뼈로 움직이는 메시는 원래 경계 상자를 벗어나므로 화면 밖 판정을 끈다
        o.frustumCulled = false;
      }
    });

    // 앉은 자세를 한 번 적용해 두고, 이를 매 프레임의 출발점으로 쓴다
    const clip = gltf.animations.find((a) => a.name === this.opts.basePose);
    if (clip) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(clip).play();
      mixer.update(0);
    }
    const bones = {} as Record<BoneKey, THREE.Object3D>;
    for (const [key, name] of Object.entries(BONES) as [BoneKey, string][]) {
      // GLTFLoader는 이름의 '.'을 지운다 (upperarm.l → upperarml)
      const bone = model.getObjectByName(name) ?? model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
      if (!bone) throw new Error(`${this.opts.url}: '${name}' 뼈를 찾을 수 없습니다`);
      bones[key] = bone;
    }
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.basePose.set(o, o.quaternion.clone());
    });
    const stretch = this.opts.limbStretch;
    if (stretch) {
      // 다음 관절을 더 멀리 둔다(팔꿈치·손목, 무릎·발목). 뼈 크기를 키우면 자식 뼈가 비틀어지므로 위치만 바꾼다
      for (const joint of [bones.lowerarmL, bones.wristL, bones.lowerarmR, bones.wristR]) joint.position.multiplyScalar(stretch.arm);
      for (const joint of [bones.lowerlegL, bones.footL, bones.lowerlegR, bones.footR]) joint.position.multiplyScalar(stretch.leg);
    }

    // hips 뼈를 의자 위 정해진 자리에 놓는다
    this.root.add(model);
    model.updateMatrixWorld(true);
    const hips = bones.hips.getWorldPosition(new THREE.Vector3());
    const want = new THREE.Vector3(0, this.seat.height + this.opts.hipsAboveSeat, this.seat.z + (this.opts.hipsBack ?? 0));
    model.position.add(want.sub(hips));
    model.updateMatrixWorld(true);

    const dist = (a: THREE.Object3D, b: THREE.Object3D) => a.getWorldPosition(this.v1).distanceTo(b.getWorldPosition(this.v2));
    this.arm = { a: dist(bones.upperarmR, bones.lowerarmR), b: dist(bones.lowerarmR, bones.wristR) };
    this.leg = { a: dist(bones.upperlegR, bones.lowerlegR), b: dist(bones.lowerlegR, bones.footR), foot: dist(bones.footR, bones.toesR) };
    // 머리 뼈 좌표계에서의 "얼굴 정면" (월드 -Z)
    this.headForward.set(0, 0, -1).applyQuaternion(bones.head.getWorldQuaternion(this.q1).invert());

    this.bones = bones;
    for (const s of Object.values(this.sticks)) s.visible = true;
  }

  apply(pose: DrummerPose) {
    const b = this.bones;
    if (!b) return;
    for (const [bone, q] of this.basePose) bone.quaternion.copy(q);
    b.hips.updateMatrixWorld(true);

    const groove = pose.beat >= 0 ? (1 - pose.beat) ** 3 : 0;

    // 상체: 손이 가는 쪽으로 돌고 멀리 뻗으면 숙인다 (ProceduralRig와 같은 규칙)
    const midX = (pose.RH.strike.x + pose.LH.strike.x) / 2;
    const midZ = (pose.RH.strike.z + pose.LH.strike.z) / 2;
    const reachY = Math.max(pose.RH.strike.y, pose.LH.strike.y);
    this.twist = THREE.MathUtils.lerp(this.twist, -midX * 0.35, 0.15);
    const lean = -0.1 + THREE.MathUtils.clamp(midZ + 0.2, -0.4, 0.2) * 0.35 - Math.max(0, reachY - 1.1) * 0.2;
    this.lean = THREE.MathUtils.lerp(this.lean, lean, 0.15);
    this.rotateWorld(b.spine, this.q3.setFromEuler(new THREE.Euler(this.lean - groove * 0.03, this.twist, 0, 'YXZ')));

    this.aimHead(b.head, pose.lookAt, groove);
    this.applyArm('RH', pose.RH, b.upperarmR, b.lowerarmR, b.wristR, 1);
    this.applyArm('LH', pose.LH, b.upperarmL, b.lowerarmL, b.wristL, -1);
    this.applyLeg(pose.RF.heel, pose.RF.angle, b.upperlegR, b.lowerlegR, b.footR, b.toesR, 1);
    this.applyLeg(pose.LF.heel, pose.LF.angle, b.upperlegL, b.lowerlegL, b.footL, b.toesL, -1);
  }

  /** 뼈를 월드 기준 회전 delta만큼 더 돌린다 */
  private rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
    const parent = bone.parent!.getWorldQuaternion(this.q1);
    const world = bone.getWorldQuaternion(this.q2).premultiply(delta);
    bone.quaternion.copy(parent.invert().multiply(world));
    bone.updateMatrixWorld(true);
  }

  /** bone→child 방향이 target을 향하도록 bone을 돌린다 */
  private aim(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
    const origin = bone.getWorldPosition(this.v1);
    const current = child.getWorldPosition(this.v2).sub(origin).normalize();
    const wanted = this.v3.copy(target).sub(origin).normalize();
    this.rotateWorld(bone, this.q3.setFromUnitVectors(current, wanted));
  }

  private aimHead(head: THREE.Object3D, target: THREE.Vector3, groove: number) {
    const current = this.v1.copy(this.headForward).applyQuaternion(head.getWorldQuaternion(this.q1));
    const wanted = this.v2.copy(target).sub(head.getWorldPosition(this.v3)).normalize();
    const turn = this.q3.setFromUnitVectors(current, wanted);
    const angle = current.angleTo(wanted);
    if (angle > MAX_HEAD_TURN) turn.slerp(new THREE.Quaternion(), 1 - MAX_HEAD_TURN / angle);
    this.rotateWorld(head, turn);
    if (groove > 0) this.rotateWorld(head, this.q3.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -groove * 0.12));
  }

  private applyArm(limb: 'RH' | 'LH', stick: StickPose, upper: THREE.Object3D, lower: THREE.Object3D, wrist: THREE.Object3D, side: number) {
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    // 손 위치: ProceduralRig와 같은 규칙 (스틱 끝에서 어깨 아래·뒤쪽 기준점 방향으로 GRIP_TO_TIP)
    const anchor = this.v1.copy(shoulder).add(this.v2.set(side * 0.04, -0.33, 0.1));
    const toAnchor = anchor.sub(stick.strike).normalize();
    const hand = new THREE.Vector3().copy(stick.strike).addScaledVector(toAnchor, GRIP_TO_TIP);
    hand.y += stick.lift * 0.4;

    solveTwoBone(shoulder, hand, this.arm.a, this.arm.b, this.v2.set(side, -1.1, 0.6).normalize(), this.mid, this.end);
    this.aim(upper, lower, this.mid);
    this.aim(lower, wrist, this.end);

    const grip = wrist.getWorldPosition(this.v1);
    const s = this.sticks[limb];
    const dir = this.v2.copy(stick.tip).sub(grip);
    // 2등신 캐릭터는 팔이 짧아 먼 심벌에 손이 닿지 않는다: 스틱을 늘려 끝이 닿게 한다(만화식 표현)
    const reach = Math.max(GRIP_TO_TIP, dir.length());
    dir.normalize();
    const butt = STICK_LEN - GRIP_TO_TIP;
    s.quaternion.setFromUnitVectors(UP, dir);
    s.scale.y = (butt + reach) / STICK_LEN;
    s.position.copy(grip).addScaledVector(dir, -butt);
  }

  private applyLeg(
    heel: THREE.Vector3,
    angle: number,
    upper: THREE.Object3D,
    lower: THREE.Object3D,
    foot: THREE.Object3D,
    toes: THREE.Object3D,
    side: number,
  ) {
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const ankle = new THREE.Vector3().copy(heel).add(this.v1.set(0, 0.08, -0.04));
    solveTwoBone(hip, ankle, this.leg.a, this.leg.b, this.v2.set(side * 0.15, 0.4, -1).normalize(), this.mid, this.end);
    this.aim(upper, lower, this.mid);
    this.aim(lower, foot, this.end);
    // 발끝은 페달 발판 방향(앞쪽, 각도만큼 들림)
    const toe = this.v1.set(0, Math.sin(angle), -Math.cos(angle)).multiplyScalar(this.leg.foot).add(foot.getWorldPosition(this.v3));
    this.aim(foot, toes, toe.clone());
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of [m.material].flat()) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
  }
}
