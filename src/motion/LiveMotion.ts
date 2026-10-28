import * as THREE from 'three';
import { INSTRUMENT_INFO } from '../core/instruments';
import type { Instrument, Limb, PieceId } from '../core/types';
import { DrumKit, type HitFlash } from '../scene/DrumKit';
import { createPose, strokeHeight, type DrummerPose } from './pose';

/** 입력 순간부터 스틱이 헤드에 닿기까지(초). 소리는 즉시 나므로 짧을수록 자연스럽다 */
const STRIKE = 0.05;
/** 친 뒤 그 자리 위에 머무는 시간 */
const HOLD = 0.4;
/** 악보 자세(또는 준비 자세)로 돌아가는 시간 */
const BLEND = 0.25;
const HOVER = 0.06;
const KICK_DOWN = 0.035;
const KICK_RELEASE = 0.16;

interface Stroke {
  piece: PieceId;
  instrument: Instrument;
  time: number;
  velocity: number;
  fromStrike: THREE.Vector3;
  fromLift: number;
}

/**
 * 직접 연주(패드·키보드) 동작을 모션 플래너의 자세 위에 덧씌운다.
 * 미래 음을 미리 알 수 없으므로 입력 순간 빠르게 내려치고(STRIKE),
 * 잠시 머문 뒤 원래 자세로 부드럽게 돌아간다.
 */
export class LiveMotion {
  private strokes: Partial<Record<'RH' | 'LH', Stroke>> = {};
  private kickTime = -Infinity;
  private pedalTime = -Infinity;
  private hatTime = -Infinity;
  private hatOpen = false;
  private flashes: Partial<Record<PieceId, { time: number; limb: Limb; velocity: number }>> = {};
  /** 마지막으로 화면에 그린 자세: 새 스트로크의 출발점 */
  private shown = createPose();
  private target = new THREE.Vector3();

  kickPress = 0;
  hatClosed = 1;

  constructor(private kit: DrumKit) {}

  hit(limb: Limb, instrument: Instrument, now: number, velocity: number) {
    const piece = INSTRUMENT_INFO[instrument].piece;
    this.flashes[piece] = { time: now, limb, velocity };
    if (limb === 'RH' || limb === 'LH') {
      const from = this.shown[limb];
      this.strokes[limb] = { piece, instrument, time: now, velocity, fromStrike: from.strike.clone(), fromLift: from.lift };
    } else if (limb === 'RF') {
      this.kickTime = now;
    } else {
      this.pedalTime = now;
    }
    if (piece === 'hihat') {
      this.hatTime = now;
      this.hatOpen = instrument === 'hihatOpen';
    }
  }

  /**
   * @param base 모션 플래너가 계산한 자세 (제자리에서 수정된다)
   * @param baseKick/baseHat 플래너의 페달 상태
   * @param scorePlaying 악보가 재생 중이면 하이햇 열림 상태를 악보에 맡긴다
   */
  apply(pose: DrummerPose, now: number, baseKick: number, baseHat: number, scorePlaying: boolean): DrummerPose {
    for (const limb of ['RH', 'LH'] as const) {
      const s = this.strokes[limb];
      if (!s) continue;
      const out = pose[limb];
      const age = now - s.time;
      const p = this.kit.strikePoint(s.piece, this.target, s.instrument);
      if (age < STRIKE) {
        const u = age / STRIKE;
        out.strike.copy(s.fromStrike).lerp(p, easeOut(u));
        out.lift = Math.max(s.fromLift, 0.085 * strokeHeight(s.velocity)) * (1 - u * u);
      } else if (age < STRIKE + HOLD) {
        out.strike.copy(p);
        out.lift = HOVER * easeOut(Math.min(1, (age - STRIKE) / 0.12));
      } else if (age < STRIKE + HOLD + BLEND) {
        const w = smooth((age - STRIKE - HOLD) / BLEND);
        out.strike.lerpVectors(p, out.strike, w);
        out.lift = HOVER + (out.lift - HOVER) * w;
      } else {
        delete this.strokes[limb];
        continue;
      }
      out.tip.copy(out.strike).y += out.lift;
    }

    // 킥: 누르는 순간 비터가 헤드를 치고 돌아온다
    const kAge = now - this.kickTime;
    this.kickPress = baseKick;
    if (kAge < KICK_DOWN) this.kickPress = Math.max(baseKick, kAge / KICK_DOWN);
    else if (kAge < KICK_DOWN + KICK_RELEASE) this.kickPress = Math.max(baseKick, 1 - easeOut((kAge - KICK_DOWN) / KICK_RELEASE));
    pose.RF.angle = DrumKit.kickPedalAngle(this.kickPress);

    // 하이햇: 악보가 재생 중이 아니거나 방금 직접 쳤으면 직접 연주 상태를 따른다
    this.hatClosed = baseHat;
    if (!scorePlaying || now - this.hatTime < 0.6) this.hatClosed = this.hatOpen ? 0 : 1;
    const pAge = now - this.pedalTime;
    if (pAge < 0.05) this.hatClosed = 0.4 + 0.6 * (pAge / 0.05);
    pose.LF.angle = DrumKit.hatPedalAngle(this.hatClosed);

    for (const limb of ['RH', 'LH'] as const) {
      this.shown[limb].strike.copy(pose[limb].strike);
      this.shown[limb].lift = pose[limb].lift;
    }
    return pose;
  }

  /** 드럼 세트 피드백용: 부품별로 마지막 직접 연주 타격 */
  flashAges(now: number): Partial<Record<PieceId, HitFlash>> {
    const out: Partial<Record<PieceId, HitFlash>> = {};
    for (const [piece, f] of Object.entries(this.flashes) as [PieceId, { time: number; limb: Limb; velocity: number }][]) {
      out[piece] = { age: now - f.time, limb: f.limb, velocity: f.velocity };
    }
    return out;
  }
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const smooth = (u: number) => u * u * (3 - 2 * u);
