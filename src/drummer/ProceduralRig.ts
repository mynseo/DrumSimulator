import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DrummerPose, StickPose } from '../motion/pose';
import type { DrummerRig } from './DrummerRig';

export interface ProceduralStyle {
  /** 피부(고양이는 털, 로봇은 몸체) 색 */
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  stick: number;
  /** human = 사람, cat = 고양이(귀·수염·꼬리), robot = 화면 얼굴 로봇 */
  head: 'human' | 'cat' | 'robot';
  hair?: number;
  /** bob = 단발, spiky = 삐죽 머리 */
  hairStyle?: 'bob' | 'spiky';
  /** 로봇 눈·안테나 불빛 색 */
  glow?: number;
  /** 팔다리 굵기 배율 */
  bulk?: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
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

const BLUSH = 0xff8fa3;
const EYE = 0x1d1a26;

/**
 * 기본 도형으로 만든 귀여운 캐릭터. 팔·다리는 2관절 IK로 목표를 따라간다.
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
  private tail: THREE.Group | null = null;
  private antenna: THREE.Group | null = null;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private yaw = 0;
  private pitch = 0.3;
  private nextBlink = 2;

  // 계산용 임시 벡터
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(private style: ProceduralStyle) {
    const bulk = style.bulk ?? 1;
    const robot = style.head === 'robot';
    const skin = this.mat(style.skin, robot ? 0.35 : 0.65, robot ? 0.5 : 0);
    const shirt = this.mat(style.shirt, 0.8);
    const pants = this.mat(style.pants, 0.85);
    const shoes = this.mat(style.shoes, 0.6);
    const stickMat = this.mat(style.stick, 0.5);
    const joint = robot ? this.mat(0x3a3f48, 0.35, 0.8) : null;

    // 골반과 상체: 상체는 골반을 축으로 기울고 돈다
    const hips = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.32, 0.14, 0.24, 3, 0.05)), pants);
    hips.position.copy(SEAT).add(new THREE.Vector3(0, 0.04, 0));
    hips.castShadow = true;
    this.root.add(hips);

    this.upper.position.copy(SEAT).add(new THREE.Vector3(0, 0.06, 0));
    this.upper.rotation.order = 'YXZ';
    this.root.add(this.upper);
    const torso = robot
      ? new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.36, 0.46, 0.24, 4, 0.08)), shirt)
      : new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.15 * bulk, 0.18, 8, 20)), shirt);
    if (!robot) torso.scale.z = 0.8;
    torso.position.y = 0.25;
    torso.castShadow = true;
    this.upper.add(torso);

    this.shoulderL.position.set(-0.19, 0.46, -0.02);
    this.shoulderR.position.set(0.19, 0.46, -0.02);
    this.upper.add(this.shoulderL, this.shoulderR);

    // 목은 몸통에 붙어 있다 (머리를 돌려도 몸통에서 떨어지지 않는다)
    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 12)), joint ?? skin);
    neck.position.set(0, NECK_TOP - 0.05, -0.01);
    this.upper.add(neck);
    this.head.position.set(0, NECK_TOP, -0.01);
    this.head.rotation.order = 'YXZ';
    this.upper.add(this.head);
    if (style.head === 'robot') this.buildRobotHead(skin);
    else this.buildFace(skin);

    const armRadius = 0.046 * bulk;
    this.arms = {
      RH: new Limb(this, armRadius, armRadius * 0.9, shirt, skin, joint ?? shirt, joint ?? skin, 0.052),
      LH: new Limb(this, armRadius, armRadius * 0.9, shirt, skin, joint ?? shirt, joint ?? skin, 0.052),
    };
    const legRadius = 0.07 * bulk;
    this.legs = {
      RF: new Limb(this, legRadius, legRadius * 0.85, pants, pants, joint ?? pants, joint ?? pants, 0),
      LF: new Limb(this, legRadius, legRadius * 0.85, pants, pants, joint ?? pants, joint ?? pants, 0),
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

    if (style.head === 'cat') this.buildTail(skin);
  }

  apply(pose: DrummerPose) {
    // 박에 맞춰 고개를 끄덕이고 몸을 살짝 들썩인다 (박이 시작될 때 가장 크게)
    const groove = pose.beat >= 0 ? (1 - pose.beat) ** 3 : 0;

    // 상체: 손이 가는 방향으로 살짝 돌고, 멀리 뻗으면 앞으로 숙인다
    const midX = (pose.RH.strike.x + pose.LH.strike.x) / 2;
    const midZ = (pose.RH.strike.z + pose.LH.strike.z) / 2;
    const reachY = Math.max(pose.RH.strike.y, pose.LH.strike.y);
    this.upper.rotation.y = THREE.MathUtils.lerp(this.upper.rotation.y, -midX * 0.35, 0.15);
    const lean = -0.1 + THREE.MathUtils.clamp(midZ + 0.2, -0.4, 0.2) * 0.35 - Math.max(0, reachY - 1.1) * 0.2;
    this.upper.rotation.x = THREE.MathUtils.lerp(this.upper.rotation.x, lean, 0.15);
    this.upper.position.y = SEAT.y + 0.06 - groove * 0.006;
    this.upper.updateMatrixWorld(true);

    this.aimHead(pose.lookAt, groove);
    this.animateFace(pose.time, groove);

    this.applyArm('RH', pose.RH, this.shoulderR, 1);
    this.applyArm('LH', pose.LH, this.shoulderL, -1);
    this.applyLeg('RF', pose.RF.heel, pose.RF.angle, 1);
    this.applyLeg('LF', pose.LF.heel, pose.LF.angle, -1);
  }

  /** 목이 돌 수 있는 범위 안에서 시선 쪽으로 머리를 돌린다 */
  private aimHead(target: THREE.Vector3, groove: number) {
    const dir = this.upper.worldToLocal(this.v1.copy(target)).sub(this.head.position);
    // 몸통 기준 정면은 -Z. 오른쪽(+X)을 보려면 Y축으로 음의 방향으로 돈다
    const yaw = THREE.MathUtils.clamp(-Math.atan2(dir.x, -dir.z), -MAX_YAW, MAX_YAW);
    const down = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -MAX_LOOK_UP, MAX_LOOK_DOWN);
    this.yaw = THREE.MathUtils.lerp(this.yaw, yaw, 0.2);
    this.pitch = THREE.MathUtils.lerp(this.pitch, down, 0.2);
    // 얼굴은 머리 그룹의 +Z에 있으므로 반 바퀴 돌려 몸통 정면(-Z)을 보게 한다
    this.head.rotation.set(this.pitch + groove * 0.12, Math.PI + this.yaw, 0);
  }

  private animateFace(time: number, groove: number) {
    // 3~5초마다 눈을 깜빡인다
    if (time > this.nextBlink + 0.14) this.nextBlink = time + 2.5 + Math.random() * 2.5;
    const blinking = time > this.nextBlink;
    for (const e of this.eyes) e.scale.y = blinking ? 0.12 : 1;
    if (this.tail) this.tail.rotation.y = Math.sin(time * 2.4) * 0.35 + groove * 0.15;
    if (this.antenna) this.antenna.rotation.z = Math.sin(time * 9) * 0.12 * groove;
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

  // ---- 얼굴 ----

  /** 머리 구 표면 위의 점. yaw는 좌우(+는 캐릭터의 왼쪽), pitch는 위아래 */
  private onHead(yaw: number, pitch: number, out = 0): { pos: THREE.Vector3; normal: THREE.Vector3 } {
    const normal = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const pos = normal.clone().multiplyScalar(HEAD_R + out).add(new THREE.Vector3(0, HEAD_LIFT, 0));
    return { pos, normal };
  }

  /** 머리 표면에 붙이고 바깥을 보게 한다 */
  private stick(obj: THREE.Object3D, yaw: number, pitch: number, out = 0) {
    const { pos, normal } = this.onHead(yaw, pitch, out);
    obj.position.copy(pos);
    obj.quaternion.setFromUnitVectors(FORWARD, normal);
    this.head.add(obj);
    return obj;
  }

  private buildFace(skin: THREE.Material) {
    const { style } = this;
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(HEAD_R, 32, 24)), skin);
    head.position.y = HEAD_LIFT;
    head.scale.set(1.04, 0.96, 1);
    head.castShadow = true;
    this.head.add(head);

    // 크고 반짝이는 눈
    const eyeMat = this.mat(EYE, 0.3);
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.materials.push(shine);
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const ball = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.026, 16, 12)), eyeMat);
      ball.scale.set(0.85, 1.2, 0.45);
      const big = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.0085, 8, 6)), shine);
      big.position.set(0.008, 0.012, 0.01);
      const small = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.004, 6, 4)), shine);
      small.position.set(-0.007, -0.009, 0.011);
      eye.add(ball, big, small);
      this.stick(eye, side * 0.36, 0.0, -0.004);
      this.eyes.push(eye);
    }

    // 볼터치
    const blush = new THREE.MeshBasicMaterial({ color: BLUSH, transparent: true, opacity: 0.55, depthWrite: false });
    this.materials.push(blush);
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.024, 20)), blush);
      b.scale.x = 1.35;
      this.stick(b, side * 0.62, -0.2, 0.002);
    }

    const mouthMat = this.mat(0x6b2f36, 0.6);
    if (style.head === 'cat') {
      // 분홍 코와 ω 입, 수염, 세모 귀
      const nose = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.012, 10, 8)), this.mat(0xff8fa3, 0.5));
      nose.scale.set(1.3, 0.9, 0.7);
      this.stick(nose, 0, -0.12, 0);
      const arc = this.geo(new THREE.TorusGeometry(0.011, 0.003, 6, 12, Math.PI));
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(arc, mouthMat);
        m.rotation.z = Math.PI;
        const g = new THREE.Group();
        m.position.x = side * 0.011;
        g.add(m);
        this.stick(g, 0, -0.22, 0);
      }
      const whiskerMat = this.mat(0x4a3b3b, 0.6);
      const whisker = this.geo(new THREE.CylinderGeometry(0.0018, 0.0018, 0.085, 4));
      for (const side of [-1, 1]) {
        for (const tilt of [-0.18, 0.12]) {
          const w = new THREE.Mesh(whisker, whiskerMat);
          w.rotation.z = Math.PI / 2 + tilt * side;
          const g = new THREE.Group();
          w.position.x = side * 0.04;
          g.add(w);
          this.stick(g, side * 0.42, -0.16 + tilt * 0.1, 0.003);
        }
      }
      const earMat = skin;
      const inner = this.mat(0xffb3c1, 0.6);
      for (const side of [-1, 1]) {
        const ear = new THREE.Group();
        const outer = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.075, 0.13, 16)), earMat);
        outer.castShadow = true;
        const pink = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.046, 0.085, 16)), inner);
        pink.position.set(0, -0.012, 0.022);
        ear.add(outer, pink);
        const { pos } = this.onHead(side * 0.5, 0.95, -0.02);
        ear.position.copy(pos);
        ear.rotation.set(0.15, 0, -side * 0.35);
        this.head.add(ear);
      }
      return;
    }

    // 사람: 웃는 입, 귀, 머리카락
    const smile = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.02, 0.0045, 6, 16, Math.PI)), mouthMat);
    smile.rotation.z = Math.PI;
    const g = new THREE.Group();
    g.add(smile);
    this.stick(g, 0, -0.27, 0);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.03, 12, 8)), skin);
      ear.scale.set(0.6, 1, 0.8);
      ear.position.set(side * HEAD_R * 1.02, HEAD_LIFT - 0.01, 0);
      this.head.add(ear);
    }
    if (style.hair === undefined) return;
    const hairMat = this.mat(style.hair, 0.85);
    // 앞이마가 보이도록 뒤로 기울인 머리 덮개
    const cap = new THREE.Mesh(this.geo(new THREE.SphereGeometry(HEAD_R * 1.07, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55)), hairMat);
    cap.position.y = HEAD_LIFT + 0.004;
    cap.rotation.x = -0.5;
    cap.castShadow = true;
    this.head.add(cap);
    if (style.hairStyle === 'spiky') {
      const spike = this.geo(new THREE.ConeGeometry(0.035, 0.11, 10));
      for (let i = 0; i < 9; i++) {
        const yaw = (i / 9) * Math.PI * 2;
        const pitch = 0.75 + (i % 2) * 0.2;
        const s = new THREE.Mesh(spike, hairMat);
        const { pos, normal } = this.onHead(yaw, pitch, -0.01);
        s.position.copy(pos);
        s.quaternion.setFromUnitVectors(UP, normal);
        s.castShadow = true;
        this.head.add(s);
      }
    } else {
      // 동글동글한 앞머리
      const bang = this.geo(new THREE.SphereGeometry(0.045, 12, 8));
      for (const yaw of [-0.55, -0.2, 0.15, 0.5]) {
        const b = new THREE.Mesh(bang, hairMat);
        b.scale.set(1, 0.7, 0.55);
        this.stick(b, yaw, 0.4, -0.005);
      }
    }
  }

  private buildRobotHead(body: THREE.Material) {
    const glow = this.style.glow ?? 0x35f0ff;
    const head = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.32, 0.27, 0.27, 4, 0.07)), body);
    head.position.y = HEAD_LIFT;
    head.castShadow = true;
    this.head.add(head);
    const screen = new THREE.Mesh(this.geo(new RoundedBoxGeometry(0.25, 0.17, 0.02, 3, 0.008)), this.mat(0x12141a, 0.25, 0.2));
    screen.position.set(0, HEAD_LIFT - 0.005, 0.13);
    this.head.add(screen);

    const light = new THREE.MeshBasicMaterial({ color: glow });
    this.materials.push(light);
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const e = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.024, 20)), light);
      e.scale.y = 1.3;
      eye.add(e);
      eye.position.set(side * 0.058, HEAD_LIFT + 0.012, 0.1415);
      this.head.add(eye);
      this.eyes.push(eye);
    }
    const smile = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.02, 0.004, 6, 16, Math.PI)), light);
    smile.rotation.z = Math.PI;
    smile.position.set(0, HEAD_LIFT - 0.035, 0.1415);
    this.head.add(smile);
    const blush = new THREE.MeshBasicMaterial({ color: BLUSH, transparent: true, opacity: 0.7 });
    this.materials.push(blush);
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.016, 16)), blush);
      b.scale.x = 1.4;
      b.position.set(side * 0.092, HEAD_LIFT - 0.028, 0.1415);
      this.head.add(b);
    }

    // 볼트 귀와 통통 튀는 안테나
    const metal = this.mat(0x3a3f48, 0.35, 0.8);
    for (const side of [-1, 1]) {
      const bolt = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16)), metal);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(side * 0.17, HEAD_LIFT, 0);
      this.head.add(bolt);
    }
    this.antenna = new THREE.Group();
    this.antenna.position.set(0, HEAD_LIFT + 0.135, 0);
    const rod = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6)), metal);
    rod.position.y = 0.04;
    const ball = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.022, 12, 10)), new THREE.MeshBasicMaterial({ color: 0xff7a9c }));
    this.materials.push(ball.material as THREE.Material);
    ball.position.y = 0.09;
    this.antenna.add(rod, ball);
    this.head.add(this.antenna);
  }

  private buildTail(fur: THREE.Material) {
    this.tail = new THREE.Group();
    this.tail.position.copy(SEAT).add(new THREE.Vector3(0, 0.08, 0.13));
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.03, 0.1),
      new THREE.Vector3(0.02, 0.15, 0.17),
      new THREE.Vector3(0.05, 0.28, 0.13),
      new THREE.Vector3(0.03, 0.34, 0.06),
    ]);
    const mesh = new THREE.Mesh(this.geo(new THREE.TubeGeometry(curve, 24, 0.028, 10)), fur);
    mesh.castShadow = true;
    const tip = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.028, 10, 8)), fur);
    tip.position.copy(curve.getPoint(1));
    this.tail.add(mesh, tip);
    this.root.add(this.tail);
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
