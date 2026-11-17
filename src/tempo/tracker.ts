import type { Onset } from './onset';

/**
 * 타격 시각들에서 빠르기를 찾는다.
 *
 * 최근 타격들 사이의 간격을 모두 모아, 후보 빠르기마다 "한 박 뒤에도 타격이 있는가"를 센다
 * (자기상관). 최근 타격일수록 크게 쳐서 빠르기가 바뀌면 몇 초 안에 따라간다.
 *
 * 한 박·반 박·두 박은 모두 잘 맞기 때문에(2배/절반 문제) 다음으로 고른다.
 * - 센 타격(킥·스네어)끼리의 간격을 더 쳐 준다: 하이햇 8분음표보다 킥·스네어의 4분음표가 이긴다
 * - 똑같이 잘 맞으면 그중 가장 짧은 간격이 한 박이다 (두 박·한 마디가 아니라)
 * - 흔한 빠르기(105 BPM 근처)를 조금 더 쳐 준다
 * - 한번 정한 빠르기 근처를 더 쳐 줘서 2배·절반 사이를 오락가락하지 않는다
 * - 사용자가 ½×·2×를 누르거나 목표 템포를 정하면 그 근처에서만 찾는다 (hint)
 */

export const MIN_BPM = 30;
export const MAX_BPM = 300;

const WINDOW_SEC = 8;
const MAX_ONSETS = 64;
/** 최근 타격의 무게가 1/e로 줄어드는 시간(초). 짧을수록 빨리 따라가지만 숫자가 흔들린다 */
const RECENCY = 1.5;
const PRIOR_BPM = 105;
const PRIOR_WIDTH = 1.0; // 옥타브
const HINT_WIDTH = 0.3;
const STEP = 1.01;

export interface TempoEstimate {
  bpm: number;
  /** 0..1. 한 박 뒤에 짝이 되는 타격이 얼마나 꾸준히 있는지 */
  confidence: number;
}

/** period 근처(±3%)에서 가장 잘 맞는 박 길이 */
function bestNear(match: (period: number) => number, period: number) {
  let out = { period, match: match(period) };
  for (const r of [0.97, 0.98, 0.99, 1.01, 1.02, 1.03]) {
    const m = match(period * r);
    if (m > out.match) out = { period: period * r, match: m };
  }
  return out;
}

interface Timed {
  t: number;
  w: number;
}

const gauss = (x: number, width: number) => Math.exp(-0.5 * (x / width) * (x / width));

export class TempoTracker {
  /** 이 빠르기 근처에서만 찾는다 (사용자가 정한 배수·목표 템포) */
  hint: number | null = null;
  /** 직전에 확정한 빠르기. 근처 후보를 더 쳐 준다 */
  last: number | null = null;

  private onsets: Onset[] = [];
  private loudest = 0;

  get size() {
    return this.onsets.length;
  }

  add(onset: Onset) {
    this.onsets.push(onset);
    if (this.onsets.length > MAX_ONSETS) this.onsets.shift();
    this.loudest = Math.max(onset.strength, this.loudest * 0.98);
  }

  clear() {
    this.onsets = [];
    this.last = null;
    this.loudest = 0;
  }

  estimate(now: number): TempoEstimate | null {
    while (this.onsets.length && this.onsets[0].time < now - WINDOW_SEC) this.onsets.shift();
    const n = this.onsets.length;
    if (n < 4) return null;

    const pts: Timed[] = this.onsets.map((o) => ({
      t: o.time,
      w: Math.min(1, Math.max(0.1, o.strength / (this.loudest || 1))),
    }));
    // 타격 쌍. 무게는 두 타격의 세기 × 나중 타격이 얼마나 최근인지
    const gaps: number[] = [];
    const weights: number[] = [];
    let self = 0;
    for (let j = 0; j < n; j++) {
      const recent = Math.exp(-(now - pts[j].t) / RECENCY);
      self += pts[j].w * pts[j].w * recent;
      for (let i = 0; i < j; i++) {
        gaps.push(pts[j].t - pts[i].t);
        weights.push(pts[i].w * pts[j].w * recent);
      }
    }
    if (self <= 0) return null;

    const match = (period: number) => {
      const sigma = 0.025 * period + 0.005;
      let sum = 0;
      for (let k = 0; k < gaps.length; k++) {
        const d = gaps[k] - period;
        if (d > 3 * sigma || d < -3 * sigma) continue;
        sum += weights[k] * gauss(d, sigma);
      }
      return sum;
    };

    let best = 0;
    let bestScore = 0;
    for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm *= STEP) {
      let score: number;
      if (this.hint) {
        // 사용자가 정한 근처에서만: 그 박이 하이햇뿐이어도(2×) 두 박 간격이 맞으면 된다
        score = (match(60 / bpm) + match(120 / bpm)) * gauss(Math.log2(bpm / this.hint), HINT_WIDTH);
      } else {
        score = match(60 / bpm) * gauss(Math.log2(bpm / PRIOR_BPM), PRIOR_WIDTH);
        if (this.last) score *= 1 + 1.5 * gauss(Math.log2(bpm / this.last), 0.12);
      }
      if (score > bestScore) {
        bestScore = score;
        best = bpm;
      }
    }
    if (!best) return null;

    if (!this.hint) {
      // 한 박·두 박·한 마디는 똑같이 잘 맞는다. 반으로 줄여도 거의 그대로 맞으면 그쪽이 한 박이다
      // (반 박에 하이햇만 있으면 약한 타격이라 덜 맞는다)
      while (best * 2 <= MAX_BPM) {
        const near = this.last !== null && Math.abs(this.last / (best * 2) - 1) < 0.06;
        const peak = bestNear(match, 30 / best);
        if (peak.match < (near ? 0.65 : 0.8) * match(60 / best)) break;
        best = 60 / peak.period;
      }
    }
    const bestMatch = Math.max(match(60 / best), match(120 / best));

    // 1~4박 떨어진 쌍들로 박 길이를 다듬는다 (멀리 떨어진 쌍일수록 정밀하다)
    let period = 60 / best;
    for (let pass = 0; pass < 2; pass++) {
      let num = 0;
      let den = 0;
      for (let k = 0; k < gaps.length; k++) {
        const beats = Math.round(gaps[k] / period);
        if (beats < 1 || beats > 4) continue;
        if (Math.abs(gaps[k] - beats * period) > 0.07 * period) continue;
        num += weights[k] * beats * gaps[k];
        den += weights[k] * beats * beats;
      }
      if (den > 0) period = num / den;
    }
    const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, 60 / period));
    return { bpm, confidence: Math.min(1, bestMatch / self) };
  }
}
