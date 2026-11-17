import { OnsetDetector, type Onset } from './onset';
import { MAX_BPM, MIN_BPM, TempoTracker } from './tracker';

/**
 * 소리 → 지금 빠르기. 화면(마이크·그리기)과 떨어져 있어서 테스트에서 합성한 소리로 그대로 돌린다.
 *
 * - locked: 빠르기를 믿을 만하다
 * - hold: 방금까지 믿을 만했는데 잠깐 흐트러졌거나(필인) 쉬는 중. 마지막 값을 흐리게 보여 준다
 * - searching: 타격은 들리지만 아직 빠르기를 모른다 ("측정 중"). 틀린 숫자를 보여 주지 않는다
 * - silent: 타격이 없다
 */
export type Phase = 'silent' | 'searching' | 'hold' | 'locked';

export interface TempoState {
  phase: Phase;
  bpm: number | null;
  confidence: number;
  /** 듣기 시작한 뒤 흐른 시간(초) */
  time: number;
}

/** 이 이상이어야 숫자를 믿는다 */
export const MIN_CONFIDENCE = 0.45;
/** 처음 숫자를 보여 줄 때는 더 까다롭게: 이 이상으로, 같은 빠르기가 두 번 이어져야 한다 */
const LOCK_CONFIDENCE = 0.6;
const HOLD_SEC = 2.5;

export class TempoEngine {
  private readonly detector: OnsetDetector;
  private readonly tracker = new TempoTracker();
  private bpm: number | null = null;
  private confidence = 0;
  private lastOnset = -Infinity;
  private lastLocked = -Infinity;
  private target: number | null = null;
  private candidate: number | null = null;

  constructor(sampleRate: number) {
    this.detector = new OnsetDetector(sampleRate);
  }

  get time() {
    return this.detector.time;
  }

  /** 입력 크기 0..1 */
  get level() {
    return this.detector.level;
  }

  /** 소리를 넣는다. 이번에 새로 찾은 타격을 돌려준다 */
  push(samples: Float32Array): Onset[] {
    const onsets = this.detector.push(samples);
    for (const o of onsets) {
      this.tracker.add(o);
      this.lastOnset = o.time;
    }
    if (onsets.length) this.update();
    else if (this.time - this.lastOnset > this.silenceAfter() && (this.bpm !== null || this.tracker.size)) {
      // 연주가 끝났다: 다음 연주는 새로 찾는다 (다른 곡일 수 있으니 ½×·2×도 푼다)
      this.tracker.clear();
      this.tracker.hint = this.target;
      this.bpm = null;
      this.confidence = 0;
    }
    return onsets;
  }

  state(): TempoState {
    const time = this.time;
    let phase: Phase;
    if (this.bpm === null) phase = this.tracker.size && time - this.lastOnset < 2 ? 'searching' : 'silent';
    else if (this.confidence >= MIN_CONFIDENCE && time - this.lastOnset < (60 / this.bpm) * 2 + 0.3) phase = 'locked';
    else phase = 'hold';
    return { phase, bpm: this.bpm, confidence: this.confidence, time };
  }

  /** 목표 템포. 정하면 그 근처에서만 찾는다 (null이면 자동) */
  setTarget(bpm: number | null) {
    this.target = bpm && bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null;
    this.tracker.hint = this.target;
    this.tracker.last = null;
  }

  /** 2배·절반으로 잘못 읽었을 때 바로잡는다. 바꾼 배수를 돌려준다 (못 바꾸면 1) */
  scale(factor: number): number {
    if (this.bpm === null) return 1;
    const next = this.bpm * factor;
    if (next < MIN_BPM || next > MAX_BPM) return 1;
    this.bpm = next;
    this.tracker.hint = next;
    this.tracker.last = next;
    return factor;
  }

  private silenceAfter() {
    return Math.max(3, this.bpm ? (60 / this.bpm) * 4 : 0);
  }

  private update() {
    const time = this.time;
    const est = this.tracker.estimate(time);
    this.confidence = est?.confidence ?? 0;
    if (est && this.bpm === null) {
      // 아무렇게나 친 타격이 우연히 맞아떨어진 것을 거른다
      const agrees = this.candidate !== null && Math.abs(est.bpm / this.candidate - 1) < 0.04;
      this.candidate = est.confidence >= LOCK_CONFIDENCE ? est.bpm : null;
      if (!agrees || this.candidate === null) return;
    }
    if (est && est.confidence >= MIN_CONFIDENCE) {
      // 숫자가 잘게 떨리지 않게 살짝 고르되, 크게 바뀌면 바로 따라간다
      const jump = this.bpm === null || Math.abs(est.bpm / this.bpm - 1) > 0.06;
      this.bpm = jump ? est.bpm : this.bpm! + (est.bpm - this.bpm!) * 0.4;
      this.lastLocked = time;
      this.tracker.last = this.bpm;
      // 사용자가 고른 배수는 빠르기가 조금씩 바뀌어도 따라간다 (목표 템포는 그대로 둔다)
      if (this.tracker.hint && !this.target) this.tracker.hint = this.bpm;
    } else if (this.bpm !== null && time - this.lastLocked > HOLD_SEC) {
      this.bpm = null;
      this.tracker.last = null;
    }
  }
}
