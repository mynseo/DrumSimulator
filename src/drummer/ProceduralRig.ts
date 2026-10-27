import * as THREE from 'three';
import type { DrummerPose, StickPose } from '../motion/pose';
import type { DrummerRig } from './DrummerRig';

export interface ProceduralStyle {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  stick: number;
  /** 'human' = 둥근 머리, 'robot' = 각진 머리와 관절 */
  head: 'human' | 'robot';
  hair?: number;
  /** 팔다리 굵기 배율 */
  bulk?: number;
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

/** 기본 도형으로 만든 사람형 캐릭터. 팔·다리는 2관절 IK로 목표를 따라간다. */
export class ProceduralRig implements DrummerRig {
  readonly root = new THREE.Group();
  private upper = new THREE.Group();
  private head = new THREE.Group();
  private shoulderL = new THREE.Object3D();
  private shoulderR = new THREE.Object3D();
  private arms: Record<'RH' | 'LH', Limb>;
  private legs: Record<'RF' | 'LF', Limb>;
  private sticks: Record<'RH' | 'LH', THREE.Mesh>;
  private feet: Record<'RF' | 'LF', THREE.Group>;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  // 계산용 임시 벡터
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(style: ProceduralStyle) {
    const bulk = style.bulk ?? 1;
    const skin = this.mat(style.skin, 0.7);
    const shirt = this.mat(style.shirt, 0.8);
    const pants = this.mat(style.pants, 0.85);
    const shoes = this.mat(style.shoes, 0.6);
    const stickMat = this.mat(style.stick, 0.5);
    const joint = style.head === 'robot' ? this.mat(0x30343a, 0.4, 0.8) : null;

    // 골반과 상체: 상체는 골반을 축으로 기울고 돈다
    const hips = this.box(0.3, 0.12, 0.2, pants);
    hips.position.copy(SEAT).add(new THREE.Vector3(0, 0.03, 0));
    this.root.add(hips);

    this.upper.position.copy(SEAT).add(new THREE.Vector3(0, 0.06, 0));
    this.upper.rotation.order = 'YXZ';
    this.root.add(this.upper);
    const torso =
      style.head === 'robot'
        ? this.box(0.34, 0.46, 0.2, shirt)
        : new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.15 * bulk, 0.22, 6, 16)), shirt);
    torso.scale.z = style.head === 'robot' ? 1 : 0.7;
    torso.position.y = 0.26;
    torso.castShadow = true;
    this.upper.add(torso);

    this.shoulderL.position.set(-0.19, 0.48, -0.02);
    this.shoulderR.position.set(0.19, 0.48, -0.02);
    this.upper.add(this.shoulderL, this.shoulderR);

    this.head.position.set(0, 0.66, -0.01);
    this.upper.add(this.head);
    const neck = this.cyl(0.045, 0.1, skin);
    neck.position.y = -0.08;
    this.head.add(neck);
    this.buildHead(style, skin);

    const armRadius = 0.042 * bulk;
    this.arms = {
      RH: new Limb(this, armRadius, armRadius * 0.85, shirt, skin, joint ?? shirt, joint ?? skin, 0.045),
      LH: new Limb(this, armRadius, armRadius * 0.85, shirt, skin, joint ?? shirt, joint ?? skin, 0.045),
    };
    const legRadius = 0.065 * bulk;
    this.legs = {
      RF: new Limb(this, legRadius, legRadius * 0.8, pants, pants, joint ?? pants, joint ?? pants, 0),
      LF: new Limb(this, legRadius, legRadius * 0.8, pants, pants, joint ?? pants, joint ?? pants, 0),
    };
    for (const l of [...Object.values(this.arms), ...Object.values(this.legs)]) this.root.add(l.group);

    const stickGeo = this.geo(new THREE.CylinderGeometry(0.0075, 0.0055, STICK_LEN, 8));
    stickGeo.translate(0, STICK_LEN / 2, 0);
    this.sticks = { RH: new THREE.Mesh(stickGeo, stickMat), LH: new THREE.Mesh(stickGeo, stickMat) };
    for (const s of Object.values(this.sticks)) {
      s.castShadow = true;
      const tip = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.009, 8, 6)), stickMat);
      tip.position.y = STICK_LEN;
      s.add(tip);
      this.root.add(s);
    }

    const makeFoot = () => {
      const g = new THREE.Group();
      const shoe = this.box(0.1, 0.07, 0.27, shoes);
      shoe.position.set(0, 0.035, -0.11);
      g.add(shoe);
      this.root.add(g);
      return g;
    };
    this.feet = { RF: makeFoot(), LF: makeFoot() };
  }

  apply(pose: DrummerPose) {
    // 상체: 손이 가는 방향으로 살짝 돌고, 멀리 뻗으면 앞으로 숙인다
    const midX = (pose.RH.strike.x + pose.LH.strike.x) / 2;
    const midZ = (pose.RH.strike.z + pose.LH.strike.z) / 2;
    const reachY = Math.max(pose.RH.strike.y, pose.LH.strike.y);
    this.upper.rotation.y = THREE.MathUtils.lerp(this.upper.rotation.y, -midX * 0.35, 0.15);
    const lean = -0.1 + THREE.MathUtils.clamp(midZ + 0.2, -0.4, 0.2) * 0.35 - Math.max(0, reachY - 1.1) * 0.2;
    this.upper.rotation.x = THREE.MathUtils.lerp(this.upper.rotation.x, lean, 0.15);
    this.upper.updateMatrixWorld(true);

    this.head.lookAt(pose.lookAt);

    this.applyArm('RH', pose.RH, this.shoulderR, 1);
    this.applyArm('LH', pose.LH, this.shoulderL, -1);
    this.applyLeg('RF', pose.RF.heel, pose.RF.angle, 1);
    this.applyLeg('LF', pose.LF.heel, pose.LF.angle, -1);
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

  private buildHead(style: ProceduralStyle, skin: THREE.Material) {
    if (style.head === 'robot') {
      const h = this.box(0.2, 0.2, 0.2, skin);
      h.position.y = 0.04;
      this.head.add(h);
      const visor = this.box(0.16, 0.05, 0.02, this.mat(0x35f0ff, 0.2, 0, 0x35f0ff));
      visor.position.set(0, 0.06, 0.1);
      this.head.add(visor);
      const antenna = this.cyl(0.006, 0.12, this.mat(0x30343a, 0.4, 0.8));
      antenna.position.set(0, 0.2, 0);
      this.head.add(antenna);
      return;
    }
    const h = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.105, 24, 18)), skin);
    h.scale.set(0.9, 1.05, 0.95);
    h.position.y = 0.05;
    h.castShadow = true;
    this.head.add(h);
    const eyeMat = this.mat(0x111111, 0.3);
    for (const x of [-0.035, 0.035]) {
      const eye = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.012, 8, 6)), eyeMat);
      eye.position.set(x, 0.07, 0.092);
      this.head.add(eye);
    }
    if (style.hair !== undefined) {
      const hair = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.112, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), this.mat(style.hair, 0.9));
      hair.position.y = 0.06;
      hair.rotation.x = -0.35;
      this.head.add(hair);
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
  box(x: number, y: number, z: number, m: THREE.Material) {
    const mesh = new THREE.Mesh(this.geo(new THREE.BoxGeometry(x, y, z)), m);
    mesh.castShadow = true;
    return mesh;
  }
  cyl(r: number, h: number, m: THREE.Material) {
    const mesh = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, h, 12)), m);
    mesh.castShadow = true;
    return mesh;
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
  private dir = new THREE.Vector3();
  private perp = new THREE.Vector3();

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

  /**
   * 2관절 IK: root에서 target까지 길이 a, b인 두 마디를 놓는다.
   * 닿지 않으면 최대한 뻗는다. pole 방향으로 가운데 관절이 굽는다.
   * @returns 실제로 끝이 닿은 위치
   */
  solve(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3): THREE.Vector3 {
    this.dir.copy(target).sub(root);
    const d = THREE.MathUtils.clamp(this.dir.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4);
    this.dir.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    this.perp.copy(pole).addScaledVector(this.dir, -pole.dot(this.dir));
    if (this.perp.lengthSq() < 1e-6) this.perp.set(0, -1, 0);
    this.perp.normalize();
    this.mid.copy(root).addScaledVector(this.dir, a * cosA).addScaledVector(this.perp, a * sinA);
    this.endPos.copy(root).addScaledVector(this.dir, d);

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
