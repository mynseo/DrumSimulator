import { VELOCITY } from './instruments';
import type { Instrument, Score, ScoreNote } from './types';

/**
 * 드럼 솔로: 한 박(16분음표 4칸)짜리 조각을 이어 붙여 만든다.
 * 글자: X = 악센트, x = 보통, g = 고스트, - = 쉼
 */
type Cell = Partial<Record<Instrument, string>>;

const CELLS = {
  // 박자를 잡는 그루브
  crashIn: { crash: 'X---', kick: 'x---', hihatClosed: '--x-' },
  grooveA: { hihatClosed: 'x-x-', kick: 'x--x' },
  grooveB: { hihatClosed: 'x-x-', snare: 'X--g' },
  // 스네어
  snareRoll: { snare: 'Xxxx' },
  snareAccent: { snare: 'X-gX', kick: '-x--' },
  snareGhost: { snare: 'gXgg' },
  crescA: { snare: 'gggg' },
  crescB: { snare: 'xxxx' },
  crescC: { snare: 'XXXX' },
  // 탐
  tom1Roll: { tom1: 'Xxxx' },
  tom2Roll: { tom2: 'Xxxx' },
  floorRoll: { floorTom: 'Xxxx' },
  snareTom: { snare: 'Xx--', tom1: '--Xx' },
  tomsDown: { tom1: 'Xx--', tom2: '--Xx' },
  tom2Floor: { tom2: 'Xx--', floorTom: '--Xx' },
  // 손발 섞기
  floorKick: { floorTom: 'X-X-', kick: '-x-x' },
  tomKick: { tom1: 'X---', tom2: '--X-', kick: '-x-x' },
  linear: { snare: 'X--x', kick: '-x--', hihatClosed: '--x-' },
  rideKick: { ride: 'X-x-', kick: 'x-x-' },
  // 강조
  stab: { crash: 'X---', snare: 'X---', kick: 'x---' },
  stabFloor: { crash: 'X---', floorTom: 'X---', kick: 'x---' },
  rest: {},
} satisfies Record<string, Cell>;

type CellName = keyof typeof CELLS;

/** 정해진 솔로: 그루브 → 스네어 → 탐 → 강조 → 손발 → 크레셴도 → 마무리 필인 */
const FEATURED: CellName[][] = [
  ['crashIn', 'grooveB', 'grooveA', 'grooveB'],
  ['grooveA', 'grooveB', 'grooveA', 'snareRoll'],
  ['snareAccent', 'snareGhost', 'snareAccent', 'snareRoll'],
  ['tom1Roll', 'tom2Roll', 'floorRoll', 'floorKick'],
  ['stab', 'rest', 'stabFloor', 'snareTom'],
  ['tomKick', 'tomKick', 'linear', 'linear'],
  ['crescA', 'crescB', 'crescC', 'tom2Floor'],
  ['tomsDown', 'tom2Floor', 'floorKick', 'snareRoll'],
];

/** 마디 성격별로 고를 수 있는 조각 */
const POOL: Record<'groove' | 'middle' | 'fill', CellName[]> = {
  groove: ['grooveA', 'grooveB', 'linear', 'rideKick'],
  middle: ['snareAccent', 'snareGhost', 'snareRoll', 'tom1Roll', 'tom2Roll', 'floorRoll', 'snareTom', 'tomsDown', 'tom2Floor', 'floorKick', 'tomKick', 'linear', 'stab', 'stabFloor', 'rideKick'],
  fill: ['snareRoll', 'tomsDown', 'tom2Floor', 'floorRoll', 'tom1Roll', 'floorKick'],
};

function build(title: string, bpm: number, bars: CellName[][]): Score {
  const notes: ScoreNote[] = [];
  bars.forEach((beats, bar) =>
    beats.forEach((name, beat) => {
      for (const [instrument, cells] of Object.entries(CELLS[name] as Cell) as [Instrument, string][]) {
        for (let i = 0; i < 4; i++) {
          const c = cells[i];
          if (!c || c === '-') continue;
          const velocity = c === 'X' ? VELOCITY.accent : c === 'g' ? VELOCITY.ghost : VELOCITY.normal;
          notes.push({ step: (bar * 4 + beat) * 4 + i, instrument, velocity });
        }
      }
    }),
  );
  return { version: 1, title, bpm, beatsPerBar: 4, stepsPerBeat: 4, bars: bars.length, notes };
}

export function featuredSolo(): Score {
  return build('드럼 솔로', 112, FEATURED);
}

/**
 * 매번 다른 8마디 솔로. 첫 마디는 그루브로 시작하고, 마지막 마디는 필인으로 끝나
 * 반복하면 다시 크래시로 돌아온다.
 */
export function randomSolo(seed = Math.floor(Math.random() * 2 ** 31), bars = 8): Score {
  const rand = mulberry32(seed);
  const pick = (pool: CellName[]) => pool[Math.floor(rand() * pool.length)];
  const plan: CellName[][] = [];
  for (let bar = 0; bar < bars; bar++) {
    const kind = bar === 0 ? 'groove' : bar === bars - 1 ? 'fill' : 'middle';
    const beats = [0, 1, 2, 3].map(() => pick(POOL[kind]));
    if (bar === 0) beats[0] = 'crashIn';
    else if (rand() < 0.3) beats[0] = rand() < 0.5 ? 'stab' : 'stabFloor';
    plan.push(beats);
  }
  return build('드럼 솔로 (랜덤)', 100 + Math.floor(rand() * 5) * 6, plan);
}

/** 작고 빠른 시드 난수 생성기 (같은 시드 → 같은 솔로) */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
