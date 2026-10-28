import type { Instrument, Score } from './types';

/**
 * PDF 악보의 기호(머리 모양·오선 위치·표시)별 악기 지정.
 * 출판사마다 하이햇·크래시·라이드를 그리는 자리가 달라, 읽은 뒤에 사용자가 기호마다 악기를 바꿀 수 있게 한다.
 * 기호는 "머리모양:오선위치[:o][:r]" (o = 열림 표시, r = ride 글씨 뒤).
 */

export type MarkMap = Record<string, Instrument>;

export interface MarkInfo {
  mark: string;
  kind: string;
  /** 0 = 맨 아랫줄, 1 = 첫째 칸 … 8 = 맨 윗줄 */
  pos: number;
  open: boolean;
  rideText: boolean;
  count: number;
  /** 지금 이 기호에 가장 많이 쓰인 악기 */
  instrument: Instrument;
}

export function parseMark(mark: string): { kind: string; pos: number; open: boolean; rideText: boolean } {
  const [kind, pos, ...flags] = mark.split(':');
  return { kind, pos: Number(pos), open: flags.includes('o'), rideText: flags.includes('r') };
}

/** 악보에 쓰인 기호들 (위쪽 오선 자리부터) */
export function marksOf(score: Score): MarkInfo[] {
  const byMark = new Map<string, Map<Instrument, number>>();
  for (const n of score.notes) {
    if (!n.mark) continue;
    const m = byMark.get(n.mark) ?? new Map<Instrument, number>();
    m.set(n.instrument, (m.get(n.instrument) ?? 0) + 1);
    byMark.set(n.mark, m);
  }
  return [...byMark]
    .map(([mark, insts]) => {
      const top = [...insts].sort((a, b) => b[1] - a[1])[0];
      return { mark, ...parseMark(mark), count: [...insts.values()].reduce((a, b) => a + b, 0), instrument: top[0] };
    })
    .sort((a, b) => b.pos - a.pos || a.mark.localeCompare(b.mark));
}

const KIND_NAMES: Record<string, string> = { x: 'X', circleX: '⊗', black: '●', half: '○', whole: '온음표', slash: '빗금' };

/** 오선 위치 이름 */
export function posName(pos: number): string {
  const lines = ['맨 아랫줄', '둘째 줄', '가운데 줄', '넷째 줄', '맨 윗줄'];
  const spaces = ['첫째 칸', '둘째 칸', '셋째 칸', '넷째 칸'];
  if (pos >= 0 && pos <= 8) return pos % 2 === 0 ? lines[pos / 2] : spaces[(pos - 1) / 2];
  if (pos === 9) return '윗줄 위';
  if (pos === -1) return '아랫줄 아래';
  if (pos > 9) return pos % 2 === 0 ? `위 덧줄 ${(pos - 8) / 2}` : `위 덧줄 ${(pos - 9) / 2} 위`;
  return pos % 2 === 0 ? `아래 덧줄 ${-pos / 2}` : `아래 덧줄 ${(-pos - 1) / 2} 아래`;
}

export function describeMark(m: Pick<MarkInfo, 'kind' | 'pos' | 'open' | 'rideText'>): string {
  const extra = [m.open ? 'o 표시' : '', m.rideText ? 'ride 글씨 뒤' : ''].filter(Boolean);
  return [`${KIND_NAMES[m.kind] ?? m.kind} · ${posName(m.pos)}`, ...extra].join(' · ');
}

/** 기호가 붙은 음을 모두 그 악기로 바꾼다. 같은 칸에 같은 악기가 겹치면 센 쪽 하나만 남긴다 */
export function applyMarkMap(score: Score, map: MarkMap): number {
  let changed = 0;
  for (const n of score.notes) {
    const to = n.mark ? map[n.mark] : undefined;
    if (to && to !== n.instrument) {
      n.instrument = to;
      changed++;
      // 손으로 치는 악기가 아니면 플램·손 지정은 뜻이 없다
      if (to === 'kick' || to === 'hihatPedal') {
        delete n.flam;
        delete n.hand;
      }
    }
  }
  if (!changed) return 0;
  const best = new Map<string, (typeof score.notes)[number]>();
  for (const n of score.notes) {
    const key = `${n.step}:${n.instrument}`;
    const old = best.get(key);
    if (!old || n.velocity > old.velocity) best.set(key, n);
  }
  score.notes = score.notes.filter((n) => best.get(`${n.step}:${n.instrument}`) === n);
  return changed;
}
