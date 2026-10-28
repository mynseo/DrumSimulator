import { VELOCITY } from '../core/instruments';
import { chooseSubdivision } from '../core/grid';
import type { Instrument, Score, ScoreNote } from '../core/types';
import type { Glyph, PageContent, Segment } from './pdfPage';

/**
 * 악보 프로그램(Finale·MuseScore·Sibelius 등)이 만든 PDF 드럼 악보를 읽는다.
 *
 * 스캔한 그림이 아니라 글자(음악 글꼴)와 선으로 그려진 PDF에서만 된다:
 * 1. 길이가 같은 가로선 5개 = 오선. 타악기 음자리표가 있는(또는 X 음표가 있는) 오선이 드럼 줄
 * 2. 오선을 위아래로 꿰뚫는 세로선 = 마디줄, 그 옆 점 두 개 = 도돌이표
 * 3. 음표 머리(글자)의 높이 → 악기, 기둥(세로선)·빔(굵은 선)·꼬리·점 → 길이, 숫자 3 → 셋잇단
 * 4. 기둥이 위로 = 손(1성부), 아래로 = 발(2성부). 성부마다 길이를 더해 박 위치를 구한다
 * 5. 도돌이표·1/2번 괄호·D.S./D.C.·To Coda·Fine을 따라 연주 순서대로 펼친다
 */

export interface SheetResult {
  score: Score;
  /** 악보에 적힌 마디 수 (펼치기 전) */
  writtenBars: number;
  /** 박자를 정확히 못 맞춰 위치로 어림한 마디 수 */
  approximated: number;
  /** 연주 순서: 펼친 마디마다 악보에 적힌 몇 번째 마디인지 (0부터) */
  order: number[];
  warnings: string[];
}

/** 펼친 악보의 최대 길이 */
const MAX_BARS = 256;

// ---------- 글꼴별 기호 ----------

type HeadKind = 'black' | 'x' | 'half' | 'whole' | 'circleX';
type Sym =
  | { t: 'head'; kind: HeadKind }
  | { t: 'rest'; beats: number; measure?: boolean }
  | { t: 'flag'; n: number }
  | { t: 'dot' }
  | { t: 'accent' }
  | { t: 'open' }
  | { t: 'closed' }
  | { t: 'percClef' }
  | { t: 'clef' }
  | { t: 'segno' }
  | { t: 'coda' }
  | { t: 'repeatDot' }
  | { t: 'graceSlash' }
  | { t: 'tuplet'; n: number };

/** Finale Maestro 계열 (MacRoman 자리 → 유니코드, 매핑이 없으면 U+F0xx) */
const MAESTRO: Record<string, Sym> = {
  '\u0153': { t: 'head', kind: 'black' }, // œ
  '\u02d9': { t: 'head', kind: 'half' }, // ˙
  '\u00fa': { t: 'head', kind: 'half' }, // ú
  w: { t: 'head', kind: 'whole' },
  '\u2211': { t: 'rest', beats: 4, measure: true }, // ∑
  '\u00d3': { t: 'rest', beats: 2 }, // Ó
  '\uf0ee': { t: 'rest', beats: 2 },
  '\u0152': { t: 'rest', beats: 1 }, // Œ
  '\u2030': { t: 'rest', beats: 0.5 }, // ‰
  '\u2248': { t: 'rest', beats: 0.25 }, // ≈
  '\u00ae': { t: 'rest', beats: 0.125 }, // ®
  j: { t: 'flag', n: 1 },
  J: { t: 'flag', n: 1 },
  r: { t: 'flag', n: 2 },
  R: { t: 'flag', n: 2 },
  '.': { t: 'dot' },
  '>': { t: 'accent' },
  o: { t: 'open' },
  '+': { t: 'closed' },
  '\uf08b': { t: 'percClef' },
  '/': { t: 'percClef' },
  '&': { t: 'clef' },
  '?': { t: 'clef' },
  '%': { t: 'segno' },
  '\u00d8': { t: 'coda' }, // Ø
  '@': { t: 'graceSlash' },
  '\uf0de': { t: 'coda' },
};
/** MaestroPercussion: 같은 자리에 타악기 음표 머리 */
const MAESTRO_PERC: Record<string, Sym> = {
  ...MAESTRO,
  y: { t: 'head', kind: 'x' },
  Y: { t: 'head', kind: 'x' },
  '\u00d9': { t: 'head', kind: 'circleX' },
};
/** SMuFL (Bravura, Leland, Petaluma, Finale Maestro 신버전 등) */
const SMUFL: Record<string, Sym> = {
  '\ue0a4': { t: 'head', kind: 'black' },
  '\ue0a3': { t: 'head', kind: 'half' },
  '\ue0a2': { t: 'head', kind: 'whole' },
  '\ue0a9': { t: 'head', kind: 'x' },
  '\ue0a8': { t: 'head', kind: 'x' },
  '\ue0a7': { t: 'head', kind: 'x' },
  '\ue0b3': { t: 'head', kind: 'circleX' },
  '\ue0b7': { t: 'head', kind: 'x' },
  '\ue4e3': { t: 'rest', beats: 4, measure: true },
  '\ue4e4': { t: 'rest', beats: 2 },
  '\ue4e5': { t: 'rest', beats: 1 },
  '\ue4e6': { t: 'rest', beats: 0.5 },
  '\ue4e7': { t: 'rest', beats: 0.25 },
  '\ue4e8': { t: 'rest', beats: 0.125 },
  '\ue240': { t: 'flag', n: 1 },
  '\ue241': { t: 'flag', n: 1 },
  '\ue242': { t: 'flag', n: 2 },
  '\ue243': { t: 'flag', n: 2 },
  '\ue244': { t: 'flag', n: 3 },
  '\ue245': { t: 'flag', n: 3 },
  '\ue1e7': { t: 'dot' },
  '\ue4a0': { t: 'accent' },
  '\ue4a1': { t: 'accent' },
  '\ue5e7': { t: 'open' },
  '\ue5e5': { t: 'closed' },
  '\ue069': { t: 'percClef' },
  '\ue06a': { t: 'percClef' },
  '\ue050': { t: 'clef' },
  '\ue062': { t: 'clef' },
  '\ue047': { t: 'segno' },
  '\ue048': { t: 'coda' },
  '\ue044': { t: 'repeatDot' },
  '\ue564': { t: 'graceSlash' },
  '\ue565': { t: 'graceSlash' },
  '\ue883': { t: 'tuplet', n: 3 },
  '\ue885': { t: 'tuplet', n: 5 },
  '\ue886': { t: 'tuplet', n: 6 },
};

function symbolOf(g: Glyph): Sym | null {
  const f = g.font.toLowerCase();
  if (f.includes('maestro') && !f.includes('text')) {
    const table = f.includes('percussion') ? MAESTRO_PERC : MAESTRO;
    return table[g.char] ?? null;
  }
  const s = SMUFL[g.char];
  if (s) return s;
  return null;
}

const isMusicFont = (g: Glyph) => {
  const f = g.font.toLowerCase();
  return (f.includes('maestro') && !f.includes('text')) || /bravura|leland|petaluma|sebastian|emmentaler|opus|engraver|finale|gootville|musejazz/.test(f) || (g.char >= '\ue000' && g.char <= '\uf8ff');
};

// ---------- 오선·마디 ----------

interface Staff {
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** 줄 간격 */
  s: number;
}

const HORIZONTAL = (seg: Segment) => Math.abs(seg.y1 - seg.y2) < 0.2;
const VERTICAL = (seg: Segment) => Math.abs(seg.x1 - seg.x2) < 0.3;

function findStaves(segs: Segment[], page: number): Staff[] {
  // 같은 높이의 가로선 조각을 이어 붙인다 (마디마다 따로 그리는 프로그램도 있다)
  const lines: { y: number; x0: number; x1: number }[] = [];
  const hs = segs
    .filter((s) => HORIZONTAL(s) && s.width < 1.5)
    .map((s) => ({ y: (s.y1 + s.y2) / 2, x0: Math.min(s.x1, s.x2), x1: Math.max(s.x1, s.x2) }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  for (const h of hs) {
    const last = lines.find((l) => Math.abs(l.y - h.y) < 0.15 && h.x0 <= l.x1 + 2 && h.x1 >= l.x0 - 2);
    if (last) {
      last.x0 = Math.min(last.x0, h.x0);
      last.x1 = Math.max(last.x1, h.x1);
    } else lines.push({ ...h });
  }
  const long = lines.filter((l) => l.x1 - l.x0 > 60).sort((a, b) => b.y - a.y);
  const staves: Staff[] = [];
  const used = new Set<number>();
  for (let i = 0; i < long.length; i++) {
    if (used.has(i)) continue;
    const a = long[i];
    const same = (l: { x0: number; x1: number }) => Math.abs(l.x0 - a.x0) < 2 && Math.abs(l.x1 - a.x1) < 2;
    const run = [i];
    for (let j = i + 1; j < long.length && run.length < 5; j++) {
      if (used.has(j) || !same(long[j])) continue;
      const gap = long[run[run.length - 1]].y - long[j].y;
      const first = long[run[0]].y - long[run[1] ?? j].y;
      if (gap < 2 || gap > 15) {
        if (gap > 15) break;
        continue;
      }
      if (run.length > 1 && Math.abs(gap - first) > 0.35) break;
      run.push(j);
    }
    if (run.length === 5) {
      run.forEach((k) => used.add(k));
      const ys = run.map((k) => long[k].y);
      staves.push({ page, x0: a.x0, x1: a.x1, top: ys[0], bottom: ys[4], s: (ys[0] - ys[4]) / 4 });
    }
  }
  return staves.sort((p, q) => q.top - p.top);
}

/** 오선 높이 위치: 0 = 맨 아랫줄, 1 = 첫째 칸, ... 8 = 맨 윗줄 */
const posOf = (st: Staff, y: number) => Math.round((y - st.bottom) / (st.s / 2));

interface Barline {
  x0: number;
  x1: number;
  thick: boolean;
  repeatLeft: boolean;
  repeatRight: boolean;
}

interface Text {
  str: string;
  x: number;
  y: number;
  x1: number;
  size: number;
}

/** 일반 글자를 줄 단위 문자열로 묶는다 */
function textRuns(glyphs: Glyph[]): Text[] {
  const gs = glyphs.filter((g) => !isMusicFont(g)).sort((a, b) => b.y - a.y || a.x - b.x);
  const runs: Text[] = [];
  for (const g of gs) {
    const r = runs.find((t) => Math.abs(t.y - g.y) < g.size * 0.3 && g.x >= t.x1 - g.size * 0.2 && g.x - t.x1 < g.size * 0.6);
    if (r) {
      if (g.x - r.x1 > g.size * 0.15) r.str += ' ';
      r.str += g.char;
      r.x1 = g.x + g.width;
    } else runs.push({ str: g.char, x: g.x, y: g.y, x1: g.x + g.width, size: g.size });
  }
  return runs;
}

// ---------- 한 줄(드럼 오선) 읽기 ----------

interface Head {
  x: number;
  w: number;
  y: number;
  pos: number;
  kind: HeadKind;
  size: number;
}
interface Chord {
  heads: Head[];
  x: number;
  voice: 1 | 2;
  beats: number;
  stemX: number;
  accent: boolean;
  open: boolean;
  closed: boolean;
  /** 앞에 꾸밈음이 붙은 머리들 = 플램 */
  flam?: Head[];
}
interface RestEv {
  x: number;
  y: number;
  beats: number;
  measure: boolean;
}

export interface MeasureMarks {
  startRepeat: boolean;
  endRepeat: boolean;
  segno: boolean;
  coda: boolean;
  toCoda: boolean;
  ds: boolean;
  dc: boolean;
  fine: boolean;
  volta: number[] | null;
}

export interface ReadMeasure {
  x0: number;
  x1: number;
  /** 박 위치 → 악기 */
  notes: { beat: number; instrument: Instrument; velocity: number; flam?: boolean }[];
  /** 박자를 계산하지 못해 위치로 어림했다 */
  approximate: boolean;
  /** 실제 길이(박). 못갖춘마디면 박자표보다 짧다 */
  length: number;
  marks: MeasureMarks;
}

const emptyMarks = (): MeasureMarks => ({
  startRepeat: false,
  endRepeat: false,
  segno: false,
  coda: false,
  toCoda: false,
  ds: false,
  dc: false,
  fine: false,
  volta: null,
});

interface StaffItems {
  glyphs: { g: Glyph; sym: Sym }[];
  segs: Segment[];
}

function readStaff(st: Staff, items: StaffItems, beatsPerBar: number, cymbalMode: { ride: boolean }, texts: Text[], pieceStart: boolean): ReadMeasure[] {
  const s = st.s;
  const { glyphs, segs } = items;

  // 마디줄: 이 오선(또는 이 오선을 포함한 여러 오선)을 위아래로 꿰뚫는 세로선
  const bars: Barline[] = [];
  const verticals = segs.filter((g) => VERTICAL(g)).map((g) => ({ x: (g.x1 + g.x2) / 2, lo: Math.min(g.y1, g.y2), hi: Math.max(g.y1, g.y2), w: g.width }));
  const barSegs = verticals
    .filter((v) => v.lo <= st.bottom + 0.3 * s && v.hi >= st.top - 0.3 * s && v.x > st.x0 + 1 && v.x <= st.x1 + 1)
    .filter((v) => Math.abs(v.hi - st.top) < 0.3 * s || Math.abs(v.lo - st.bottom) < 0.3 * s || v.hi - v.lo > (st.top - st.bottom) * 2.5)
    .sort((a, b) => a.x - b.x);
  for (const v of barSegs) {
    const last = bars[bars.length - 1];
    if (last && v.x - last.x1 < 1.3 * s) {
      last.x1 = v.x;
      last.thick ||= v.w > 1.5;
    } else bars.push({ x0: v.x, x1: v.x, thick: v.w > 1.5, repeatLeft: false, repeatRight: false });
  }

  // 도돌이 점: 셋째 칸(3)·다섯째 칸(5) 높이의 점 한 쌍
  const dots = glyphs.filter((x) => x.sym.t === 'dot' || x.sym.t === 'repeatDot');
  const repeatDots = new Set<Glyph>();
  for (const b of bars) {
    for (const side of ['left', 'right'] as const) {
      const near = dots.filter(({ g }) => {
        const p = posOf(st, g.y);
        const cx = g.x + g.width / 2;
        const inSide = side === 'left' ? cx < b.x0 && b.x0 - cx < 2 * s : cx > b.x1 && cx - b.x1 < 2.2 * s;
        return inSide && (p === 3 || p === 5);
      });
      if (near.some(({ g }) => posOf(st, g.y) === 3) && near.some(({ g }) => posOf(st, g.y) === 5)) {
        near.forEach(({ g }) => repeatDots.add(g));
        if (side === 'left') b.repeatLeft = true;
        else b.repeatRight = true;
      }
    }
  }

  // 마디 구간
  const edges: { x0: number; x1: number; startRepeat: boolean; endRepeat: boolean }[] = [];
  let from = st.x0;
  let startRepeat = false;
  for (const b of bars) {
    edges.push({ x0: from, x1: b.x0, startRepeat, endRepeat: b.repeatLeft });
    from = b.x1;
    startRepeat = b.repeatRight;
  }
  if (st.x1 - from > 3 * s) edges.push({ x0: from, x1: st.x1, startRepeat, endRepeat: false });

  // 음표 머리
  const heads: Head[] = glyphs
    .filter((x) => x.sym.t === 'head')
    .map(({ g, sym }) => ({ x: g.x, w: g.width || s * 1.2, y: g.y, pos: posOf(st, g.y), kind: (sym as { kind: HeadKind }).kind, size: g.size }));

  // 기둥: 머리에 붙은 가는 세로선
  const stems = verticals.filter((v) => v.w < 1.2 && v.hi - v.lo > 1.4 * s && !barSegs.includes(v));
  const beams = segs
    .filter((g) => g.width >= 0.25 * s && g.width < 1.2 * s && Math.abs(g.x2 - g.x1) > 0.5 * s && Math.abs(g.y2 - g.y1) <= 0.7 * Math.abs(g.x2 - g.x1))
    .map((g) => (g.x1 <= g.x2 ? g : { ...g, x1: g.x2, y1: g.y2, x2: g.x1, y2: g.y1 }));
  const flags = glyphs.filter((x) => x.sym.t === 'flag');

  type StemRef = { stem: (typeof stems)[number]; up: boolean };
  const stemOf = new Map<Head, StemRef>();
  const onStem = (h: Head, v: (typeof stems)[number], up: boolean) =>
    up ? h.y >= v.lo - 0.7 * s && h.y <= v.hi - 1.2 * s : h.y <= v.hi + 0.7 * s && h.y >= v.lo + 1.2 * s;
  for (const h of heads) {
    let best: StemRef | null = null;
    let bestD = Infinity;
    for (const v of stems) {
      // 위 기둥은 머리 오른쪽 끝, 아래 기둥은 왼쪽 끝에 붙는다
      const dUp = Math.abs(v.x - (h.x + h.w));
      if (dUp < 0.45 * s && onStem(h, v, true) && dUp < bestD) {
        best = { stem: v, up: true };
        bestD = dUp;
      }
      const dDown = Math.abs(v.x - h.x);
      if (dDown < 0.45 * s && onStem(h, v, false) && dDown < bestD) {
        best = { stem: v, up: false };
        bestD = dDown;
      }
    }
    if (best) stemOf.set(h, best);
  }
  // 2도 화음: 한 머리가 기둥 반대편으로 비켜 앉는다. 이미 붙은 머리와 한 칸 차이면 같은 화음
  for (const h of heads) {
    if (stemOf.has(h)) continue;
    for (const v of stems) {
      const mates = heads.filter((o) => stemOf.get(o)?.stem === v);
      if (!mates.length || !mates.some((o) => Math.abs(o.pos - h.pos) <= 1)) continue;
      const up = stemOf.get(mates[0])!.up;
      const edge = up ? h.x : h.x + h.w;
      if (Math.abs(v.x - edge) < 0.45 * s && onStem(h, v, up)) {
        stemOf.set(h, { stem: v, up });
        break;
      }
    }
  }

  // 점은 바로 왼쪽의 가장 가까운 음표 머리(또는 쉼표)에 붙는다. 촘촘한 16분음표에서 옆 음표의 점을 가져오지 않게
  const owners: { key: unknown; right: number; y: number; dy: number }[] = [
    ...heads.map((h) => ({ key: h as unknown, right: h.x + h.w, y: h.y, dy: 0.8 * s })),
    ...glyphs.filter((x) => x.sym.t === 'rest').map((x) => ({ key: x.g as unknown, right: x.g.x + x.g.width, y: x.g.y, dy: 1.2 * s })),
  ];
  const dotCount = new Map<unknown, number>();
  for (const { g } of dots) {
    if (repeatDots.has(g)) continue;
    let best: (typeof owners)[number] | null = null;
    for (const o of owners) {
      const gap = g.x - o.right;
      if (gap < -0.1 * s || gap > 2.2 * s || Math.abs(g.y - o.y) > o.dy) continue;
      if (!best || o.right > best.right) best = o;
    }
    if (best) dotCount.set(best.key, (dotCount.get(best.key) ?? 0) + 1);
  }
  const accents = glyphs.filter((x) => x.sym.t === 'accent');
  const opens = glyphs.filter((x) => x.sym.t === 'open');
  const closes = glyphs.filter((x) => x.sym.t === 'closed');

  // 꾸밈음(플램 등): 기둥에 빗금이 있거나 머리가 작다. 박자에 들지 않으니 뺀다
  const slashes = glyphs.filter((x) => x.sym.t === 'graceSlash');
  const headSize = heads.map((h) => h.size).sort((a, b) => a - b)[heads.length >> 1] ?? 0;
  // 빗금만으로는 모른다: 버즈·림샷 표시도 같은 기호다. 꾸밈음은 빔 없이 꼬리가 달린 기둥에 빗금이 그어진다
  const slashed = (v: (typeof stems)[number]) => slashes.some(({ g }) => Math.abs(g.x + g.width / 2 - v.x) < 1.2 * s && g.y >= v.lo - s && g.y <= v.hi + s);

  // 화음(같은 기둥을 공유하는 머리들). 꾸밈음은 따로 모아 바로 뒤 화음의 플램으로 붙인다
  const chords: Chord[] = [];
  const graces: Head[][] = [];
  const byStem = new Map<unknown, Head[]>();
  for (const h of heads) {
    const ref = stemOf.get(h);
    const key = ref ? ref.stem : h;
    byStem.set(key, [...(byStem.get(key) ?? []), h]);
  }
  for (const [key, hs] of byStem) {
    const ref = stemOf.get(hs[0]);
    if (hs.every((h) => h.size < headSize * 0.8)) {
      graces.push(hs); // 작은 머리 = 꾸밈음
      continue;
    }
    const kind = hs[0].kind;
    let base = kind === 'whole' ? 4 : kind === 'half' ? 2 : 1;
    const x = Math.min(...hs.map((h) => h.x));
    let stemX = x;
    if (ref) {
      const v = ref.stem;
      stemX = v.x;
      const far = ref.up ? v.hi : v.lo;
      const ys = beams
        .filter((b) => b.x1 - 0.2 * s <= v.x && v.x <= b.x2 + 0.2 * s)
        .map((b) => b.y1 + ((b.y2 - b.y1) * (v.x - b.x1)) / (b.x2 - b.x1 || 1))
        .filter((y) => (ref.up ? y >= far - 3 * s && y <= far + 0.6 * s : y <= far + 3 * s && y >= far - 0.6 * s))
        .sort((a, b) => a - b);
      let n = 0;
      for (let i = 0; i < ys.length; i++) if (i === 0 || ys[i] - ys[i - 1] > 0.3 * s) n++;
      let flagged = 0;
      for (const f of flags) {
        if (f.g.x >= v.x - 0.6 && f.g.x <= v.x + 2.5 * s && Math.abs(f.g.y - far) < 3.5 * s) flagged = Math.max(flagged, (f.sym as { n: number }).n);
      }
      if (flagged && !n && slashed(v)) {
        graces.push(hs);
        continue;
      }
      n = Math.max(n, flagged);
      base /= 2 ** n;
    } else if (kind !== 'whole' && kind !== 'half') {
      base = 1;
    }
    const right = Math.max(...hs.map((h) => h.x + h.w));
    const ndots = Math.max(0, ...hs.map((h) => dotCount.get(h) ?? 0));
    const beats = base * (ndots >= 2 ? 1.75 : ndots === 1 ? 1.5 : 1);
    const voice: 1 | 2 = ref ? (ref.up ? 1 : 2) : hs[0].pos >= 4 ? 1 : 2;
    const cx0 = x - 0.4 * s;
    const cx1 = right + 0.4 * s;
    const within = (g: Glyph) => g.x + g.width / 2 >= cx0 && g.x + g.width / 2 <= cx1;
    const accent = accents.some(({ g }) => within(g) && (voice === 1 ? g.y > Math.max(...hs.map((h) => h.y)) : g.y < Math.min(...hs.map((h) => h.y))));
    const above = (g: Glyph) => within(g) && g.y > Math.max(...hs.map((h) => h.y));
    const open = opens.some(({ g }) => above(g));
    const closed = closes.some(({ g }) => above(g));
    void key;
    chords.push({ heads: hs, x, voice, beats, stemX, accent, open, closed });
  }

  // 꾸밈음 → 오른쪽으로 가장 가까운 화음(4칸 안)이 플램
  for (const g of graces) {
    const gx = Math.max(...g.map((h) => h.x));
    const target = chords.filter((c) => c.x > gx && c.x - gx < 4 * s && c.heads.some((h) => h.pos >= 3)).sort((a, b) => a.x - b.x)[0];
    if (target) target.flam = [...(target.flam ?? []), ...g];
  }

  const rests: RestEv[] = glyphs
    .filter((x) => x.sym.t === 'rest')
    .map(({ g, sym }) => {
      const r = sym as { beats: number; measure?: boolean };
      const nd = dotCount.get(g) ?? 0;
      return { x: g.x, y: g.y, beats: r.beats * (nd ? 1.5 : 1), measure: !!r.measure };
    });

  // 잇단음표 숫자: 오선 근처의 작은 3·5·6
  const tuplets: { x: number; y: number; n: number }[] = [];
  for (const { g, sym } of glyphs) if (sym.t === 'tuplet') tuplets.push({ x: g.x + g.width / 2, y: g.y, n: (sym as { n: number }).n });
  for (const t of texts) {
    if (/^[356]$/.test(t.str.trim()) && t.size < 2.5 * s && t.y < st.top + 7 * s && t.y > st.bottom - 6 * s && t.x > st.x0 + 3 * s) {
      tuplets.push({ x: (t.x + t.x1) / 2, y: t.y, n: Number(t.str.trim()) });
    }
  }
  const tupletScale = new Map<Chord | RestEv, number>();
  for (const t of tuplets) {
    const ratio = t.n === 3 ? 2 / 3 : t.n === 6 ? 4 / 6 : t.n === 5 ? 4 / 5 : 1;
    const voice: 1 | 2 = t.y > (st.top + st.bottom) / 2 ? 1 : 2;
    // 숫자 아래(위)의 빔이 덮는 범위
    const beam = beams
      .filter((b) => b.x1 - s <= t.x && t.x <= b.x2 + s)
      .map((b) => ({ b, d: Math.abs((b.y1 + b.y2) / 2 - t.y) }))
      .filter((x) => x.d < 3.5 * s)
      .sort((a, b) => a.d - b.d)[0]?.b;
    let members: (Chord | RestEv)[];
    if (beam) {
      members = chords.filter((c) => c.voice === voice && c.stemX >= beam.x1 - 0.5 && c.stemX <= beam.x2 + 0.5);
    } else {
      members = chords
        .filter((c) => c.voice === voice)
        .sort((a, b) => Math.abs(a.x - t.x) - Math.abs(b.x - t.x))
        .slice(0, t.n);
    }
    for (const m of members) tupletScale.set(m, ratio);
  }

  // 마디마다 성부별로 박 위치 계산
  const out: ReadMeasure[] = [];
  edges.forEach((e) => {
    const inM = (x: number) => x >= e.x0 && x < e.x1;
    const cs = chords.filter((c) => inM(c.x));
    const rs = rests.filter((r) => inM(r.x));
    if (!cs.length && !rs.length) return; // 음자리표·조표만 있는 머리 부분
    const restVoice = assignRests(cs, rs, s, st.bottom + 2 * s, beatsPerBar, (c) => c.beats * (tupletScale.get(c) ?? 1), (r) => r.beats * (tupletScale.get(r) ?? 1));
    const notes: ReadMeasure['notes'] = [];
    // "ride"·"H.H" 글씨로 하이햇 자리의 X 음표를 라이드로 바꾼다: 글씨보다 오른쪽 음표부터
    const switches = texts
      .filter((t) => t.x >= e.x0 - s && t.x < e.x1 && t.y >= st.top && t.y <= st.top + 8 * s)
      .map((t) => ({ x: t.x, ride: /\bride\b|\bR\.\s?C\b/i.test(t.str) ? true : /H\.?\s?H|hi-?hat/i.test(t.str) ? false : null }))
      .filter((t): t is { x: number; ride: boolean } => t.ride !== null)
      .sort((a, b) => a.x - b.x);
    const rideAt = (x: number) => {
      let ride = cymbalMode.ride;
      for (const sw of switches) if (sw.x <= x + s) ride = sw.ride;
      return ride;
    };
    let approximate = false;
    let length = beatsPerBar;
    const timed: { x: number; beat: number }[] = [];
    const pending: { c: Chord; v: 1 | 2; d: number }[] = [];
    for (const v of [1, 2] as const) {
      type Ev = { x: number; beats: number; chord?: Chord };
      const evs: Ev[] = [
        ...cs.filter((c) => c.voice === v).map((c) => ({ x: c.x, beats: c.beats * (tupletScale.get(c) ?? 1), chord: c })),
        // 온마디 쉼표는 음표가 있는 성부의 것이 아니다 (다른 성부가 이 마디를 쉰다는 뜻)
        ...rs.filter((r) => restVoice.get(r) === v && !r.measure).map((r) => ({ x: r.x, beats: r.beats * (tupletScale.get(r) ?? 1) })),
      ].sort((a, b) => a.x - b.x);
      if (!evs.some((x) => x.chord)) continue;
      const total = evs.reduce((sum, x) => sum + x.beats, 0);
      let start = 0;
      if (Math.abs(total - beatsPerBar) > 1e-6) {
        // 곡의 첫 마디가 짧으면 못갖춘마디: 끝에 붙인다. 그 밖에는 위치로 어림 (쉼표를 숨긴 악보도 많다)
        if (pieceStart && out.length === 0 && total < beatsPerBar) {
          start = beatsPerBar - total;
          length = Math.min(length, total);
        } else {
          for (const x of evs) if (x.chord) pending.push({ c: x.chord, v, d: x.beats });
          continue;
        }
      }
      let beat = start;
      for (const x of evs) {
        timed.push({ x: x.x, beat });
        if (x.chord) addChord(x.chord, beat);
        beat += x.beats;
      }
    }
    if (pending.length) {
      // 길이가 안 맞는 성부(숨긴 쉼표 등): 다른 성부에서 구한 (위치, 박)으로 자리를 찾는다.
      // 이 마디에서 실제로 쓰인 박 나눔(16분·셋잇단 등) 위에서, 음 길이 순서를 지키며 위치가 가장 가까운 박을 고른다
      const fits = (g: number) => timed.every((t) => Math.abs(t.beat * g - Math.round(t.beat * g)) < 1e-6);
      const grid = [4, 3, 8, 6, 12].find(fits) ?? 12;
      for (const v of [1, 2] as const) {
        const list = pending.filter((p) => p.v === v);
        if (!list.length) continue;
        const beats = placeByPosition(list.map((p) => ({ x: p.c.x, d: p.d })), timed, e.x0 + 2.5 * s, e.x1 - s, beatsPerBar, grid, 0.6 * s);
        list.forEach((p, i) => {
          // 다른 성부의 음과 같은 세로줄이면 정확한 박이다. 그 밖은 어림
          if (!timed.some((t) => Math.abs(t.x - p.c.x) < 0.6 * s)) approximate = true;
          addChord(p.c, beats[i]);
        });
      }
    }
    function addChord(c: Chord, beat: number) {
      const velocity = c.accent ? VELOCITY.accent : VELOCITY.normal;
      const added: ReadMeasure['notes'] = [];
      for (const h of c.heads) {
        let instrument = instrumentAt(h, c.open);
        if (instrument === 'hihatClosed' && !c.closed && rideAt(c.x)) instrument = 'ride';
        if (notes.some((n) => Math.abs(n.beat - beat) < 1e-6 && n.instrument === instrument)) continue;
        const note = { beat, instrument, velocity };
        notes.push(note);
        added.push(note);
      }
      if (c.flam) {
        // 꾸밈음과 같은 높이의 머리(같은 북)에 플램. 없으면 손으로 치는 첫 음
        const hand = added.filter((n) => n.instrument !== 'kick' && n.instrument !== 'hihatPedal');
        const same = hand.filter((n) => c.flam!.some((g) => instrumentAt(g, false) === n.instrument || Math.abs(g.pos - posOfInstrument(c, n.instrument)) <= 1));
        for (const n of same.length ? same : hand.slice(0, 1)) n.flam = true;
      }
    }
    if (switches.length) cymbalMode.ride = switches[switches.length - 1].ride;
    notes.sort((a, b) => a.beat - b.beat);
    out.push({ x0: e.x0, x1: e.x1, notes, approximate, length, marks: { ...emptyMarks(), startRepeat: e.startRepeat, endRepeat: e.endRepeat } });
  });
  return out;
}

/**
 * 쉼표가 어느 성부 것인지 정한다.
 * 가운데 줄에서 확실히 위·아래로 비켜 있으면 그 위치대로. 가운데 근처의 애매한 쉼표(MuseScore는 두 성부 쉼표를
 * 모두 가운데 둘 때가 많다)는 두 성부의 길이 합이 마디 길이에 가장 잘 맞도록 나눈다.
 * 그 성부 음표와 같은 세로줄에 있는 쉼표는 그 성부 것이 될 수 없다.
 */
function assignRests(
  cs: Chord[],
  rs: RestEv[],
  s: number,
  mid: number,
  beatsPerBar: number,
  chordBeats: (c: Chord) => number,
  restBeats: (r: RestEv) => number,
): Map<RestEv, 1 | 2> {
  const out = new Map<RestEv, 1 | 2>();
  const voices = new Set(cs.map((c) => c.voice));
  const clash = (r: RestEv, v: 1 | 2) => cs.some((c) => c.voice === v && Math.abs(c.x - r.x) < 0.6 * s);
  const loose: RestEv[] = [];
  for (const r of rs) {
    if (r.measure) out.set(r, voices.has(1) ? 2 : 1);
    else if (clash(r, 1) && !clash(r, 2)) out.set(r, 2);
    else if (clash(r, 2) && !clash(r, 1)) out.set(r, 1);
    else if (voices.size === 2 && r.y >= mid + s) out.set(r, 1);
    else if (voices.size === 2 && r.y <= mid - s) out.set(r, 2);
    else loose.push(r);
  }
  const sums = (extra: Map<RestEv, 1 | 2>) => {
    const t = { 1: 0, 2: 0 };
    for (const c of cs) t[c.voice] += chordBeats(c);
    for (const [r, v] of extra) if (!r.measure) t[v] += restBeats(r);
    return t;
  };
  const score = (m: Map<RestEv, 1 | 2>) => {
    const t = sums(m);
    let fit = 0;
    let dev = 0;
    for (const v of [1, 2] as const) {
      if (!voices.has(v) && t[v] === 0) continue;
      if (Math.abs(t[v] - beatsPerBar) < 1e-6) fit++;
      dev += t[v] > beatsPerBar + 1e-6 ? 10 * (t[v] - beatsPerBar) : beatsPerBar - t[v];
    }
    return fit * 100 - dev;
  };
  if (loose.length <= 10) {
    let best = new Map(out);
    let bestScore = -Infinity;
    for (let mask = 0; mask < 1 << loose.length; mask++) {
      const m = new Map(out);
      loose.forEach((r, i) => m.set(r, mask & (1 << i) ? 2 : 1));
      // 음표가 한 성부뿐이면 쉼표도 그쪽을 우선한다 (동점일 때 앞선 마스크가 남는다)
      const sc = score(m);
      if (sc > bestScore) {
        bestScore = sc;
        best = m;
      }
    }
    return best;
  }
  const only: 1 | 2 = voices.has(2) && !voices.has(1) ? 2 : 1;
  for (const r of loose) out.set(r, voices.size === 2 ? (r.y >= mid ? 1 : 2) : only);
  return out;
}

/**
 * 길이 합이 안 맞는 성부의 음을 박에 놓는다.
 * 박 → x 위치를 알려진 (x, 박) 점들로 보간해, 각 음의 x와 가장 가까운 격자 박을 고르되
 * 앞 음이 끝난 뒤에 다음 음이 오고(숨긴 쉼표는 허용) 마지막 음이 마디 안에서 끝나게 한다 (동적 계획법).
 */
export function placeByPosition(
  evs: { x: number; d: number }[],
  known: { x: number; beat: number }[],
  xStart: number,
  xEnd: number,
  beatsPerBar: number,
  grid: number,
  same: number,
): number[] {
  const pts = [...known].sort((a, b) => a.beat - b.beat || a.x - b.x);
  if (!pts.some((p) => p.beat === 0)) pts.unshift({ x: xStart, beat: 0 });
  pts.push({ x: Math.max(xEnd, pts[pts.length - 1].x + 1), beat: beatsPerBar });
  const xOf = (b: number) => {
    let i = pts.findIndex((p) => p.beat >= b);
    if (i <= 0) return pts[Math.max(0, i)].x;
    const a = pts[i - 1];
    const c = pts[i];
    return c.beat > a.beat ? a.x + ((c.x - a.x) * (b - a.beat)) / (c.beat - a.beat) : c.x;
  };
  const n = beatsPerBar * grid;
  const slots = Array.from({ length: n }, (_, k) => k / grid);
  const cost = evs.map((e) => {
    const exact = known.find((p) => Math.abs(p.x - e.x) < same);
    return slots.map((b) => (exact ? (Math.abs(b - exact.beat) < 1e-6 ? 0 : 1e6) : Math.abs(xOf(b) - e.x)));
  });
  const INF = 1e12;
  const dp = evs.map(() => new Array(n).fill(INF));
  const from = evs.map(() => new Array(n).fill(-1));
  for (let k = 0; k < n; k++) dp[0][k] = cost[0][k];
  for (let i = 1; i < evs.length; i++) {
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < k; j++) {
        // 앞 음 길이보다 일찍 오면 큰 벌점 (악보가 틀렸을 수도 있으니 금지하지는 않는다)
        const early = slots[j] + evs[i - 1].d > slots[k] + 1e-6 ? 50 : 0;
        const c = dp[i - 1][j] + cost[i][k] + early;
        if (c < dp[i][k]) {
          dp[i][k] = c;
          from[i][k] = j;
        }
      }
    }
  }
  const last = evs.length - 1;
  let bestK = 0;
  for (let k = 0; k < n; k++) {
    const over = slots[k] + evs[last].d > beatsPerBar + 1e-6 ? 50 : 0;
    const bestOver = slots[bestK] + evs[last].d > beatsPerBar + 1e-6 ? 50 : 0;
    if (dp[last][k] + over < dp[last][bestK] + bestOver) bestK = k;
  }
  const out = new Array(evs.length).fill(0);
  for (let i = last, k = bestK; i >= 0; i--) {
    out[i] = slots[k];
    k = from[i][k] >= 0 ? from[i][k] : k;
  }
  return out;
}

/** 화음 안에서 그 악기로 읽힌 머리의 오선 위치 */
function posOfInstrument(c: Chord, instrument: Instrument): number {
  return c.heads.find((h) => instrumentAt(h, c.open) === instrument)?.pos ?? -99;
}

/** 오선 위치·머리 모양 → 악기 (드럼 악보에서 가장 흔한 표기) */
function instrumentAt(h: Head, open: boolean): Instrument {
  const p = h.pos;
  if (h.kind === 'x' || h.kind === 'circleX') {
    if (p <= -1) return 'hihatPedal';
    if (p >= 10) return 'crash';
    if (p === 8) return 'ride';
    // 동그라미 X는 열린 하이햇 (MuseScore 기본 드럼 세트)
    if (p === 9) return open || h.kind === 'circleX' ? 'hihatOpen' : 'hihatClosed';
    return 'snare'; // 크로스 스틱
  }
  if (p <= 2) return 'kick';
  if (p <= 4) return 'floorTom';
  if (p === 5) return 'snare';
  if (p === 6) return 'tom2';
  if (p <= 8) return 'tom1';
  return open ? 'hihatOpen' : 'hihatClosed';
}

// ---------- 전체 ----------

interface Slot {
  /** 같은 마디의 여러 줄(예: <2x>, <D.S time>): 몇 번째로 칠 때 어느 줄인지 */
  variants: ReadMeasure[];
  labels: (Label | null)[];
  marks: MeasureMarks;
}
interface Label {
  visits: number[];
  ds: boolean;
}

function parseLabel(str: string): Label | null {
  const m = str.match(/<([^>]*)>/);
  if (!m) return null;
  const visits = [...m[1].matchAll(/(\d+)\s*x/gi)].map((x) => Number(x[1]));
  const ds = /D\.?\s?S|D\.?\s?C/i.test(m[1]);
  return visits.length || ds ? { visits, ds } : null;
}

export function readSheet(pages: PageContent[], fallbackTitle = 'PDF 악보'): SheetResult {
  const warnings: string[] = [];
  let beatsPerBar = 4;
  let bpm = 0;
  let title = '';
  const slots: Slot[] = [];
  const cymbalMode = { ride: false };
  let lastLabels: (Label | null)[] | null = null;
  let anyMusic = false;

  pages.forEach((page, pi) => {
    const staves = findStaves(page.segments, pi);
    const texts = textRuns(page.glyphs);
    if (pi === 0) {
      const big = texts.filter((t) => t.y > page.height * 0.75 && /\S/.test(t.str)).sort((a, b) => b.size - a.size)[0];
      title = big?.str.trim() ?? '';
      const tempo = texts.find((t) => /=\s*\d{2,3}/.test(t.str));
      if (tempo) bpm = Number(tempo.str.match(/=\s*(\d{2,3})/)![1]);
    }
    if (!staves.length) return;
    const syms = page.glyphs.map((g) => ({ g, sym: symbolOf(g) })).filter((x): x is { g: Glyph; sym: Sym } => x.sym !== null);
    if (syms.length) anyMusic = true;

    // 각 글리프·선분은 가장 가까운 오선 하나에만 속한다
    const band = (st: Staff, y: number) => (y > st.top ? y - st.top : y < st.bottom ? st.bottom - y : 0);
    const nearest = (x: number, y: number) => {
      let best: Staff | null = null;
      let bd = Infinity;
      for (const st of staves) {
        if (x < st.x0 - 4 * st.s || x > st.x1 + 2 * st.s) continue;
        const d = band(st, y);
        if (d < bd) {
          bd = d;
          best = st;
        }
      }
      return best && bd < 8 * best.s ? best : null;
    };
    const items = new Map<Staff, StaffItems>(staves.map((st) => [st, { glyphs: [], segs: [] }]));
    for (const x of syms) {
      const st = nearest(x.g.x, x.g.y);
      if (st) items.get(st)!.glyphs.push(x);
    }
    for (const seg of page.segments) {
      const midY = (seg.y1 + seg.y2) / 2;
      for (const st of staves) {
        // 마디줄은 여러 오선에 걸칠 수 있으니 겹치는 오선 모두에 준다
        const lo = Math.min(seg.y1, seg.y2);
        const hi = Math.max(seg.y1, seg.y2);
        if (hi >= st.bottom - 7 * st.s && lo <= st.top + 7 * st.s && (nearest((seg.x1 + seg.x2) / 2, midY) === st || (lo <= st.bottom && hi >= st.top))) items.get(st)!.segs.push(seg);
      }
    }

    // 박자표: 첫 페이지 첫 드럼 줄의 'c'(4/4) 또는 숫자
    const isDrum = (st: Staff) => {
      const it = items.get(st)!;
      const clef = it.glyphs.find((x) => (x.sym.t === 'percClef' || x.sym.t === 'clef') && x.g.x < st.x0 + 8 * st.s);
      if (clef) return clef.sym.t === 'percClef';
      return it.glyphs.some((x) => x.sym.t === 'head' && ((x.sym as { kind: HeadKind }).kind === 'x' || /percussion/i.test(x.g.font)));
    };
    const drums = staves.filter(isDrum);
    if (pi === 0 && drums[0]) {
      const st = drums[0];
      const ts = texts.filter((t) => /^\d{1,2}$/.test(t.str) && t.x < st.x0 + 15 * st.s && t.y >= st.bottom - st.s && t.y <= st.top + st.s);
      const up = ts.find((t) => posOf(st, t.y) >= 4);
      if (up && Number(up.str) >= 2 && Number(up.str) <= 12) beatsPerBar = Number(up.str);
    }

    // 시스템: 왼쪽 끝에서 여러 오선을 잇는 세로선
    const systemOf = new Map<Staff, number>();
    staves.forEach((st, i) => systemOf.set(st, i));
    for (const seg of page.segments) {
      if (!VERTICAL(seg)) continue;
      const lo = Math.min(seg.y1, seg.y2);
      const hi = Math.max(seg.y1, seg.y2);
      const linked = staves.filter((st) => Math.abs(seg.x1 - st.x0) < 3 && st.top <= hi + 1 && st.bottom >= lo - 1);
      if (linked.length > 1) {
        const id = Math.min(...linked.map((st) => systemOf.get(st)!));
        for (const st of linked) {
          const old = systemOf.get(st)!;
          for (const [k, v] of systemOf) if (v === old) systemOf.set(k, id);
        }
      }
    }
    const systems = [...new Set(staves.map((st) => systemOf.get(st)!))].map((id) => staves.filter((st) => systemOf.get(st) === id));

    for (const sys of systems) {
      const group = sys.filter((st) => drums.includes(st));
      if (!group.length) continue;
      const pieceStart = slots.length === 0;
      const read = group.map((st) => readStaff(st, items.get(st)!, beatsPerBar, cymbalMode, texts, pieceStart));
      const main = read[0];
      if (!main.length) continue;
      // 줄 이름표 <2x>, <D.S time>
      let labels = group.map((st) => {
        const t = texts.find((t) => t.str.includes('<') && t.y >= st.top - st.s && t.y <= st.top + 5 * st.s && t.x < st.x0 + 40 * st.s);
        return t ? parseLabel(t.str) : null;
      });
      if (group.length > 1 && labels.every((l) => !l) && lastLabels && lastLabels.length === labels.length) labels = lastLabels;
      if (labels.some((l) => l)) lastLabels = labels;

      const sysTop = sys[0].top;
      const sysBottom = sys[sys.length - 1].bottom;
      const s0 = sys[0].s;
      const startIdx = slots.length;
      main.forEach((m, k) => {
        const variants = read.map((r) => r.find((x) => Math.abs(x.x0 - m.x0) < 3 * s0 && Math.abs(x.x1 - m.x1) < 3 * s0) ?? null).filter((x): x is ReadMeasure => !!x);
        slots.push({ variants, labels: labels.slice(0, variants.length), marks: { ...m.marks } });
        void k;
      });

      // 이 시스템에 속한 표시: 시스템 위 14칸 ~ 아래 8칸
      const mine = (y: number) => y <= sysTop + 14 * s0 && y >= sysBottom - 8 * s0;
      const measureAt = (x: number) => {
        let i = main.findIndex((m) => x >= m.x0 - s0 && x < m.x1);
        if (i < 0) i = x < main[0].x0 ? 0 : main.length - 1;
        return slots[startIdx + i];
      };
      for (const t of texts) {
        if (!mine(t.y)) continue;
        const str = t.str.replace(/\s+/g, ' ');
        const cx = (t.x + t.x1) / 2;
        if (/to\s*coda/i.test(str)) measureAt(Math.min(cx, t.x1 - s0)).marks.toCoda = true;
        else if (/D\.\s?S\./i.test(str)) measureAt(t.x).marks.ds = true;
        else if (/D\.\s?C\./i.test(str)) measureAt(t.x).marks.dc = true;
        else if (/^fine$/i.test(str.trim())) measureAt(t.x).marks.fine = true;
        else if (/^\d(\s*[.,]\s*\d)*\.?(\s|$)/.test(str.trim()) && t.y > sysTop) {
          // 1·2번 괄호: 숫자 왼쪽 위에서 시작하는 가로선
          const line = page.segments.find(
            (g) => HORIZONTAL(g) && g.width < 1.5 && Math.min(g.x1, g.x2) <= t.x && Math.min(g.x1, g.x2) >= t.x - 3 * s0 && g.y1 > t.y && g.y1 - t.y < 3 * t.size && Math.abs(g.x2 - g.x1) > 4 * s0,
          );
          if (line) {
            // 숫자 뒤에 코드 이름 등이 붙어 한 덩어리로 읽힐 수 있다
            const nums = str.trim().match(/^\d(\s*[.,]\s*\d)*/)![0].match(/\d/g)!.map(Number);
            const lx0 = Math.min(line.x1, line.x2);
            const lx1 = Math.max(line.x1, line.x2);
            main.forEach((m, i) => {
              const overlap = Math.min(m.x1, lx1) - Math.max(m.x0, lx0);
              if (overlap > (m.x1 - m.x0) * 0.5) slots[startIdx + i].marks.volta = nums;
            });
          }
        }
      }
      for (const st of sys) {
        for (const { g, sym } of items.get(st)!.glyphs) {
          if (sym.t === 'segno') measureAt(g.x).marks.segno = true;
          if (sym.t === 'coda') measureAt(g.x).marks.coda = true;
        }
      }
      // 맨 위 오선 위쪽의 세뇨·코다 (보컬 줄이 있으면 그 위에 붙는다)
      for (const g of page.glyphs) {
        const sym = symbolOf(g);
        if (!sym || (sym.t !== 'segno' && sym.t !== 'coda') || !mine(g.y)) continue;
        if (sys.some((st) => items.get(st)!.glyphs.some((x) => x.g === g))) continue;
        if (sym.t === 'segno') measureAt(g.x).marks.segno = true;
        else measureAt(g.x).marks.coda = true;
      }
    }
  });

  if (!slots.length) {
    throw new Error(anyMusic || pages.some((p) => p.glyphs.length) ? '드럼 악보 줄을 찾지 못했어요' : '글자가 없는 PDF예요. 스캔한 악보는 아직 읽을 수 없어요');
  }

  // 1번 괄호는 다음 도돌이표(:||)까지 이어진다. 괄호 선이 다음 줄로 그려지지 않는 악보가 많다.
  // 그 뒤에 2번 괄호가 없으면 괄호로 보지 않는다(가사 절 번호 등)
  for (let i = 0; i < slots.length; i++) {
    const v = slots[i].marks.volta;
    if (!v || !v.includes(1)) continue;
    let j = i;
    while (j < slots.length && !slots[j].marks.endRepeat) j++;
    const next = slots[j + 1]?.marks.volta;
    if (j < slots.length && next && !next.includes(1)) {
      for (let k = i; k <= j; k++) slots[k].marks.volta = v;
    } else {
      for (let k = i; k < slots.length && slots[k].marks.volta?.join() === v.join(); k++) slots[k].marks.volta = null;
    }
    i = j;
  }

  const order = unroll(slots, warnings).slice(0, MAX_BARS);
  if (order.length === MAX_BARS) warnings.push(`너무 길어서 앞 ${MAX_BARS}마디만 불러왔어요`);

  // 박 위치 → 칸
  const placed: { beat: number; instrument: Instrument; velocity: number; flam?: boolean }[] = [];
  let approximated = 0;
  order.forEach(({ m }, bar) => {
    if (m.approximate) approximated++;
    for (const n of m.notes) placed.push({ ...n, beat: bar * beatsPerBar + n.beat });
  });
  const stepsPerBeat = chooseSubdivision(placed.map((n) => ({ beat: n.beat })));
  const notes: ScoreNote[] = [];
  const seen = new Set<string>();
  for (const n of placed) {
    const step = Math.round(n.beat * stepsPerBeat);
    const key = `${step}:${n.instrument}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ step, instrument: n.instrument, velocity: n.velocity, ...(n.flam ? { flam: true } : {}) });
  }
  if (!notes.length) throw new Error('드럼 음표를 찾지 못했어요');
  const uniq = new Set(order.map((o) => o.slot)).size;
  if (approximated) warnings.push(`${approximated}마디는 쉼표가 생략돼 음 위치로 박을 맞췄어요`);

  return {
    score: {
      version: 1,
      title: title || fallbackTitle,
      bpm: bpm >= 30 && bpm <= 300 ? bpm : 100,
      beatsPerBar,
      stepsPerBeat,
      bars: order.length,
      notes,
    },
    writtenBars: uniq,
    approximated,
    order: order.map((o) => o.slot),
    warnings,
  };
}

/** 도돌이표·괄호·D.S./D.C./코다를 따라 연주 순서를 만든다 */
function unroll(slots: Slot[], warnings: string[]): { slot: number; m: ReadMeasure }[] {
  const out: { slot: number; m: ReadMeasure }[] = [];
  const visits = new Array(slots.length).fill(0);
  const taken = new Map<number, number>();
  const segno = slots.findIndex((s) => s.marks.segno);
  const coda = slots.findIndex((s, i) => s.marks.coda && !s.marks.toCoda && i > 0);
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  let alCoda = false;
  let alFine = false;
  let i = 0;
  let guard = 0;
  while (i < slots.length && guard++ < 4000) {
    const sl = slots[i];
    const mk = sl.marks;
    if (mk.startRepeat && !(out.length && out[out.length - 1].slot >= i)) {
      if (repeatStart !== i) pass = 1;
      repeatStart = i;
    }
    if (mk.volta) {
      // D.S./D.C. 뒤에는 마지막 괄호, 단 To Coda가 든 괄호가 있으면 그 괄호
      const afterJump = () => {
        let max = 0;
        for (let k = i; k < slots.length && slots[k].marks.volta; k++) {
          if (alCoda && slots[k].marks.toCoda) return slots[k].marks.volta![0];
          max = Math.max(max, ...slots[k].marks.volta!);
        }
        return max;
      };
      const want = jumped ? afterJump() : pass;
      if (!mk.volta.includes(want)) {
        i++;
        continue;
      }
    }
    visits[i]++;
    out.push({ slot: i, m: pickVariant(sl, visits[i], jumped) });
    if (jumped && alFine && mk.fine) break;
    if (jumped && alCoda && mk.toCoda && coda > i) {
      i = coda;
      continue;
    }
    if (mk.endRepeat && !jumped) {
      const t = taken.get(i) ?? 0;
      if (t < 1) {
        taken.set(i, t + 1);
        pass++;
        i = repeatStart;
        continue;
      }
    }
    if ((mk.ds || mk.dc) && !jumped) {
      jumped = true;
      alCoda = coda >= 0;
      alFine = slots.some((s) => s.marks.fine);
      if (mk.ds && segno < 0) warnings.push('D.S. 표시가 있지만 세뇨(𝄋)를 못 찾아 처음으로 돌아가요');
      i = mk.ds && segno >= 0 ? segno : 0;
      pass = 1;
      continue;
    }
    i++;
  }
  return out;
}

function pickVariant(sl: Slot, visit: number, ds: boolean): ReadMeasure {
  const { variants, labels } = sl;
  if (variants.length === 1) return variants[0];
  if (labels.some((l) => l)) {
    if (ds) {
      const i = labels.findIndex((l) => l?.ds);
      if (i >= 0) return variants[i];
    }
    const i = labels.findIndex((l) => l?.visits.includes(visit));
    if (i >= 0) return variants[i];
    const free = labels.findIndex((l) => !l);
    if (free >= 0) return variants[free];
    return variants[0];
  }
  return variants[Math.min(variants.length - 1, ds ? variants.length - 1 : visit - 1)];
}
