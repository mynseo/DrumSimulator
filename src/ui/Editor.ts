import { INSTRUMENTS, VELOCITY } from '../core/instruments';
import { stepsPerBar } from '../core/timeline';
import type { Hand, Instrument, Score, ScoreNote, Timeline } from '../core/types';

/**
 * 격자형 악보 편집기.
 *   클릭: 없음 → 보통 → 악센트 → 고스트 → 없음
 *   우클릭(터치: 길게 누르기): 손 지정 (자동 → R → L → 자동)
 * 각 칸에는 자동/지정된 손(R/L)이 표시된다.
 */
export class Editor {
  onChange?: () => void;
  onSeek?: (step: number) => void;
  private cells = new Map<string, HTMLElement>();
  private columns: HTMLElement[][] = [];
  private playheadStep = -1;

  constructor(private container: HTMLElement, private score: Score) {
    container.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setScore(score: Score) {
    this.score = score;
    this.render();
  }

  render() {
    const { score } = this;
    const total = score.bars * stepsPerBar(score);
    const perBar = stepsPerBar(score);
    this.container.innerHTML = '';
    this.cells.clear();
    this.columns = Array.from({ length: total }, () => []);
    this.playheadStep = -1;

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.gridTemplateColumns = `var(--label-w) repeat(${total}, var(--cell-w))`;

    // 머리줄: 마디·박 번호 (클릭하면 그 위치로 이동)
    grid.appendChild(div('label head', ''));
    for (let s = 0; s < total; s++) {
      const beatStart = s % score.stepsPerBeat === 0;
      const el = div(`head${s % perBar === 0 ? ' bar' : ''}${beatStart ? ' beat' : ''}`, '');
      if (s % perBar === 0) el.textContent = String(s / perBar + 1);
      else if (beatStart) el.textContent = '·';
      el.title = `${Math.floor(s / perBar) + 1}마디 ${Math.floor((s % perBar) / score.stepsPerBeat) + 1}박 — 클릭해서 이동`;
      el.addEventListener('click', () => this.onSeek?.(s));
      grid.appendChild(el);
      this.columns[s].push(el);
    }

    for (const inst of INSTRUMENTS) {
      grid.appendChild(div('label', inst.label));
      for (let s = 0; s < total; s++) {
        const el = div(`cell${s % perBar === 0 ? ' bar' : ''}${s % score.stepsPerBeat === 0 ? ' beat' : ''}`, '');
        el.dataset.kind = inst.kind;
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (e.button === 0) this.cycleVelocity(s, inst.id);
        });
        // 우클릭, 또는 터치 화면에서 길게 누르기
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.cycleHand(s, inst.id);
        });
        grid.appendChild(el);
        this.cells.set(`${s}:${inst.id}`, el);
        this.columns[s].push(el);
      }
    }
    this.container.appendChild(grid);
    this.refreshCells();
  }

  /** 타임라인(손 배정 결과)을 칸에 표시한다 */
  showSticking(timeline: Timeline) {
    for (const el of this.cells.values()) {
      el.removeAttribute('data-limb');
      el.classList.remove('forced', 'unplayable');
    }
    for (const h of timeline.hits) {
      const el = this.cells.get(`${h.step}:${h.instrument}`);
      if (!el) continue;
      if (h.limb) el.dataset.limb = h.limb;
      else el.classList.add('unplayable');
      if (h.handForced) el.classList.add('forced');
    }
  }

  setPlayhead(step: number) {
    if (step === this.playheadStep) return;
    this.columns[this.playheadStep]?.forEach((el) => el.classList.remove('playhead'));
    this.playheadStep = step;
    const col = this.columns[step];
    if (!col) return;
    col.forEach((el) => el.classList.add('playhead'));
    // 재생 위치가 화면 밖으로 나가면 따라간다
    const head = col[0];
    const box = this.container.getBoundingClientRect();
    const r = head.getBoundingClientRect();
    if (r.right > box.right - 40 || r.left < box.left + 120) {
      this.container.scrollLeft += r.left - box.left - 160;
    }
  }

  private find(step: number, instrument: Instrument): ScoreNote | undefined {
    return this.score.notes.find((n) => n.step === step && n.instrument === instrument);
  }

  private cycleVelocity(step: number, instrument: Instrument) {
    const n = this.find(step, instrument);
    if (!n) {
      this.score.notes.push({ step, instrument, velocity: VELOCITY.normal });
    } else if (n.velocity >= VELOCITY.accent) {
      n.velocity = VELOCITY.ghost;
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
    this.refreshCells();
    this.onChange?.();
  }

  /** 악보가 밖에서(녹음 등) 바뀌었을 때 칸 표시만 새로 고친다 */
  refresh() {
    this.refreshCells();
  }

  private refreshCells() {
    for (const el of this.cells.values()) el.classList.remove('on', 'accent', 'ghost');
    for (const n of this.score.notes) {
      const el = this.cells.get(`${n.step}:${n.instrument}`);
      if (!el) continue;
      el.classList.add('on');
      if (n.velocity >= VELOCITY.accent) el.classList.add('accent');
      else if (n.velocity <= VELOCITY.ghost) el.classList.add('ghost');
    }
  }
}

function div(className: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}
