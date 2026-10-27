import { INSTRUMENT_INFO, INSTRUMENT_ORDER, PIECES } from './instruments';
import { assignSticking } from './sticking';
import { LIMBS, type Hit, type Limb, type PieceId, type Score, type Timeline } from './types';

export function stepsPerBar(score: Score): number {
  return score.beatsPerBar * score.stepsPerBeat;
}

export function buildTimeline(score: Score): Timeline {
  const stepDuration = 60 / score.bpm / score.stepsPerBeat;
  const totalSteps = score.bars * stepsPerBar(score);
  const notes = score.notes
    .filter((n) => n.step >= 0 && n.step < totalSteps)
    .sort((a, b) => a.step - b.step || INSTRUMENT_ORDER[a.instrument] - INSTRUMENT_ORDER[b.instrument]);

  const limbs = assignSticking(notes, stepDuration);
  const hits: Hit[] = notes.map((n, i) => ({
    time: n.step * stepDuration,
    step: n.step,
    instrument: n.instrument,
    piece: INSTRUMENT_INFO[n.instrument].piece,
    limb: limbs[i],
    velocity: n.velocity,
    handForced: !!n.hand,
  }));

  const byLimb = Object.fromEntries(LIMBS.map((l) => [l, [] as Hit[]])) as Record<Limb, Hit[]>;
  const byPiece = Object.fromEntries(PIECES.map((p) => [p, [] as Hit[]])) as Record<PieceId, Hit[]>;
  for (const h of hits) {
    if (h.limb) byLimb[h.limb].push(h);
    byPiece[h.piece].push(h);
  }
  return {
    duration: totalSteps * stepDuration,
    stepDuration,
    totalSteps,
    stepsPerBeat: score.stepsPerBeat,
    beatsPerBar: score.beatsPerBar,
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
