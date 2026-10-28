import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DrummerPose, StickPose } from '../motion/pose';
import type { DrummerRig } from './DrummerRig';
import { solveTwoBone } from './ik';

export interface ProceduralStyle {
  /** 피부(고양이는 털) 색 */
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  stick: number;
  /** human = 사람, cat = 고양이(세모 귀), rocker = 한쪽으로 넘긴 긴 머리에 소리 지르는 록커 */
  head: 'human' | 'cat' | 'rocker';
  hair?: number;
  /** 팔다리 굵기 배율 */
  bulk?: number;
  /** 박에 맞춘 고개 흔들기 세기 (1 = 살짝 끄덕임) */
  headbang?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SEAT = new THREE.Vector3(0, 0.53, 0.42);
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const THIGH = 0.43;
const SHIN = 0.42;
const STICK_LEN = 0.41;
/** 손에서 스틱 끝까지 거리(뒤쪽 5cm는 손 뒤로 나온다) */
const GRIP_TO_TIP = 0.36;

/** 2등신에 가까운 큰 머리: 귀여운 인상의 핵심 */
const HEAD_R = 0.155;
/** 목 위 끝(머리가 도는 축)과 그 위 머리 중심까지의 거리 */
const NECK_TOP = 0.54;
const HEAD_LIFT = 0.13;
/** 목이 돌 수 있는 범위(라디안) */
const MAX_YAW = 0.55;
const MAX_LOOK_DOWN = 0.6;
const MAX_LOOK_UP = 0.3;

const EYE = 0x1d1a26;

/**
 * 기본 도형으로 만든 단순한 캐릭터: 큰 머리와 점 눈. 팔·다리는 2관절 IK로 목표를 따라간다.
 * 목은 몸통에 붙어 있고 머리는 목 위 끝을 축으로 정해진 범위 안에서만 돈다.
 */
export class ProceduralRig implements DrummerRig {
  readonly root = new THREE.Group();
  private upper = new THREE.Group();
  /** 목 위 끝에 있는 머리 축. 이 그룹의 +Z가 얼굴 방향 */
  private head = new THREE.Group();
  private shoulderL = new THREE.Object3D();
  private shoulderR = new THREE.Object3D();
  private arms: Record<'RH' | 'LH', Limb>;
  private legs: Record<'RF' | 'LF', Limb>;
  private sticks: Record<'RH' | 'LH', THREE.Mesh>;
  private feet: Record<'RF' | 'LF', THREE.Group>;
  private eyes: THREE.Object3D[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private yaw = 0;
  private pitch = 0.3;
  private nextBlink = 2;
  /** 록커: 뒤처져 따라오는 머리카락 묶음과 벌린 입 */
  private hair: THREE.Group | null = null;
  private mouth: THREE.Object3D | null = null;
  private hairSpring = { x: 0.3, z: 0, v: { x: 0, z: 0 } };
  private lastTime = 0;

  // 계산용 임시 벡터
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(private style: ProceduralStyle) {
    const bulk = style.bulk ?? 1;
    const skin = this.mat(style.skin, 0.65);
    const shirt = this.mat(style.shirt, 0.8);
    const pants = this.mat(style.pants, 0.85);
    const shoes = this.mat(style.shoes, 0.6);
    const stickMat = this.mat(style.stick, 0.5);

    // 골반과 상체: 상체는 골반을 축으로 기울고 돈다
    const hips = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.32, 0.14, 0.24, 3, 0.05)), pants);
    hips.position.copy(SEAT).add(new THREE.Vector3(0, 0.04, 0));
    hips.castShadow = true;
    this.root.add(hips);

    this.upper.position.copy(SEAT).add(new THREE.Vector3(0, 0.06, 0));
    this.upper.rotation.order = 'YXZ';
    this.root.add(this.upper);
    const torso = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.15 * bulk, 0.18, 8, 20)), shirt);
    torso.scale.z = 0.8;
    torso.position.y = 0.25;
    torso.castShadow = true;
    this.upper.add(torso);

    this.shoulderL.position.set(-0.19, 0.46, -0.02);
    this.shoulderR.position.set(0.19, 0.46, -0.02);
    this.upper.add(this.shoulderL, this.shoulderR);

    // 목은 몸통에 붙어 있다 (머리를 돌려도 몸통에서 떨어지지 않는다)
    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 12)), skin);
    neck.position.set(0, NECK_TOP - 0.05, -0.01);
    this.upper.add(neck);
    this.head.position.set(0, NECK_TOP, -0.01);
    this.head.rotation.order = 'YXZ';
    this.upper.add(this.head);
    this.buildFace(skin);

    const armRadius = 0.046 * bulk;
    this.arms = {
      RH: new Limb(this, armRadius, armRadius * 0.9, shirt, skin, shirt, skin, 0.052),
      LH: new Limb(this, armRadius, armRadius * 0.9, shirt, skin, shirt, skin, 0.052),
    };
    const legRadius = 0.07 * bulk;
    this.legs = {
      RF: new Limb(this, legRadius, legRadius * 0.85, pants, pants, pants, pants, 0),
      LF: new Limb(this, legRadius, legRadius * 0.85, pants, pants, pants, pants, 0),
    };
    for (const l of [...Object.values(this.arms), ...Object.values(this.legs)]) this.root.add(l.group);

    const stickGeo = this.geo(new THREE.CylinderGeometry(0.0075, 0.0055, STICK_LEN, 8));
    stickGeo.translate(0, STICK_LEN / 2, 0);
    this.sticks = { RH: new THREE.Mesh(stickGeo, stickMat), LH: new THREE.Mesh(stickGeo, stickMat) };
    for (const s of Object.values(this.sticks)) {
      s.castShadow = true;
      const tip = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.01, 8, 6)), stickMat);
      tip.position.y = STICK_LEN;
      s.add(tip);
      this.root.add(s);
    }

    // 둥근 신발
    const shoeGeo = this.geo(new THREE.CapsuleGeometry(0.05, 0.17, 4, 12));
    const makeFoot = () => {
      const g = new THREE.Group();
      const shoe = new THREE.Mesh(shoeGeo, shoes);
      shoe.rotation.x = Math.PI / 2;
      shoe.scale.set(1.05, 1, 0.75);
      shoe.position.set(0, 0.038, -0.1);
      shoe.castShadow = true;
      g.add(shoe);
      this.root.add(g);
      return g;
    };
    this.feet = { RF: makeFoot(), LF: makeFoot() };

  }

  apply(pose: DrummerPose) {
    // 박에 맞춰 고개를 끄덕이고 몸을 살짝 들썩인다 (박이 시작될 때 가장 크게)
    const groove = pose.beat >= 0 ? (1 - pose.beat) ** 3 : 0;
    const bang = this.style.headbang ?? 1;
    // 헤드뱅잉: 박마다 좌우를 번갈아 가며 고개를 갸웃한다
    const side = pose.beat >= 0 ? (pose.beatIndex % 2 === 0 ? 1 : -1) : 0;

    // 상체: 손이 가는 방향으로 살짝 돌고, 멀리 뻗으면 앞으로 숙인다
    const midX = (pose.RH.strike.x + pose.LH.strike.x) / 2;
    const midZ = (pose.RH.strike.z + pose.LH.strike.z) / 2;
    const reachY = Math.max(pose.RH.strike.y, pose.LH.strike.y);
    this.upper.rotation.y = THREE.MathUtils.lerp(this.upper.rotation.y, -midX * 0.35, 0.15);
    const lean = -0.1 + THREE.MathUtils.clamp(midZ + 0.2, -0.4, 0.2) * 0.35 - Math.max(0, reachY - 1.1) * 0.2;
    this.upper.rotation.x = THREE.MathUtils.lerp(this.upper.rotation.x, lean + groove * 0.04 * (bang - 1), 0.15);
    this.upper.position.y = SEAT.y + 0.06 - groove * 0.006 * bang;
    this.upper.updateMatrixWorld(true);

    this.aimHead(pose.lookAt, groove * bang, groove * side * 0.12 * (bang - 1));
    this.animateFace(pose.time, groove);

    this.applyArm('RH', pose.RH, this.shoulderR, 1);
    this.applyArm('LH', pose.LH, this.shoulderL, -1);
    this.applyLeg('RF', pose.RF.heel, pose.RF.angle, 1);
    this.applyLeg('LF', pose.LF.heel, pose.LF.angle, -1);
  }

  /** 목이 돌 수 있는 범위 안에서 시선 쪽으로 머리를 돌린다 */
  private aimHead(target: THREE.Vector3, groove: number, roll = 0) {
    const dir = this.upper.worldToLocal(this.v1.copy(target)).sub(this.head.position);
    // 몸통 기준 정면은 -Z. 오른쪽(+X)을 보려면 Y축으로 음의 방향으로 돈다
    const yaw = THREE.MathUtils.clamp(-Math.atan2(dir.x, -dir.z), -MAX_YAW, MAX_YAW);
    const down = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -MAX_LOOK_UP, MAX_LOOK_DOWN);
    this.yaw = THREE.MathUtils.lerp(this.yaw, yaw, 0.2);
    this.pitch = THREE.MathUtils.lerp(this.pitch, down, 0.2);
    // 얼굴은 머리 그룹의 +Z에 있으므로 반 바퀴 돌려 몸통 정면(-Z)을 보게 한다
    this.head.rotation.set(this.pitch + groove * 0.12, Math.PI + this.yaw, roll);
  }

  private animateFace(time: number, groove: number) {
    // 3~5초마다 눈을 깜빡인다
    if (time > this.nextBlink + 0.14) this.nextBlink = time + 2.5 + Math.random() * 2.5;
    const blinking = time > this.nextBlink;
    for (const e of this.eyes) e.scale.y = blinking ? 0.12 : 1;
    if (this.mouth) this.mouth.scale.y = 0.8 + groove * 0.9; // 박마다 "예에!" 하고 입을 더 벌린다
    this.swingHair(time);
  }

  /**
   * 머리카락은 머리를 늦게 따라온다: 머리 기울기를 목표로 하는 스프링이라 고개를 세게 흔들수록
   * 반대로 젖혀졌다가 출렁이며 따라온다
   */
  private swingHair(time: number) {
    if (!this.hair) return;
    const dt = Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const h = this.hairSpring;
    for (const axis of ['x', 'z'] as const) {
      const target = axis === 'x' ? this.head.rotation.x : this.head.rotation.z;
      const a = (target - h[axis]) * 260 - h.v[axis] * 14;
      h.v[axis] += a * dt;
      h[axis] += h.v[axis] * dt;
    }
    // 머리 기준 회전이므로 (따라오는 각도 - 지금 머리 각도)만큼 뒤처진다
    this.hair.rotation.x = THREE.MathUtils.clamp(h.x - this.head.rotation.x, -0.7, 0.7);
    this.hair.rotation.z = THREE.MathUtils.clamp(h.z - this.head.rotation.z, -0.6, 0.6);
  }

  private applyArm(limb: 'RH' | 'LH', stick: StickPose, shoulderObj: THREE.Object3D, side: number) {
    const shoulder = shoulderObj.getWorldPosition(this.v1);
    // 스틱 뒤쪽이 향하는 기준점: 어깨보다 아래·뒤쪽(팔꿈치를 몸 옆에 둔 자세)
    const anchor = this.v2.copy(shoulder).add(this.v3.set(side * 0.04, -0.33, 0.1));
    const toAnchor = anchor.sub(stick.strike).normalize();
    // 손은 스틱 끝에서 GRIP_TO_TIP만큼 떨어진 곳. 들어 올릴 때 손은 일부만 올라가고 나머지는 손목이 꺾인다
    const hand = this.v3.copy(stick.strike).addScaledVector(toAnchor, GRIP_TO_TIP);
    hand.y += stick.lift * 0.4;

    const pole = this.v4.set(side * 1, -1.1, 0.6).normalize();
    const reached = this.arms[limb].solve(shoulder, hand, UPPER_ARM, FOREARM, pole);

    const s = this.sticks[limb];
    s.position.copy(reached);
    const dir = this.v2.copy(stick.tip).sub(reached).normalize();
    s.quaternion.setFromUnitVectors(UP, dir);
    s.position.addScaledVector(dir, -(STICK_LEN - GRIP_TO_TIP));
  }

  private applyLeg(limb: 'RF' | 'LF', heel: THREE.Vector3, angle: number, side: number) {
    const foot = this.feet[limb];
    foot.position.copy(heel);
    foot.rotation.x = angle;
    const hip = this.v1.copy(SEAT).add(this.v2.set(side * 0.1, 0.02, -0.03));
    const ankle = this.v3.copy(heel).add(this.v4.set(0, 0.08, -0.04));
    this.legs[limb].solve(hip, ankle, THIGH, SHIN, this.v2.set(side * 0.15, 0.4, -1).normalize());
  }

  // ---- 얼굴: 큰 머리, 점 눈, 머리 모양만 남긴 단순한 형태 ----

  private buildFace(skin: THREE.Material) {
    const { style } = this;
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(HEAD_R, 32, 24)), skin);
    head.position.y = HEAD_LIFT;
    head.castShadow = true;
    this.head.add(head);
    this.addDotEyes(this.mat(EYE, 0.4), HEAD_R * 0.97, 0.05);

    if (style.head === 'cat') {
      // 고양이는 세모 귀 두 개로만 알아보게 한다
      const ear = this.geo(new THREE.ConeGeometry(0.07, 0.12, 12));
      for (const side of [-1, 1]) {
        const e = new THREE.Mesh(ear, skin);
        e.position.set(side * 0.085, HEAD_LIFT + 0.12, 0);
        e.rotation.z = -side * 0.4;
        e.castShadow = true;
        this.head.add(e);
      }
      return;
    }
    if (style.head === 'rocker') return this.buildRocker(skin);
    if (style.hair === undefined) return;
    // 앞이마가 보이도록 뒤로 기울인 머리 덮개 하나
    const hair = new THREE.Mesh(this.geo(new THREE.SphereGeometry(HEAD_R * 1.06, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55)), this.mat(style.hair, 0.85));
    hair.position.y = HEAD_LIFT + 0.004;
    hair.rotation.x = -0.5;
    hair.castShadow = true;
    this.head.add(hair);
  }

  /**
   * 병맛 록커: 금발 긴 머리를 한쪽으로 쫙 넘겨 한쪽 눈을 덮고, 뒷머리는 어깨까지 늘어진다.
   * 입은 소리 지르듯 크게 벌렸다. 머리카락은 머리 꼭대기를 축으로 따로 출렁인다.
   */
  private buildRocker(skin: THREE.Material) {
    void skin;
    const blond = this.mat(this.style.hair ?? 0xffd23f, 0.55);
    const pivot = new THREE.Group();
    pivot.position.y = HEAD_LIFT + HEAD_R * 0.8;
    this.head.add(pivot);
    this.hair = pivot;
    const put = (g: THREE.BufferGeometry, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
      const m = new THREE.Mesh(this.geo(g), blond);
      // pivot 기준 위치 (머리 중심 기준 좌표에서 pivot 높이를 뺀다)
      m.position.set(pos[0], pos[1] - pivot.position.y, pos[2]);
      m.scale.set(...scale);
      m.rotation.set(...rot);
      m.castShadow = true;
      pivot.add(m);
      return m;
    };
    const ball = new THREE.SphereGeometry(1, 24, 16);
    // 정수리: 가르마를 한쪽(왼쪽)에 두고 반대쪽으로 부풀린 덮개
    put(new THREE.SphereGeometry(HEAD_R * 1.08, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), [0.012, HEAD_LIFT + 0.006, -0.004], [1.05, 1.08, 1.04], [-0.35, 0, -0.32]);
    // 앞머리: 이마를 가로질러 오른쪽 눈을 덮고 턱 아래까지 쫙 넘긴 큰 한 덩어리
    put(ball, [0.055, HEAD_LIFT + 0.035, HEAD_R * 0.86], [0.12, 0.07, 0.045], [0.25, 0, -0.75]);
    put(ball, [0.115, HEAD_LIFT - 0.07, HEAD_R * 0.62], [0.06, 0.15, 0.05], [0.1, 0, -0.18]);
    // 뒷머리: 어깨 아래까지 늘어지는 긴 머리 (끝이 살짝 바깥으로 뻗친다)
    put(ball, [0, HEAD_LIFT - 0.14, -0.1], [0.16, 0.24, 0.09], [-0.15, 0, 0]);
    put(ball, [-0.12, HEAD_LIFT - 0.17, -0.02], [0.06, 0.2, 0.08], [0, 0, 0.25]);
    put(ball, [0.13, HEAD_LIFT - 0.2, -0.03], [0.065, 0.22, 0.08], [0, 0, -0.3]);

    // 소리 지르는 입
    const mouth = new THREE.Group();
    mouth.position.set(-0.025, HEAD_LIFT - 0.07, HEAD_R * 0.88);
    const hole = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1, 16, 12)), this.mat(0x3a0d16, 0.6));
    hole.scale.set(0.038, 0.032, 0.02);
    mouth.add(hole);
    this.head.add(mouth);
    this.mouth = mouth;
  }

  /** 얼굴 앞(+Z)에 점 눈 두 개. 깜빡일 때 세로로 납작해진다 */
  private addDotEyes(mat: THREE.Material, depth: number, spacing: number) {
    const dot = this.geo(new THREE.SphereGeometry(0.02, 12, 10));
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(dot, mat);
      eye.scale.set(1, 1.25, 0.5);
      eye.position.set(side * spacing, HEAD_LIFT + 0.01, depth);
      this.head.add(eye);
      this.eyes.push(eye);
    }
  }

  // ---- 메시 헬퍼 (Limb에서도 쓴다) ----
  mat(color: number, roughness: number, metalness = 0, emissive = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
    this.materials.push(m);
    return m;
  }
  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  dispose() {
    this.root.removeFromParent();
    this.materials.forEach((m) => m.dispose());
    this.geometries.forEach((g) => g.dispose());
  }
}

/** 두 마디(위팔·아래팔 또는 허벅지·정강이)와 관절 구 */
class Limb {
  readonly group = new THREE.Group();
  private a: THREE.Mesh;
  private b: THREE.Mesh;
  private j0: THREE.Mesh;
  private j1: THREE.Mesh;
  private end: THREE.Mesh | null = null;
  private mid = new THREE.Vector3();
  private endPos = new THREE.Vector3();

  constructor(rig: ProceduralRig, r0: number, r1: number, m0: THREE.Material, m1: THREE.Material, jm0: THREE.Material, jm1: THREE.Material, endRadius: number) {
    const unit = rig.geo(new THREE.CylinderGeometry(1, 1, 1, 12));
    this.a = new THREE.Mesh(unit, m0);
    this.b = new THREE.Mesh(unit, m1);
    this.a.scale.set(r0, 1, r0);
    this.b.scale.set(r1, 1, r1);
    const sphere = rig.geo(new THREE.SphereGeometry(1, 12, 8));
    this.j0 = new THREE.Mesh(sphere, jm0);
    this.j0.scale.setScalar(r0 * 1.05);
    this.j1 = new THREE.Mesh(sphere, jm1);
    this.j1.scale.setScalar(r0 * 0.95);
    this.group.add(this.a, this.b, this.j0, this.j1);
    if (endRadius > 0) {
      this.end = new THREE.Mesh(sphere, m1);
      this.end.scale.setScalar(endRadius);
      this.group.add(this.end);
    }
    for (const m of [this.a, this.b]) m.castShadow = true;
  }

  /** 2관절 IK로 두 마디를 놓는다 (solveTwoBone 참고). @returns 실제로 끝이 닿은 위치 */
  solve(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
    solveTwoBone(root, target, a, b, pole, this.mid, this.endPos);

    place(this.a, root, this.mid);
    place(this.b, this.mid, this.endPos);
    this.j0.position.copy(root);
    this.j1.position.copy(this.mid);
    this.end?.position.copy(this.endPos);
    return this.endPos;
  }
}

const tmpDir = new THREE.Vector3();
function place(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) {
  tmpDir.copy(to).sub(from);
  const len = tmpDir.length();
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / (len || 1)));
  mesh.scale.y = len;
}
