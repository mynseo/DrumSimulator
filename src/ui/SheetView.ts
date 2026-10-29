import type { SheetPage } from '../import/pdfFile';
import type { MeasureRegion } from '../import/sheet';

/**
 * 불러온 PDF 악보를 그대로 보여 주고, 연주 중인 마디에 상자를 씌우고 지금 박 자리에 세로선을 긋는다.
 * 연주 위치가 화면 밖으로 나가면 따라 내려간다. 마디를 누르면 그 마디로 이동한다.
 */
export class SheetView {
  onSeek?: (bar: number) => void;
  private pages: SheetPage[] = [];
  private regions: MeasureRegion[] = [];
  /** 펼친 마디 → 악보에 적힌 마디 */
  private order: number[] = [];
  private pageEls: HTMLElement[] = [];
  private box = div('sheet-box');
  private cursor = div('sheet-cursor');
  private shown = -1;

  constructor(private container: HTMLElement) {
    this.clear();
  }

  get loaded() {
    return this.pages.length > 0;
  }

  /** 다른 곡을 불러오면 악보를 지운다 */
  clear() {
    for (const p of this.pages) if (p.url) URL.revokeObjectURL(p.url);
    this.pages = [];
    this.regions = [];
    this.order = [];
    this.pageEls = [];
    this.shown = -1;
    this.container.innerHTML = '';
    const empty = div('sheet-empty');
    empty.textContent = 'PDF 악보를 열면 여기에서 악보를 보면서 연주 위치를 따라갈 수 있어요.';
    this.container.append(empty);
  }

  set(pages: SheetPage[], regions: MeasureRegion[], order: number[]) {
    this.clear();
    this.pages = pages;
    this.regions = regions;
    this.order = order;
    this.container.innerHTML = '';
    this.pageEls = pages.map((p, i) => {
      const el = div('sheet-page');
      const [x0, y0, x1, y1] = p.view;
      el.style.aspectRatio = `${x1 - x0} / ${y1 - y0}`;
      if (p.url) {
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = `악보 ${i + 1}쪽`;
        img.draggable = false;
        el.append(img);
      }
      el.addEventListener('click', (e) => this.clicked(i, el, e));
      this.container.append(el);
      return el;
    });
  }

  /** 지금 칸(마디 번호와 마디 안 비율)에 상자·선을 옮긴다 */
  setPlayhead(bar: number, fraction: number) {
    const slot = this.order[bar];
    const r = slot === undefined ? undefined : this.regions[slot];
    const page = r && this.pages[r.page];
    if (!r || !page) {
      this.box.remove();
      this.cursor.remove();
      this.shown = -1;
      return;
    }
    const [vx0, , vx1, vy1] = page.view;
    const vh = page.view[3] - page.view[1];
    const vw = vx1 - vx0;
    // 오선 위아래로 조금 넉넉하게 (음표 기둥·빔이 오선 밖으로 나온다)
    const pad = (r.top - r.bottom) * 0.9;
    const left = ((r.x0 - vx0) / vw) * 100;
    const width = ((r.x1 - r.x0) / vw) * 100;
    const top = ((vy1 - (r.top + pad)) / vh) * 100;
    const height = ((r.top - r.bottom + 2 * pad) / vh) * 100;
    const el = this.pageEls[r.page];
    if (this.box.parentElement !== el) el.append(this.box, this.cursor);
    Object.assign(this.box.style, { left: `${left}%`, width: `${width}%`, top: `${top}%`, height: `${height}%` });
    Object.assign(this.cursor.style, { left: `${left + width * Math.min(1, Math.max(0, fraction))}%`, top: `${top}%`, height: `${height}%` });
    if (bar !== this.shown) {
      this.shown = bar;
      this.follow();
    }
  }

  /** 연주 중인 마디가 보이게 스크롤 (마디가 바뀔 때만) */
  private follow() {
    const c = this.container;
    const box = this.box.getBoundingClientRect();
    const view = c.getBoundingClientRect();
    if (box.top >= view.top + 8 && box.bottom <= view.bottom - 8) return;
    c.scrollTo({ top: c.scrollTop + box.top - view.top - view.height * 0.25, behavior: 'smooth' });
  }

  /** 누른 자리의 마디로 이동: 그 마디를 처음 치는 곳 (지금보다 뒤에 다시 나오면 그쪽) */
  private clicked(page: number, el: HTMLElement, e: MouseEvent) {
    const p = this.pages[page];
    const rect = el.getBoundingClientRect();
    const [vx0, vy0, vx1, vy1] = p.view;
    const x = vx0 + ((e.clientX - rect.left) / rect.width) * (vx1 - vx0);
    const y = vy1 - ((e.clientY - rect.top) / rect.height) * (vy1 - vy0);
    const slot = this.regions.findIndex((r) => r.page === page && x >= r.x0 && x <= r.x1 && y <= r.top + (r.top - r.bottom) && y >= r.bottom - (r.top - r.bottom));
    if (slot < 0) return;
    const bars = this.order.flatMap((s, i) => (s === slot ? [i] : []));
    const next = bars.find((b) => b > this.shown) ?? bars[0];
    if (next !== undefined) this.onSeek?.(next);
  }
}

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}
