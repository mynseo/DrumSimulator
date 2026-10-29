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

/** 화면에 띄울 악보 페이지 그림 */
export interface SheetPage {
  /** 그림 주소 (blob:) */
  url: string;
  /** PDF 좌표의 페이지 범위 [x0, y0, x1, y1] (위가 +y) */
  view: number[];
}

/** 화면에 그릴 페이지 폭(픽셀). 패널에서 확대해 봐도 글자가 흐리지 않을 만큼 */
const RENDER_WIDTH = 1400;

/** 악보 프로그램으로 만든 PDF 드럼 악보 → 연주 순서대로 펼친 악보 (+ 연주하는 자리를 보여 줄 페이지 그림) */
export async function scoreFromPdf(file: File, onProgress?: (page: number, pages: number) => void): Promise<SheetResult & { pages: SheetPage[] }> {
  const pdfjs = await loadPdfjs();
  // 그림 악보를 읽으려면 그림 픽셀이 필요하다 (ImageBitmap 대신 원본 데이터로 받는다)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0, isOffscreenCanvasSupported: false }).promise;
  try {
    const pages: PageContent[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i, doc.numPages);
      pages.push(await readPage(await doc.getPage(i)));
    }
    const sheet = readSheet(pages, file.name.replace(/\.[^.]+$/, ''));
    const images: SheetPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        images.push(await renderPage(await doc.getPage(i)));
      } catch {
        images.push({ url: '', view: [0, 0, 1, 1] }); // 그리지 못한 페이지는 빈칸 (연주에는 지장 없음)
      }
    }
    return { ...sheet, pages: images };
  } finally {
    void doc.destroy();
  }
}

async function renderPage(page: import('pdfjs-dist').PDFPageProxy): Promise<SheetPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('페이지를 그리지 못했어요');
  return { url: URL.createObjectURL(blob), view: [...page.view] };
}
