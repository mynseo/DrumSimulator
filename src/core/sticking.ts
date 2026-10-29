import { INSTRUMENT_INFO, INSTRUMENT_ORDER } from './instruments';
import type { Hand, Instrument, Limb, ScoreNote } from './types';

/** 한 손으로 연속해서 무리 없이 칠 수 있는 최소 간격(초). 이보다 빠르면 손을 바꾼다. */
export const MIN_SAME_HAND_GAP = 0.11;
/** 동시에 치는 두 악기가 이보다 멀리 떨어져 있으면 팔을 엇갈리지 않는다 */
const CROSS_LIMIT = 0.6;
/** 이 간격 안에서 단타가 이어지면 "연속 패시지"로 보고 손을 번갈아 쓴다 */
const ALTERNATE_WINDOW = 0.3;

interface HandState {
  time: number;
  lateral: number;
}

const handLimb = (h: Hand): Limb => (h === 'R' ? 'RH' : 'LH');
const other = (h: Hand): Hand => (h === 'R' ? 'L' : 'R');

/**
 * 악보의 각 음을 어느 손/발로 칠지 정한다.
 *
 * - 킥은 오른발, 하이햇 페달은 왼발.
 * - 두 손이 동시에 칠 때: 하이햇·라이드(박자 유지)는 오른손, 나머지는 왼손.
 *   (오른손잡이 크로스 핸드 자세: 오른손이 하이햇, 왼손이 스네어)
 *   그 외에는 오른쪽에 있는 악기를 오른손이 친다.
 * - 단타는 비용으로 고른다: 같은 손 연타가 너무 빠르면 큰 비용, 이동 거리,
 *   빠른 패시지에서 같은 손 반복, 박자 유지 악기에 대한 오른손 선호.
 * - 사용자가 손을 지정한 음은 그대로 따른다.
 * - 같은 순간에 손으로 칠 음이 셋 이상이면 남는 음은 null(소리만 남).
 *
 * @param notes step 순으로 정렬된 음 목록
 * @returns 입력 배열과 같은 순서의 손발 배정
 */
/** 칸 → 시각. 숫자면 한 칸의 길이(초), 함수면 빠르기가 바뀌는 곡의 칸별 시각 */
export type StepTime = number | ((step: number) => number);
const timeFn = (t: StepTime) => (typeof t === 'number' ? (step: number) => step * t : t);

export function assignSticking(notes: ScoreNote[], stepTime: StepTime): (Limb | null)[] {
  const timeOf = timeFn(stepTime);
  const result: (Limb | null)[] = new Array(notes.length).fill(null);
  const state: Record<Hand, HandState> = {
    R: { time: -Infinity, lateral: INSTRUMENT_INFO.hihatClosed.lateral },
    L: { time: -Infinity, lateral: INSTRUMENT_INFO.snare.lateral },
  };
  let lastSingle: { hand: Hand; time: number } = { hand: 'L', time: -Infinity };

  const use = (h: Hand, idx: number, time: number) => {
    result[idx] = handLimb(h);
    state[h] = { time, lateral: INSTRUMENT_INFO[notes[idx].instrument].lateral };
  };

  let i = 0;
  while (i < notes.length) {
    const step = notes[i].step;
    const time = timeOf(step);
    const group: number[] = [];
    while (i < notes.length && notes[i].step === step) group.push(i++);

    const handNotes: number[] = [];
    for (const idx of group) {
      const kind = INSTRUMENT_INFO[notes[idx].instrument].kind;
      if (kind === 'RF') result[idx] = 'RF';
      else if (kind === 'LF') result[idx] = 'LF';
      else handNotes.push(idx);
    }
    if (handNotes.length === 0) continue;

    handNotes.sort((a, b) => INSTRUMENT_ORDER[notes[a].instrument] - INSTRUMENT_ORDER[notes[b].instrument]);

    // 1) 사용자가 지정한 손
    const taken = new Set<Hand>();
    const free: number[] = [];
    for (const idx of handNotes) {
      const forced = notes[idx].hand;
      if (forced && !taken.has(forced)) {
        taken.add(forced);
        use(forced, idx, time);
      } else {
        free.push(idx);
      }
    }

    const available = (['R', 'L'] as Hand[]).filter((h) => !taken.has(h));
    const playable = free.slice(0, available.length);

    if (playable.length === 2) {
      const [a, b] = playable;
      const ia = INSTRUMENT_INFO[notes[a].instrument];
      const ib = INSTRUMENT_INFO[notes[b].instrument];
      let rightIdx: number;
      // 서로 멀리 떨어진 두 악기(왼쪽 크래시 + 오른쪽 플로어 탐)는 팔이 엇갈리지 않게 좌우대로 친다
      const farApart = Math.abs(ia.lateral - ib.lateral) > CROSS_LIMIT;
      // 박자 유지 악기(하이햇)는 오른손. 단 다른 악기가 멀리 오른쪽(오른쪽 크래시·플로어 탐)이면
      // 왼손이 오른손 밑으로 건너가야 하니 오른손이 그쪽을 치고 왼손이 하이햇을 맡는다
      const crossing = (keeper: typeof ia, other: typeof ia) => farApart && other.lateral > keeper.lateral;
      if (ia.timekeeper && !ib.timekeeper) rightIdx = crossing(ia, ib) ? b : a;
      else if (ib.timekeeper && !ia.timekeeper) rightIdx = crossing(ib, ia) ? a : b;
      else if (!farApart && ia.cymbal && !ib.cymbal) rightIdx = a;
      else if (!farApart && ib.cymbal && !ia.cymbal) rightIdx = b;
      else rightIdx = ia.lateral >= ib.lateral ? a : b;
      use('R', rightIdx, time);
      use('L', rightIdx === a ? b : a, time);
    } else if (playable.length === 1) {
      const idx = playable[0];
      let hand: Hand;
      if (available.length === 1) {
        hand = available[0];
      } else {
        // 오른손이 곧 하이햇·라이드를 또 쳐야 하면(박자 유지 중), 사이의 음은 왼손이 맡는다
        const rightBusy = !INSTRUMENT_INFO[notes[idx].instrument].timekeeper && timekeeperSoon(notes, i, time, timeOf);
        hand = cheaperHand(notes[idx], time, state, lastSingle, rightBusy);
        // 하이햇·라이드로 박자를 유지하는 것은 필인처럼 번갈아 치는 패시지가 아니다
        if (!INSTRUMENT_INFO[notes[idx].instrument].timekeeper) lastSingle = { hand, time };
      }
      use(hand, idx, time);
    }
  }
  return result;
}

/**
 * 이보다 촘촘한 연속 단타는 한 손씩 번갈아(싱글) 치면 한 손 간격이 MIN_SAME_HAND_GAP보다 짧아진다.
 * 실제 드러머처럼 한 번 손목을 내릴 때 두 번 튕기는 더블 스트로크(RRLL)로 친다.
 */
export const DOUBLE_GAP = MIN_SAME_HAND_GAP / 2;

/**
 * 빠른 롤을 더블 스트로크로 바꾼다. limbs를 고치고, 더블의 둘째 타(튕겨서 치는 음)인지를 돌려준다.
 * 손으로 치는 음이 한 칸에 하나씩 DOUBLE_GAP 이하 간격으로 4개 이상 이어진 구간만 바꾸고,
 * 사용자가 손을 지정했거나 플램이 섞인 구간은 그대로 둔다.
 */
export function applyDoubles(notes: ScoreNote[], limbs: (Limb | null)[], stepTime: StepTime): boolean[] {
  const timeOf = timeFn(stepTime);
  const second = new Array(notes.length).fill(false);
  // 칸마다 손으로 치는 음 (한 칸에 손 음이 둘이면 롤이 아니다)
  const singles: number[] = [];
  let i = 0;
  while (i < notes.length) {
    const step = notes[i].step;
    const hands: number[] = [];
    while (i < notes.length && notes[i].step === step) {
      if (INSTRUMENT_INFO[notes[i].instrument].kind === 'hand') hands.push(i);
      i++;
    }
    if (hands.length === 1) singles.push(hands[0]);
    else if (hands.length > 1) singles.push(-1); // 구간을 끊는다
  }
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 4 && run.every((k) => !notes[k].hand && !notes[k].flam)) {
      // 첫 음의 손으로 시작해 두 번씩 번갈아
      let hand: Limb = limbs[run[0]] === 'LH' ? 'LH' : 'RH';
      run.forEach((k, j) => {
        if (j > 0 && j % 2 === 0) hand = hand === 'RH' ? 'LH' : 'RH';
        limbs[k] = hand;
        second[k] = j % 2 === 1;
      });
    }
    run = [];
  };
  for (let j = 0; j < singles.length; j++) {
    const k = singles[j];
    if (k < 0) {
      flush();
      continue;
    }
    const prev = run[run.length - 1];
    if (prev !== undefined && timeOf(notes[k].step) - timeOf(notes[prev].step) > DOUBLE_GAP + 1e-9) flush();
    run.push(k);
  }
  flush();
  return second;
}

/** 오른손이 이 시간 안에 하이햇·라이드로 돌아가야 하면 "바쁘다"고 본다 */
const RIGHT_BUSY_WINDOW = 0.2;

/** 곧(RIGHT_BUSY_WINDOW 안에) 하이햇·라이드 음이 있는가 (notes는 step 순, from은 다음 묶음의 시작) */
function timekeeperSoon(notes: ScoreNote[], from: number, time: number, timeOf: (step: number) => number): boolean {
  for (let j = from; j < notes.length; j++) {
    if (timeOf(notes[j].step) - time > RIGHT_BUSY_WINDOW) return false;
    if (INSTRUMENT_INFO[notes[j].instrument].timekeeper && !notes[j].hand) return true;
  }
  return false;
}

function cheaperHand(
  note: ScoreNote,
  time: number,
  state: Record<Hand, HandState>,
  lastSingle: { hand: Hand; time: number },
  rightBusy = false,
): Hand {
  const info = INSTRUMENT_INFO[note.instrument];
  const cost = (h: Hand): number => {
    let c = 0;
    const gap = time - state[h].time;
    if (gap < MIN_SAME_HAND_GAP) c += 5 + (10 * (MIN_SAME_HAND_GAP - gap)) / MIN_SAME_HAND_GAP;
    // 이동 거리는 손이 최근에 친 위치에서만 의미가 있다
    if (gap < 1) c += Math.abs(info.lateral - state[h].lateral) * 1.5;

    const inPassage = time - lastSingle.time <= ALTERNATE_WINDOW;
    if (inPassage && h === lastSingle.hand) c += 1.2;
    if (!inPassage && h === 'L') c += 0.6; // 새 프레이즈는 오른손으로 시작

    if (info.timekeeper && h === 'R') c -= 1.5;
    if (rightBusy && h === 'R') c += 1.5;
    // 오른손이 가까이 있지 않은데 왼손이 오른쪽 끝(플로어 탐·라이드)까지 건너가는 것을 피한다
    if (h === 'L' && info.lateral > state[other(h)].lateral + 0.25 && info.lateral > 0.3) c += 0.8;
    if (h === 'R' && info.lateral < state[other(h)].lateral - 0.25 && !info.timekeeper && info.lateral < -0.35) c += 0.4;
    return c;
  };
  return cost('R') <= cost('L') ? 'R' : 'L';
}

/**
 * 직접 연주용: 들어오는 타격마다 그 자리에서 손발을 고른다.
 * 미래 음을 모르므로 악보용 assignSticking과 같은 비용 규칙을 한 음씩 적용한다.
 * 거의 동시에 친 두 음(하이햇+스네어)은 "같은 손 연타가 너무 빠름" 규칙으로 자연히 다른 손이 된다.
 */
export class LiveSticking {
  private state: Record<Hand, HandState> = {
    R: { time: -Infinity, lateral: INSTRUMENT_INFO.hihatClosed.lateral },
    L: { time: -Infinity, lateral: INSTRUMENT_INFO.snare.lateral },
  };
  private lastSingle: { hand: Hand; time: number } = { hand: 'L', time: -Infinity };

  next(instrument: Instrument, time: number): Limb {
    const info = INSTRUMENT_INFO[instrument];
    if (info.kind === 'RF') return 'RF';
    if (info.kind === 'LF') return 'LF';
    const hand = cheaperHand({ step: 0, instrument, velocity: 1 }, time, this.state, this.lastSingle);
    this.state[hand] = { time, lateral: info.lateral };
    if (!info.timekeeper) this.lastSingle = { hand, time };
    return handLimb(hand);
  }
}
