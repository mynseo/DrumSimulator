import * as THREE from 'three';
import { nextHit, previousHit } from '../core/timeline';
import type { Hit, PieceId, Timeline } from '../core/types';
import { DrumKit } from '../scene/DrumKit';
import { createPose, strokeHeight, type DrummerPose, type StickPose } from './pose';

/** 박자를 쉬는 동안 스틱 끝이 떠 있는 높이 */
const HOVER = 0.06;
/** 다음 타격을 위한 준비 동작(들어 올리기→내려치기)의 최대 길이(초) */
const STROKE_MAX = 0.45;
/** 타격 후 다음 위치로 수평 이동을 마치는 시점(스트로크 진행률) */
const TRAVEL_END = 0.7;
const KICK_RELEASE = 0.16;
const KICK_WINDUP = 0.22;

const REST_PIECE: Record<'RH' | 'LH', PieceId> = { RH: 'hihat', LH: 'snare' };

/**
 * 타임라인과 재생 위치만으로 드러머 자세를 계산한다(상태 없음).
 * 그래서 되감기·반복·일시정지를 해도 자세가 항상 소리와 맞는다.
 */
export class MotionPlanner {
  readonly pose = createPose();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private look = new THREE.Vector3(0, 0.7, -0.3);

  constructor(private kit: DrumKit) {}

  compute(timeline: Timeline, t: number, loop: boolean, playing = false, now = performance.now() / 1000): DrummerPose {
    const beatLen = timeline.stepDuration * timeline.stepsPerBeat;
    this.pose.beat = playing ? (t / beatLen) % 1 : -1;
    this.pose.time = now;

    this.stick(this.pose.RH, 'RH', timeline, t, loop);
    this.stick(this.pose.LH, 'LH', timeline, t, loop);

    const kick = this.kickPress(timeline.byLimb.RF, t, timeline.duration, loop);
    this.pose.RF.heel.copy(this.kit.rightHeel);
    this.pose.RF.angle = DrumKit.kickPedalAngle(kick);
    const hat = this.hatClosed(timeline, t, loop);
    this.pose.LF.heel.copy(this.kit.leftHeel);
    this.pose.LF.angle = DrumKit.hatPedalAngle(hat);

    // 시선: 두 스틱이 향하는 곳의 중간, 부드럽게 따라간다
    this.tmpA.copy(this.pose.RH.strike).add(this.pose.LH.strike).multiplyScalar(0.5);
    this.look.lerp(this.tmpA, 0.08);
    this.pose.lookAt.copy(this.look);

    this.kickPressValue = kick;
    this.hatClosedValue = hat;
    return this.pose;
  }

  /** 마지막 compute 결과: 드럼 세트 페달 애니메이션에 쓴다 */
  kickPressValue = 0;
  hatClosedValue = 1;

  private stick(out: StickPose, limb: 'RH' | 'LH', timeline: Timeline, t: number, loop: boolean) {
    const hits = timeline.byLimb[limb];
    const prev = previousHit(hits, t, timeline.duration, loop);
    const next = nextHit(hits, t, timeline.duration, loop);
    const rest = this.kit.strikePoint(REST_PIECE[limb], this.tmpB);

    const from = prev ? this.kit.strikePoint(prev.hit.piece, this.tmpA, prev.hit.instrument).clone() : rest.clone();
    const to = next ? this.kit.strikePoint(next.hit.piece, new THREE.Vector3(), next.hit.instrument) : from.clone();
    const prevTime = prev ? prev.time : -Infinity;

    if (!next) {
      // 더 칠 음이 없음: 마지막 위치 위에서 튕겨 올라와 머문다
      const rebound = prev ? easeOut(Math.min(1, (t - prevTime) / 0.15)) : 1;
      out.strike.copy(from);
      out.lift = HOVER * rebound;
      out.tip.copy(from).y += out.lift;
      return;
    }

    const strokeStart = Math.max(prevTime, next.time - STROKE_MAX);
    if (t < strokeStart) {
      // 긴 쉼: 이전 타격 지점 위에 떠 있는다
      const rebound = prev ? easeOut(Math.min(1, (t - prevTime) / 0.15)) : 1;
      out.strike.copy(from);
      out.lift = HOVER * rebound;
      out.tip.copy(from).y += out.lift;
      return;
    }

    const span = next.time - strokeStart;
    const u = span > 0 ? (t - strokeStart) / span : 1;
    const startLift = strokeStart > prevTime ? HOVER : 0;
    // 더블의 둘째 타는 손목을 다시 들지 않고 손가락으로 튕긴다: 아주 낮게
    const rebound = next.hit.rebound ? 0.45 : 1;
    const peak = Math.max(startLift, clamp(span * 0.55, 0.035, 0.24) * strokeHeight(next.hit.velocity) * rebound);

    out.strike.copy(from).lerp(to, smoothstep(0, TRAVEL_END, u));
    // 올라갈 때는 감속, 내려칠 때는 가속(손목 스냅)
    out.lift = u < 0.5 ? lerp(startLift, peak, easeOut(u / 0.5)) : lerp(peak, 0, easeIn((u - 0.5) / 0.5));
    out.tip.copy(out.strike).y += out.lift;
  }

  /** 1 = 비터가 헤드를 친 순간, 0 = 쉼, 음수 = 치기 전 뒤로 젖힘 */
  private kickPress(hits: Hit[], t: number, duration: number, loop: boolean): number {
    const prev = previousHit(hits, t, duration, loop);
    const next = nextHit(hits, t, duration, loop);
    let p = 0;
    if (prev) {
      const age = t - prev.time;
      if (age < KICK_RELEASE) p = 1 - easeOut(age / KICK_RELEASE);
    }
    if (next) {
      const until = next.time - t;
      const windup = Math.min(KICK_WINDUP, prev ? (next.time - prev.time) * 0.6 : KICK_WINDUP);
      if (until < windup) {
        const u = 1 - until / windup; // 0 → 1
        const amount = 0.5 * next.hit.velocity ** 1.5 + 0.08; // 세게 찰수록 비터를 크게 젖힌다
        // 먼저 뒤로 젖혔다가(-) 헤드를 친다(1)
        const v = u < 0.55 ? -amount * easeOut(u / 0.55) : lerp(-amount, 1, easeIn((u - 0.55) / 0.45));
        p = prev && t - prev.time < KICK_RELEASE ? Math.min(p, v) : v;
      }
    }
    return p;
  }

  /** 하이햇 닫힘 정도: 1 = 닫힘(발로 누름), 0 = 열림 */
  private hatClosed(timeline: Timeline, t: number, loop: boolean): number {
    const hits = timeline.byPiece.hihat;
    const prev = previousHit(hits, t, timeline.duration, loop);
    const next = nextHit(hits, t, timeline.duration, loop);
    let closed = prev && prev.hit.instrument === 'hihatOpen' ? 0 : 1;
    if (next) {
      const until = next.time - t;
      if (next.hit.instrument === 'hihatPedal' && until < 0.18) {
        // 페달 "칙": 발을 살짝 들었다가 밟는다
        const u = 1 - until / 0.18;
        closed = Math.min(closed, 1 - Math.sin(u * Math.PI) * 0.8);
      } else if (next.hit.instrument !== 'hihatOpen' && closed === 0 && until < 0.06) {
        closed = 1 - until / 0.06;
      } else if (next.hit.instrument === 'hihatOpen' && closed === 1 && until < 0.08) {
        closed = until / 0.08;
      }
    }
    return closed;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const easeIn = (u: number) => u * u;
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
