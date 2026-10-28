import { INSTRUMENT_INFO, PIECES } from '../core/instruments';
import { previousHit } from '../core/timeline';
import type { Instrument, Limb, PieceId, Timeline } from '../core/types';

interface PadDef {
  instrument: Instrument;
  /** 짧은 이름 (패드에 크게 표시) */
  name: string;
  /** KeyboardEvent.code — 한글 입력 상태에서도 같은 키로 동작한다 */
  keys: string[];
}

/**
 * 드러머 자리에서 본 세트 배치를 따른다: 왼쪽 하이햇, 가운데 스네어·탐, 오른쪽 플로어 탐·라이드, 아래 페달.
 * 키보드는 왼손(A·S·D)과 오른손(J·K) 양쪽에 스네어·하이햇을 둬서 번갈아 치기 쉽게 했다.
 */
export const PADS: PadDef[] = [
  { instrument: 'crash', name: '크래시', keys: ['KeyQ'] },
  { instrument: 'tom1', name: '하이 탐', keys: ['KeyW'] },
  { instrument: 'tom2', name: '미드 탐', keys: ['KeyE'] },
  { instrument: 'crash2', name: '크래시 2', keys: ['KeyR', 'KeyI'] },
  { instrument: 'ride', name: '라이드', keys: ['KeyU'] },
  { instrument: 'hihatOpen', name: '하이햇 열림', keys: ['KeyA'] },
  { instrument: 'snare', name: '스네어', keys: ['KeyD', 'KeyJ'] },
  { instrument: 'rimshot', name: '림샷', keys: ['KeyG', 'KeyH'] },
  { instrument: 'floorTom', name: '플로어 탐', keys: ['KeyF', 'KeyL'] },
  { instrument: 'hihatClosed', name: '하이햇', keys: ['KeyS', 'KeyK'] },
  { instrument: 'hihatPedal', name: '하이햇 페달', keys: ['KeyX'] },
  { instrument: 'kick', name: '킥', keys: ['KeyB', 'KeyN'] },
];

const KEY_TO_INSTRUMENT = new Map<string, Instrument>(PADS.flatMap((p) => p.keys.map((k) => [k, p.instrument] as const)));

export function instrumentForKey(code: string): Instrument | undefined {
  return KEY_TO_INSTRUMENT.get(code);
}

const keyLabel = (code: string) => code.replace(/^Key/, '');

/** 터치·마우스·키보드로 치는 드럼 패드 */
export class Pads {
  onHit?: (instrument: Instrument, velocity: number) => void;
  private els = new Map<Instrument, HTMLElement>();
  private seen: Partial<Record<PieceId, number>> = {};

  constructor(container: HTMLElement) {
    const grid = document.createElement('div');
    grid.className = 'pads';
    for (const pad of PADS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `pad pad-${pad.instrument}`;
      el.dataset.kind = INSTRUMENT_INFO[pad.instrument].cymbal ? 'cymbal' : INSTRUMENT_INFO[pad.instrument].kind === 'hand' ? 'drum' : 'pedal';
      el.innerHTML = `<span class="pad-name">${pad.name}</span><span class="pad-keys">${pad.keys.map(keyLabel).join(' · ')}</span>`;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        // 가운데를 칠수록 세게 (실제 드럼처럼): 0.55 ~ 1
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const velocity = 1 - 0.45 * Math.min(1, Math.hypot(dx, dy));
        this.onHit?.(pad.instrument, velocity);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      grid.appendChild(el);
      this.els.set(pad.instrument, el);
    }
    container.appendChild(grid);
  }

  /** 맞은 패드를 친 손발의 색으로 번쩍인다. dim이면 악보 재생으로 친 것(약하게) */
  flash(instrument: Instrument, limb: Limb | null, dim = false) {
    const el = this.els.get(instrument);
    if (!el) return;
    el.style.setProperty('--hit', `var(--${(limb ?? 'RH').toLowerCase()})`);
    el.classList.remove('hit', 'hit-dim');
    void el.offsetWidth; // 애니메이션을 처음부터 다시 시작
    el.classList.add(dim ? 'hit-dim' : 'hit');
  }

  /** 악보 재생 중 맞는 패드도 따라 번쩍여서 어디를 치는지 보여 준다 */
  followScore(timeline: Timeline, t: number, loop: boolean) {
    for (const piece of PIECES) {
      const prev = previousHit(timeline.byPiece[piece], t, timeline.duration, loop);
      if (!prev || this.seen[piece] === prev.time || t - prev.time > 0.08) continue;
      this.seen[piece] = prev.time;
      // 같은 순간 같은 부품의 다른 소리(예: 하이햇 닫힘+페달)도 모두 표시
      for (const h of timeline.byPiece[piece]) if (h.step === prev.hit.step) this.flash(h.instrument, h.limb, true);
    }
  }

  /** 정지·되감기 후 같은 음을 다시 표시할 수 있게 기록을 지운다 */
  resetFollow() {
    this.seen = {};
  }
}
