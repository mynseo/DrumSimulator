import { readPage, type PageContent } from './pdfPage';
import { readSheet, type SheetResult } from './sheet';

/** 아티팩트 빌드에서 pdf.js를 불러올 곳 (package.json의 pdfjs-dist 버전과 같게) */
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build';

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** pdf.js는 1MB가 넘어서 PDF를 처음 열 때만 불러온다 */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (import.meta.env.VITE_TARGET === 'artifact') {
    const lib: typeof import('pdfjs-dist') = await import(/* @vite-ignore */ `${PDFJS_CDN}/pdf.min.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.mjs`;
    return lib;
  }
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

/** 악보 프로그램으로 만든 PDF 드럼 악보 → 연주 순서대로 펼친 악보 */
export async function scoreFromPdf(file: File, onProgress?: (page: number, pages: number) => void): Promise<SheetResult> {
  const pdfjs = await loadPdfjs();
  // 그림 악보를 읽으려면 그림 픽셀이 필요하다 (ImageBitmap 대신 원본 데이터로 받는다)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0, isOffscreenCanvasSupported: false }).promise;
  try {
    const pages: PageContent[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i, doc.numPages);
      pages.push(await readPage(await doc.getPage(i)));
    }
    return readSheet(pages, file.name.replace(/\.[^.]+$/, ''));
  } finally {
    void doc.destroy();
  }
}
