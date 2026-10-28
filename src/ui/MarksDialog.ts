import { INSTRUMENTS } from '../core/instruments';
import { applyMarkMap, describeMark, marksOf, type MarkInfo, type MarkMap } from '../core/marks';
import type { Instrument, Score } from '../core/types';

const SAVED_KEY = 'drumsim.markMap.v1';

/** 저장해 둔 기호별 악기 (다음에 여는 PDF에도 쓰기로 한 것) */
export function savedMarkMap(): MarkMap | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as MarkMap) : null;
  } catch {
    return null;
  }
}

function saveMarkMap(map: MarkMap | null) {
  try {
    if (map) localStorage.setItem(SAVED_KEY, JSON.stringify(map));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    /* 저장 불가 환경 */
  }
}

/**
 * 기호별 악기 지정: PDF 악보에서 읽은 기호(머리 모양·오선 위치)마다 어떤 악기로 칠지 고른다.
 * 출판사마다 클로즈·오픈 하이햇, 크래시, 라이드를 그리는 자리가 달라서 필요하다.
 */
export class MarksDialog {
  onChange?: () => void;
  onPreview?: (instrument: Instrument) => void;
  private score: Score | null = null;

  constructor(
    private dialog: HTMLDialogElement,
    private list: HTMLElement,
    private remember: HTMLInputElement,
  ) {
    remember.addEventListener('change', () => this.saveIfRemembered());
  }

  open(score: Score) {
    this.score = score;
    this.remember.checked = !!savedMarkMap();
    this.render();
    this.dialog.showModal();
  }

  private render() {
    const marks = this.score ? marksOf(this.score) : [];
    this.list.innerHTML = '';
    this.remember.closest('label')!.hidden = !marks.length;
    if (!marks.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'PDF 악보를 불러오면 악보의 기호마다 어떤 악기로 칠지 정할 수 있어요.';
      this.list.append(p);
      return;
    }
    for (const m of marks) {
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.innerHTML = markIcon(m);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = describeMark(m);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `${m.count}개`;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `${describeMark(m)} 악기`);
      for (const inst of INSTRUMENTS) select.append(new Option(inst.label, inst.id, false, inst.id === m.instrument));
      select.addEventListener('change', () => this.assign(m, select.value as Instrument));
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'ghost';
      play.textContent = '▶';
      play.title = '미리 듣기';
      play.addEventListener('click', () => this.onPreview?.(select.value as Instrument));
      this.list.append(icon, name, count, select, play);
    }
  }

  private assign(m: MarkInfo, instrument: Instrument) {
    if (!this.score) return;
    applyMarkMap(this.score, { [m.mark]: instrument });
    this.saveIfRemembered();
    this.onChange?.();
    this.render();
  }

  /** "다음 PDF에도"를 켰으면 지금 악보의 지정을 저장해 둔 것과 합쳐 남긴다 */
  private saveIfRemembered() {
    if (!this.remember.checked) {
      saveMarkMap(null);
      return;
    }
    const map: MarkMap = { ...(savedMarkMap() ?? {}) };
    for (const m of this.score ? marksOf(this.score) : []) map[m.mark] = m.instrument;
    saveMarkMap(map);
  }
}

/** 작은 오선 위에 기호를 그린 그림 */
function markIcon(m: Pick<MarkInfo, 'kind' | 'pos' | 'open'>): string {
  const gap = 6;
  // 덧줄 위·아래 기호도 보이게 그릴 높이 범위를 기호에 맞춘다
  const hi = Math.max(8, m.pos) + 1.5;
  const lo = Math.min(0, m.pos) - 1.5;
  const y = (pos: number) => 2 + ((hi - pos) * gap) / 2;
  const height = y(lo) + 2;
  const parts: string[] = [];
  for (let k = 0; k < 5; k++) parts.push(`<line x1="4" x2="40" y1="${y(k * 2) }" y2="${y(k * 2) }" />`);
  // 덧줄
  for (let p = 10; p <= m.pos; p += 2) parts.push(`<line x1="13" x2="31" y1="${y(p) }" y2="${y(p) }" />`);
  for (let p = -2; p >= m.pos; p -= 2) parts.push(`<line x1="13" x2="31" y1="${y(p) }" y2="${y(p) }" />`);
  const cy = y(m.pos) ;
  const r = gap / 2;
  if (m.kind === 'x' || m.kind === 'circleX') {
    parts.push(`<path class="mark" d="M${22 - r} ${cy - r}L${22 + r} ${cy + r}M${22 + r} ${cy - r}L${22 - r} ${cy + r}" />`);
    if (m.kind === 'circleX') parts.push(`<circle class="mark" cx="22" cy="${cy}" r="${r + 1}" fill="none" />`);
  } else if (m.kind === 'slash') {
    parts.push(`<path class="mark" d="M${22 - r} ${cy + r + 1}L${22 + r} ${cy - r - 1}" />`);
  } else {
    const fill = m.kind === 'black' ? 'currentColor' : 'none';
    parts.push(`<ellipse class="mark" cx="22" cy="${cy}" rx="${r + 1}" ry="${r - 0.5}" fill="${fill}" transform="rotate(-20 22 ${cy})" />`);
  }
  if (m.open) parts.push(`<circle class="mark" cx="22" cy="${Math.max(4, cy - 12)}" r="2.2" fill="none" />`);
  return `<svg viewBox="0 0 44 ${height}" width="52" height="${Math.round((height * 52) / 44)}" aria-hidden="true">${parts.join('')}</svg>`;
}
