import { INSTRUMENT_INFO, INSTRUMENT_ORDER } from './instruments';
import type { Hand, Instrument, Limb, ScoreNote } from './types';

/** 한 손으로 연속해서 무리 없이 칠 수 있는 최소 간격(초). 이보다 빠르면 손을 바꾼다. */
export const MIN_SAME_HAND_GAP = 0.11;
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
export function assignSticking(notes: ScoreNote[], stepDuration: number): (Limb | null)[] {
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
    const time = step * stepDuration;
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
      if (ia.timekeeper && !ib.timekeeper) rightIdx = a;
      else if (ib.timekeeper && !ia.timekeeper) rightIdx = b;
      else if (ia.cymbal && !ib.cymbal) rightIdx = a;
      else if (ib.cymbal && !ia.cymbal) rightIdx = b;
      else rightIdx = ia.lateral >= ib.lateral ? a : b;
      use('R', rightIdx, time);
      use('L', rightIdx === a ? b : a, time);
    } else if (playable.length === 1) {
      const idx = playable[0];
      let hand: Hand;
      if (available.length === 1) {
        hand = available[0];
      } else {
        hand = cheaperHand(notes[idx], time, state, lastSingle);
        // 하이햇·라이드로 박자를 유지하는 것은 필인처럼 번갈아 치는 패시지가 아니다
        if (!INSTRUMENT_INFO[notes[idx].instrument].timekeeper) lastSingle = { hand, time };
      }
      use(hand, idx, time);
    }
  }
  return result;
}

function cheaperHand(
  note: ScoreNote,
  time: number,
  state: Record<Hand, HandState>,
  lastSingle: { hand: Hand; time: number },
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
