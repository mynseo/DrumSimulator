import { DIGIT_TEMPLATES } from './digits';
import type { Glyph, PageImage, Segment } from './pdfPage';

/**
 * 그림으로 된 드럼 악보(스캔·이미지 PDF) 인식.
 *
 * 깨끗하게 조판된 악보를 가정한 규칙 기반 인식이다. 결과를 글자·선 PDF와 같은 모양(SMuFL 기호 + 선분)으로
 * 바꿔 내므로, 박 계산·반복 펼치기는 sheet.ts가 그대로 맡는다.
 * 1. 가로로 긴 검은 줄 5개 = 오선. 오선을 지운다(위아래로 이어진 기호는 남긴다)
 * 2. 세로로 긴 가는 줄 = 기둥·마디줄. 지운 뒤 남은 덩어리를 크기·모양으로 분류한다
 *    (꽉 찬 타원 = 음표 머리, X = X 머리, 납작하고 긴 것 = 빔, 작은 원 = 점, 키 큰 것 = 쉼표 …)
 */

export interface OmrResult {
  glyphs: Glyph[];
  segments: Segment[];
  /** 개발용: 덩어리와 분류 결과 (그림 좌표) */
  debug?: { blobs: { x: number; y: number; w: number; h: number; kind: string; area: number }[]; staves: Stave[]; verts: Vert[] };
}

const FONT = 'OMR';
/** 읽은 숫자·기호는 보통 글자로 내보낸다 (sheet.ts가 빠르기·여러 마디 쉼표 수로 읽는다) */
const TEXT_FONT = 'OMRText';

interface Line {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}
export interface Stave {
  lines: Line[];
  /** 줄 간격(픽셀) */
  s: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
}
export interface Vert {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  pixels: number[];
}

export function recognizeImage(img: PageImage, debug = false): OmrResult {
  const { w, h } = img;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = img.gray[i] < 150 ? 1 : 0;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? dark[y * w + x] : 0);

  // ---------- 1. 오선 ----------
  const rowRun: { len: number; x0: number }[] = [];
  let maxRun = 0;
  for (let y = 0; y < h; y++) {
    let best = 0;
    let bestX = 0;
    let cur = 0;
    for (let x = 0; x < w; x++) {
      if (dark[y * w + x]) {
        cur++;
        if (cur > best) {
          best = cur;
          bestX = x - cur + 1;
        }
      } else cur = 0;
    }
    rowRun.push({ len: best, x0: bestX });
    maxRun = Math.max(maxRun, best);
  }
  const lines: Line[] = [];
  for (let y = 0; y < h; y++) {
    const r = rowRun[y];
    if (r.len < maxRun * 0.75 || r.len < w * 0.3) continue;
    const last = lines[lines.length - 1];
    if (last && y === last.y1 + 1) {
      last.y1 = y;
      last.x0 = Math.min(last.x0, r.x0);
      last.x1 = Math.max(last.x1, r.x0 + r.len - 1);
    } else lines.push({ y0: y, y1: y, x0: r.x0, x1: r.x0 + r.len - 1 });
  }
  const staves: Stave[] = [];
  for (let i = 0; i + 4 < lines.length; ) {
    const five = lines.slice(i, i + 5);
    const mids = five.map((l) => (l.y0 + l.y1) / 2);
    const gaps = mids.slice(1).map((m, k) => m - mids[k]);
    const g = gaps.reduce((a, b) => a + b, 0) / 4;
    if (g > 4 && gaps.every((d) => Math.abs(d - g) < Math.max(1.6, g * 0.15))) {
      staves.push({ lines: five, s: g, top: mids[0], bottom: mids[4], x0: Math.min(...five.map((l) => l.x0)), x1: Math.max(...five.map((l) => l.x1)) });
      i += 5;
    } else i++;
  }
  if (!staves.length) return { glyphs: [], segments: [] };
  const s = staves.map((st) => st.s).sort((a, b) => a - b)[staves.length >> 1];

  // 오선 지우기: 줄 바로 위아래가 모두 비어 있는 곳만 (음표·마디줄이 지나가는 곳은 남긴다)
  for (const st of staves) {
    for (const l of st.lines) {
      for (let x = l.x0; x <= l.x1; x++) {
        if (at(x, l.y0 - 1) && at(x, l.y1 + 1)) continue;
        for (let y = l.y0; y <= l.y1; y++) dark[y * w + x] = 0;
      }
    }
  }
  // ---------- 2. 세로줄(기둥·마디줄) ----------
  // 가는 기둥은 흐린 회색으로 그려진 경우가 많아 더 연한 회색까지 검은 것으로 본다
  const faint = (x: number, y: number) => img.gray[y * w + x] < 215;
  // 기둥은 보통 3칸 이상. 고스트 노트 괄호(1.5칸 남짓)는 세로선으로 보지 않는다
  const minLen = Math.round(s * 2.1);
  const colRuns: { x: number; y0: number; y1: number }[] = [];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!faint(x, y)) {
        y++;
        continue;
      }
      let e = y;
      while (e + 1 < h && faint(x, e + 1)) e++;
      if (e - y + 1 >= minLen) colRuns.push({ x, y0: y, y1: e });
      y = e + 1;
    }
  }
  const verts: Vert[] = [];
  for (const r of colRuns) {
    const v = verts.find((v) => v.x1 === r.x - 1 && Math.min(v.y1, r.y1) - Math.max(v.y0, r.y0) > 0.6 * Math.min(v.y1 - v.y0, r.y1 - r.y0));
    if (v) {
      v.x1 = r.x;
      v.y0 = Math.min(v.y0, r.y0);
      v.y1 = Math.max(v.y1, r.y1);
    } else verts.push({ x0: r.x, x1: r.x, y0: r.y0, y1: r.y1 });
  }
  // 가는 것만 선이다 (음표 머리를 여러 개 쌓은 덩어리도 세로로 길 수 있다)
  const thinW = Math.max(4, s * 0.42);
  const thin = verts.filter((v) => v.x1 - v.x0 + 1 <= thinW);
  const thick = verts.filter((v) => v.x1 - v.x0 + 1 > thinW && v.x1 - v.x0 + 1 <= s * 0.8);
  const spans = (v: Vert) => staves.some((st) => v.y0 <= st.top + 1 && v.y1 >= st.bottom - 1);
  const lineVerts = [...thin, ...thick.filter(spans)];
  for (const v of lineVerts) for (let x = v.x0; x <= v.x1; x++) for (let y = v.y0; y <= v.y1; y++) dark[y * w + x] = 0;

  // ---------- 3. 덩어리 ----------
  const label = new Int32Array(w * h).fill(-1);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!dark[i] || label[i] >= 0) continue;
    const b: Blob = { x0: w, y0: h, x1: 0, y1: 0, area: 0, pixels: [] };
    label[i] = blobs.length;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      b.pixels.push(p);
      b.area++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (dark[q] && label[q] < 0) {
            label[q] = blobs.length;
            stack.push(q);
          }
        }
      }
    }
    blobs.push(b);
  }

  const out: OmrResult = { glyphs: [], segments: [] };
  if (debug) out.debug = { blobs: [], staves, verts: lineVerts };

  // 그림 좌표 → 페이지 좌표 (페이지는 위가 +y)
  const kx = (img.x1 - img.x0) / w;
  const ky = (img.y1 - img.y0) / h;
  const PX = (x: number) => img.x0 + x * kx;
  const PY = (y: number) => img.y1 - y * ky;
  const glyph = (char: string, x: number, yCenter: number, width: number) =>
    out.glyphs.push({ font: FONT, char, x: PX(x), y: PY(yCenter), size: 4 * s * ky, width: width * kx });

  for (const st of staves) {
    for (const l of st.lines) {
      const y = PY((l.y0 + l.y1) / 2);
      out.segments.push({ x1: PX(l.x0), y1: y, x2: PX(l.x1), y2: y, width: (l.y1 - l.y0 + 1) * ky });
    }
    // 그림 악보는 드럼 악보만 있다고 보고 오선마다 타악기 음자리표를 붙인다
    glyph('', st.x0 + s, (st.top + st.bottom) / 2, s);
  }
  for (const v of lineVerts) {
    const x = PX((v.x0 + v.x1 + 1) / 2);
    let y0 = v.y0;
    let y1 = v.y1 + 1;
    // 오선을 꿰뚫지만 한쪽 끝만 오선 끝줄에 닿는 기둥(빔에서 맨 아랫줄 머리까지)은 마디줄로 보이지 않게 끝을 조금 민다
    for (const st of staves) {
      if (y0 > st.top + 0.4 * s || y1 < st.bottom - 0.4 * s) continue;
      const topEnd = Math.abs(y0 - st.top) < 0.4 * s;
      const bottomEnd = Math.abs(y1 - st.bottom) < 0.4 * s;
      const otherStaff = staves.some((o) => o !== st && y0 <= o.bottom && y1 >= o.top);
      if (topEnd !== bottomEnd && !otherStaff && thin.includes(v)) {
        if (topEnd && st.top - y0 < 0.4 * s && y1 - st.bottom > 1.5 * s) y0 = st.top - 0.45 * s;
        if (bottomEnd && y1 - st.bottom < 0.4 * s && st.top - y0 > 1.5 * s) y1 = st.bottom + 0.45 * s;
      }
    }
    out.segments.push({ x1: x, y1: PY(y0), x2: x, y2: PY(y1), width: (v.x1 - v.x0 + 1) * kx });
  }

  const staveOf = (y: number) => {
    let best = staves[0];
    let bd = Infinity;
    for (const st of staves) {
      const d = y < st.top ? st.top - y : y > st.bottom ? y - st.bottom : 0;
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return { st: best, d: bd };
  };
  // 기둥 끝 (빔·꼬리가 붙는 곳)
  const stemEnds = thin.flatMap((v) => [
    { x: (v.x0 + v.x1) / 2, y: v.y0, top: true, v },
    { x: (v.x0 + v.x1) / 2, y: v.y1, top: false, v },
  ]);
  const touchesStemEnd = (b: Blob) => stemEnds.filter((e) => e.x >= b.x0 - 2 && e.x <= b.x1 + 2 && e.y >= b.y0 - s * 0.6 && e.y <= b.y1 + s * 0.6);
  // 두 기둥 사이를 잇는 덩어리 (기운 두 겹 빔은 기둥에 잘려 조각으로 남는다)
  const bridges = (b: Blob) => {
    const near = (x: number) => thin.filter((v) => Math.abs((v.x0 + v.x1) / 2 - x) <= 0.35 * s && v.y0 <= b.y1 + 0.3 * s && v.y1 >= b.y0 - 0.3 * s);
    const l = near(b.x0);
    const r = near(b.x1);
    return l.length > 0 && r.some((v) => !l.includes(v));
  };
  // 오선 위에서 두 기둥의 윗끝을 잇는 조각은 빔이다 (위로 뻗은 기둥 끝에 머리는 오지 않는다)
  const topBridge = (b: Blob) => {
    const tops = (x: number) => thin.filter((v) => Math.abs((v.x0 + v.x1) / 2 - x) <= 0.35 * s && v.y0 >= b.y0 - 0.4 * s && v.y0 <= b.y1 && v.y1 > b.y1 + s);
    const l = tops(b.x0);
    const r = tops(b.x1);
    return l.length > 0 && r.some((v) => !l.includes(v));
  };
  const stemFoot = (b: Blob) =>
    thin.some(
      (v) =>
        (v.x0 - b.x1 >= -1 && v.x0 - b.x1 <= 3 && v.y1 >= b.y0 && v.y1 <= b.y1 + 0.5 * s && v.y0 < b.y0 - s) ||
        (b.x0 - v.x1 >= -1 && b.x0 - v.x1 <= 3 && v.y0 <= b.y1 && v.y0 >= b.y0 - 0.5 * s && v.y1 > b.y1 + s),
    );
  // 꼬리는 기둥 끝에서 시작해 오른쪽으로 뻗는다 (왼쪽 끝이 기둥에 붙어 있다)
  // 위 기둥의 꼬리는 오선 위에, 아래 기둥의 꼬리는 오선 아래에 있다 (오선 쪽 끝에 붙은 것은 이웃 머리)
  const flagEnd = (b: Blob) => {
    const { st } = staveOf((b.y0 + b.y1) / 2);
    return stemEnds.find(
      (e) =>
        b.x0 >= e.x - 2 &&
        b.x0 <= e.x + 0.35 * s &&
        (e.top ? Math.abs(b.y0 - e.y) < 0.6 * s && b.y1 < st.top + 1.5 * s : Math.abs(b.y1 - e.y) < 0.6 * s && b.y0 > st.bottom - 1.5 * s),
    );
  };

  // 박자표: 오선 위쪽 절반과 아래쪽 절반에 같은 가로 위치로 겹쳐 놓인 숫자 두 개 (빼고 본다)
  const timeSig = new Set<Blob>();
  for (const a of blobs) {
    const ah = (a.y1 - a.y0 + 1) / s;
    if (ah < 1.4 || ah > 2.6) continue;
    const { st } = staveOf((a.y0 + a.y1) / 2);
    const mid = (st.top + st.bottom) / 2;
    if (!(a.y1 <= mid + 0.4 * s && a.y0 >= st.top - 0.5 * s)) continue;
    const b = blobs.find(
      (o) => o !== a && Math.abs((o.x0 + o.x1) / 2 - (a.x0 + a.x1) / 2) < 0.6 * s && o.y0 >= mid - 0.4 * s && o.y1 <= st.bottom + 0.5 * s && (o.y1 - o.y0 + 1) / s >= 1.4,
    );
    if (b) {
      timeSig.add(a);
      timeSig.add(b);
    }
  }

  // ---------- 4. 숫자: 여러 마디 쉼표 위의 마디 수, 빠르기(♩ = 130) ----------
  const textBlobs = new Set<Blob>();
  const text = (char: string, x0: number, x1: number, base: number, height: number) =>
    out.glyphs.push({ font: TEXT_FONT, char, x: PX(x0), y: PY(base), size: (height * ky) / 0.72, width: (x1 - x0 + 1) * kx });
  const digitOf = (b: Blob) => readDigit(b, w, label, blobs.indexOf(b));
  const cxOf = (b: Blob) => (b.x0 + b.x1) / 2;
  const hOf = (b: Blob) => (b.y1 - b.y0 + 1) / s;
  /** 왼쪽부터 바짝 붙어 이어지는 숫자들. 하나라도 숫자가 아니면 null */
  const digitRun = (cands: Blob[]) => {
    const run: Blob[] = [];
    for (const b of cands.sort((p, q) => p.x0 - q.x0)) {
      if (run.length && b.x0 - run[run.length - 1].x1 > 0.8 * s) break;
      if (hOf(b) < 0.9 || hOf(b) > 2.8) return null;
      run.push(b);
    }
    const digits = run.map((b) => digitOf(b));
    return run.length && digits.every((d) => d !== null) ? { blobs: run, str: digits.join('') } : null;
  };
  const emit = (run: Blob[], str: string) => {
    const base = Math.max(...run.map((b) => b.y1)) + 1;
    const height = Math.max(...run.map((b) => b.y1 - b.y0 + 1));
    // 숫자 사이가 벌어져 있어도 한 낱말로 읽히게 한 글자로 낸다
    text(str, run[0].x0, run[run.length - 1].x1, base, height);
    for (const b of run) textBlobs.add(b);
    return { base, height };
  };
  for (const b of blobs) {
    const W = (b.x1 - b.x0 + 1) / s;
    const H = hOf(b);
    const { st, d } = staveOf((b.y0 + b.y1) / 2);
    // 여러 마디 쉼표(오선 가운데의 굵고 긴 막대) 위의 숫자
    if (d === 0 && W >= 2.5 && H <= 0.8 && b.area / ((b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1)) >= 0.75) {
      const run = digitRun(blobs.filter((o) => o.y1 < st.top && o.y1 > st.top - 4 * s && cxOf(o) > b.x0 && cxOf(o) < b.x1));
      if (run) emit(run.blobs, run.str);
    }
    // 빠르기: 가로로 납작한 획 두 개가 위아래로 놓인 = 와 그 오른쪽 숫자
    if (d > 0 && b.y1 < st.top && W >= 0.5 && W <= 1.6 && H <= 0.4) {
      const pair = blobs.find((o) => o !== b && Math.abs(o.x0 - b.x0) < 0.3 * s && Math.abs(o.x1 - b.x1) < 0.3 * s && o.y0 > b.y1 && o.y0 - b.y1 < 0.8 * s && hOf(o) <= 0.4);
      if (!pair) continue;
      const top = b.y0 - 1.5 * s;
      const bottom = pair.y1 + 1.5 * s;
      const run = digitRun(blobs.filter((o) => o.x0 > b.x1 && o.x0 - b.x1 < 6 * s && o.y0 >= top && o.y1 <= bottom));
      if (!run || run.blobs[0].x0 - b.x1 > 1.2 * s || run.str.length < 2) continue;
      const { base, height } = emit(run.blobs, run.str);
      text('=', b.x0, b.x1, base, height);
      textBlobs.add(b);
      textBlobs.add(pair);
      // = 왼쪽의 작은 음표(♩)도 악보의 음이 아니다
      for (const o of blobs) if (o.x1 < b.x0 && b.x0 - o.x1 < 2.5 * s && o.y0 >= top - 2 * s && o.y1 <= bottom) textBlobs.add(o);
    }
  }

  // 잇단음표 숫자 3·5·6: 오선 밖, 기둥에 붙지 않은 숫자
  for (const b of blobs) {
    if (textBlobs.has(b) || timeSig.has(b)) continue;
    const H = hOf(b);
    const W = (b.x1 - b.x0 + 1) / s;
    const { st, d } = staveOf((b.y0 + b.y1) / 2);
    if (d < 0.5 * s || d > 4 * s || H < 0.9 || H > 2 || W < 0.45 || W > 1.4 || cxOf(b) < st.x0 + 3.2 * s) continue;
    if (thin.some((v) => v.x1 >= b.x0 - 2 && v.x0 <= b.x1 + 2 && v.y0 <= b.y1 && v.y1 >= b.y0)) continue;
    const n = digitOf(b);
    if (n !== '3' && n !== '5' && n !== '6') continue;
    glyph(n === '3' ? '\ue883' : n === '5' ? '\ue885' : '\ue886', b.x0, (b.y0 + b.y1) / 2, b.x1 - b.x0 + 1);
    textBlobs.add(b);
  }

  // 4분쉼표는 오선을 지울 때 여러 조각으로 갈라진다: 기둥 없는 좁은 세로 띠에 모인 작은 조각들
  for (const a of blobs) {
    if (textBlobs.has(a) || timeSig.has(a)) continue;
    const { st, d } = staveOf((a.y0 + a.y1) / 2);
    if (d > 0 || (a.x1 - a.x0 + 1) / s > 0.9 || hOf(a) > 1.5 || cxOf(a) < st.x0 + 3.2 * s) continue;
    const group = blobs.filter((o) => !textBlobs.has(o) && o.x0 <= a.x1 + 0.3 * s && o.x1 >= a.x0 - 0.3 * s && o.y1 >= st.top - 0.5 * s && o.y0 <= st.bottom + 0.5 * s && (o.x1 - o.x0 + 1) / s <= 0.9 && hOf(o) <= 1.5);
    if (group.length < 2) continue;
    const x0 = Math.min(...group.map((o) => o.x0));
    const x1 = Math.max(...group.map((o) => o.x1));
    const y0 = Math.min(...group.map((o) => o.y0));
    const y1 = Math.max(...group.map((o) => o.y1));
    if ((x1 - x0 + 1) / s > 1.2 || (y1 - y0 + 1) / s < 2.2 || (y1 - y0 + 1) / s > 3.3) continue;
    if (thin.some((v) => v.x1 >= x0 - 0.5 * s && v.x0 <= x1 + 0.5 * s && v.y0 <= y1 && v.y1 >= y0)) continue;
    glyph('', x0, (y0 + y1) / 2, x1 - x0 + 1);
    for (const o of group) textBlobs.add(o);
  }

  // 괄호 친 고스트 노트를 기둥이 가로지르면 기둥을 지울 때 "(●" 와 "●)" 두 쪽으로 갈라진다. 다시 붙여 읽는다
  for (const a of blobs) {
    if (textBlobs.has(a) || hOf(a) < 1.3 || hOf(a) > 2.3 || (a.x1 - a.x0 + 1) / s > 1) continue;
    const b = blobs.find(
      (o) => o !== a && !textBlobs.has(o) && o.x0 > a.x1 && o.x0 - a.x1 <= thinW + 2 && Math.abs(o.y0 - a.y0) < 0.3 * s && Math.abs(o.y1 - a.y1) < 0.3 * s && (o.x1 - o.x0 + 1) / s <= 1,
    );
    if (!b) continue;
    const width = (b.x1 - a.x0 + 1) / s;
    const stem = thin.some((v) => v.x0 >= a.x1 && v.x1 <= b.x0 && v.y0 <= (a.y0 + a.y1) / 2 && v.y1 >= (a.y0 + a.y1) / 2);
    if (!stem || width < 1.1 || width > 2.3) continue;
    const cy = (a.y0 + a.y1) / 2;
    const { st, d } = staveOf(cy);
    if (d > 2 * s || cxOf(a) < st.x0 + 3.2 * s) continue;
    const head = Math.min(1.1 * s, (b.x1 - a.x0 + 1) * 0.6);
    const cx = (a.x0 + b.x1 + 1) / 2;
    glyph('\ue0f5', a.x0, cy, 0.4 * s);
    glyph('\ue0a4', cx - head / 2, cy, head);
    textBlobs.add(a);
    textBlobs.add(b);
  }

  for (const b of blobs) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    if (bw < 3 && bh < 3) continue;
    const W = bw / s;
    const H = bh / s;
    const density = b.area / (bw * bh);
    const { st, d } = staveOf((b.y0 + b.y1) / 2);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const inStaff = d === 0;
    let kind = '?';
    const isHeader = cx < st.x0 + 3.2 * s;

    const id = blobs.indexOf(b);
    const ends = touchesStemEnd(b);
    let cores: { x0: number; x1: number }[] = [];
    let pieces: { x0: number; x1: number }[] = [];
    if (d > 6 * s || isHeader || timeSig.has(b) || textBlobs.has(b)) kind = 'skip';
    else if (cy < st.top && W >= 0.6 && H <= 1.6 && topBridge(b)) kind = 'beam';
    else if (d < 2 * s && H >= 0.75 && H <= 1.4 && W >= 1.9 && W <= 8 && density < 0.6 && (pieces = splitX(b, s, w, label, id)).length) kind = 'xs';
    // 머리보다 납작하고 넓은 오선 밖 조각: 두 겹 빔의 아래 빔 토막
    else if (!inStaff && W >= 1.3 && W <= 2.2 && H < 0.8 && density < 0.75 && thicknessOk(b, s, w, label, id) && bridges(b)) kind = 'beam';
    else if (W <= 0.75 && H <= 0.75 && W >= 0.3 && H >= 0.3 && density >= 0.55 && d < 2 * s && cy < st.bottom && stemFoot(b)) {
      kind = 'smallHead'; // 기둥 끝에 바로 붙은 작은 조각: 기둥에 반쯤 잘린 작은 머리(고스트 노트)
    } else if (W <= 0.52 && H <= 0.52 && W >= 0.2 && H >= 0.2 && density >= 0.55) {
      kind = 'dot';
    } else if (W >= 0.52 && W <= 0.9 && H >= 0.45 && H <= 0.85 && density >= 0.7 && d < 2 * s) {
      kind = 'head'; // 작은 머리 (괄호 친 고스트 노트)
    } else if (d >= 1.5 * s && W >= 1 && H <= 3.2 && bridges(b) && thicknessOk(b, s, w, label, id)) {
      kind = 'beam';
    } else if (!inStaff && density < 0.55 && flagEnd(b) && H >= 0.8 && H <= 4.8 && W >= 0.45 && W <= 1.6) {
      // 오선 밖에서 기둥 끝에 붙은 획은 꼬리 (대각선이라 X 머리처럼 보일 수 있다)
      kind = H <= 2.4 ? 'flag1' : H <= 3.6 ? 'flag2' : 'flag3';
    } else if (W >= 0.75 && W <= 1.75 && H >= 0.6 && H <= 1.55 && (density >= 0.62 || ring(b, w, label, id) > 0.75 || diagonals(b, w, label, id) > 0.7) && !(W >= 1.1 && H <= 0.8 && density >= 0.75)) {
      // 음표 머리: 꽉 찬 타원 / 테두리 원(⊗) / X. 기둥 조각이 붙어 조금 길어질 수 있다
      if (ring(b, w, label, id) > 0.75 && W >= 0.95 && H >= 0.85 * W && density < 0.58) kind = 'circleX';
      else if (density >= 0.62) kind = 'head';
      else kind = 'x';
    } else if (W > 1.4 && W <= 2.4 && H >= 0.7 && H <= 1.4 && diagonals(b, w, label, id) > 0.6 && density < 0.6) {
      kind = 'x'; // 덧줄이 붙은 X (크래시)
    } else if (W >= 0.7 && density >= 0.55 && H <= 1.7 && ends.length && thicknessOk(b, s, w, label, id) && diagonals(b, w, label, id) < 0.5) {
      kind = 'beam'; // 빔 (기울어진 빔·두 겹 빔·짧은 갈고리 빔 포함)
    } else if (W >= 1.5 && H <= 3.2 && ends.length && thicknessOk(b, s, w, label, id) && slanted(b, s, w, label, id)) {
      kind = 'beam'; // 많이 기운 빔: 상자는 성기지만 열마다 두께가 고른 띠 하나
    } else if (W >= 1.1 && H <= 0.8 && density >= 0.75) {
      // 납작하고 긴 외톨이: 오선 가운데면 쉼표(짧으면 온·2분, 아주 길면 여러 마디 쉼)
      if (inStaff && W >= 2.5) kind = 'multirest';
      else if (inStaff && W <= 1.8) {
        // 온쉼표는 줄에 매달리고(위쪽이 줄), 2분쉼표는 줄 위에 앉는다(아래쪽이 줄)
        const near = (y: number) => Math.min(...st.lines.map((l) => Math.abs((l.y0 + l.y1) / 2 - y)));
        kind = near(b.y0) < near(b.y1 + 1) ? 'wholeRest' : 'halfRest';
      }
      else kind = 'beam';
    } else if (W <= 0.55 && H >= 0.9 && H <= 1.9 && d < 2 * s) {
      kind = 'paren'; // 고스트 노트 괄호
    } else if (W >= 1.2 && W <= 5 && H >= 0.8 && H <= 2.2 && d < 2 * s && (cores = denseCores(b, s, w, label, id)).length) {
      kind = 'ghost'; // 괄호와 붙은 머리
    } else if (W > 1.2 && W <= 2.4 && H >= 0.5 && H <= 1.2 && !inStaff) {
      kind = 'accent';
    } else if (W <= 0.8 && H <= 0.8 && W >= 0.35 && hole(b, w, label, id)) {
      kind = 'open';
    } else if (flagEnd(b) && H >= 1.2 && H <= 4.8 && W >= 0.45 && W <= 1.6) {
      // 기둥 끝에 붙은 꼬리: 길이로 개수를 센다
      kind = H <= 2.4 ? 'flag1' : H <= 3.6 ? 'flag2' : 'flag3';
    } else if (H >= 1.3 && H <= 3.4 && W >= 0.55 && W <= 1.5) {
      if (H <= 2.2) kind = 'rest8';
      else kind = lobes(b, w, label, id) >= 2 ? 'rest16' : 'rest4';
    } else if (W >= 1.4 && W <= 2.6 && H >= 1.3 && H <= 2.6 && inStaff) {
      kind = 'measureRepeat';
    }
    // 음표 머리는 오선 근처에만 있다 (덧줄 두 개 정도까지). 그보다 먼 X·⊗ 모양은 악센트·열림 표시
    const pos = (st.bottom - cy) / (s / 2);
    if ((kind === 'head' || kind === 'x' || kind === 'circleX') && (pos > 12.5 || pos < -6.5)) kind = W <= 0.85 && hole(b, w, label, id) ? 'open' : 'accent';
    out.debug?.blobs.push({ x: b.x0, y: b.y0, w: bw, h: bh, kind, area: b.area });

    const left = b.x0;
    switch (kind) {
      case 'head':
        glyph('', left, cy, bw);
        break;
      case 'xs':
        // 맞붙은 X 머리 여러 개
        for (const p of pieces) glyph('', p.x0, cy, p.x1 - p.x0 + 1);
        break;
      case 'x':
        // 덧줄이 붙어 넓어진 X는 가운데 머리 폭만큼만
        glyph('', cx - Math.min(bw, 1.2 * s) / 2, cy, Math.min(bw, 1.2 * s));
        break;
      case 'circleX':
        glyph('', left, cy, bw);
        break;
      case 'smallHead':
        glyph('\ue0f5', b.x0 - 0.45 * s, cy, 0.4 * s);
        glyph('\ue0a4', b.x1 + 1 - 0.75 * s, cy, 0.75 * s);
        break;
      case 'dot':
        glyph('', left, cy, bw);
        break;
      case 'accent':
        glyph('', left, cy, bw);
        break;
      case 'open':
        glyph('', left, cy, bw);
        break;
      case 'rest8':
        glyph('', left, cy, bw);
        break;
      case 'rest16':
        glyph('', left, cy, bw);
        break;
      case 'rest4':
        glyph('', left, cy, bw);
        break;
      case 'halfRest':
        glyph('', left, cy, bw);
        break;
      case 'wholeRest':
        glyph('', left, cy, bw);
        break;
      case 'multirest':
        glyph('\ue4ee', left, cy, bw);
        break;
      case 'paren':
        glyph('\ue0f5', left, cy, bw);
        break;
      case 'ghost':
        for (const c of cores) {
          glyph('\ue0f5', c.x0 - 0.45 * s, cy, 0.4 * s);
          glyph('\ue0a4', c.x0, cy, c.x1 - c.x0 + 1);
        }
        break;
      case 'measureRepeat':
        glyph('', left, cy, bw);
        break;
      case 'flag1':
      case 'flag2':
      case 'flag3': {
        const e = flagEnd(b)!;
        const n = Number(kind.slice(4));
        const up = e.top; // 위로 뻗은 기둥 끝(위쪽)에 붙은 꼬리
        glyph(String.fromCharCode(0xe240 + (n - 1) * 2 + (up ? 0 : 1)), e.x, e.y + (up ? 0.5 : -0.5) * s, bw);
        break;
      }
      case 'beam':
        for (const seg of beamSegments(b, s, w, label, blobs.indexOf(b))) {
          out.segments.push({ x1: PX(seg.x1), y1: PY(seg.y1), x2: PX(seg.x2), y2: PY(seg.y2), width: seg.t * ky });
        }
        break;
    }
  }
  return out;
}

/** 덩어리 안 한 열의 검은 구간들 */
function columnRuns(b: Blob, x: number, w: number, label: Int32Array, id: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let y = b.y0; y <= b.y1 + 1; y++) {
    const on = y <= b.y1 && label[y * w + x] === id;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      runs.push([start, y - 1]);
      start = -1;
    }
  }
  return runs;
}

function thicknessOk(b: Blob, s: number, w: number, label: Int32Array, id: number): boolean {
  const ts: number[] = [];
  for (let x = b.x0; x <= b.x1; x++) for (const [a, c] of columnRuns(b, x, w, label, id)) ts.push(c - a + 1);
  ts.sort((p, q) => p - q);
  const med = ts[ts.length >> 1] ?? 0;
  return med >= 0.25 * s && med <= 0.8 * s;
}

let digitTemplates: { d: string; ar: number; f: number[] }[] | null = null;

/** 덩어리를 가로 5 × 세로 7칸으로 나눈 검은 정도를 숫자 견본과 비교한다. 충분히 닮은 것이 없으면 null */
function readDigit(b: Blob, w: number, label: Int32Array, id: number): string | null {
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bh < 8 || bw > bh * 1.2) return null;
  digitTemplates ??= DIGIT_TEMPLATES.map((t) => ({ d: t[0], ar: Number(t.slice(1, 4)) / 100, f: [...t.slice(4)].map(Number) }));
  const f: number[] = [];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      const y0 = (gy * bh) / 7;
      const y1 = ((gy + 1) * bh) / 7;
      const x0 = (gx * bw) / 5;
      const x1 = ((gx + 1) * bw) / 5;
      let ink = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (label[(b.y0 + y) * w + b.x0 + x] === id) ink += wx * wy;
          area += wx * wy;
        }
      }
      f.push((ink / area) * 9);
    }
  }
  const ar = bw / bh;
  let best = Infinity;
  let digit: string | null = null;
  for (const t of digitTemplates) {
    let dist = 40 * (ar - t.ar) ** 2;
    for (let i = 0; i < 35; i++) dist += (f[i] - t.f[i]) ** 2;
    if (dist < best) {
      best = dist;
      digit = t.d;
    }
  }
  return best < 260 ? digit : null;
}

/** 열마다 띠가 하나씩이고 그 가운데 높이가 한쪽으로 고르게 움직이는가 (기운 빔) */
function slanted(b: Blob, s: number, w: number, label: Int32Array, id: number): boolean {
  const mids: number[] = [];
  let ok = 0;
  let n = 0;
  for (let x = b.x0; x <= b.x1; x++) {
    const runs = columnRuns(b, x, w, label, id);
    if (!runs.length) continue;
    n++;
    if (runs.length === 1) {
      ok++;
      mids.push((runs[0][0] + runs[0][1]) / 2);
    }
  }
  if (n === 0 || ok / n < 0.8 || mids.length < 4) return false;
  // 가운데 높이가 거의 직선으로 이어져야 한다
  const k = (mids[mids.length - 1] - mids[0]) / (mids.length - 1);
  const err = median(mids.map((m, i) => Math.abs(m - (mids[0] + k * i))));
  return err <= 0.3 * s;
}

/** 빔 덩어리 → 선분들 (두 겹 빔이 붙어 있으면 위아래로 나눈다) */
function beamSegments(b: Blob, s: number, w: number, label: Int32Array, id: number) {
  const cols: [number, number][][] = [];
  for (let x = b.x0; x <= b.x1; x++) cols.push(columnRuns(b, x, w, label, id).filter(([a, c]) => c - a + 1 >= 0.2 * s));
  const layers = Math.max(1, Math.round(median(cols.map((c) => c.length).filter((n) => n > 0))));
  const segs: { x1: number; y1: number; x2: number; y2: number; t: number }[] = [];
  for (let k = 0; k < layers; k++) {
    const pts: { x: number; y: number; t: number }[] = [];
    cols.forEach((c, i) => {
      if (c.length === layers) pts.push({ x: b.x0 + i, y: (c[k][0] + c[k][1]) / 2, t: c[k][1] - c[k][0] + 1 });
    });
    if (pts.length < 2) continue;
    // 양 끝 몇 열의 가운데 높이로 직선을 잡는다
    const n = Math.max(1, Math.round(pts.length * 0.2));
    const l = pts.slice(0, n);
    const r = pts.slice(-n);
    segs.push({
      x1: b.x0,
      y1: median(l.map((p) => p.y)),
      x2: b.x1 + 1,
      y2: median(r.map((p) => p.y)),
      t: median(pts.map((p) => p.t)),
    });
  }
  return segs;
}

/** 괄호 사이의 꽉 찬 머리들: 세로로 두꺼운 열들이 이어진 구간마다 하나 (괄호 친 고스트 노트가 둘 붙어 있을 수 있다) */
function denseCores(b: Blob, s: number, w: number, label: Int32Array, id: number): { x0: number; x1: number }[] {
  const cores: { x0: number; x1: number }[] = [];
  let start = -1;
  for (let x = b.x0; x <= b.x1 + 1; x++) {
    const thick = x <= b.x1 && columnRuns(b, x, w, label, id).some(([a, c]) => c - a + 1 >= 0.5 * s && c - a + 1 <= 1.3 * s);
    if (thick && start < 0) start = x;
    if (!thick && start >= 0) {
      if (x - start >= 0.5 * s && x - start <= 1.6 * s) cores.push({ x0: start, x1: x - 1 });
      start = -1;
    }
  }
  return cores;
}

/** 두 대각선 위에 검은 점이 얼마나 있는가 (X 모양이면 1에 가깝다) */
/** 맞붙은 X 머리 덩어리를 같은 폭으로 나눈다. 조각마다 X 모양이어야 한다 */
function splitX(b: Blob, s: number, w: number, label: Int32Array, id: number): { x0: number; x1: number }[] {
  const bw = b.x1 - b.x0 + 1;
  const k = Math.round(bw / (1.35 * s));
  if (k < 2) return [];
  const pieces = Array.from({ length: k }, (_, i) => ({ x0: Math.round(b.x0 + (i * bw) / k), x1: Math.round(b.x0 + ((i + 1) * bw) / k) - 1 }));
  return pieces.every((p) => diagonals({ ...b, x0: p.x0, x1: p.x1 }, w, label, id) > 0.6) ? pieces : [];
}

function diagonals(b: Blob, w: number, label: Int32Array, id: number): number {
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  // 덧줄이 붙은 넓은 X는 가운데 정사각형만 본다
  const side = Math.min(bw, bh);
  const ox = b.x0 + (bw - side) / 2;
  let hit = 0;
  let n = 0;
  for (let t = 0.1; t <= 0.9; t += 0.05) {
    for (const [x, y] of [
      [ox + t * side, b.y0 + t * bh],
      [ox + (1 - t) * side, b.y0 + t * bh],
    ]) {
      n++;
      let on = false;
      for (let dx = -1; dx <= 1 && !on; dx++) for (let dy = -1; dy <= 1 && !on; dy++) on = label[Math.round(y + dy) * w + Math.round(x + dx)] === id;
      if (on) hit++;
    }
  }
  return hit / n;
}

/** 테두리 원 위에 검은 점이 얼마나 있는가 (⊗·○) */
function ring(b: Blob, w: number, label: Int32Array, id: number): number {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const rx = (b.x1 - b.x0) / 2 - 0.5;
  const ry = (b.y1 - b.y0) / 2 - 0.5;
  let hit = 0;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let on = false;
    for (let k = 0; k <= 2 && !on; k++) {
      const x = Math.round(cx + Math.cos(a) * (rx - k));
      const y = Math.round(cy + Math.sin(a) * (ry - k));
      on = label[y * w + x] === id;
    }
    if (on) hit++;
  }
  return hit / n;
}

/** 가운데가 비어 있는 작은 원 */
function hole(b: Blob, w: number, label: Int32Array, id: number): boolean {
  const cx = Math.round((b.x0 + b.x1) / 2);
  const cy = Math.round((b.y0 + b.y1) / 2);
  return label[cy * w + cx] !== id && ring(b, w, label, id) > 0.7;
}

/** 왼쪽 가장자리 쪽의 덩어리 수: 16분쉼표는 갈고리가 두 개 */
function lobes(b: Blob, w: number, label: Int32Array, id: number): number {
  const x = Math.round(b.x0 + (b.x1 - b.x0) * 0.25);
  return columnRuns(b, x, w, label, id).length;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q);
  return a[a.length >> 1];
}
