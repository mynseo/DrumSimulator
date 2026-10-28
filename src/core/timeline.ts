import { INSTRUMENT_INFO, INSTRUMENT_ORDER, PIECES, VELOCITY } from './instruments';
import { applyDoubles, assignSticking } from './sticking';
import { LIMBS, type Hit, type Limb, type PieceId, type Score, type Timeline } from './types';

/** 플램의 꾸밈음이 본 음보다 먼저 나오는 시간(초). 실제 연주에서 20~40ms 정도 */
export const FLAM_GAP = 0.03;

export function stepsPerBar(score: Score): number {
  return score.beatsPerBar * score.stepsPerBeat;
}

/** 마디마다 박 수 */
export function barBeatsOf(score: Score): number[] {
  return Array.from({ length: score.bars }, (_, i) => score.barBeats?.[i] ?? score.beatsPerBar);
}

/** 마디 시작 칸들. 마지막 원소는 전체 칸 수 */
export function barStarts(score: Score): number[] {
  const out = [0];
  for (const b of barBeatsOf(score)) out.push(out[out.length - 1] + Math.round(b * score.stepsPerBeat));
  return out;
}

export function totalStepsOf(score: Score): number {
  const starts = barStarts(score);
  return starts[starts.length - 1];
}

/** 칸이 속한 마디 번호(0부터)와 그 마디 안의 칸 */
export function barOfStep(starts: number[], step: number): { bar: number; offset: number } {
  let lo = 0;
  let hi = starts.length - 2;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (starts[m] <= step) lo = m;
    else hi = m - 1;
  }
  return { bar: lo, offset: step - starts[lo] };
}

export function buildTimeline(score: Score): Timeline {
  const stepDuration = 60 / score.bpm / score.stepsPerBeat;
  const starts = barStarts(score);
  const totalSteps = starts[starts.length - 1];
  const notes = score.notes
    .filter((n) => n.step >= 0 && n.step < totalSteps)
    .sort((a, b) => a.step - b.step || INSTRUMENT_ORDER[a.instrument] - INSTRUMENT_ORDER[b.instrument]);

  const limbs = assignSticking(notes, stepDuration);
  const rebound = applyDoubles(notes, limbs, stepDuration);
  const duration = totalSteps * stepDuration;
  const hits: Hit[] = notes.map((n, i) => ({
    time: n.step * stepDuration,
    step: n.step,
    instrument: n.instrument,
    piece: INSTRUMENT_INFO[n.instrument].piece,
    limb: limbs[i],
    // 튕겨서 치는 둘째 타는 첫 타보다 조금 약하다
    velocity: rebound[i] ? n.velocity * 0.85 : n.velocity,
    handForced: !!n.hand,
    ...(rebound[i] ? { rebound: true } : {}),
  }));

  // 플램: 본 음을 치는 손의 반대 손이 조금 먼저 약하게 친다. 그 손이 같은 순간 다른 것을 치고 있으면 못 친다
  const gap = Math.min(FLAM_GAP, stepDuration * 0.45);
  notes.forEach((n, i) => {
    const limb = limbs[i];
    if (!n.flam || (limb !== 'RH' && limb !== 'LH')) return;
    const other: Limb = limb === 'RH' ? 'LH' : 'RH';
    if (hits.some((h) => h.step === n.step && h.limb === other)) return;
    hits.push({
      time: (hits[i].time - gap + duration) % duration,
      step: n.step,
      instrument: n.instrument,
      piece: hits[i].piece,
      limb: other,
      velocity: Math.min(VELOCITY.ghost + 0.05, n.velocity * 0.5),
      handForced: false,
      grace: true,
    });
  });
  hits.sort((a, b) => a.time - b.time);

  const byLimb = Object.fromEntries(LIMBS.map((l) => [l, [] as Hit[]])) as Record<Limb, Hit[]>;
  const byPiece = Object.fromEntries(PIECES.map((p) => [p, [] as Hit[]])) as Record<PieceId, Hit[]>;
  for (const h of hits) {
    if (h.limb) byLimb[h.limb].push(h);
    byPiece[h.piece].push(h);
  }
  return {
    duration,
    stepDuration,
    totalSteps,
    stepsPerBeat: score.stepsPerBeat,
    beatsPerBar: score.beatsPerBar,
    barStarts: starts,
    hits,
    byLimb,
    byPiece,
  };
}

/** 반복 재생을 고려해 t 시점의 바로 이전/다음 타격을 찾는다. 반환되는 time은 t와 같은 축으로 보정된 값. */
export interface Neighbor {
  hit: Hit;
  time: number;
}

export function previousHit(hits: Hit[], t: number, duration: number, loop: boolean): Neighbor | null {
  if (hits.length === 0) return null;
  const i = upperBound(hits, t) - 1;
  if (i >= 0) return { hit: hits[i], time: hits[i].time };
  if (!loop) return null;
  const last = hits[hits.length - 1];
  return { hit: last, time: last.time - duration };
}

export function nextHit(hits: Hit[], t: number, duration: number, loop: boolean): Neighbor | null {
  if (hits.length === 0) return null;
  const i = upperBound(hits, t);
  if (i < hits.length) return { hit: hits[i], time: hits[i].time };
  if (!loop) return null;
  return { hit: hits[0], time: hits[0].time + duration };
}

/** time > t 인 첫 인덱스 */
function upperBound(hits: Hit[], t: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
