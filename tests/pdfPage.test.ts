import { describe, expect, it } from 'vitest';
import { readPage } from '../src/import/pdfPage';

/** pdf.js getOperatorList 결과를 흉내 낸다 (pdfjs-dist 4.x 연산자 번호) */
function fakePage(fnArray: number[], argsArray: unknown[]) {
  const fonts: Record<string, unknown> = { f1: { name: 'ABCDEF+MaestroPercussion', fontMatrix: [0.001, 0, 0, 0.001, 0, 0] } };
  return { view: [0, 0, 600, 840], getOperatorList: async () => ({ fnArray, argsArray }), commonObjs: { get: (id: string) => fonts[id] } };
}

describe('PDF 그리기 명령 따라가기', () => {
  it('글자마다 위치를 구하고, 간격 숫자(TJ)도 반영한다', async () => {
    const page = fakePage(
      [31, 37, 42, 44],
      [null, ['f1', 1], [18.5, 0, 0, 18.5, 100, 500], [[{ unicode: 'y', width: 290 }, -500, { unicode: 'œ', width: 320 }]]],
    );
    const { glyphs } = await readPage(page);
    expect(glyphs.map((g) => g.font)).toEqual(['MaestroPercussion', 'MaestroPercussion']);
    expect(glyphs[0]).toMatchObject({ char: 'y', x: 100, y: 500 });
    expect(glyphs[1].x).toBeCloseTo(100 + 0.29 * 18.5 + 0.5 * 18.5, 6);
    expect(glyphs[1].size).toBeCloseTo(18.5, 6);
  });

  it('변환 행렬을 거친 선과 채운 사각형(빔)을 선분으로 바꾼다', async () => {
    const page = fakePage(
      [10, 12, 2, 91, 20, 91, 22, 11],
      [null, [2, 0, 0, 2, 10, 20], [0.5], [[13, 14], [0, 0, 0, 10]], null, [[19], [5, 5, 20, 1.2]], null, null],
    );
    const { segments } = await readPage(page);
    expect(segments[0]).toMatchObject({ x1: 10, y1: 20, x2: 10, y2: 40, width: 1 });
    expect(segments[1].x1).toBeCloseTo(20);
    expect(segments[1].x2).toBeCloseTo(60);
    expect(segments[1].y1).toBeCloseTo(31.2);
    expect(segments[1].width).toBeCloseTo(2.4);
  });
});
