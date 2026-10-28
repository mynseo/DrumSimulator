import { INSTRUMENTS, VELOCITY } from '../core/instruments';
import { barOfStep, barStarts } from '../core/timeline';
import type { Hand, Instrument, Score, ScoreNote, Timeline } from '../core/types';

const ROW_H = 24;
/** 화면 밖으로 미리 그려 두는 칸 수 (빠르게 스크롤해도 빈칸이 덜 보이게) */
const OVERSCAN = 24;

interface CellState {
  velocity: number;
  flam: boolean;
}
interface StickState {
  limb: string | null;
  forced: boolean;
}

/**
 * 격자형 악보 편집기.
 *   클릭: 없음 → 보통 → 악센트 → 플램 → 고스트 → 없음
 *   우클릭(터치: 길게 누르기): 손 지정 (자동 → R → L → 자동)
 * 각 칸에는 자동/지정된 손(R/L)이 표시된다.
 *
 * 긴 곡(32분음표·6잇단이 섞인 100마디 악보는 칸이 10만 개가 넘는다)도 가볍게 다루도록
 * 화면에 보이는 칸만 만든다. 스크롤하면 그 구간을 다시 그린다.
 */
export class Editor {
  onChange?: () => void;
  onSeek?: (step: number) => void;
  private playheadStep = -1;
  private total = 0;
  private starts: number[] = [0];
  private cellW = 26;
  private labelW = 80;
  private notes = new Map<string, CellState>();
  private sticking = new Map<string, StickState>();
  private headRow!: HTMLElement;
  private body!: HTMLElement;
  /** 지금 그려 둔 칸 범위 [from, to) */
  private drawn = { from: 0, to: 0 };
  private frame = 0;

  constructor(private container: HTMLElement, private score: Score) {
    container.addEventListener('contextmenu', (e) => e.preventDefault());
    container.addEventListener('scroll', () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.drawWindow();
      });
    });
    window.addEventListener('resize', () => this.drawWindow());
  }

  setScore(score: Score) {
    this.score = score;
    this.render();
  }

  render() {
    const { score } = this;
    this.starts = barStarts(score);
    this.total = this.starts[this.starts.length - 1];
    const style = getComputedStyle(this.container);
    const baseW = parseFloat(style.getPropertyValue('--cell-w')) || 26;
    this.labelW = parseFloat(style.getPropertyValue('--label-w')) || 80;
    // 잘게 나눈 악보는 칸을 좁혀 한 마디가 화면에 더 많이 들어오게 한다
    this.cellW = score.stepsPerBeat <= 6 ? baseW : score.stepsPerBeat <= 8 ? Math.round(baseW * 0.7) : Math.round(baseW * 0.5);
    this.playheadStep = -1;
    this.container.innerHTML = '';

    const grid = div('grid', '');
    grid.style.width = `${this.labelW + this.total * this.cellW}px`;
    grid.style.setProperty('--cw', `${this.cellW}px`);

    // 왼쪽 악기 이름 줄 (가로 스크롤해도 고정)
    const labels = div('labels', '');
    labels.appendChild(div('label head', ''));
    for (const inst of INSTRUMENTS) labels.appendChild(div('label', inst.label));
    grid.appendChild(labels);

    const canvas = div('canvas', '');
    canvas.style.width = `${this.total * this.cellW}px`;
    this.headRow = div('head-row', '');
    this.body = div('cells', '');
    this.body.style.height = `${INSTRUMENTS.length * ROW_H}px`;
    canvas.append(this.headRow, this.body);
    grid.appendChild(canvas);
    this.container.appendChild(grid);

    // 칸마다 듣지 않고 한 곳에서 받는다
    this.headRow.addEventListener('click', (e) => {
      const s = Number((e.target as HTMLElement).dataset.s);
      if (!Number.isNaN(s)) this.onSeek?.(s);
    });
    this.body.addEventListener('mousedown', (e) => {
      const at = this.cellAt(e.target);
      if (!at || e.button !== 0) return;
      e.preventDefault();
      this.cycleVelocity(at.step, at.instrument);
    });
    this.body.addEventListener('contextmenu', (e) => {
      const at = this.cellAt(e.target);
      if (!at) return;
      e.preventDefault();
      this.cycleHand(at.step, at.instrument);
    });

    this.indexNotes();
    this.drawn = { from: 0, to: 0 };
    this.drawWindow();
  }

  private cellAt(target: EventTarget | null): { step: number; instrument: Instrument } | null {
    const el = target as HTMLElement | null;
    if (!el?.dataset?.s || !el.dataset.i) return null;
    return { step: Number(el.dataset.s), instrument: el.dataset.i as Instrument };
  }

  /** 보이는 구간의 칸만 만든다 */
  private drawWindow(force = false) {
    if (!this.body) return;
    const view = this.container.clientWidth || 1200;
    const left = Math.max(0, this.container.scrollLeft - this.labelW);
    const from = Math.max(0, Math.floor(left / this.cellW) - OVERSCAN);
    const to = Math.min(this.total, Math.ceil((left + view) / this.cellW) + OVERSCAN);
    if (!force && from >= this.drawn.from && to <= this.drawn.to && this.drawn.to > this.drawn.from) return;
    // 넉넉히 그려 두어 조금 스크롤할 때마다 다시 그리지 않게
    const span = to - from;
    const a = Math.max(0, from - span);
    const b = Math.min(this.total, to + span);
    this.drawn = { from: a, to: b };

    const { score } = this;
    const spb = score.stepsPerBeat;
    const heads = document.createDocumentFragment();
    const cells = document.createDocumentFragment();
    for (let s = a; s < b; s++) {
      const x = `${s * this.cellW}px`;
      const { bar, offset } = barOfStep(this.starts, s);
      const barStart = offset === 0;
      const beatStart = offset % spb === 0;
      const h = div(`head${barStart ? ' bar' : ''}${beatStart ? ' beat' : ''}${s === this.playheadStep ? ' playhead' : ''}`, '');
      h.style.left = x;
      h.dataset.s = String(s);
      if (barStart) h.textContent = String(bar + 1);
      else if (beatStart) h.textContent = '·';
      h.title = `${bar + 1}마디 ${Math.floor(offset / spb) + 1}박 — 클릭해서 이동`;
      heads.appendChild(h);
      INSTRUMENTS.forEach((inst, row) => {
        const el = div(`cell${barStart ? ' bar' : ''}${beatStart ? ' beat' : ''}${s === this.playheadStep ? ' playhead' : ''}`, '');
        el.style.left = x;
        el.style.top = `${row * ROW_H}px`;
        el.dataset.s = String(s);
        el.dataset.i = inst.id;
        el.dataset.kind = inst.kind;
        this.decorate(el, `${s}:${inst.id}`);
        cells.appendChild(el);
      });
    }
    this.headRow.replaceChildren(heads);
    this.body.replaceChildren(cells);
  }

  /** 칸 하나에 음·손 표시를 입힌다 */
  private decorate(el: HTMLElement, key: string) {
    el.classList.remove('on', 'accent', 'ghost', 'flam', 'forced', 'unplayable');
    delete el.dataset.limb;
    const n = this.notes.get(key);
    if (n) {
      el.classList.add('on');
      if (n.velocity >= VELOCITY.accent) el.classList.add('accent');
      else if (n.velocity <= VELOCITY.ghost) el.classList.add('ghost');
      if (n.flam) el.classList.add('flam');
    }
    const st = this.sticking.get(key);
    if (st) {
      if (st.limb) el.dataset.limb = st.limb;
      else el.classList.add('unplayable');
      if (st.forced) el.classList.add('forced');
    }
  }

  private redecorate() {
    for (const el of this.body?.children ?? []) {
      const c = el as HTMLElement;
      this.decorate(c, `${c.dataset.s}:${c.dataset.i}`);
    }
  }

  private indexNotes() {
    this.notes.clear();
    for (const n of this.score.notes) this.notes.set(`${n.step}:${n.instrument}`, { velocity: n.velocity, flam: !!n.flam });
  }

  /** 타임라인(손 배정 결과)을 칸에 표시한다 */
  showSticking(timeline: Timeline) {
    this.sticking.clear();
    for (const h of timeline.hits) {
      if (h.grace) continue;
      this.sticking.set(`${h.step}:${h.instrument}`, { limb: h.limb, forced: h.handForced });
    }
    this.redecorate();
  }

  setPlayhead(step: number) {
    if (step === this.playheadStep) return;
    this.playheadStep = step;
    for (const el of this.container.querySelectorAll('.playhead')) el.classList.remove('playhead');
    if (step < 0) return;
    // 재생 위치가 화면 밖으로 나가면 따라간다
    const x = this.labelW + step * this.cellW - this.container.scrollLeft;
    const view = this.container.clientWidth;
    if (x > view - 40 || x < this.labelW + 40) {
      this.container.scrollLeft += x - this.labelW - 80;
      this.drawWindow();
    }
    for (const el of this.container.querySelectorAll(`[data-s="${step}"]`)) el.classList.add('playhead');
  }

  private find(step: number, instrument: Instrument): ScoreNote | undefined {
    return this.score.notes.find((n) => n.step === step && n.instrument === instrument);
  }

  /** 누를 때마다: 보통 → 세게 → 플램(손으로 치는 악기만) → 약하게 → 지우기 */
  private cycleVelocity(step: number, instrument: Instrument) {
    const n = this.find(step, instrument);
    const hand = INSTRUMENTS.find((i) => i.id === instrument)?.kind === 'hand';
    if (!n) {
      this.score.notes.push({ step, instrument, velocity: VELOCITY.normal });
    } else if (n.flam) {
      delete n.flam;
      n.velocity = VELOCITY.ghost;
    } else if (n.velocity >= VELOCITY.accent) {
      if (hand) n.flam = true;
      else n.velocity = VELOCITY.ghost;
    } else if (n.velocity <= VELOCITY.ghost) {
      this.score.notes.splice(this.score.notes.indexOf(n), 1);
    } else {
      n.velocity = VELOCITY.accent;
    }
    this.changed();
  }

  private cycleHand(step: number, instrument: Instrument) {
    if (INSTRUMENTS.find((i) => i.id === instrument)?.kind !== 'hand') return;
    const n = this.find(step, instrument);
    if (!n) return;
    const order: (Hand | undefined)[] = [undefined, 'R', 'L'];
    const next = order[(order.indexOf(n.hand) + 1) % order.length];
    if (next) n.hand = next;
    else delete n.hand;
    this.changed();
  }

  private changed() {
    this.refresh();
    this.onChange?.();
  }

  /** 악보가 밖에서(녹음 등) 바뀌었을 때 칸 표시만 새로 고친다 */
  refresh() {
    this.indexNotes();
    this.redecorate();
  }
}

function div(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
