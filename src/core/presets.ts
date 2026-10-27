import { VELOCITY } from './instruments';
import { featuredSolo, randomSolo } from './solo';
import type { Instrument, Score, ScoreNote } from './types';

/**
 * 문자열로 패턴을 적는다. 한 글자 = 한 칸, 공백과 '|'는 무시.
 *   x = 보통, X = 악센트, g = 고스트, R/L = 해당 손으로 지정(보통 세기), - = 쉼
 */
function pattern(rows: Partial<Record<Instrument, string>>): ScoreNote[] {
  const notes: ScoreNote[] = [];
  for (const [instrument, row] of Object.entries(rows) as [Instrument, string][]) {
    const cells = row.replace(/[\s|]/g, '');
    for (let step = 0; step < cells.length; step++) {
      const c = cells[step];
      if (c === '-' || c === '.') continue;
      const note: ScoreNote = { step, instrument, velocity: VELOCITY.normal };
      if (c === 'X') note.velocity = VELOCITY.accent;
      else if (c === 'g') note.velocity = VELOCITY.ghost;
      else if (c === 'R' || c === 'L') note.hand = c;
      notes.push(note);
    }
  }
  return notes;
}

const base = { version: 1 as const, beatsPerBar: 4 };

export interface Preset {
  name: string;
  score: Score;
  /** 있으면 고를 때마다 새로 만든다 (랜덤 솔로) */
  make?: () => Score;
}

export const PRESETS: Preset[] = [
  {
    name: '8비트 록',
    score: {
      ...base,
      title: '8비트 록',
      bpm: 100,
      stepsPerBeat: 4,
      bars: 2,
      notes: pattern({
        crash: 'X--------------- ----------------',
        hihatClosed: '--x-x-x-x-x-x-x- x-x-x-x-x-x-x-x-',
        snare: '----X-------X--- ----X-------X---',
        kick: 'x-------x-x----- x-------x-x---x-',
      }),
    },
  },
  {
    name: '16비트 그루브 + 탐 필인',
    score: {
      ...base,
      title: '16비트 그루브 + 탐 필인',
      bpm: 92,
      stepsPerBeat: 4,
      bars: 4,
      notes: pattern({
        crash: 'X--------------- ---------------- ---------------- ----------------',
        hihatClosed: '-xXxXxXxXxXxXxXx XxXxXxXxXxXxXxXx XxXxXxXxXxXxXxXx ----------------',
        snare: '----X--g----X--- ----X--g----X--g ----X--g----X--- XXXX------------',
        tom1: '---------------- ---------------- ---------------- ----XXXX--------',
        tom2: '---------------- ---------------- ---------------- --------XXXX----',
        floorTom: '---------------- ---------------- ---------------- ------------XXXX',
        kick: 'x-----x-x-x----- x-----x-x-x---x- x-----x-x-x----- x---x---x---x---',
      }),
    },
  },
  {
    name: '디스코 (오픈 하이햇)',
    score: {
      ...base,
      title: '디스코 (오픈 하이햇)',
      bpm: 118,
      stepsPerBeat: 4,
      bars: 2,
      notes: pattern({
        hihatClosed: 'x---x---x---x--- x---x---x---x---',
        hihatOpen: '--x---x---x---x- --x---x---x---x-',
        snare: '----X-------X--- ----X-------X-g-',
        kick: 'x---x---x---x--- x---x---x---x---',
      }),
    },
  },
  {
    name: '재즈 스윙 (셋잇단)',
    score: {
      ...base,
      title: '재즈 스윙 (셋잇단)',
      bpm: 132,
      stepsPerBeat: 3,
      bars: 2,
      notes: pattern({
        ride: 'x--x-xx--x-x x--x-xx--x-x',
        snare: '-----g-----g --g-----g--X',
        hihatPedal: '---x-----x-- ---x-----x--',
        kick: 'g-----g----- g-----g-----',
      }),
    },
  },
  { name: '드럼 솔로', score: featuredSolo() },
  { name: '드럼 솔로 (매번 새로 만들기)', score: randomSolo(1), make: () => randomSolo() },
  {
    name: '빈 악보',
    score: { ...base, title: '새 악보', bpm: 100, stepsPerBeat: 4, bars: 2, notes: [] },
  },
];

export function cloneScore(score: Score): Score {
  return { ...score, notes: score.notes.map((n) => ({ ...n })) };
}
