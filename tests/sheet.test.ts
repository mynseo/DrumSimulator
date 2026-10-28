import { describe, expect, it } from 'vitest';
import type { Glyph, PageContent, Segment } from '../src/import/pdfPage';
import { readSheet } from '../src/import/sheet';

/**
 * Finale(Maestro 글꼴)이 그리는 방식대로 가짜 PDF 페이지를 만든다.
 * 오선 간격 5, 음표 머리 폭 6, 위 기둥은 머리 오른쪽, 아래 기둥은 왼쪽.
 */
const S = 5;
const HEAD = 6;

class PageBuilder {
  glyphs: Glyph[] = [];
  segments: Segment[] = [];
  line(x1: number, y1: number, x2: number, y2: number, width = 0.6) {
    this.segments.push({ x1, y1, x2, y2, width });
  }
  glyph(char: string, x: number, y: number, font = 'Maestro', width = HEAD, size = 20) {
    this.glyphs.push({ font, char, x, y, size, width });
  }
  text(str: string, x: number, y: number, size = 9) {
    [...str].forEach((c, i) => this.glyph(c, x + i * size * 0.5, y, 'TimesNewRomanPSMT', size * 0.5, size));
  }
  page(): PageContent {
    return { width: 600, height: 840, glyphs: this.glyphs, segments: this.segments };
  }
}

type Voice = 'up' | 'down';
interface Ev {
  beat: number;
  /** 오선 위치와 머리 모양. 비면 쉼표 */
  heads?: { pos: number; x?: boolean }[];
  len: number;
  open?: boolean;
  dot?: boolean;
}

class Staff {
  readonly bottom: number;
  bars: number[] = [];
  constructor(
    private b: PageBuilder,
    readonly top: number,
    readonly x0 = 40,
    readonly x1 = 560,
    perc = true,
  ) {
    this.bottom = top - 4 * S;
    for (let i = 0; i < 5; i++) b.line(x0, top - i * S, x1, top - i * S);
    if (perc) b.glyph('', x0 + 4, this.bottom + 2 * S);
  }
  y = (pos: number) => this.bottom + (pos * S) / 2;
  barline(x: number, repeat?: 'start' | 'end') {
    this.bars.push(x);
    this.b.line(x, this.bottom, x, this.top);
    if (repeat) {
      this.b.line(x + (repeat === 'start' ? -1.5 : 1.5), this.bottom, x + (repeat === 'start' ? -1.5 : 1.5), this.top, 2.4);
      const dx = repeat === 'start' ? 3 : -5;
      this.b.glyph('.', x + dx, this.y(3), 'Maestro', 1.5);
      this.b.glyph('.', x + dx, this.y(5), 'Maestro', 1.5);
    }
  }
  /** 한 마디 안의 한 성부: 박 위치를 x로 바꿔 머리·기둥·빔·꼬리·쉼표를 그린다 */
  voice(x0: number, x1: number, voice: Voice, evs: Ev[]) {
    const xOf = (beat: number) => x0 + 8 + (beat * (x1 - x0 - 16)) / 4;
    const far = voice === 'up' ? this.top + 6 * S : this.bottom - 3 * S;
    const stems: { x: number; len: number; beat: number }[] = [];
    for (const e of evs) {
      const x = xOf(e.beat);
      if (!e.heads) {
        const glyph = { 4: '∑', 2: '', 1: 'Œ', 0.5: '‰', 0.25: '≈' }[e.len]!;
        this.b.glyph(glyph, x, this.y(voice === 'up' ? 6 : 2));
        if (e.dot) this.b.glyph('.', x + HEAD + 1.5, this.y(voice === 'up' ? 6 : 2), 'Maestro', 1.5);
        continue;
      }
      for (const h of e.heads) this.b.glyph(h.x ? 'y' : 'œ', x, this.y(h.pos), 'MaestroPercussion');
      const ys = e.heads.map((h) => this.y(h.pos));
      const sx = voice === 'up' ? x + HEAD : x;
      this.b.line(sx, voice === 'up' ? Math.min(...ys) : Math.max(...ys), sx, far);
      if (e.dot) this.b.glyph('.', x + HEAD + 1.5, ys[0] + (e.heads[0].pos % 2 === 0 ? S / 2 : 0), 'Maestro', 1.5);
      if (e.open) this.b.glyph('o', x + 1, this.top + 4 * S);
      stems.push({ x: sx, len: e.len, beat: e.beat });
    }
    // 같은 박 안의 8분·16분음표를 빔으로 묶는다. 혼자 남으면 꼬리
    const groups = new Map<number, typeof stems>();
    for (const st of stems) if (st.len < 1) groups.set(Math.floor(st.beat + 1e-9), [...(groups.get(Math.floor(st.beat + 1e-9)) ?? []), st]);
    const dir = voice === 'up' ? -1 : 1;
    for (const g of groups.values()) {
      if (g.length === 1) {
        this.b.glyph(g[0].len <= 0.25 ? (voice === 'up' ? 'r' : 'R') : voice === 'up' ? 'j' : 'J', g[0].x, far, 'Maestro', 3);
        continue;
      }
      this.b.line(g[0].x, far, g[g.length - 1].x, far, 2.3);
      for (let i = 0; i < g.length; i++) {
        if (g[i].len > 0.25 + 1e-9) continue;
        const a = g[i];
        const nb = g[i + 1] && g[i + 1].len <= 0.25 + 1e-9 ? g[i + 1] : null;
        if (nb) this.b.line(a.x, far + dir * 3.5, nb.x, far + dir * 3.5, 2.3);
        else if (!(g[i - 1] && g[i - 1].len <= 0.25 + 1e-9)) this.b.line(a.x, far + dir * 3.5, a.x + (i === 0 ? 4 : -4), far + dir * 3.5, 2.3);
      }
    }
  }
}

const hat = (beat: number, len = 0.5, extra: { pos: number; x?: boolean }[] = []): Ev => ({ beat, len, heads: [{ pos: 9, x: true }, ...extra] });
const kick = (beat: number, len = 1): Ev => ({ beat, len, heads: [{ pos: 1 }] });
const SNARE = { pos: 5 };

/** 8비트: 하이햇 8분, 2·4박 스네어, 1·3박 킥 */
function rockBar(st: Staff, x0: number, x1: number) {
  st.voice(x0, x1, 'up', [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => hat(b, 0.5, b === 1 || b === 3 ? [SNARE] : [])));
  st.voice(x0, x1, 'down', [kick(0), kick(1), kick(2), { beat: 3, len: 1 }]);
}

const at = (score: ReturnType<typeof readSheet>['score'], instrument: string) =>
  score.notes.filter((n) => n.instrument === instrument).map((n) => n.step / score.stepsPerBeat);

describe('PDF 드럼 악보 읽기', () => {
  it('기둥 방향으로 손·발 성부를 나누고 빔·쉼표로 박 위치를 구한다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(300);
    st.barline(560);
    rockBar(st, 40, 300);
    // 둘째 마디: 16분음표 하이햇, 점8분+16분 킥, 4박 스네어
    st.voice(300, 560, 'up', [
      ...[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75].map((x) => hat(x, 0.25)),
      { beat: 3, len: 1, heads: [SNARE] },
    ]);
    st.voice(300, 560, 'down', [{ beat: 0, len: 0.75, dot: true, heads: [{ pos: 1 }] }, { beat: 0.75, len: 0.25, heads: [{ pos: 1 }] }, { beat: 1, len: 1 }, { beat: 2, len: 2 }]);
    b.text('= 96', 80, 760);

    const r = readSheet([b.page()]);
    expect(r.score.bpm).toBe(96);
    expect(r.score.bars).toBe(2);
    expect(r.approximated).toBe(0);
    expect(at(r.score, 'hihatClosed')).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75]);
    expect(at(r.score, 'snare')).toEqual([1, 3, 7]);
    expect(at(r.score, 'kick')).toEqual([0, 1, 2, 4, 4.75]);
  });

  it('셋잇단 숫자 3이 붙은 빔 묶음은 2/3 길이로 읽는다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    // 매 박 셋잇단 8분음표 하이햇 (숫자 3은 빔 위에)
    const evs: Ev[] = [];
    for (let beat = 0; beat < 4; beat++) for (let k = 0; k < 3; k++) evs.push(hat(beat + k / 3, 0.5));
    st.voice(40, 560, 'up', evs);
    for (let beat = 0; beat < 4; beat++) b.text('3', 40 + 8 + ((beat + 1 / 3) * (520 - 16)) / 4 + 3, st.top + 6.8 * S, 8);
    st.voice(40, 560, 'down', [kick(0), kick(1), kick(2), kick(3)]);
    const r = readSheet([b.page()]);
    expect(r.score.stepsPerBeat).toBe(3);
    expect(at(r.score, 'hihatClosed').map((x) => +x.toFixed(3))).toEqual(evs.map((e) => +e.beat.toFixed(3)));
  });

  it('도돌이표 안의 두 번째 줄(<2x>)은 두 번째 반복 때 친다', () => {
    const b = new PageBuilder();
    const main = new Staff(b, 700);
    const alt = new Staff(b, 640);
    b.text('<2x>', 10, alt.top + 2);
    for (const st of [main, alt]) {
      st.barline(45, 'start');
      st.barline(300);
      st.barline(560, 'end');
    }
    rockBar(main, 45, 300);
    rockBar(main, 300, 560);
    rockBar(alt, 45, 300);
    // 두 번째 반복의 둘째 마디는 탐 4분음표
    alt.voice(300, 560, 'up', [0, 1, 2, 3].map((x) => ({ beat: x, len: 1, heads: [{ pos: 7 }] })));
    alt.voice(300, 560, 'down', [kick(0), kick(1), kick(2), kick(3)]);
    // 두 오선을 잇는 시스템 왼쪽 선
    b.line(40, main.top, 40, alt.bottom);

    const r = readSheet([b.page()]);
    expect(r.writtenBars).toBe(2);
    expect(r.order).toEqual([0, 1, 0, 1]);
    expect(at(r.score, 'tom1')).toEqual([12, 13, 14, 15]);
  });

  it('1·2번 괄호와 D.S. al Coda를 따라 펼친다', () => {
    const b = new PageBuilder();
    // 마디: 0 | 1(세뇨, |:) | 2(To Coda) | 3(1번 괄호, :||) | 4(2번 괄호) | 5(D.S. al Coda) | 6(코다)
    const bars = [40, 110, 180, 250, 320, 390, 460, 530];
    const st = new Staff(b, 700, 40, 530);
    bars.slice(1).forEach((x) => st.barline(x, x === 320 ? 'end' : undefined));
    b.line(108.5, st.bottom, 108.5, st.top, 2.4);
    b.glyph('.', 113, st.y(3), 'Maestro', 1.5);
    b.glyph('.', 113, st.y(5), 'Maestro', 1.5);
    const pos = [5, 6, 7, 3, 8, 5, 10];
    for (let i = 0; i < 7; i++) st.voice(bars[i], bars[i + 1], 'up', [{ beat: 0, len: 1, heads: [{ pos: pos[i], x: i === 6 }] }, { beat: 1, len: 1 }, { beat: 2, len: 2 }]);
    b.glyph('%', 115, st.top + 8 * S);
    b.text('To Coda', 200, st.top + 8 * S);
    b.text('1.', 255, st.top + 6 * S);
    b.line(252, st.top + 8 * S, 315, st.top + 8 * S);
    b.text('2.', 325, st.top + 6 * S);
    b.line(322, st.top + 8 * S, 385, st.top + 8 * S);
    b.text('D.S. al Coda', 395, st.bottom - 6 * S);
    b.glyph('\u00d8', 470, st.top + 8 * S);
    const r = readSheet([b.page()]);
    // 0 1 2 3 | (반복) 1 2 4 5 | (D.S.) 1 2 → 코다 6
    expect(r.order).toEqual([0, 1, 2, 3, 1, 2, 4, 5, 1, 2, 6]);
  });

  it('첫 마디가 못갖춘마디면 마디 끝에 붙인다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(200);
    st.barline(560);
    // 1박짜리 못갖춘마디: 4분음표 스네어 하나 (x 간격은 박 단위로만 쓰인다)
    st.voice(40, 200, 'up', [{ beat: 0, len: 1, heads: [SNARE] }]);
    rockBar(st, 200, 560);
    const r = readSheet([b.page()]);
    expect(at(r.score, 'snare')).toEqual([3, 5, 7]);
  });

  it('6잇단 괄호 안의 음표와 쉼표를 모두 2/3 길이로 읽고, 모든 음이 들어가는 박 나눔을 고른다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    const xOf = (beat: number) => 40 + 8 + (beat * (520 - 16)) / 4;
    // 1박: 스네어 6잇단 16분 (S r S r S S), 2박 4분쉼표, 3~4박 2분쉼표
    const slots: Ev[] = [0, 2, 4, 5].map((k) => ({ beat: k / 6, len: 0.25, heads: [SNARE] }));
    st.voice(40, 560, 'up', [...slots, { beat: 1 / 6, len: 0.25 }, { beat: 3 / 6, len: 0.25 }, { beat: 1, len: 1 }, { beat: 2, len: 2 }]);
    st.voice(40, 560, 'down', [kick(0), kick(1), kick(2), kick(3)]);
    // 괄호: 숫자 6 양옆 가로선, 양 끝은 음표 쪽(아래)으로 꺾인다
    const y = st.top + 6.5 * S;
    const mid = xOf(0.4);
    b.text('6', mid - 2, y - 3, 8);
    b.line(xOf(0) - 2, y, mid - 4, y);
    b.line(mid + 6, y, xOf(5 / 6) + 8, y);
    b.line(xOf(0) - 2, y, xOf(0) - 2, y - 4);
    b.line(xOf(5 / 6) + 8, y, xOf(5 / 6) + 8, y - 4);
    const r = readSheet([b.page()]);
    expect(r.approximated).toBe(0);
    expect(r.score.stepsPerBeat).toBe(6);
    expect(at(r.score, 'snare').map((x) => +x.toFixed(4))).toEqual([0, 1 / 3, 2 / 3, 5 / 6].map((x) => +x.toFixed(4)));
    expect(at(r.score, 'kick')).toEqual([0, 1, 2, 3]);
  });

  it('트레몰로 빗금은 음 길이 동안 쪼개 치고, 음표 위의 R·L 글자는 그 손으로 친다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    // 1·2박 스네어 4분음표, 3박 스네어 4분음표 + 트레몰로 빗금 두 줄(SMuFL tremolo2) = 16분음표 4개, 4박 쉼
    st.voice(40, 560, 'up', [...[0, 1, 2].map((x): Ev => ({ beat: x, len: 1, heads: [SNARE] })), { beat: 3, len: 1 }]);
    st.voice(40, 560, 'down', [kick(0), kick(1), kick(2), kick(3)]);
    const xOf = (beat: number) => 40 + 8 + (beat * (520 - 16)) / 4;
    b.glyph('\ue221', xOf(2) + HEAD - 2, st.top + 3 * S, 'Leland', 4);
    // 스티킹: 1박 L, 2박 R
    b.text('L', xOf(0) + 1, st.top + 9 * S, 9);
    b.text('R', xOf(1) + 1, st.top + 9 * S, 9);
    const r = readSheet([b.page()]);
    const snares = r.score.notes.filter((n) => n.instrument === 'snare');
    expect(snares.map((n) => n.step / r.score.stepsPerBeat)).toEqual([0, 1, 2, 2.25, 2.5, 2.75]);
    expect(snares.slice(0, 3).map((n) => n.hand)).toEqual(['L', 'R', undefined]);
  });

  it('스네어 자리의 동그라미 X는 림샷', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    st.voice(40, 560, 'up', [0, 1, 2, 3].map((x) => ({ beat: x, len: 1, heads: [SNARE] })));
    // 둘째 박 머리를 동그라미 X로 바꾼다 (MaestroPercussion Ù 자리)
    const head = b.glyphs.find((g) => g.char === '\u0153' && Math.abs(g.x - (40 + 8 + (1 * 504) / 4)) < 0.5)!;
    head.char = '\u00d9';
    const r = readSheet([b.page()]);
    expect(r.score.notes.map((n) => n.instrument)).toEqual(['snare', 'rimshot', 'snare', 'snare']);
  });

  it('작은 꾸밈음이 앞에 붙은 음은 플램으로 읽는다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    rockBar(st, 40, 560);
    // 2박 스네어 앞의 작은 꾸밈음(같은 높이, 크기 60%)
    const x = 40 + 8 + (1 * (520 - 16)) / 4;
    b.glyph('\u0153', x - 9, st.y(5), 'MaestroPercussion', HEAD * 0.6, 12);
    b.line(x - 9 + HEAD * 0.6, st.y(5), x - 9 + HEAD * 0.6, st.y(5) + 2.5 * S);
    const r = readSheet([b.page()]);
    const snares = r.score.notes.filter((n) => n.instrument === 'snare');
    expect(snares.map((n) => [n.step / r.score.stepsPerBeat, !!n.flam])).toEqual([[1, true], [3, false]]);
  });

  it('여러 마디 쉼표는 위에 적힌 수만큼 쉰다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(200);
    st.barline(380);
    st.barline(560);
    rockBar(st, 40, 200);
    b.glyph('', 220, st.y(4), 'Bravura', 140);
    b.text('3', 287, st.top + 2 * S);
    rockBar(st, 380, 560);
    const { score } = readSheet([b.page()]);
    expect(score.bars).toBe(5);
    expect(at(score, 'snare')).toEqual([1, 3, 17, 19]);
  });

  it('곡 중간에 바뀐 박자표를 마디 길이에 반영한다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(300);
    st.barline(560);
    rockBar(st, 40, 300);
    // 둘째 마디는 3/4: 박자표 숫자(SMuFL) 뒤에 4분음표 스네어 셋
    b.glyph('\ue083', 304, st.y(6), 'Bravura', 6, 20);
    b.glyph('\ue084', 304, st.y(2), 'Bravura', 6, 20);
    for (const x of [330, 405, 480]) {
      b.glyph('œ', x, st.y(5), 'MaestroPercussion');
      b.line(x + HEAD, st.y(5), x + HEAD, st.top + 6 * S);
    }
    const { score } = readSheet([b.page()]);
    expect(score.barBeats).toEqual([4, 3]);
    expect(at(score, 'snare')).toEqual([1, 3, 4, 5, 6]);
  });

  it('두 마디 반복(•//•)은 앞의 두 마디를 그대로 친다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    for (const x of [170, 300, 430, 560]) st.barline(x);
    rockBar(st, 40, 170);
    // 둘째 마디: 4박 모두 스네어
    st.voice(170, 300, 'up', [0, 1, 2, 3].map((beat) => ({ beat, len: 1, heads: [SNARE] })));
    // 셋째·넷째 마디 사이 마디줄 위의 두 마디 반복 기호
    b.glyph('\ue501', 415, st.y(4), 'Bravura', 30, 20);
    const { score } = readSheet([b.page()]);
    expect(score.bars).toBe(4);
    expect(at(score, 'snare')).toEqual([1, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 15]);
  });

  it('음마다 악보 기호(머리 모양·자리)를 남긴다', () => {
    const b = new PageBuilder();
    const st = new Staff(b, 700);
    st.barline(560);
    rockBar(st, 40, 560);
    const { score } = readSheet([b.page()]);
    expect(new Set(score.notes.map((n) => n.mark))).toEqual(new Set(['x:9', 'black:5', 'black:1']));
  });

  it('악보가 없는 PDF는 알려 준다', () => {
    expect(() => readSheet([{ width: 600, height: 840, glyphs: [], segments: [] }])).toThrow(/악보를 찾지 못했어요/);
  });
});
