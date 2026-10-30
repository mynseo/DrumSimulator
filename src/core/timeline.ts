import { INSTRUMENT_INFO, INSTRUMENT_ORDER, PIECES, VELOCITY } from './instruments';
import { applyDoubles, assignSticking } from './sticking';
import { LIMBS, type Hit, type Instrument, type Limb, type PieceId, type Score, type ScoreNote, type Timeline } from './types';

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

/** 빠르기 구간들 (중간에 빠르기가 바뀌면 여러 개) */
export function tempoSegments(score: Score): Timeline['tempo'] {
  const segs: Timeline['tempo'] = [{ step: 0, time: 0, dur: 60 / score.bpm / score.stepsPerBeat, bpm: score.bpm }];
  for (const c of [...(score.tempos ?? [])].sort((a, b) => a.step - b.step)) {
    if (!(c.bpm > 0) || c.step <= 0) continue;
    const last = segs[segs.length - 1];
    if (c.step === last.step) segs.pop();
    const prev = segs[segs.length - 1];
    segs.push({ step: c.step, time: prev ? prev.time + (c.step - prev.step) * prev.dur : 0, dur: 60 / c.bpm / score.stepsPerBeat, bpm: c.bpm });
  }
  return segs;
}

function segmentAt(tempo: Timeline['tempo'], key: 'step' | 'time', v: number) {
  let lo = 0;
  let hi = tempo.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (tempo[m][key] <= v) lo = m;
    else hi = m - 1;
  }
  return tempo[lo];
}

/** 칸 → 시각(초). 칸은 소수여도 된다 */
export function timeAtStep(tl: Pick<Timeline, 'tempo'>, step: number): number {
  const seg = segmentAt(tl.tempo, 'step', step);
  return seg.time + (step - seg.step) * seg.dur;
}

/** 시각(초) → 칸 (소수) */
export function stepAtTime(tl: Pick<Timeline, 'tempo'>, time: number): number {
  const seg = segmentAt(tl.tempo, 'time', time);
  return seg.step + (time - seg.time) / seg.dur;
}

/** 그 칸의 빠르기 */
export function bpmAtStep(tl: Pick<Timeline, 'tempo'>, step: number): number {
  return segmentAt(tl.tempo, 'step', step).bpm;
}

/** 라이드로 박을 타는 구간인지 볼 앞뒤 범위(초) */
const RIDE_WINDOW = 2.5;
/** 크래시 직전 이 시간 안에 탐·스네어 단타가 이어졌으면 필인 끝 */
const FILL_WINDOW = 1.2;
/** 크래시 사이가 이보다 가까우면 같은 구간(한쪽 크래시로 이어 친다) */
const CRASH_RUN_GAP = 0.9;

/**
 * 악보의 "크래시"를 왼쪽·오른쪽 중 어느 크래시로 칠지 정한다.
 * - 하이햇 대신 라이드로 박을 타는 구간: 오른손이 라이드 쪽에 있으니 오른쪽 크래시
 * - 필인(탐·스네어가 이어지는 구간)이 끝난 직후: 탐을 돌아 내려온 손이 닿기 좋은 오른쪽 크래시
 * - 그 밖에는 왼쪽 크래시. 사용자가 왼손을 지정했거나, 같은 순간에 오른쪽 크래시가 이미 있으면 그대로
 */
export function crashSides(notes: ScoreNote[], timeOf: (step: number) => number): Instrument[] {
  const times = notes.map((n) => timeOf(n.step));
  const right = (i: number) => {
    const n = notes[i];
    const t = times[i];
    let ride = 0;
    let hat = 0;
    const fill: Instrument[] = [];
    let keeperInFill = false;
    notes.forEach((o, j) => {
      const dt = times[j] - t;
      if (Math.abs(dt) <= RIDE_WINDOW && o.step !== n.step) {
        if (o.instrument === 'ride') ride++;
        else if (o.instrument === 'hihatClosed' || o.instrument === 'hihatOpen') hat++;
      }
      if (dt < 0 && dt >= -FILL_WINDOW && INSTRUMENT_INFO[o.instrument].kind === 'hand') {
        if (INSTRUMENT_INFO[o.instrument].timekeeper || o.instrument === 'crash' || o.instrument === 'crash2') keeperInFill = true;
        else fill.push(o.instrument);
      }
    });
    const isFill = !keeperInFill && fill.length >= 3 && (fill.some((x) => x === 'tom1' || x === 'tom2' || x === 'floorTom') || fill.length >= 4);
    return ride > hat || isFill;
  };
  // 크래시로 박을 타듯 이어 치는 구간은 한쪽 크래시로: 첫 크래시가 정한 쪽을 따른다
  const out = notes.map((n) => n.instrument);
  let side = false;
  let last = -Infinity;
  notes.forEach((n, i) => {
    if (n.instrument !== 'crash') return;
    if (times[i] - last > CRASH_RUN_GAP) side = right(i);
    last = times[i];
    const taken = notes.some((o) => o.step === n.step && o.instrument === 'crash2');
    if (side && n.hand !== 'L' && !taken) out[i] = 'crash2';
  });
  return out;
}

export function buildTimeline(score: Score): Timeline {
  const stepDuration = 60 / score.bpm / score.stepsPerBeat;
  const starts = barStarts(score);
  const totalSteps = starts[starts.length - 1];
  const tempo = tempoSegments(score);
  const timeOf = (step: number) => timeAtStep({ tempo }, step);
  let notes = score.notes
    .filter((n) => n.step >= 0 && n.step < totalSteps)
    .sort((a, b) => a.step - b.step || INSTRUMENT_ORDER[a.instrument] - INSTRUMENT_ORDER[b.instrument]);

  // 크래시는 상황에 맞는 쪽으로 (악보에 적힌 악기는 written에 남긴다)
  const sides = crashSides(notes, timeOf);
  const written = notes.map((n) => n.instrument);
  notes = notes.map((n, i) => (sides[i] === n.instrument ? n : { ...n, instrument: sides[i] }));
  let limbs = assignSticking(notes, timeOf, score.stepsPerBeat);
  // 오른손이 아직 필인 끝을 치고 있어 왼손이 맡게 된 오른쪽 크래시는, 팔을 엇갈리지 않게 왼쪽 크래시로 친다
  const crossed = notes.map((n, i) => n.instrument === 'crash2' && written[i] === 'crash' && limbs[i] === 'LH');
  if (crossed.some(Boolean)) {
    notes = notes.map((n, i) => (crossed[i] ? { ...n, instrument: 'crash' } : n));
    limbs = assignSticking(notes, timeOf, score.stepsPerBeat);
  }
  const rebound = applyDoubles(notes, limbs, timeOf);
  const duration = timeOf(totalSteps);
  const hits: Hit[] = notes.map((n, i) => ({
    time: timeOf(n.step),
    step: n.step,
    instrument: n.instrument,
    piece: INSTRUMENT_INFO[n.instrument].piece,
    limb: limbs[i],
    // 튕겨서 치는 둘째 타는 첫 타보다 조금 약하다
    velocity: rebound[i] ? n.velocity * 0.85 : n.velocity,
    handForced: !!n.hand,
    ...(rebound[i] ? { rebound: true } : {}),
    ...(written[i] !== n.instrument ? { written: written[i] } : {}),
  }));

  // 플램: 본 음을 치는 손의 반대 손이 조금 먼저 약하게 친다. 그 손이 같은 순간 다른 것을 치고 있으면 못 친다
  notes.forEach((n, i) => {
    const limb = limbs[i];
    if (!n.flam || (limb !== 'RH' && limb !== 'LH')) return;
    const gap = Math.min(FLAM_GAP, (timeOf(n.step + 1) - timeOf(n.step)) * 0.45);
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
    tempo,
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
