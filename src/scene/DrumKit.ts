import * as THREE from 'three';
import { PIECES } from '../core/instruments';
import { previousHit } from '../core/timeline';
import type { Instrument, Limb, PieceId, Timeline } from '../core/types';

/** 어떤 손발로 쳤는지 색으로 보여 준다 */
export const LIMB_COLORS: Record<Limb, number> = {
  RH: 0xff7a2f,
  LH: 0x2fb8ff,
  RF: 0x7dff6a,
  LF: 0xd77dff,
};
const FEEDBACK_TIME = 0.45;
/** 스네어 헤드 좌표계에서 림샷 때 스틱이 닿는 곳: 드러머 쪽 테 바로 안 (스네어 반지름 0.17) */
const RIM_POINT = new THREE.Vector3(0.03, 0.014, 0.15);

/** 드럼 의자: 앉는 면의 높이와 앞뒤(Z) 위치 */
export interface Seat {
  height: number;
  z: number;
}
export const DEFAULT_SEAT: Seat = { height: 0.51, z: 0.42 };

/** 한 부품이 마지막으로 맞은 정보 (age = 맞은 뒤 지난 초) */
export interface HitFlash {
  age: number;
  limb: Limb | null;
  velocity: number;
}

interface Piece {
  id: PieceId;
  group: THREE.Group;
  /** 맞았을 때 빛나는 부분(헤드나 심벌 표면) */
  glow: THREE.MeshStandardMaterial[];
  /** 흔들림/눌림 애니메이션이 적용되는 부분 */
  wobble: THREE.Object3D;
  strike: THREE.Object3D;
  ring: THREE.Mesh;
  cymbal: boolean;
}

/**
 * 드러머는 원점 근처에 앉아 -Z 방향을 바라본다. 드러머 기준 오른쪽이 +X.
 * 단위는 미터.
 */
export class DrumKit {
  readonly root = new THREE.Group();
  private pieces = {} as Record<PieceId, Piece>;
  private hihatTop!: THREE.Object3D;
  private kickBeater!: THREE.Object3D;
  private kickPedal!: THREE.Object3D;
  private throne = new THREE.Group();
  private throneSeat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.17, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }),
  );
  private throneRod!: THREE.Mesh;
  private hatPedal!: THREE.Object3D;

  private shellMat = new THREE.MeshStandardMaterial({ color: 0x7a1020, metalness: 0.4, roughness: 0.35 });
  private chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.25 });
  private darkMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.6, roughness: 0.5 });

  constructor() {
    this.buildDrum('snare', new THREE.Vector3(-0.24, 0.64, -0.16), 0.17, 0.14, 0.12, new THREE.Vector3(0.02, 0, 0.05));
    this.buildDrum('tom1', new THREE.Vector3(-0.15, 0.86, -0.45), 0.13, 0.22, 0.38, new THREE.Vector3(0, 0, 0.04));
    this.buildDrum('tom2', new THREE.Vector3(0.17, 0.86, -0.45), 0.15, 0.24, 0.38, new THREE.Vector3(0, 0, 0.04));
    this.buildDrum('floorTom', new THREE.Vector3(0.46, 0.5, -0.14), 0.2, 0.4, 0.05, new THREE.Vector3(-0.04, 0, 0.05));
    this.buildKick();
    this.buildCymbal('crash', new THREE.Vector3(-0.52, 1.38, -0.55), 0.23, 0.35, -0.3, new THREE.Vector3(0.05, 0, 0.18));
    // 오른쪽 크래시: 라이드 안쪽 뒤 위. 라이드보다 높고 조금 작다 (얼굴을 가리지 않게 바깥쪽으로)
    this.buildCymbal('crash2', new THREE.Vector3(0.72, 1.34, -0.66), 0.21, 0.38, 0.32, new THREE.Vector3(-0.09, 0, 0.15));
    this.buildCymbal('ride', new THREE.Vector3(0.68, 1.12, -0.42), 0.28, 0.25, 0.25, new THREE.Vector3(-0.1, 0, 0.12));
    this.buildHihat(new THREE.Vector3(-0.5, 0.92, -0.14));
    this.buildThrone();
  }

  /** 각 부품의 타격 지점(월드 좌표). 림샷은 스네어 헤드 가운데가 아니라 드러머 쪽 테를 함께 때린다 */
  strikePoint(piece: PieceId, out = new THREE.Vector3(), instrument?: Instrument): THREE.Vector3 {
    if (instrument === 'rimshot') return this.pieces.snare.wobble.localToWorld(out.copy(RIM_POINT));
    return this.pieces[piece].strike.getWorldPosition(out);
  }

  /** 페달 위에 발을 올리는 지점 */
  readonly rightHeel = new THREE.Vector3(0.08, 0.04, 0.12);
  readonly leftHeel = new THREE.Vector3(-0.32, 0.04, 0.12);

  /**
   * 재생 위치 t에서 피드백과 하이햇/페달 상태를 갱신한다.
   * @param kickPress 0 = 쉼, 1 = 비터가 헤드를 친 순간, 음수 = 뒤로 젖힘
   * @param hatClosed 0 = 하이햇 열림, 1 = 닫힘
   */
  update(
    timeline: Timeline,
    t: number,
    loop: boolean,
    kickPress: number,
    hatClosed: number,
    live: Partial<Record<PieceId, HitFlash>> = {},
  ) {
    for (const id of PIECES) {
      const p = this.pieces[id];
      // 악보 재생과 직접 연주 중 더 최근에 맞은 것을 보여 준다
      const prev = previousHit(timeline.byPiece[id], t, timeline.duration, loop);
      let flash: HitFlash | null = prev ? { age: t - prev.time, limb: prev.hit.limb, velocity: prev.hit.velocity } : null;
      const l = live[id];
      if (l && (!flash || l.age < flash.age)) flash = l;
      const age = flash ? flash.age : Infinity;
      const active = age >= 0 && age < FEEDBACK_TIME;
      // 세기가 확실히 보이게: 고스트는 은은하게 작은 파문, 악센트는 밝게 크게 퍼지는 파문
      const v = flash ? flash.velocity : 0;
      const k = active ? (1 - age / FEEDBACK_TIME) ** 2 * (0.12 + 0.88 * v * v) : 0;
      const color = active && flash!.limb ? LIMB_COLORS[flash!.limb] : 0xffffff;
      for (const m of p.glow) {
        m.emissive.setHex(color);
        m.emissiveIntensity = k * 2;
      }
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(color);
      ringMat.opacity = k * 0.9;
      p.ring.visible = k > 0.01;
      const s = (0.6 + 0.6 * v) * (1 + (active ? age : 0) * (2 + 7 * v * v));
      p.ring.scale.set(s, s, s);

      if (p.cymbal) {
        // 한 번도 안 맞은 심벌은 age가 Infinity: sin(Infinity)는 NaN이므로 따로 처리한다
        const ringing = age >= 0 && age < 1.5;
        const amp = ringing ? Math.exp(-age * 3.5) * 0.12 * v ** 1.5 : 0;
        p.wobble.rotation.x = ringing ? Math.sin(age * 22) * amp : 0;
        p.wobble.rotation.z = ringing ? Math.cos(age * 17) * amp * 0.6 : 0;
      } else if (id !== 'kick') {
        p.wobble.position.y = active ? -Math.sin(Math.min(1, age / 0.06) * Math.PI) * 0.01 * v ** 1.5 : 0;
      }
    }

    // 다음 타격 직전의 하이햇 상단 위치는 발 상태에서 직접 계산된다
    this.hihatTop.position.y = 0.012 + (1 - hatClosed) * 0.03;
    this.kickBeater.rotation.x = 0.6 * (1 - kickPress);
    this.kickPedal.rotation.x = DrumKit.kickPedalAngle(kickPress);
    this.hatPedal.rotation.x = DrumKit.hatPedalAngle(hatClosed);
  }

  /** 페달 발판 각도(라디안, +면 발끝이 들림). 드러머의 발도 같은 각도를 따른다 */
  static kickPedalAngle(press: number) {
    return 0.1 + 0.18 * (1 - press);
  }

  static hatPedalAngle(closed: number) {
    return 0.12 + (1 - closed) * 0.16;
  }

  private addPiece(
    id: PieceId,
    group: THREE.Group,
    wobble: THREE.Object3D,
    glow: THREE.MeshStandardMaterial[],
    strikeLocal: THREE.Vector3,
    cymbal: boolean,
    strikeParent: THREE.Object3D = wobble,
  ) {
    const strike = new THREE.Object3D();
    strike.position.copy(strikeLocal);
    strikeParent.add(strike);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.05, 32),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    if (id === 'kick') {
      ring.position.copy(strikeLocal).add(new THREE.Vector3(0, 0, 0.004));
    } else {
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(strike.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.004, 0));
      wobble.updateWorldMatrix(true, false);
      wobble.worldToLocal(ring.position);
    }
    ring.visible = false;
    wobble.add(ring);

    this.root.add(group);
    this.pieces[id] = { id, group, wobble, glow, strike, ring, cymbal };
  }

  private buildDrum(id: PieceId, center: THREE.Vector3, radius: number, depth: number, tilt: number, strikeOffset: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.x = tilt; // +이면 윗면이 드러머 쪽(+Z)으로 기운다
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, 40, 1, true), this.shellMat);
    shell.position.y = -depth / 2;
    shell.castShadow = true;
    group.add(shell);

    const wobble = new THREE.Group();
    group.add(wobble);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
    const head = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, 40), headMat);
    head.rotation.x = -Math.PI / 2;
    head.receiveShadow = true;
    wobble.add(head);

    for (const y of [0, -depth]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 48), this.chromeMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      group.add(rim);
    }
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), this.darkMat);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -depth;
    group.add(bottom);

    // 스탠드: 바닥까지 다리
    if (id === 'floorTom') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const top = new THREE.Vector3(Math.cos(a) * radius, -depth * 0.3, Math.sin(a) * radius);
        const leg = this.rod(top, new THREE.Vector3(top.x * 1.15, -center.y, top.z * 1.15), 0.008, this.chromeMat);
        group.add(leg);
      }
    } else {
      const stand = this.rod(
        new THREE.Vector3(center.x, 0, center.z + 0.05),
        new THREE.Vector3(center.x, center.y - depth, center.z + 0.02),
        0.012,
        this.chromeMat,
      );
      this.root.add(stand);
    }

    this.addPiece(id, group, wobble, [headMat], strikeOffset, false);
  }

  private buildKick() {
    const r = 0.27;
    const depth = 0.4;
    const group = new THREE.Group();
    group.position.set(0.04, r + 0.02, -0.47);
    const body = new THREE.Group();
    body.rotation.x = Math.PI / 2; // 축이 Z를 향하도록
    group.add(body);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 48, 1, true), this.shellMat);
    shell.castShadow = true;
    body.add(shell);

    const wobble = new THREE.Group();
    group.add(wobble);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8, side: THREE.DoubleSide });
    const batter = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 48), headMat);
    batter.position.z = depth / 2;
    wobble.add(batter);
    const resoMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6, side: THREE.DoubleSide });
    const reso = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 48), resoMat);
    reso.position.z = -depth / 2;
    group.add(reso);
    for (const z of [depth / 2, -depth / 2]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 8, 48), this.shellMat);
      hoop.position.z = z;
      group.add(hoop);
    }

    // 페달과 비터: 피벗은 드럼 앞쪽 바닥
    const pedalBase = new THREE.Group();
    pedalBase.position.set(0.08, 0.03, -0.245);
    this.root.add(pedalBase);
    this.kickBeater = new THREE.Group();
    pedalBase.add(this.kickBeater);
    this.kickBeater.add(this.rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.22, 0), 0.005, this.chromeMat));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    ball.position.y = 0.22;
    this.kickBeater.add(ball);

    this.kickPedal = new THREE.Group();
    this.kickPedal.position.set(0.08, 0.03, 0.12);
    this.root.add(this.kickPedal);
    this.kickPedal.add(this.footboard());

    this.addPiece('kick', group, wobble, [headMat], new THREE.Vector3(0.04, -0.03, depth / 2), false);
  }

  private footboard(): THREE.Mesh {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.27), this.darkMat);
    board.position.z = -0.135; // 피벗(뒤꿈치)에서 앞으로
    board.castShadow = true;
    return board;
  }

  private cymbalMesh(radius: number, mat: THREE.Material): THREE.Mesh {
    const pts = [
      new THREE.Vector2(0.001, 0.035),
      new THREE.Vector2(radius * 0.18, 0.03),
      new THREE.Vector2(radius * 0.25, 0.012),
      new THREE.Vector2(radius, 0),
      new THREE.Vector2(radius, -0.003),
      new THREE.Vector2(radius * 0.25, 0.009),
      new THREE.Vector2(radius * 0.18, 0.027),
      new THREE.Vector2(0.001, 0.032),
    ];
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat);
    mesh.castShadow = true;
    return mesh;
  }

  private bronze() {
    return new THREE.MeshStandardMaterial({ color: 0xc9a043, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide });
  }

  private buildCymbal(id: PieceId, center: THREE.Vector3, radius: number, tilt: number, tiltZ: number, strike: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.set(tilt, 0, tiltZ);
    const wobble = new THREE.Group();
    group.add(wobble);
    const mat = this.bronze();
    wobble.add(this.cymbalMesh(radius, mat));
    const stand = this.rod(new THREE.Vector3(center.x, 0, center.z - 0.05), center.clone().add(new THREE.Vector3(0, -0.03, 0)), 0.01, this.chromeMat);
    this.root.add(stand);
    this.addTripod(new THREE.Vector3(center.x, 0, center.z - 0.05));
    this.addPiece(id, group, wobble, [mat], strike.clone().setY(0.01), true);
  }

  private buildHihat(center: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.x = 0.08;
    const wobble = new THREE.Group();
    group.add(wobble);
    const mat = this.bronze();
    const bottom = this.cymbalMesh(0.17, mat);
    bottom.rotation.x = Math.PI; // 아래 심벌은 뒤집혀 있다
    wobble.add(bottom);
    this.hihatTop = new THREE.Group();
    this.hihatTop.add(this.cymbalMesh(0.17, mat));
    wobble.add(this.hihatTop);
    this.root.add(this.rod(new THREE.Vector3(center.x, 0, center.z), center.clone().add(new THREE.Vector3(0, 0.08, 0)), 0.01, this.chromeMat));
    this.addTripod(new THREE.Vector3(center.x, 0, center.z));

    this.hatPedal = new THREE.Group();
    this.hatPedal.position.set(-0.32, 0.03, 0.12);
    this.root.add(this.hatPedal);
    this.hatPedal.add(this.footboard());

    this.addPiece('hihat', group, wobble, [mat], new THREE.Vector3(0.03, 0.01, 0.13), true, this.hihatTop);
  }

  private buildThrone() {
    this.throneRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), this.chromeMat);
    this.throne.add(this.throneSeat, this.throneRod);
    this.throneSeat.castShadow = true;
    this.throneRod.castShadow = true;
    this.addTripod(new THREE.Vector3(0, 0, 0), this.throne);
    this.root.add(this.throne);
    this.setThrone(DEFAULT_SEAT);
  }

  /** 의자 높이(앉는 면)와 앞뒤 위치. 캐릭터 체형에 맞춰 조절한다 */
  setThrone(seat: Seat) {
    this.throne.position.z = seat.z;
    this.throneSeat.position.y = seat.height - 0.04;
    this.throneRod.scale.y = seat.height - 0.08;
    this.throneRod.position.y = (seat.height - 0.08) / 2;
  }

  private addTripod(base: THREE.Vector3, parent: THREE.Object3D = this.root) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const foot = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2));
      parent.add(this.rod(base.clone().setY(0.2), foot, 0.007, this.chromeMat));
    }
  }

  private rod(from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
    const dir = to.clone().sub(from);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), mat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = true;
    return mesh;
  }
}
