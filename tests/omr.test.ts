import { describe, expect, it } from 'vitest';
import type { PageContent } from '../src/import/pdfPage';
import { recognizeImage } from '../src/import/omr';
import { readSheet } from '../src/import/sheet';

/**
 * 스캔한 악보처럼 그림 한 장으로 된 드럼 악보를 직접 그린다.
 * 오선 간격 12픽셀, 빠르기 = 120, 한 마디: 하이햇 8분음표 8개(두 개씩 빔), 2·4박 스네어, 매 박 베이스드럼.
 */
const W = 600;
const H = 240;
const T = 100; // 맨 윗줄
const S = 12;

function drawScore(): Uint8Array {
  const g = new Uint8Array(W * H).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) g[y * W + x] = 0;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) g[(cy + y) * W + cx + x] = 0;
  };
  const cross = (cx: number, cy: number) => {
    for (let t = -6; t <= 6; t++) {
      const y = Math.round((t * 5) / 6);
      rect(cx + t, cy + y, cx + t + 1, cy + y);
      rect(cx + t, cy - y, cx + t + 1, cy - y);
    }
  };
  for (let k = 0; k < 5; k++) rect(20, T + k * S, 560, T + k * S);
  rect(20, T, 21, T + 4 * S);
  rect(559, T, 560, T + 4 * S);
  const hat = T - S / 2;
  const snare = T + 1.5 * S;
  const kick = T + 3.5 * S;
  const stemTop = hat - 3 * S;
  const xs = Array.from({ length: 8 }, (_, i) => 110 + i * 55);
  xs.forEach((cx, i) => {
    cross(cx, hat);
    if (i % 4 === 2) ellipse(cx, snare, 7, 5);
    rect(cx + 6, stemTop, cx + 7, i % 4 === 2 ? snare : hat);
    if (i % 2 === 0) rect(cx + 6, stemTop, xs[i + 1] + 7, stemTop + 5);
    if (i % 2 === 0) {
      ellipse(cx, kick, 7, 5);
      rect(cx - 7, kick, cx - 6, kick + 3 * S);
    }
  });
  // 빠르기 "= 120" (5×7 점 글꼴을 3배로)
  const FONT5x7: Record<string, string[]> = {
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  };
  rect(30, 58, 41, 60);
  rect(30, 65, 41, 67);
  [...'120'].forEach((d, i) => FONT5x7[d].forEach((row, y) => [...row].forEach((c, x) => c === '#' && rect(48 + i * 18 + x * 3, 52 + y * 3, 50 + i * 18 + x * 3, 54 + y * 3))));
  return g;
}

function page(): PageContent {
  return { width: W, height: 840, glyphs: [], segments: [], images: [{ gray: drawScore(), w: W, h: H, x0: 0, y0: 840 - H, x1: W, y1: 840 }] };
}

describe('그림 악보 인식', () => {
  it('오선·기둥·머리를 찾는다', () => {
    const r = recognizeImage(page().images![0], true);
    expect(r.debug!.staves).toHaveLength(1);
    expect(r.debug!.staves[0].s).toBeCloseTo(S, 0);
    const kinds = r.debug!.blobs.map((b) => b.kind);
    expect(kinds.filter((k) => k === 'x')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'head')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'beam')).toHaveLength(4);
  });

  it('한 마디 리듬을 읽는다', () => {
    const r = readSheet([page()]);
    expect(r.warnings.join(' ')).toContain('그림 악보');
    const at = (inst: string) =>
      r.score.notes
        .filter((n) => n.instrument === inst)
        .map((n) => n.step / r.score.stepsPerBeat)
        .sort((a, b) => a - b);
    expect(at('hihatClosed')).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(at('snare')).toEqual([1, 3]);
    expect(at('kick')).toEqual([0, 1, 2, 3]);
    expect(r.score.bpm).toBe(120);
  });

  it('한 마디 반복(•/•)과 두 마디 반복(•//•)을 알아본다', () => {
    const g = new Uint8Array(W * H).fill(255);
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) g[y * W + x] = 0;
    };
    for (let k = 0; k < 5; k++) rect(20, T + k * S, 560, T + k * S);
    for (const x of [20, 200, 380, 560]) rect(x, T, x + 1, T + 4 * S);
    // 빗금: 왼쪽 아래 → 오른쪽 위, 오선 둘째 줄 ~ 넷째 줄
    const slash = (x: number) => {
      for (let t = 0; t <= 1; t += 0.01) rect(x + t * 18, T + 3 * S - t * 2 * S - 2, x + t * 18 + 3, T + 3 * S - t * 2 * S + 2);
    };
    const dots = (x0: number, x1: number) => {
      rect(x0 - 2, T + S + 2, x0 + 2, T + S + 6);
      rect(x1 - 2, T + 3 * S - 6, x1 + 2, T + 3 * S - 2);
    };
    slash(100);
    dots(102, 118);
    // 두 마디 반복은 두 마디 사이 마디줄에 걸쳐 놓인다
    slash(357);
    slash(383);
    dots(359, 403);
    const r = recognizeImage({ gray: g, w: W, h: H, x0: 0, y0: 840 - H, x1: W, y1: 840 });
    const signs = r.glyphs.filter((x) => x.char === '\ue500' || x.char === '\ue501').map((x) => x.char.charCodeAt(0).toString(16));
    expect(signs).toEqual(['e500', 'e501']);
  });
});
