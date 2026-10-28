/**
 * PDF 한 페이지에서 악보를 읽는 데 필요한 원재료만 뽑는다.
 * - 글리프: 음악 글꼴(Maestro, Bravura 등)의 음표 머리·쉼표·기호 한 글자씩, 페이지 좌표의 기준점(왼쪽 아래)과 함께
 * - 선분: 오선·마디줄·기둥(stem)·빔(beam)
 * pdf.js의 텍스트 추출은 가까운 글자를 한 덩어리로 묶어 버려서, 그리기 명령을 직접 따라가며 글자마다 위치를 구한다.
 */

/** pdf.js의 연산자 번호 (pdfjs-dist 4.x OPS) */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  beginText: 31,
  setCharSpacing: 33,
  setWordSpacing: 34,
  setHScale: 35,
  setLeading: 36,
  setFont: 37,
  setTextRise: 39,
  moveText: 40,
  setLeadingMoveText: 41,
  setTextMatrix: 42,
  nextLine: 43,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  setLineWidth: 2,
  constructPath: 91,
  paintImageXObject: 85,
} as const;

export interface Glyph {
  /** 글꼴 이름 (서브셋 접두어 제거, 예: "MaestroPercussion") */
  font: string;
  /** 유니코드 글자 (음악 글꼴은 보통 개인 영역이거나 ASCII 자리) */
  char: string;
  /** 글자 기준점 (페이지 좌표, 위가 +y) */
  x: number;
  y: number;
  /** 글자 크기(페이지 단위) */
  size: number;
  width: number;
}

/** 직선 조각. 채운 사각형(빔·두꺼운 줄)도 가운데 선과 두께로 바꿔 둔다 */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** 페이지에 그려진 그림(스캔·이미지로 만든 악보). 흑백 밝기 0(검정)~255(흰색) */
export interface PageImage {
  gray: Uint8Array;
  w: number;
  h: number;
  /** 그림이 놓인 페이지 좌표 범위 (왼쪽 아래 x0,y0 ~ 오른쪽 위 x1,y1) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageContent {
  width: number;
  height: number;
  glyphs: Glyph[];
  segments: Segment[];
  /** 페이지의 절반 이상을 덮는 그림만 (악보를 그림으로 넣은 PDF) */
  images?: PageImage[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** pdf.js 페이지 객체 중 여기서 쓰는 부분 */
export interface PdfPageLike {
  view: number[];
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  commonObjs: { get(name: string): unknown; has?(name: string): boolean };
  objs?: { get(name: string, callback?: (data: unknown) => void): unknown };
}

interface GlyphArg {
  unicode?: string;
  fontChar?: string;
  width?: number;
  isSpace?: boolean;
}

export async function readPage(page: PdfPageLike): Promise<PageContent> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const glyphs: Glyph[] = [];
  const segments: Segment[] = [];

  interface State {
    ctm: Matrix;
    lineWidth: number;
    font: string;
    fontSize: number;
    fontMatrix: number[];
    vertical: boolean;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    leading: number;
    rise: number;
  }
  let st: State = {
    ctm: IDENTITY,
    lineWidth: 1,
    font: '',
    fontSize: 1,
    fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    vertical: false,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  const stack: State[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let path: { pts: [number, number][]; closed: boolean }[] = [];
  const imageOps: { id: string; ctm: Matrix }[] = [];

  const fontName = (id: string) => {
    try {
      const f = page.commonObjs.get(id) as { name?: string; loadedName?: string; fontMatrix?: number[]; vertical?: boolean };
      return f;
    } catch {
      return undefined;
    }
  };

  const showGlyphs = (items: unknown[]) => {
    const fm = st.fontMatrix;
    for (const it of items) {
      if (typeof it === 'number') {
        // TJ 간격: 1/1000 글자 크기 단위, 양수면 왼쪽으로
        const tx = (-it / 1000) * st.fontSize * st.hScale;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
        continue;
      }
      const g = it as GlyphArg | null;
      if (!g) continue;
      const w = (g.width ?? 0) * fm[0];
      const trm = mul([st.fontSize * st.hScale, 0, 0, st.fontSize, 0, st.rise], mul(tm, st.ctm));
      const [x, y] = apply(trm, 0, 0);
      const size = Math.hypot(trm[2], trm[3]);
      const ch = g.unicode ?? g.fontChar ?? '';
      if (ch && !g.isSpace) glyphs.push({ font: st.font, char: ch, x, y, size, width: w * size });
      const tx = (w * st.fontSize + st.charSpacing + (g.isSpace ? st.wordSpacing : 0)) * st.hScale;
      tm = mul([1, 0, 0, 1, tx, 0], tm);
    }
  };

  const flush = (kind: 'stroke' | 'fill') => {
    for (const sub of path) {
      const p = sub.pts.map(([x, y]) => apply(st.ctm, x, y));
      if (kind === 'stroke') {
        const lw = st.lineWidth * Math.hypot(st.ctm[0], st.ctm[1]) || 0.5;
        const n = sub.closed ? p.length : p.length - 1;
        for (let i = 0; i < n; i++) {
          const a = p[i];
          const b = p[(i + 1) % p.length];
          segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], width: lw });
        }
      } else if (p.length >= 3) {
        const seg = fillToSegment(p);
        // 배경·글상자처럼 큰 면은 선이 아니다 (빔·굵은 마디줄은 두께가 몇 pt 안 된다)
        if (seg.width < 20) segments.push(seg);
      }
    }
    path = [];
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as any[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...st });
        break;
      case OPS.restore:
        st = stack.pop() ?? st;
        break;
      case OPS.transform:
        st.ctm = mul(args as Matrix, st.ctm);
        break;
      case OPS.setLineWidth:
        st.lineWidth = args[0];
        break;
      case OPS.beginText:
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case OPS.setFont: {
        const f = fontName(args[0]);
        st.font = (f?.name ?? args[0]).replace(/^[A-Z]{6}\+/, '');
        st.fontMatrix = f?.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
        st.fontSize = args[1];
        break;
      }
      case OPS.setCharSpacing:
        st.charSpacing = args[0];
        break;
      case OPS.setWordSpacing:
        st.wordSpacing = args[0];
        break;
      case OPS.setHScale:
        st.hScale = args[0] / 100;
        break;
      case OPS.setLeading:
        st.leading = -args[0];
        break;
      case OPS.setTextRise:
        st.rise = args[0];
        break;
      case OPS.setLeadingMoveText:
        st.leading = args[1];
        tlm = mul([1, 0, 0, 1, args[0], args[1]], tlm);
        tm = tlm;
        break;
      case OPS.moveText:
        tlm = mul([1, 0, 0, 1, args[0], args[1]], tlm);
        tm = tlm;
        break;
      case OPS.setTextMatrix:
        tlm = args as Matrix;
        tm = tlm;
        break;
      case OPS.nextLine:
        tlm = mul([1, 0, 0, 1, 0, st.leading], tlm);
        tm = tlm;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        showGlyphs(args[0]);
        break;
      case OPS.nextLineShowText:
        tlm = mul([1, 0, 0, 1, 0, st.leading], tlm);
        tm = tlm;
        showGlyphs(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        st.wordSpacing = args[0];
        st.charSpacing = args[1];
        tlm = mul([1, 0, 0, 1, 0, st.leading], tlm);
        tm = tlm;
        showGlyphs(args[2]);
        break;
      case OPS.constructPath:
        addPath(path, args[0], args[1]);
        break;
      case OPS.moveTo:
      case OPS.lineTo:
      case OPS.rectangle:
      case OPS.closePath:
        addPath(path, [fn], args ?? []);
        break;
      case OPS.stroke:
      case OPS.closeStroke:
        flush('stroke');
        break;
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        flush('fill');
        break;
      case OPS.endPath:
        path = [];
        break;
      case OPS.paintImageXObject:
        imageOps.push({ id: args[0], ctm: st.ctm });
        break;
    }
  }
  const [x0, y0, x1, y1] = page.view;
  const width = x1 - x0;
  const height = y1 - y0;
  const images: PageImage[] = [];
  for (const { id, ctm } of imageOps) {
    // 그림은 단위 정사각형을 ctm으로 옮긴 자리에 그려진다
    const [ax, ay] = apply(ctm, 0, 0);
    const [bx, by] = apply(ctm, 1, 1);
    const box = { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
    if ((box.x1 - box.x0) * (box.y1 - box.y0) < width * height * 0.5 || !page.objs) continue;
    const data = await new Promise<unknown>((resolve) => page.objs!.get(id, resolve));
    const gray = toGray(data);
    if (gray) images.push({ ...gray, ...box });
  }
  return { width, height, glyphs, segments, ...(images.length ? { images } : {}) };
}

/** pdf.js 그림 데이터 → 흑백 밝기 배열 */
function toGray(img: unknown): { gray: Uint8Array; w: number; h: number } | null {
  const o = img as { width?: number; height?: number; kind?: number; data?: Uint8Array | Uint8ClampedArray };
  if (!o?.data || !o.width || !o.height) return null;
  const { width: w, height: h, data, kind } = o;
  const gray = new Uint8Array(w * h);
  if (kind === 1) {
    // 1비트: 한 줄씩 바이트로 묶여 있다 (1 = 흰색)
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  } else {
    const ch = kind === 3 ? 4 : 3;
    for (let i = 0; i < w * h; i++) gray[i] = (data[i * ch] * 3 + data[i * ch + 1] * 6 + data[i * ch + 2]) / 10;
  }
  return { gray, w, h };
}

function addPath(path: { pts: [number, number][]; closed: boolean }[], ops: number[], args: number[]) {
  let j = 0;
  const cur = () => path[path.length - 1];
  for (const op of ops) {
    switch (op) {
      case OPS.moveTo:
        path.push({ pts: [[args[j], args[j + 1]]], closed: false });
        j += 2;
        break;
      case OPS.lineTo:
        if (!cur()) path.push({ pts: [], closed: false });
        cur().pts.push([args[j], args[j + 1]]);
        j += 2;
        break;
      case OPS.curveTo:
        cur()?.pts.push([args[j + 4], args[j + 5]]);
        j += 6;
        break;
      case OPS.curveTo2:
      case OPS.curveTo3:
        cur()?.pts.push([args[j + 2], args[j + 3]]);
        j += 4;
        break;
      case OPS.rectangle: {
        const [x, y, w, h] = args.slice(j, j + 4);
        path.push({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true });
        j += 4;
        break;
      }
      case OPS.closePath:
        if (cur()) cur().closed = true;
        break;
    }
  }
}

/** 채운 다각형(빔은 평행사변형, 굵은 줄은 사각형)을 긴 축 방향의 선분으로 바꾼다 */
function fillToSegment(p: [number, number][]): Segment {
  const xs = p.map((q) => q[0]);
  const ys = p.map((q) => q[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxX - minX >= maxY - minY) {
    // 가로로 긴 모양: 왼쪽 끝과 오른쪽 끝의 세로 가운데를 잇는다 (빔은 기울어 있을 수 있다)
    const left = p.filter((q) => q[0] - minX < 0.01 * (maxX - minX) + 0.05);
    const right = p.filter((q) => maxX - q[0] < 0.01 * (maxX - minX) + 0.05);
    const mid = (qs: [number, number][]) => qs.reduce((s, q) => s + q[1], 0) / qs.length;
    const ly = left.length ? mid(left) : (minY + maxY) / 2;
    const ry = right.length ? mid(right) : (minY + maxY) / 2;
    const thick = left.length >= 2 ? Math.max(...left.map((q) => q[1])) - Math.min(...left.map((q) => q[1])) : maxY - minY;
    return { x1: minX, y1: ly, x2: maxX, y2: ry, width: thick };
  }
  return { x1: (minX + maxX) / 2, y1: minY, x2: (minX + maxX) / 2, y2: maxY, width: maxX - minX };
}
